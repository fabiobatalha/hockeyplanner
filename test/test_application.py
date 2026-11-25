import os
import unittest
from pathlib import Path
from queue import Queue
from tempfile import TemporaryDirectory
from threading import Event
from unittest.mock import patch
from uuid import uuid4

from hockeyplanner import Accounts, create_app, open_database
from hockeyplanner.email_tasks import EmailTasks
from hockeyplanner.models import Credentials


PASSWORD = "Strong!Password"


class ApplicationTestCase(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"HOCKEYPLANNER_PUBLIC_URL": "https://hockeyplanner.ca"}))
        self.database = Path(directory) / "planner.sqlite3"
        self.sessions = open_database(self.database)
        self.addCleanup(self.sessions.kw["bind"].dispose)
        self.email_tasks = EmailTasks()
        self.addCleanup(self.email_tasks.executor.shutdown)

    def create_app(self, **options):
        with (
            patch("hockeyplanner.open_database", return_value=self.sessions),
            patch("hockeyplanner.EmailTasks", return_value=self.email_tasks),
        ):
            app = create_app(self.database, **options)
        app.testing = True
        return app

    def account(self, username):
        return Accounts(self.sessions).create(
            Credentials(username=username, password=PASSWORD), email=f"{username}@example.com",
        )

    def sign_in(self, client, identifier):
        response = client.post("/api/login", json={"identifier": identifier, "password": PASSWORD})
        self.assert_status(response, 204)

    def assert_status(self, response, expected):
        self.assertEqual(response.status_code, expected, response.get_data(as_text=True))


class PageAndAccountTests(ApplicationTestCase):
    def test_welcome_page_and_protected_library(self):
        client = self.create_app().test_client()
        self.account("coach")
        welcome = client.get("/")
        self.assert_status(welcome, 200)
        self.assertIn(b"More Than a Game. A Community.", welcome.data)
        self.assertIn(b'data-public-root="https://hockeyplanner.ca/"', welcome.data)
        self.assert_status(client.get("/drills"), 401)

        self.sign_in(client, "COACH@EXAMPLE.COM")
        self.assertEqual(client.get("/").location, "/editor")
        self.assert_status(client.get("/drills"), 200)
        self.assert_status(client.get("/plans"), 200)
        self.assert_status(client.post("/api/logout"), 204)
        self.assert_status(client.get("/drills"), 401)

    def test_confirmation_is_queued_and_requires_a_valid_code(self):
        deliveries = Queue()
        release = Event()
        finished = Event()
        self.addCleanup(release.set)

        def deliver(address, code, token):
            deliveries.put((address, code, token))
            release.wait(timeout=5)
            finished.set()

        client = self.create_app(send_confirmation=deliver).test_client()
        response = client.post("/api/register", json={
            "username": "coach", "email": "coach@example.com", "password": PASSWORD,
        })
        self.assert_status(response, 202)
        address, code, token = deliveries.get(timeout=5)
        self.assertFalse(finished.is_set(), "The request waited for email delivery to finish.")
        release.set()
        self.assertTrue(finished.wait(timeout=5))
        self.assertEqual(address, "coach@example.com")
        self.assertRegex(code, r"^\d{6}$")

        wrong = "000001" if code == "000000" else "000000"
        self.assert_status(client.post("/api/confirm-email", json={"token": token, "code": wrong}), 400)
        self.assert_status(client.post("/api/confirm-email", json={"token": token, "code": code}), 200)
        self.assertEqual(client.get("/api/account").json["user"]["email"], address)
        self.assert_status(client.post("/api/confirm-email", json={"token": token, "code": code}), 400)

    def test_password_reset_is_single_use_and_unknown_addresses_get_same_response(self):
        deliveries = Queue()
        client = self.create_app(send_password_reset=lambda *parts: deliveries.put(parts)).test_client()
        self.account("coach")

        unknown = client.post("/api/forgot-password", json={"email": "unknown@example.com"})
        known = client.post("/api/forgot-password", json={"email": "coach@example.com"})
        self.assert_status(unknown, 202)
        self.assert_status(known, 202)
        self.assertEqual(unknown.data, known.data)
        address, token = deliveries.get(timeout=5)
        self.assertEqual(address, "coach@example.com")

        update = {"token": token, "new_password": "New!StrongPassword"}
        self.assert_status(client.post("/api/reset-password", json=update), 204)
        self.assert_status(client.post("/api/reset-password", json=update), 400)
        self.assert_status(client.post("/api/login", json={"identifier": "coach", "password": PASSWORD}), 401)
        self.assert_status(client.post("/api/login", json={"identifier": "coach", "password": update["new_password"]}), 204)


class LibraryTests(ApplicationTestCase):
    @staticmethod
    def drill(title="Passing drill"):
        return {"id": str(uuid4()), "title": title, "description": "", "items": []}

    def test_free_drill_limit_allows_updates_at_capacity(self):
        app = self.create_app()
        self.account("admin")
        self.account("coach")
        coach = app.test_client()
        self.sign_in(coach, "coach")

        for _ in range(20):
            drill = self.drill()
            self.assert_status(coach.put(f"/api/drills/{drill['id']}", json=drill), 204)

        extra = self.drill()
        response = coach.put(f"/api/drills/{extra['id']}", json=extra)
        self.assert_status(response, 409)
        self.assertEqual(response.json["capacity"]["limit"], 20)
        self.assert_status(coach.put(f"/api/drills/{drill['id']}", json=drill | {"title": "Updated"}), 204)

    def test_platform_drills_are_read_only_and_copies_are_independent(self):
        app = self.create_app()
        owner_id = self.account("admin")
        self.account("coach")
        owner, coach, guest = (app.test_client() for _ in range(3))
        self.sign_in(owner, "admin")
        self.sign_in(coach, "coach")

        original = self.drill()
        path = f"/api/drills/{original['id']}"
        platform = f"/api/platform-drills/{owner_id}/{original['id']}"
        self.assert_status(owner.put(path, json=original), 204)
        self.assert_status(coach.put(path + "/platform"), 403)
        self.assert_status(owner.put(path + "/platform"), 204)
        self.assert_status(coach.put(path, json=original), 403)

        token = coach.get(platform + "/link").json["token"]
        self.assert_status(guest.get(f"/share/{token}/drill/{original['id']}"), 200)
        copy_id = str(uuid4())
        self.assert_status(coach.post(platform + "/copy", json={"id": copy_id}), 201)
        copy, = coach.get("/api/library").json["drills"]
        self.assertEqual(copy["id"], copy_id)
        self.assertNotIn("platformSource", copy)
        self.assert_status(coach.put(f"/api/drills/{copy_id}", json=copy | {"title": "My drill"}), 204)
        self.assertEqual(owner.get("/api/library").json["drills"][0]["title"], original["title"])

    def test_shared_plan_opens_for_guests_and_can_be_copied(self):
        app = self.create_app()
        owner_id = self.account("owner")
        self.account("recipient")
        owner, recipient, guest = (app.test_client() for _ in range(3))
        self.sign_in(owner, "owner")
        self.sign_in(recipient, "recipient")

        drill = self.drill()
        plan = {"id": str(uuid4()), "name": "Practice plan", "activities": [drill]}
        path = f"/api/plans/{plan['id']}"
        self.assert_status(owner.put(f"/api/drills/{drill['id']}", json=drill), 204)
        self.assert_status(owner.put(path, json=plan), 200)
        link = owner.put(path + "/link")
        self.assert_status(link, 200)
        token = link.json["token"]
        self.assert_status(guest.get(f"/share/{token}/present"), 200)
        self.assert_status(recipient.post("/api/shared-plans/claim", json={"token": token}), 204)

        copy_id = str(uuid4())
        self.assert_status(recipient.post(f"/api/shared-plans/{owner_id}/{plan['id']}/copy", json={"id": copy_id}), 201)
        library = recipient.get("/api/library").json
        copy, = library["plans"]
        copied_drill, = library["drills"]
        self.assertEqual(copy["id"], copy_id)
        self.assertNotEqual(copied_drill["id"], drill["id"])
        self.assertEqual(copy["activities"][0]["id"], copied_drill["id"])

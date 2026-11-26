import json
import os
import re
import unittest
from pathlib import Path
from queue import Queue
from tempfile import TemporaryDirectory
from threading import Event
from unittest.mock import patch
from uuid import UUID, uuid4

from hockeyplanner import Accounts, create_app, open_database
from hockeyplanner.database import LibraryRecord, UserPublicIdentity
from hockeyplanner.library import Library
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
    def test_guests_can_edit_the_sample_but_need_an_account_to_save(self):
        app = self.create_app()
        guest = app.test_client()
        self.assertIn(b'href="/demo"', guest.get("/").data)
        demo = guest.get("/demo")
        self.assert_status(demo, 200)
        self.assertIn(b"Breakout passing", demo.data)
        self.assertIn(b"Create an account to save", demo.data)
        self.assertIn(b'id="preview-demo"', demo.data)
        self.assertEqual(guest.get("/editor/demo-draft").location, "/login?next=/editor/demo-draft")
        self.assert_status(guest.put(f"/api/drills/{uuid4()}", json={}), 401)

        self.account("coach")
        self.sign_in(guest, "coach")
        draft = guest.get("/editor/demo-draft")
        self.assert_status(draft, 200)
        self.assertIn(b"data-restore-demo", draft.data)

    def test_language_cookie_and_account_preference(self):
        app = self.create_app()
        client = app.test_client()
        response = client.get("/login", headers={"Accept-Language": "fr-CA"})
        self.assertIn(b'lang="fr-CA"', response.data)
        self.assertIn(b"Se connecter", response.data)
        browser_json = re.search(r'id="browser-translations" type="application/json">(.*?)</script>',
                                 response.get_data(as_text=True)).group(1)
        self.assertEqual(json.loads(browser_json)["Movement Legend"], "Légende des mouvements")

        response = client.post("/language", data={"language": "en", "next": "/login?next=/plans"})
        self.assert_status(response, 303)
        self.assertEqual(response.location, "/login?next=/plans")
        self.assertIn(b'lang="en"', client.get("/login", headers={"Accept-Language": "fr"}).data)

        self.account("coach")
        self.sign_in(client, "coach")
        self.assert_status(client.post("/language", data={"language": "fr-CA", "next": "/editor"}), 303)
        another_browser = app.test_client()
        self.sign_in(another_browser, "coach")
        self.assertIn(b'lang="fr-CA"', another_browser.get("/editor", headers={"Accept-Language": "en"}).data)
        self.assertIn("Éditeur d’exercices", another_browser.get("/editor").get_data(as_text=True))

    def test_language_selection_checks_locale_and_redirect(self):
        client = self.create_app().test_client()
        self.assert_status(client.post("/language", data={"language": "invalid"}), 400)
        response = client.post("/language", data={"language": "en", "next": "//example.com"})
        self.assertEqual(response.location, "/")

    def test_browser_language_priority_handles_regional_variants(self):
        client = self.create_app().test_client()
        for header, expected in (("en-US,fr-CA;q=0.8", "en"), ("fr-FR,en;q=0.8", "fr-CA")):
            with self.subTest(header=header):
                response = client.get("/login", headers={"Accept-Language": header})
                self.assertIn(f'lang="{expected}"'.encode(), response.data)

    def test_confirmation_email_uses_request_language_in_the_worker(self):
        deliveries = Queue()
        client = self.create_app().test_client()
        with (
            patch("hockeyplanner.email_confirmation.smtp_settings"),
            patch("hockeyplanner.email_confirmation.send_email", side_effect=lambda *parts: deliveries.put(parts)),
        ):
            response = client.post("/api/register", headers={"Accept-Language": "fr-CA"}, json={
                "username": "coach", "email": "coach@example.com", "password": PASSWORD,
            })
            self.assert_status(response, 202)
            address, subject, body = deliveries.get(timeout=5)
        self.assertEqual(address, "coach@example.com")
        self.assertIn("Confirmez", subject)
        self.assertIn("code à six chiffres", body)
        self.assertIn("https://hockeyplanner.ca/confirm-email/", body)

    def test_regular_account_cannot_manage_another_account_with_its_exact_id(self):
        app = self.create_app()
        admin, coach, guest = (app.test_client() for _ in range(3))
        self.account("admin")
        self.account("coach")
        self.sign_in(admin, "admin")
        self.sign_in(coach, "coach")
        target_id = admin.get("/api/account").json["user"]["id"]
        path = f"/api/admin/users/{target_id}"
        changes = {"role": "user", "enabled": False}
        self.assert_status(guest.delete(path), 401)
        self.assert_status(coach.get("/api/admin/users"), 403)
        self.assert_status(coach.put(path, json=changes), 403)
        self.assert_status(coach.delete(path), 403)
        self.assertEqual(admin.get("/api/account").json["user"]["role"], "poweruser")

    def test_admin_actions_use_public_uuids(self):
        app = self.create_app()
        self.account("admin")
        internal_id = self.account("coach")
        admin = app.test_client()
        self.sign_in(admin, "admin")
        users = admin.get("/api/admin/users").json["users"]
        target = next(user for user in users if user["username"] == "coach")
        self.assertEqual(UUID(target["id"]).version, 4)
        path = f"/api/admin/users/{target['id']}"
        changes = {"role": "user", "enabled": False}
        self.assert_status(admin.put(f"/api/admin/users/{internal_id}", json=changes), 404)
        self.assert_status(admin.put(f"/api/admin/users/{uuid4()}", json=changes), 404)
        updated = admin.put(path, json=changes)
        self.assert_status(updated, 200)
        self.assertEqual(updated.json["user"]["id"], target["id"])
        self.assertFalse(updated.json["user"]["enabled"])
        self.assert_status(admin.delete(path), 204)
        self.assert_status(admin.delete(path), 404)

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
            "return_to": "/editor/demo-draft",
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
        confirmed = client.post("/api/confirm-email", json={"token": token, "code": code})
        self.assert_status(confirmed, 200)
        self.assertEqual(confirmed.json["return_to"], "/editor/demo-draft")
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
        self.account("admin")
        self.account("coach")
        owner, coach, guest = (app.test_client() for _ in range(3))
        self.sign_in(owner, "admin")
        self.sign_in(coach, "coach")

        original = self.drill()
        path = f"/api/drills/{original['id']}"
        owner_id = owner.get("/api/account").json["user"]["id"]
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

    def test_existing_accounts_and_platform_snapshots_gain_public_uuids(self):
        owner_id = self.account("admin")
        coach_id = self.account("coach")
        original = self.drill()
        draft = original | {"id": str(uuid4()), "platformSource": {"ownerId": owner_id, "drillId": original["id"]}}
        plan = {"id": str(uuid4()), "name": "Existing plan", "activities": [draft]}

        with self.sessions.begin() as session:
            session.add_all([
                LibraryRecord(owner_id=owner_id, collection="drills", id=original["id"], body=json.dumps(original)),
                LibraryRecord(owner_id=coach_id, collection="plans", id=plan["id"], body=json.dumps(plan)),
            ])
        Library(self.sessions).flag_platform_drill(owner_id, original["id"], True)
        UserPublicIdentity.__table__.drop(self.sessions.kw["bind"])

        first = open_database(self.database)
        self.addCleanup(first.kw["bind"].dispose)
        second = open_database(self.database)
        self.addCleanup(second.kw["bind"].dispose)
        identity = Accounts(first).list_users()[0]
        self.assertEqual(identity.id, owner_id)
        self.assertEqual(identity.public_id.version, 4)
        self.assertEqual(Accounts(second).list_users()[0].public_id, identity.public_id)
        data = Library(second).read(coach_id)
        source = {"ownerId": str(identity.public_id), "drillId": original["id"]}
        self.assertEqual(data["platform_drills"][0]["platformSource"], source)
        self.assertEqual(data["plans"][0]["activities"][0]["platformSource"], source)

    def test_shared_plan_opens_for_guests_and_can_be_copied(self):
        app = self.create_app()
        self.account("owner")
        self.account("recipient")
        owner, recipient, guest = (app.test_client() for _ in range(3))
        self.sign_in(owner, "owner")
        owner_id = owner.get("/api/account").json["user"]["id"]
        self.sign_in(recipient, "recipient")

        drill = self.drill()
        plan = {"id": str(uuid4()), "name": "Practice plan", "activities": [drill | {"duration_minutes": 8}]}
        path = f"/api/plans/{plan['id']}"
        self.assert_status(owner.put(f"/api/drills/{drill['id']}", json=drill), 204)
        self.assert_status(owner.put(path, json=plan), 200)
        self.assert_status(owner.put(f"/api/drills/{drill['id']}", json=drill | {"title": "Updated drill"}), 204)
        link = owner.put(path + "/link")
        self.assert_status(link, 200)
        token = link.json["token"]
        self.assert_status(guest.get(f"/share/{token}/present"), 200)
        preview = guest.post("/api/shared-plans/preview", json={"token": token})
        self.assert_status(preview, 200)
        self.assertEqual(preview.json["plan"]["activities"][0]["duration_minutes"], 8)
        self.assertEqual(preview.json["plan"]["activities"][0]["title"], "Updated drill")
        self.assert_status(recipient.get(path + "/link"), 404)
        self.assert_status(recipient.get(f"/api/shared-plans/{owner_id}/{plan['id']}/link"), 404)
        self.assert_status(recipient.post(
            f"/api/shared-plans/{owner_id}/{plan['id']}/copy", json={"id": str(uuid4())},
        ), 404)
        self.assert_status(recipient.post("/api/shared-plans/claim", json={"token": token}), 204)

        copy_id = str(uuid4())
        self.assert_status(recipient.post(f"/api/shared-plans/{owner_id}/{plan['id']}/copy", json={"id": copy_id}), 201)
        library = recipient.get("/api/library").json
        copy, = library["plans"]
        copied_drill, = library["drills"]
        self.assertEqual(copy["id"], copy_id)
        self.assertNotEqual(copied_drill["id"], drill["id"])
        self.assertEqual(copy["activities"][0]["id"], copied_drill["id"])
        self.assertEqual(copy["activities"][0]["duration_minutes"], 8)
        self.assertNotIn("duration_minutes", copied_drill)

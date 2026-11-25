import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from pydantic import ValidationError

from hockeyplanner.library import resolve_platform_drills, valid_id
from hockeyplanner.models import Login, Registration
from hockeyplanner.public_urls import public_base_url


class ValidationTests(unittest.TestCase):
    def test_registration_requires_email_and_a_strong_password(self):
        valid = {"username": "Coach", "email": "coach@example.com", "password": "Strong!Password"}
        self.assertEqual(Registration.model_validate(valid).email, valid["email"])

        for changes in (
            {"email": ""},
            {"password": "Short!Pwd"},
            {"password": "lowercase!password"},
            {"password": "NoSpecialCharacter"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                Registration.model_validate(valid | changes)

    def test_login_normalizes_email(self):
        login = Login(identifier=" Coach@Example.COM ", password="Strong!Password")
        self.assertEqual(login.identifier, "coach@example.com")

    def test_canonical_ids(self):
        value = str(uuid4())
        self.assertTrue(valid_id(value))
        self.assertFalse(valid_id(value.replace("-", "")))
        self.assertFalse(valid_id("not-a-uuid"))

    def test_public_base_url_accepts_a_path_and_rejects_unsafe_values(self):
        with patch.dict(os.environ, {"HOCKEYPLANNER_PUBLIC_URL": "https://hockeyplanner.ca/planner/"}):
            self.assertEqual(public_base_url(), "https://hockeyplanner.ca/planner/")
        for url in ("javascript:alert(1)", "https://user:pass@example.com", "https://example.com/#fragment", "//example.com"):
            with self.subTest(url=url), patch.dict(os.environ, {"HOCKEYPLANNER_PUBLIC_URL": url}):
                with self.assertRaises(ValueError):
                    public_base_url()

    def test_platform_snapshot_uses_current_content_and_keeps_its_plan_id(self):
        source = {"ownerId": 1, "drillId": "original"}
        snapshot = {"id": "plan-item", "title": "Old title", "platformSource": source}
        current = {"id": "original", "title": "Updated title"}
        self.assertEqual(resolve_platform_drills([snapshot], {(1, "original"): current}), [
            {"id": "plan-item", "title": "Updated title", "platformSource": source},
        ])
        self.assertEqual(resolve_platform_drills([snapshot], {}), [snapshot])

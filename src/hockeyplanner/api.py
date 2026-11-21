import re
import time
from threading import Lock
from urllib.parse import urlsplit

from flask import Blueprint, Response, abort, g, jsonify, make_response, request
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException

from .accounts import SESSION_AGE, AccountNotFound, Accounts, AdministrationDenied, EmailTaken, IncorrectPassword, UsernameTaken
from .library import MODELS, Library, valid_id
from .models import PASSWORD_REQUIREMENTS, AccountStatus, AccountUpdate, EmailUpdate, LibraryImport, Login, PasswordChange, Registration, PlanCopyRequest, PlanLinkClaim, PlanShareRequest
from .sharing import ShareNotFound, Sharing


SESSION_COOKIE = "hockeyplanner_session"


class LoginLimiter:
    def __init__(self) -> None:
        self.lock = Lock()
        self.attempts = {}

    def allow(self, address: str) -> bool:
        now = time.monotonic()
        with self.lock:
            self.attempts = {key: value for key, value in self.attempts.items() if value[0] > now - 60}
            start, count = self.attempts.get(address, (now, 0))
            self.attempts[address] = (start, count + 1)
            return count < 15


def session_token() -> str | None:
    token = request.cookies.get(SESSION_COOKIE, "")
    return token if re.fullmatch(r"[A-Za-z0-9_-]{43}", token) else None


def create_api(library: Library, accounts: Accounts, sharing: Sharing, secure_cookies: bool) -> Blueprint:
    api = Blueprint("planner_api", __name__, url_prefix="/api")
    limiter = LoginLimiter()

    @api.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @api.errorhandler(ValidationError)
    @api.errorhandler(ValueError)
    @api.errorhandler(RecursionError)
    def invalid_data(error):
        if isinstance(error, ValidationError) and any(item["type"] == "password_policy" for item in error.errors()):
            return jsonify(error=PASSWORD_REQUIREMENTS), 400
        return jsonify(error="Invalid data. Check your input and try again."), 400

    @api.errorhandler(UsernameTaken)
    def duplicate_username(_error):
        return jsonify(error="This username is already taken."), 409

    @api.errorhandler(EmailTaken)
    def duplicate_email(_error):
        return jsonify(error="That email address is already in use."), 409

    @api.errorhandler(IncorrectPassword)
    def incorrect_password(_error):
        return jsonify(error="Incorrect current password."), 403

    @api.errorhandler(ShareNotFound)
    def share_not_found(error):
        return jsonify(error=str(error)), 404

    @api.errorhandler(SQLAlchemyError)
    def database_error(_error):
        return jsonify(error="The application database is unavailable."), 503

    @api.before_request
    def authorize():
        origin = request.headers.get("Origin")
        if request.method in {"POST", "PUT", "DELETE"} and origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != request.host.lower():
                abort(403, "This request must come from the planner.")
        if request.endpoint not in {"planner_api.login", "planner_api.register", "planner_api.logout"}:
            g.user = accounts.get_user(session_token())
            if request.endpoint != "planner_api.account" and g.user is None:
                abort(401, "Sign in to continue.")
            if request.endpoint not in {"planner_api.account", "planner_api.update_email"} and not g.user.email:
                abort(403, "Add an email address to your account to continue.")
            if request.path.startswith("/api/admin/") and g.user.role != "poweruser":
                abort(403, "Poweruser access is required.")

    @api.after_request
    def prevent_caching(response):
        response.cache_control.no_store = True
        return response

    def session_response(token: str | None) -> Response:
        response = make_response("", 204)
        options = {"path": "/", "httponly": True, "samesite": "Strict", "secure": secure_cookies or request.is_secure}
        if token:
            response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_AGE, **options)
        else:
            response.delete_cookie(SESSION_COOKIE, **options)
        return response

    def credential_payload():
        if not limiter.allow(request.remote_addr or ""):
            abort(429, "Too many attempts. Try again in a minute.")
        request.max_content_length = 4096
        return request.get_json()

    @api.get("/account")
    def account():
        return jsonify(AccountStatus(user=g.user).model_dump())

    @api.put("/account/email")
    def update_email():
        changes = EmailUpdate.model_validate(credential_payload())
        return jsonify(email=accounts.update_email(g.user.id, changes))

    @api.put("/account/password")
    def change_password():
        changes = PasswordChange.model_validate(credential_payload())
        return session_response(accounts.change_password(g.user.id, changes))

    @api.post("/register")
    def register():
        try:
            details = Registration.model_validate(credential_payload())
        except ValidationError as error:
            if any(item["type"] == "password_policy" for item in error.errors()):
                raise
            abort(400, "Use a username of 3–32 letters, numbers, dots, underscores or hyphens and a valid email address. " + PASSWORD_REQUIREMENTS)
        user_id = accounts.create(details, email=details.email)
        return session_response(accounts.start_session(user_id, session_token()))

    @api.post("/login")
    def login():
        try:
            user = accounts.authenticate(Login.model_validate(credential_payload()))
        except ValidationError:
            user = None
        token = accounts.start_session(user.id, session_token(), user.password_hash) if user else None
        if token is None:
            abort(401, "Incorrect username, email, or password.")
        return session_response(token)

    @api.post("/logout")
    def logout():
        accounts.end_session(session_token())
        return session_response(None)

    @api.get("/admin/users")
    def list_users():
        return jsonify(users=[user.model_dump() for user in accounts.list_users()])

    @api.put("/admin/users/<int:user_id>")
    def update_user(user_id: int):
        request.max_content_length = 4096
        changes = AccountUpdate.model_validate(request.get_json())
        try:
            updated = accounts.update_user(g.user.id, user_id, changes)
        except AdministrationDenied as error:
            abort(403, str(error))
        except AccountNotFound:
            abort(404, "User account not found.")
        return jsonify(user=updated.model_dump())

    @api.get("/library")
    def read_library():
        return jsonify(library.read(g.user.id))

    @api.post("/library/import")
    def import_library():
        library.import_legacy(g.user.id, LibraryImport.model_validate(request.get_json()))
        return "", 204

    @api.get("/plans/<uuid:plan_id>/shares")
    def plan_recipients(plan_id):
        return jsonify(recipients=sharing.recipients(g.user.id, str(plan_id)))

    @api.post("/plans/<uuid:plan_id>/shares")
    def share_plan(plan_id):
        request.max_content_length = 4096
        details = PlanShareRequest.model_validate(request.get_json())
        sharing.share(g.user.id, str(plan_id), details.username)
        return "", 204

    @api.delete("/plans/<uuid:plan_id>/shares/<int:recipient_id>")
    def revoke_plan_share(plan_id, recipient_id):
        sharing.revoke(g.user.id, str(plan_id), recipient_id)
        return "", 204

    @api.get("/plans/<uuid:plan_id>/link")
    def read_plan_link(plan_id):
        return jsonify(token=sharing.get_link(g.user.id, str(plan_id)))

    @api.put("/plans/<uuid:plan_id>/link")
    def create_plan_link(plan_id):
        return jsonify(token=sharing.create_link(g.user.id, str(plan_id)))

    @api.delete("/plans/<uuid:plan_id>/link")
    def disable_plan_link(plan_id):
        sharing.disable_link(g.user.id, str(plan_id))
        return "", 204

    @api.post("/shared-plans/preview")
    def preview_plan_link():
        request.max_content_length = 4096
        claim = PlanLinkClaim.model_validate(request.get_json())
        return jsonify(sharing.preview_link(claim.token))

    @api.post("/shared-plans/claim")
    def claim_plan_link():
        request.max_content_length = 4096
        claim = PlanLinkClaim.model_validate(request.get_json())
        sharing.claim_link(g.user.id, claim.token)
        return "", 204

    @api.get("/shared-plans")
    def shared_plans():
        return jsonify(plans=sharing.incoming(g.user.id))

    @api.delete("/shared-plans/<int:owner_id>/<uuid:plan_id>")
    def leave_shared_plan(owner_id, plan_id):
        sharing.revoke(owner_id, str(plan_id), g.user.id)
        return "", 204

    @api.post("/shared-plans/<int:owner_id>/<uuid:plan_id>/copy")
    def copy_shared_plan(owner_id, plan_id):
        request.max_content_length = 4096
        details = PlanCopyRequest.model_validate(request.get_json())
        return jsonify(plan_id=sharing.copy(g.user.id, owner_id, str(plan_id), str(details.id))), 201

    @api.route("/<collection>/<record_id>", methods=["PUT", "DELETE"])
    def write_library(collection: str, record_id: str):
        model = MODELS.get(collection)
        if model is None or not valid_id(record_id):
            abort(404, "Unknown record.")
        payload = model.model_validate(request.get_json()) if request.method == "PUT" else None
        library.write(g.user.id, collection, record_id, payload)
        return "", 204

    return api

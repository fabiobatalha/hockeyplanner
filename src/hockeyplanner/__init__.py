import argparse
from collections.abc import Callable
from hashlib import sha256
from pathlib import Path

from flask import Flask, render_template, request, url_for
from flask_babel import Babel, gettext
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException

from .accounts import Accounts
from .api import create_api, session_token
from .database import configured_database, open_database
from .email_confirmation import EmailConfirmations, smtp_confirmation
from .email_tasks import EmailTasks
from .library import Library
from .i18n import LANGUAGES, PlannerDomain, browser_catalog, language_tag, request_language
from .pages import create_pages
from .password_reset import PasswordResets, smtp_password_reset
from .public_urls import public_base_url
from .sharing import Sharing


PROJECT_DIR = Path(__file__).resolve().parents[2]


def create_app(
    data_file: Path | None = None, *, secure_cookies: bool = False,
    send_confirmation: Callable[[str, str, str], None] = smtp_confirmation,
    send_password_reset: Callable[[str, str], None] = smtp_password_reset,
) -> Flask:
    web = PROJECT_DIR / "web"
    if not (web / "style.css").is_file():
        raise FileNotFoundError("Web directory not found. Run the editor from the project.")

    app = Flask(__name__, static_folder=str(web), static_url_path="/static")
    public_root = public_base_url()

    @app.context_processor
    def public_link_context():
        language = language_tag()
        return {
            "public_root": public_root, "language": language, "languages": LANGUAGES,
            "browser_translations": browser_catalog(language),
        }

    asset_hash = sha256()
    for asset in sorted(path for path in web.rglob("*") if path.is_file()):
        asset_hash.update(asset.relative_to(web).as_posix().encode())
        asset_hash.update(b"\0")
        asset_hash.update(sha256(asset.read_bytes()).digest())
    version = asset_hash.hexdigest()[:16]

    @app.get(f"/static/{version}/<path:filename>")
    def web_asset(filename):
        return app.send_static_file(filename)

    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    sessions = open_database(data_file or configured_database() or PROJECT_DIR / "data" / "hockeyplanner.sqlite3")
    email_tasks = EmailTasks()
    confirmations = EmailConfirmations(sessions, send_confirmation, email_tasks)
    confirmations.cleanup()
    library, accounts, sharing = Library(sessions), Accounts(sessions), Sharing(sessions)
    babel = Babel(app, locale_selector=lambda: request_language(accounts.session_locale(session_token())).replace("-", "_"))
    babel.domain_instance = PlannerDomain()
    app.register_blueprint(create_api(
        library, accounts, sharing, confirmations,
        PasswordResets(sessions, send_password_reset, email_tasks), secure_cookies,
    ))

    app.register_blueprint(create_pages(accounts, library, sharing))

    @app.errorhandler(HTTPException)
    def http_error(error):
        code = error.code
        server_error = code is not None and 500 <= code < 600
        response = error.get_response()
        if request.path == "/api" or request.path.startswith("/api/"):
            response.set_data(app.json.dumps({
                "error": gettext("The server could not complete the request.") if server_error else error.description,
            }))
            response.mimetype = "application/json"
        elif not request.path.startswith("/static/") and (server_error or code in (401, 404)):
            if code == 401:
                title = gettext("Sign in required")
                message = gettext("Sign in to open this page.")
                action = (gettext("Sign in"), url_for("pages.login", next=request.path))
            elif code == 404:
                title = gettext("Page not found")
                message = error.description if error.description != type(error).description else gettext("This page or shared link may have moved or expired.")
                action = (gettext("Back to Hockey Planner"), url_for("pages.index"))
            else:
                title = gettext("Something went wrong")
                message = gettext("Hockey Planner couldn’t load this page. Try again in a moment.")
                action = (gettext("Try again"), "") if request.method == "GET" else (gettext("Back to Hockey Planner"), url_for("pages.index"))
            response.set_data(render_template(
                "error.html", page="error", title=title, error=message, status_code=code, action=action,
            ))
            response.mimetype = "text/html"
        response.cache_control.no_store = True
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Start Hockey Planner.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--data-file", type=Path)
    parser.add_argument("--secure-cookies", action="store_true", help="Require HTTPS for session cookies.")
    options = parser.parse_args()

    try:
        app = create_app(options.data_file, secure_cookies=options.secure_cookies)
    except (OSError, SQLAlchemyError, ValueError) as error:
        parser.exit(1, f"Could not start the local server: {error}\n")
    app.run(host=options.host, port=options.port)

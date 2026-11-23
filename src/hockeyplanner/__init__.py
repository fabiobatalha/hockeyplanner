import argparse
from collections.abc import Callable
from hashlib import sha256
from pathlib import Path

from flask import Flask
from sqlalchemy.exc import SQLAlchemyError

from .accounts import Accounts
from .api import create_api
from .database import open_database
from .email_confirmation import EmailConfirmations, smtp_confirmation
from .library import Library
from .pages import create_pages
from .password_reset import PasswordResets, smtp_password_reset
from .sharing import Sharing


PROJECT_DIR = Path(__file__).resolve().parents[2]


def create_app(
    data_file: Path | None = None, *, secure_cookies: bool = False,
    send_confirmation: Callable[[str, str, str], None] = smtp_confirmation,
    send_password_reset: Callable[[str, str], None] = smtp_password_reset,
) -> Flask:
    web = PROJECT_DIR / "web"
    style = web / "style.css"
    if not style.is_file():
        raise FileNotFoundError("Web directory not found. Run the editor from the project.")

    app = Flask(__name__, static_folder=str(web), static_url_path="/static")
    version = sha256(style.read_bytes()).hexdigest()[:16]

    @app.get(f"/static/{version}/style.css")
    def stylesheet():
        return app.send_static_file("style.css")

    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    sessions = open_database(data_file or PROJECT_DIR / "data" / "hockeyplanner.sqlite3")
    confirmations = EmailConfirmations(sessions, send_confirmation)
    confirmations.cleanup()
    library, accounts, sharing = Library(sessions), Accounts(sessions), Sharing(sessions)
    app.register_blueprint(create_api(
        library, accounts, sharing, confirmations,
        PasswordResets(sessions, send_password_reset), secure_cookies,
    ))

    app.register_blueprint(create_pages(accounts, library, sharing))

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
    except (OSError, SQLAlchemyError) as error:
        parser.exit(1, f"Could not start the local server: {error}\n")
    app.run(host=options.host, port=options.port)

import argparse
from pathlib import Path

from flask import Flask
from sqlalchemy.exc import SQLAlchemyError

from .accounts import Accounts
from .api import create_api
from .database import open_database
from .library import Library
from .sharing import Sharing


PROJECT_DIR = Path(__file__).resolve().parents[2]


def create_app(data_file: Path | None = None, *, secure_cookies: bool = False) -> Flask:
    web = PROJECT_DIR / "web"
    if not (web / "index.html").is_file():
        raise FileNotFoundError("Web directory not found. Run the editor from the project.")

    app = Flask(__name__, static_folder=str(web), static_url_path="")
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
    sessions = open_database(data_file or PROJECT_DIR / "data" / "hockeyplanner.sqlite3")
    app.register_blueprint(create_api(Library(sessions), Accounts(sessions), Sharing(sessions), secure_cookies))

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

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

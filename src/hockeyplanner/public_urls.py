from os import getenv
from urllib.parse import urlsplit


def public_base_url() -> str:
    url = getenv("HOCKEYPLANNER_PUBLIC_URL", "https://hockeyplanner.ca").strip().rstrip("/")
    parts = urlsplit(url)
    if (
        parts.scheme not in ("http", "https") or not parts.hostname
        or parts.username is not None or parts.password is not None
        or parts.query or parts.fragment or any(character.isspace() for character in url)
        or "\\" in url
    ):
        raise ValueError("HOCKEYPLANNER_PUBLIC_URL must be a public HTTP or HTTPS base URL.")
    return url + "/"

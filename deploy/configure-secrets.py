"""Load deployment settings into Podman without including passwords in the manifests."""

import argparse
import base64
import json
from pathlib import Path
import secrets
import subprocess


def store(name: str, values: dict[str, str], *, replace: bool = False) -> None:
    document = json.dumps({
        key: base64.b64encode(value.encode()).decode("ascii")
        for key, value in values.items()
    })
    command = ["podman", "secret", "create"]
    if replace:
        command.append("--replace")
    subprocess.run([*command, name, "-"], input=document, text=True, check=True, stdout=subprocess.DEVNULL)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("env_file", type=Path, nargs="?", default=Path(".env"))
    args = parser.parse_args()
    application = {}
    for line in args.env_file.read_text().splitlines():
        name, separator, value = line.strip().partition("=")
        if separator and name.startswith("HOCKEYPLANNER_") and not name.startswith("HOCKEYPLANNER_DB_"):
            application[name] = value
    for name in ("hockeyplanner-postgres-admin", "hockeyplanner-postgres-app"):
        exists = subprocess.run(["podman", "secret", "exists", name], check=False)
        if exists.returncode == 1:
            store(name, {"password": secrets.token_urlsafe(32)})
        elif exists.returncode:
            exists.check_returncode()
    store("hockeyplanner-app-environment", application, replace=True)


if __name__ == "__main__":
    main()

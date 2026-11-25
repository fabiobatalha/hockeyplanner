import json
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from babel.messages.mofile import write_mo
from babel.messages.pofile import read_po
from babel.support import Translations
from flask import request
from flask_babel import Domain, get_locale


LANGUAGES = {"en": "English", "fr-CA": "Français (Canada)"}
TRANSLATIONS = Path(__file__).resolve().parent / "translations"
LOCALE_COOKIE = "hockeyplanner_locale"


def request_language(saved: str | None = None) -> str:
    for choice in (saved, request.cookies.get(LOCALE_COOKIE)):
        if choice in LANGUAGES:
            return choice
    for tag, quality in sorted(request.accept_languages, key=lambda item: item[1], reverse=True):
        if quality <= 0:
            continue
        primary = tag.lower().split("-", 1)[0]
        if primary == "fr":
            return "fr-CA"
        if primary == "en":
            return "en"
    return "en"


def language_tag() -> str:
    return str(get_locale() or "en").replace("_", "-")


def locale_directory(language: str) -> Path:
    return TRANSLATIONS / language.replace("-", "_") / "LC_MESSAGES"


def read_catalog(language: str):
    with (locale_directory(language) / "messages.po").open("rb") as source:
        return read_po(source, locale=language.replace("-", "_"), abort_invalid=True)


@lru_cache
def translations(language: str):
    if language == "en":
        return Translations()
    directory = locale_directory(language)
    if (compiled := directory / "messages.mo").is_file():
        with compiled.open("rb") as source:
            return Translations(source)
    binary = BytesIO()
    write_mo(binary, read_catalog(language))
    binary.seek(0)
    return Translations(binary)


def browser_messages(catalog) -> dict:
    return {
        message.id if isinstance(message.id, str) else message.id[0]: message.string
        for message in catalog
        if message.id and message.string and not message.fuzzy
        and any(path.startswith("web/") for path, _ in message.locations)
    }


@lru_cache
def browser_catalog(language: str) -> dict:
    if language == "en":
        return {}
    compiled = locale_directory(language) / "browser.json"
    if compiled.is_file():
        return json.loads(compiled.read_text())
    return browser_messages(read_catalog(language))


class PlannerDomain(Domain):
    def get_translations(self):
        return translations(language_tag())


def email_text(language: str, message: str, **values) -> str:
    text = translations(language).gettext(message)
    return text % values if values else text

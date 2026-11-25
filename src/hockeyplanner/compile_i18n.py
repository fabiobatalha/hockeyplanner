"""Compile versioned translation catalogs into the deployable app."""

import json

from babel.messages.mofile import write_mo

from .i18n import LANGUAGES, browser_messages, locale_directory, read_catalog


def main() -> None:
    for language in LANGUAGES.keys() - {"en"}:
        directory = locale_directory(language)
        catalog = read_catalog(language)
        with (directory / "messages.mo").open("wb") as output:
            write_mo(output, catalog)
        (directory / "browser.json").write_text(
            json.dumps(browser_messages(catalog), ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()

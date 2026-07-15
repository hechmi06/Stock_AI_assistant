"""Extraction du texte principal d'articles de presse (opt-in).

Recoit des URLs en arguments, renvoie sur stdout un JSON : une liste (alignee
sur l'ordre des URLs) contenant le texte extrait ou null. Utilise trafilatura
(robuste sur la mise en page reelle des sites d'actualite).

Degrade proprement : si trafilatura n'est pas installe, si le telechargement
echoue (paywall, anti-bot, timeout) ou si aucun texte n'est extrait, la valeur
est null et l'appelant retombe sur le resume du flux.

Usage : python article_extractor.py <url1> <url2> ...
"""

import json
import sys

MAX_CHARS = 4000

try:
    import trafilatura
except Exception:  # trafilatura non installe : extraction desactivee
    trafilatura = None


def extract(url: str) -> str | None:
    if trafilatura is None or not url:
        return None
    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return None
        text = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=False,
            no_fallback=False,
        )
        if not text:
            return None
        return text.strip()[:MAX_CHARS] or None
    except Exception:
        return None


def main() -> None:
    urls = sys.argv[1:]
    print(json.dumps([extract(url) for url in urls]))


if __name__ == "__main__":
    main()

"""Univers de candidats du PortfolioRecommendationAgent, charge depuis la config.

Le fichier `app/data/universe.json` ne contient AUCUNE donnee de marche : seulement
la liste des titres a examiner (le plateau d'entree) et une eligibilite grossiere
par profil. Tout le jugement (scoring, selection des titres rentables, ponderation)
est fait par les agents sur des donnees reelles collectees a l'execution.

Pourquoi un fichier et pas une API : sur le plan gratuit, aucune source ne fournit
de liste filtree fiable (le screener FMP est payant, l'endpoint `profile` est trop
vite rate-limite pour enrichir des dizaines de titres). La liste des grandes capis
bouge peu : la figer dans un fichier editable est le choix robuste et gratuit.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from .schemas import InvestorRiskProfile, UniverseInstrument

_UNIVERSE_PATH = Path(__file__).resolve().parent.parent / "data" / "universe.json"

# Filet de securite minimal si le fichier de config est absent ou illisible.
_SEED_UNIVERSE: list[UniverseInstrument] = [
    UniverseInstrument(ticker="AAPL", sector="Technology", eligible_profiles=["moderate", "dynamic"]),
    UniverseInstrument(ticker="MSFT", sector="Technology"),
    UniverseInstrument(ticker="JNJ", sector="Healthcare"),
    UniverseInstrument(ticker="KO", sector="Consumer Defensive"),
    UniverseInstrument(ticker="PG", sector="Consumer Defensive"),
    UniverseInstrument(ticker="JPM", sector="Financial Services", eligible_profiles=["moderate", "dynamic"]),
    UniverseInstrument(ticker="XOM", sector="Energy", eligible_profiles=["moderate", "dynamic"]),
    UniverseInstrument(ticker="NVDA", sector="Technology", eligible_profiles=["moderate", "dynamic"]),
    UniverseInstrument(ticker="TSLA", sector="Consumer Cyclical", eligible_profiles=["dynamic"]),
    UniverseInstrument(ticker="NEE", sector="Utilities"),
]


class UniverseProvider:
    """Fournit la liste des candidats et leur eligibilite par profil de risque."""

    def __init__(self, universe_path: Path | None = None) -> None:
        self.universe_path = universe_path or _UNIVERSE_PATH
        self._lock = threading.Lock()
        self._cache: list[UniverseInstrument] | None = None

    def for_profile(
        self,
        profile: InvestorRiskProfile,
        excluded: set[str] | None = None,
    ) -> list[UniverseInstrument]:
        """Candidats eligibles a ce profil et non exclus par l'utilisateur.

        La segmentation ici est volontairement grossiere (elle ecarte surtout les
        valeurs les plus speculatives des profils prudents). La segmentation fine
        reste faite par les agents : le TechnicalAgent calcule la volatilite reelle
        et le screening penalise/ecarte les titres trop volatils pour un prudent.
        """
        blocked = {ticker.strip().upper() for ticker in (excluded or set())}
        return [
            instrument
            for instrument in self._load()
            if instrument.ticker not in blocked and profile in instrument.eligible_profiles
        ]

    def _load(self) -> list[UniverseInstrument]:
        with self._lock:
            if self._cache is not None:
                return self._cache
            self._cache = self._read_file() or list(_SEED_UNIVERSE)
            return self._cache

    def _read_file(self) -> list[UniverseInstrument]:
        try:
            raw = json.loads(self.universe_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        entries = raw.get("instruments") if isinstance(raw, dict) else None
        if not isinstance(entries, list):
            return []
        instruments: list[UniverseInstrument] = []
        for item in entries:
            if not isinstance(item, dict):
                continue
            ticker = str(item.get("ticker", "")).strip().upper()
            if not ticker:
                continue
            try:
                instruments.append(
                    UniverseInstrument(
                        ticker=ticker,
                        name=item.get("name"),
                        sector=item.get("sector") or "Unknown",
                        eligible_profiles=item.get("eligible_profiles")
                        or ["conservative", "moderate", "dynamic"],
                        currency=item.get("currency") or "USD",
                    )
                )
            except Exception:
                continue
        return instruments

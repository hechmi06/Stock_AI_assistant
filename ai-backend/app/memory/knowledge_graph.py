"""Knowledge Graph du MarketDataAgent (triplets sujet-predicat-objet, SQLite).

Relie chaque ticker a ses attributs (secteur, industrie, pays, place de
cotation, devise, sources de donnees) sous forme de faits interrogeables.
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.agents.schemas import MarketDataResult, NewsResult, TechnicalResult

from .structured_memory import default_db_path

# Predicats a valeur unique : la nouvelle valeur remplace l'ancienne.
_FUNCTIONAL_PREDICATES = {
    "has_name",
    "in_sector",
    "in_industry",
    "based_in",
    "listed_on",
    "quoted_in",
    "has_website",
    "has_trend",
    "has_support_level",
    "has_resistance_level",
    "has_rsi",
    "has_technical_score",
    "has_news_sentiment",
    "has_news_sentiment_score",
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS kg_triples (
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (subject, predicate, object)
);
CREATE INDEX IF NOT EXISTS idx_kg_subject ON kg_triples (subject);
"""


class KnowledgeGraph:
    def __init__(self, db_path: Path | None = None) -> None:
        path = db_path or default_db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def add_fact(self, subject: str, predicate: str, obj: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            if predicate in _FUNCTIONAL_PREDICATES:
                self._conn.execute(
                    "DELETE FROM kg_triples WHERE subject = ? AND predicate = ?",
                    (subject, predicate),
                )
            self._conn.execute(
                "INSERT INTO kg_triples (subject, predicate, object, updated_at)"
                " VALUES (?, ?, ?, ?)"
                " ON CONFLICT(subject, predicate, object) DO UPDATE SET"
                "  updated_at=excluded.updated_at",
                (subject, predicate, obj, now),
            )
            self._conn.commit()

    def ingest_result(self, result: MarketDataResult) -> None:
        """Extrait les faits d'un resultat de collecte et les ajoute au graphe."""
        ticker = result.ticker
        profile = result.company_profile

        self.add_fact(ticker, "is_a", "company")
        if profile.name:
            self.add_fact(ticker, "has_name", profile.name)
        if profile.sector:
            self.add_fact(ticker, "in_sector", profile.sector)
            self.add_fact(profile.sector, "is_a", "sector")
        if profile.industry:
            self.add_fact(ticker, "in_industry", profile.industry)
            self.add_fact(profile.industry, "is_a", "industry")
        if profile.country:
            self.add_fact(ticker, "based_in", profile.country)
        if profile.exchange:
            self.add_fact(ticker, "listed_on", profile.exchange)
            self.add_fact(profile.exchange, "is_a", "exchange")
        if profile.currency:
            self.add_fact(ticker, "quoted_in", profile.currency)
        if profile.website:
            self.add_fact(ticker, "has_website", profile.website)
        for source in result.sources_used:
            self.add_fact(ticker, "data_from", source)
            self.add_fact(source, "is_a", "data_source")

    def ingest_technical_result(self, result: TechnicalResult) -> None:
        """Faits techniques : indicateurs, tendance, niveaux de support/resistance."""
        ticker = result.ticker

        if result.rsi is not None:
            self.add_fact(ticker, "has_indicator", "RSI_14")
            self.add_fact("RSI_14", "calculated_from", "historical_prices")
            self.add_fact(ticker, "has_rsi", str(result.rsi))
        if result.moving_averages.sma_20 is not None:
            self.add_fact(ticker, "has_indicator", "SMA_20")
            self.add_fact("SMA_20", "calculated_from", "historical_prices")
        if result.moving_averages.sma_50 is not None:
            self.add_fact(ticker, "has_indicator", "SMA_50")
            self.add_fact("SMA_50", "calculated_from", "historical_prices")
        self.add_fact(ticker, "has_trend", result.trend)
        if result.support_level is not None:
            self.add_fact(ticker, "has_support_level", str(result.support_level))
        if result.resistance_level is not None:
            self.add_fact(ticker, "has_resistance_level", str(result.resistance_level))
        if result.technical_score is not None:
            self.add_fact(ticker, "has_technical_score", str(result.technical_score))

    def ingest_news_result(self, result: NewsResult) -> None:
        """Faits d'actualite : sentiment global et evenements importants detectes."""
        ticker = result.ticker

        if result.sentiment_label:
            self.add_fact(ticker, "has_news_sentiment", result.sentiment_label)
        if result.sentiment_score is not None:
            self.add_fact(ticker, "has_news_sentiment_score", str(result.sentiment_score))
        for event in result.key_events:
            self.add_fact(ticker, "affected_by_event", event)
            self.add_fact(event, "is_a", "news_event")
        for source in result.sources_used:
            self.add_fact(ticker, "news_from", source)
            self.add_fact(source, "is_a", "news_source")

    def facts_for(self, subject: str) -> list[dict[str, str]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT subject, predicate, object, updated_at FROM kg_triples"
                " WHERE subject = ? ORDER BY predicate, object",
                (subject,),
            ).fetchall()
        return [dict(row) for row in rows]

    def all_facts(self) -> list[dict[str, str]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT subject, predicate, object, updated_at FROM kg_triples"
                " ORDER BY subject, predicate, object"
            ).fetchall()
        return [dict(row) for row in rows]

    def related(self, obj: str) -> list[dict[str, str]]:
        """Sujets relies a un objet donne (ex. toutes les societes d'un secteur)."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT subject, predicate, object, updated_at FROM kg_triples"
                " WHERE object = ? ORDER BY subject, predicate",
                (obj,),
            ).fetchall()
        return [dict(row) for row in rows]

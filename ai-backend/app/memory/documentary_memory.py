"""Memoire documentaire du NewsAgent (SQLite).

Stocke les analyses de news completes (runs) et chaque article vu, avec
deduplication par hash de titre : l'agent sait quels articles sont nouveaux
d'une collecte a l'autre.
"""

from __future__ import annotations

import hashlib
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.agents.schemas import NewsResult

from .structured_memory import default_db_path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS news_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    status TEXT NOT NULL,
    sentiment_label TEXT,
    sentiment_score REAL,
    articles_count INTEGER NOT NULL,
    result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_runs_ticker
    ON news_runs (ticker, collected_at DESC);

CREATE TABLE IF NOT EXISTS news_articles (
    ticker TEXT NOT NULL,
    title_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT,
    origin TEXT,
    published_at TEXT,
    url TEXT,
    summary TEXT,
    sentiment TEXT,
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (ticker, title_hash)
);
CREATE INDEX IF NOT EXISTS idx_news_articles_ticker
    ON news_articles (ticker, published_at DESC);
"""


def _title_hash(title: str) -> str:
    normalized = " ".join(title.lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


class DocumentaryMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        path = db_path or default_db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def store(self, result: NewsResult) -> tuple[str, int]:
        """Memorise un run complet + articles. Renvoie (date, nb de nouveaux articles)."""
        collected_at = datetime.now(timezone.utc).isoformat()
        new_articles = 0
        with self._lock:
            self._conn.execute(
                "INSERT INTO news_runs (ticker, collected_at, status, sentiment_label,"
                " sentiment_score, articles_count, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    result.ticker,
                    collected_at,
                    result.status,
                    result.sentiment_label,
                    result.sentiment_score,
                    len(result.articles),
                    result.model_dump_json(),
                ),
            )
            for article in result.articles:
                cursor = self._conn.execute(
                    "INSERT INTO news_articles (ticker, title_hash, title, source, origin,"
                    " published_at, url, summary, sentiment, first_seen_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    " ON CONFLICT(ticker, title_hash) DO UPDATE SET"
                    "  sentiment=COALESCE(excluded.sentiment, news_articles.sentiment)",
                    (
                        result.ticker,
                        _title_hash(article.title),
                        article.title,
                        article.source,
                        article.origin,
                        article.published_at,
                        article.url,
                        article.summary,
                        article.sentiment,
                        collected_at,
                    ),
                )
                # rowcount == 1 pour un INSERT reel comme pour un UPDATE : on
                # distingue les nouveaux articles via lastrowid apres INSERT pur.
                if cursor.lastrowid and cursor.rowcount == 1:
                    new_articles += 1
            self._conn.commit()
        return collected_at, new_articles

    def latest_run(self, ticker: str) -> tuple[NewsResult, str] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT result_json, collected_at FROM news_runs"
                " WHERE ticker = ? ORDER BY collected_at DESC LIMIT 1",
                (ticker,),
            ).fetchone()
        if row is None:
            return None
        try:
            result = NewsResult.model_validate_json(row["result_json"])
        except Exception:
            return None
        return result, row["collected_at"]

    def known_articles_count(self, ticker: str) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS total FROM news_articles WHERE ticker = ?",
                (ticker,),
            ).fetchone()
        return int(row["total"]) if row else 0

    def recent_articles(self, ticker: str, limit: int = 20) -> list[dict[str, object]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT title, source, origin, published_at, url, sentiment, first_seen_at"
                " FROM news_articles WHERE ticker = ?"
                " ORDER BY published_at DESC LIMIT ?",
                (ticker, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def sentiment_history(self, ticker: str, limit: int = 30) -> list[dict[str, object]]:
        """Serie des sentiments par run : montre l'evolution du ton des news."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT collected_at, sentiment_label, sentiment_score, articles_count"
                " FROM news_runs WHERE ticker = ?"
                " ORDER BY collected_at DESC LIMIT ?",
                (ticker, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def summary(self, ticker: str) -> dict[str, object]:
        return {
            "ticker": ticker,
            "known_articles": self.known_articles_count(ticker),
            "recent_articles": self.recent_articles(ticker),
            "sentiment_history": self.sentiment_history(ticker),
        }

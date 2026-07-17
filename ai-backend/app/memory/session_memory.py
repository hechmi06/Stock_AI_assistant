"""Memoire de session du SynthesisAgent (SQLite).

Historise chaque synthese produite (score global, recommandation, confiance,
resultat complet) pour permettre de suivre l'evolution du diagnostic d'un
ticker de session en session, sans jamais influencer le calcul lui-meme.
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.agents.schemas import SynthesisResult

from .structured_memory import default_db_path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS synthesis_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    global_score INTEGER NOT NULL,
    recommendation TEXT NOT NULL,
    confidence_score INTEGER NOT NULL,
    result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_synthesis_sessions_ticker
    ON synthesis_sessions (ticker, generated_at DESC);
"""


class SessionMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or default_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def store(self, result: SynthesisResult) -> str:
        """Memorise une synthese complete et renvoie sa date d'enregistrement."""
        generated_at = datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._conn.execute(
                "INSERT INTO synthesis_sessions"
                " (ticker, generated_at, status, global_score, recommendation,"
                "  confidence_score, result_json)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    result.ticker,
                    generated_at,
                    result.status,
                    result.global_score,
                    result.recommendation,
                    result.confidence_score,
                    result.model_dump_json(),
                ),
            )
            self._conn.commit()
        return generated_at

    def latest(self, ticker: str) -> tuple[SynthesisResult, str] | None:
        """Derniere synthese memorisee pour un ticker (resultat, date)."""
        with self._lock:
            row = self._conn.execute(
                "SELECT result_json, generated_at FROM synthesis_sessions"
                " WHERE ticker = ? ORDER BY generated_at DESC LIMIT 1",
                (ticker,),
            ).fetchone()
        if row is None:
            return None
        try:
            result = SynthesisResult.model_validate_json(row["result_json"])
        except Exception:
            # Session ecrite par une version anterieure du schema : inutilisable.
            return None
        return result, row["generated_at"]

    def count(self, ticker: str) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS n FROM synthesis_sessions WHERE ticker = ?",
                (ticker,),
            ).fetchone()
        return int(row["n"])

    def history(self, ticker: str, limit: int = 10) -> list[dict[str, object]]:
        """Evolution du diagnostic : scores et recommandations des dernieres sessions."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT generated_at, status, global_score, recommendation, confidence_score"
                " FROM synthesis_sessions WHERE ticker = ?"
                " ORDER BY generated_at DESC LIMIT ?",
                (ticker, max(1, limit)),
            ).fetchall()
        return [dict(row) for row in rows]

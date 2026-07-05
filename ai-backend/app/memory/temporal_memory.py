"""Memoire temporelle du TechnicalAgent (SQLite).

Conserve les indicateurs techniques dates a chaque calcul, pour pouvoir
suivre leur evolution dans le temps (serie de RSI, tendance, volatilite...).
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.agents.schemas import TechnicalResult

from .structured_memory import default_db_path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS technical_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    status TEXT NOT NULL,
    rsi REAL,
    sma_20 REAL,
    sma_50 REAL,
    volatility REAL,
    trend TEXT NOT NULL,
    support_level REAL,
    resistance_level REAL,
    technical_score INTEGER,
    signal TEXT NOT NULL,
    result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_technical_ticker
    ON technical_snapshots (ticker, computed_at DESC);
"""


class TemporalMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        path = db_path or default_db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def store(self, result: TechnicalResult) -> str:
        computed_at = datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._conn.execute(
                "INSERT INTO technical_snapshots"
                " (ticker, computed_at, status, rsi, sma_20, sma_50, volatility,"
                "  trend, support_level, resistance_level, technical_score, signal, result_json)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    result.ticker,
                    computed_at,
                    result.status,
                    result.rsi,
                    result.moving_averages.sma_20,
                    result.moving_averages.sma_50,
                    result.volatility,
                    result.trend,
                    result.support_level,
                    result.resistance_level,
                    result.technical_score,
                    result.signal,
                    result.model_dump_json(),
                ),
            )
            self._conn.commit()
        return computed_at

    def series(self, ticker: str, limit: int = 30) -> list[dict[str, object]]:
        """Serie temporelle des indicateurs (du plus recent au plus ancien)."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT computed_at, status, rsi, sma_20, sma_50, volatility,"
                " trend, support_level, resistance_level, technical_score, signal"
                " FROM technical_snapshots WHERE ticker = ?"
                " ORDER BY computed_at DESC LIMIT ?",
                (ticker, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def latest(self, ticker: str) -> tuple[TechnicalResult, str] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT result_json, computed_at FROM technical_snapshots"
                " WHERE ticker = ? ORDER BY computed_at DESC LIMIT 1",
                (ticker,),
            ).fetchone()
        if row is None:
            return None
        return TechnicalResult.model_validate_json(row["result_json"]), row["computed_at"]

    def count(self, ticker: str) -> int:
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS n FROM technical_snapshots WHERE ticker = ?",
                (ticker,),
            ).fetchone()
        return int(row["n"])

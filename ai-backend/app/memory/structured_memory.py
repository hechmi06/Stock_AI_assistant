"""Memoire structuree du MarketDataAgent (SQLite).

Stocke sous forme de tables relationnelles ce que l'agent collecte :
snapshots complets, profils entreprise, ratios, etats financiers et
historique de prix. La base vit hors de ai-backend/ pour ne pas
declencher le --reload d'uvicorn a chaque ecriture.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.agents.schemas import MarketDataResult

_SCHEMA = """
CREATE TABLE IF NOT EXISTS market_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    status TEXT NOT NULL,
    price REAL,
    change_percent REAL,
    sources TEXT NOT NULL,
    result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_ticker
    ON market_snapshots (ticker, collected_at DESC);

CREATE TABLE IF NOT EXISTS company_profiles (
    ticker TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    name TEXT, sector TEXT, industry TEXT, country TEXT,
    website TEXT, market_cap REAL, currency TEXT, exchange TEXT
);

CREATE TABLE IF NOT EXISTS financial_ratios (
    ticker TEXT NOT NULL,
    name TEXT NOT NULL,
    value REAL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (ticker, name)
);

CREATE TABLE IF NOT EXISTS financial_statements (
    ticker TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    fiscal_date TEXT, total_revenue REAL, net_income REAL,
    total_assets REAL, total_debt REAL, operating_cashflow REAL
);

CREATE TABLE IF NOT EXISTS historical_prices (
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL, high REAL, low REAL,
    close REAL NOT NULL,
    volume INTEGER,
    PRIMARY KEY (ticker, date)
);
"""


def default_db_path() -> Path:
    """<racine projet>/data/agent_memory.db, surchargeable via AGENT_MEMORY_DB."""
    override = os.getenv("AGENT_MEMORY_DB", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[3] / "data" / "agent_memory.db"


class StructuredMemory:
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

    def store(self, result: MarketDataResult) -> str:
        """Memorise un resultat complet et met a jour les tables structurees."""
        collected_at = datetime.now(timezone.utc).isoformat()
        profile = result.company_profile
        statements = result.financial_statements_summary

        with self._lock:
            self._conn.execute(
                "INSERT INTO market_snapshots"
                " (ticker, collected_at, status, price, change_percent, sources, result_json)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    result.ticker,
                    collected_at,
                    result.status,
                    result.price,
                    result.change_percent,
                    json.dumps(result.sources_used),
                    result.model_dump_json(),
                ),
            )

            if profile.name:
                self._conn.execute(
                    "INSERT INTO company_profiles"
                    " (ticker, updated_at, name, sector, industry, country,"
                    "  website, market_cap, currency, exchange)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    " ON CONFLICT(ticker) DO UPDATE SET"
                    "  updated_at=excluded.updated_at, name=excluded.name,"
                    "  sector=excluded.sector, industry=excluded.industry,"
                    "  country=excluded.country, website=excluded.website,"
                    "  market_cap=excluded.market_cap, currency=excluded.currency,"
                    "  exchange=excluded.exchange",
                    (
                        result.ticker,
                        collected_at,
                        profile.name,
                        profile.sector,
                        profile.industry,
                        profile.country,
                        profile.website,
                        profile.market_cap,
                        profile.currency,
                        profile.exchange,
                    ),
                )

            for name, value in result.financial_ratios.items():
                if value is None:
                    continue
                self._conn.execute(
                    "INSERT INTO financial_ratios (ticker, name, value, updated_at)"
                    " VALUES (?, ?, ?, ?)"
                    " ON CONFLICT(ticker, name) DO UPDATE SET"
                    "  value=excluded.value, updated_at=excluded.updated_at",
                    (result.ticker, name, value, collected_at),
                )

            if statements.fiscal_date or statements.total_revenue is not None:
                self._conn.execute(
                    "INSERT INTO financial_statements"
                    " (ticker, updated_at, fiscal_date, total_revenue, net_income,"
                    "  total_assets, total_debt, operating_cashflow)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                    " ON CONFLICT(ticker) DO UPDATE SET"
                    "  updated_at=excluded.updated_at, fiscal_date=excluded.fiscal_date,"
                    "  total_revenue=excluded.total_revenue, net_income=excluded.net_income,"
                    "  total_assets=excluded.total_assets, total_debt=excluded.total_debt,"
                    "  operating_cashflow=excluded.operating_cashflow",
                    (
                        result.ticker,
                        collected_at,
                        statements.fiscal_date,
                        statements.total_revenue,
                        statements.net_income,
                        statements.total_assets,
                        statements.total_debt,
                        statements.operating_cashflow,
                    ),
                )

            for point in result.historical_prices:
                self._conn.execute(
                    "INSERT INTO historical_prices"
                    " (ticker, date, open, high, low, close, volume)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)"
                    " ON CONFLICT(ticker, date) DO UPDATE SET"
                    "  open=excluded.open, high=excluded.high, low=excluded.low,"
                    "  close=excluded.close, volume=excluded.volume",
                    (
                        result.ticker,
                        point.date,
                        point.open,
                        point.high,
                        point.low,
                        point.close,
                        point.volume,
                    ),
                )

            self._conn.commit()
        return collected_at

    def latest_snapshot(self, ticker: str) -> tuple[MarketDataResult, str] | None:
        """Dernier resultat memorise pour un ticker (resultat, date de collecte)."""
        with self._lock:
            row = self._conn.execute(
                "SELECT result_json, collected_at FROM market_snapshots"
                " WHERE ticker = ? ORDER BY collected_at DESC LIMIT 1",
                (ticker,),
            ).fetchone()
        if row is None:
            return None
        try:
            result = MarketDataResult.model_validate_json(row["result_json"])
        except Exception:
            # Snapshot ecrit par une version anterieure du schema : inutilisable.
            return None
        return result, row["collected_at"]

    def summary(self, ticker: str) -> dict[str, object]:
        """Vue d'ensemble de ce que la memoire connait d'un ticker."""
        with self._lock:
            snapshots = self._conn.execute(
                "SELECT collected_at, status, price, change_percent, sources"
                " FROM market_snapshots WHERE ticker = ?"
                " ORDER BY collected_at DESC LIMIT 10",
                (ticker,),
            ).fetchall()
            snapshot_count = self._conn.execute(
                "SELECT COUNT(*) AS n FROM market_snapshots WHERE ticker = ?", (ticker,)
            ).fetchone()["n"]
            profile = self._conn.execute(
                "SELECT * FROM company_profiles WHERE ticker = ?", (ticker,)
            ).fetchone()
            ratios = self._conn.execute(
                "SELECT name, value, updated_at FROM financial_ratios WHERE ticker = ?",
                (ticker,),
            ).fetchall()
            statements = self._conn.execute(
                "SELECT * FROM financial_statements WHERE ticker = ?", (ticker,)
            ).fetchone()
            history = self._conn.execute(
                "SELECT COUNT(*) AS n, MIN(date) AS first_date, MAX(date) AS last_date"
                " FROM historical_prices WHERE ticker = ?",
                (ticker,),
            ).fetchone()

        return {
            "ticker": ticker,
            "snapshot_count": snapshot_count,
            "recent_snapshots": [
                {
                    "collected_at": row["collected_at"],
                    "status": row["status"],
                    "price": row["price"],
                    "change_percent": row["change_percent"],
                    "sources": json.loads(row["sources"]),
                }
                for row in snapshots
            ],
            "company_profile": dict(profile) if profile else None,
            "financial_ratios": [dict(row) for row in ratios],
            "financial_statements": dict(statements) if statements else None,
            "historical_prices": {
                "count": history["n"],
                "first_date": history["first_date"],
                "last_date": history["last_date"],
            },
        }

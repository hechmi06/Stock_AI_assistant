"""Append-only point-in-time archive for market and agent data.

The existing memories remain optimized for the latest value. This journal has
different semantics: every row states when a fact was effective, when it became
available to the system and when it was actually observed. Backtests can then
filter on ``available_at <= as_of`` instead of reading the latest known value.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import threading
import uuid
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any

from app.agents.schemas import (
    HistoricalPrice,
    MarketDataResult,
    NewsResult,
    PointInTimeEvent,
    PointInTimeQueryResult,
    PointInTimeSummary,
)

from .structured_memory import default_db_path

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
_EVENT_NAMESPACE = uuid.UUID("74630af6-51d7-4a95-aaba-1c9a93726271")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS point_in_time_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS point_in_time_events (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    component TEXT NOT NULL,
    event_type TEXT NOT NULL,
    effective_at TEXT NOT NULL,
    available_at TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source TEXT NOT NULL,
    quality TEXT NOT NULL,
    knowledge_mode TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    payload_hash TEXT NOT NULL,
    run_id TEXT,
    payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pit_ticker_available
    ON point_in_time_events (ticker, available_at DESC);
CREATE INDEX IF NOT EXISTS idx_pit_component_asof
    ON point_in_time_events (ticker, component, event_type, available_at DESC);
CREATE INDEX IF NOT EXISTS idx_pit_observed
    ON point_in_time_events (ticker, observed_at DESC);
"""


class PointInTimeStore:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or default_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA busy_timeout=5000")
            self._conn.executescript(_SCHEMA)
            self._conn.execute(
                "INSERT OR IGNORE INTO point_in_time_schema_migrations (version, applied_at)"
                " VALUES (?, ?)",
                (SCHEMA_VERSION, datetime.now(timezone.utc).isoformat()),
            )
            self._conn.commit()

    def record_market_data(
        self,
        result: MarketDataResult,
        observed_at: str | datetime | None = None,
    ) -> int:
        observed = self._timestamp(observed_at)
        run_id = str(uuid.uuid4())
        source = self._market_source(result)
        inserted = 0

        inserted += self.record_event(
            ticker=result.ticker,
            component="market_data",
            event_type="market_snapshot",
            effective_at=observed,
            available_at=observed,
            observed_at=observed,
            source=source,
            quality=result.status,
            knowledge_mode="observed",
            payload=result.model_dump(mode="json"),
            run_id=run_id,
        )

        if result.raw_price is not None or result.price is not None:
            payload = (
                result.raw_price.model_dump(mode="json")
                if result.raw_price is not None
                else {"price": result.price, "change_percent": result.change_percent}
            )
            inserted += self.record_event(
                ticker=result.ticker,
                component="market_data",
                event_type="price_quote",
                effective_at=observed,
                available_at=observed,
                observed_at=observed,
                source=source,
                quality=result.status,
                knowledge_mode="observed",
                payload=payload,
                run_id=run_id,
            )

        profile = result.company_profile
        if profile.name:
            profile_source = self._preferred_source(
                result,
                ("yfinance", "financial_modeling_prep", "alpha_vantage"),
            )
            inserted += self.record_event(
                ticker=result.ticker,
                component="fundamental",
                event_type="company_profile",
                effective_at=observed,
                available_at=observed,
                observed_at=observed,
                source=profile_source,
                quality=result.status,
                knowledge_mode="observed",
                payload=profile.model_dump(mode="json"),
                run_id=run_id,
            )

        ratios = {
            name: value
            for name, value in result.financial_ratios.items()
            if value is not None
        }
        if ratios:
            fundamental_source = self._preferred_source(
                result,
                ("financial_modeling_prep", "alpha_vantage", "yfinance"),
            )
            inserted += self.record_event(
                ticker=result.ticker,
                component="fundamental",
                event_type="financial_ratios",
                effective_at=observed,
                available_at=observed,
                observed_at=observed,
                source=fundamental_source,
                quality=result.status,
                knowledge_mode="observed",
                payload=ratios,
                run_id=run_id,
            )

        statements = result.financial_statements_summary
        if statements.fiscal_date or statements.total_revenue is not None:
            statement_source = self._preferred_source(
                result,
                ("financial_modeling_prep", "alpha_vantage", "yfinance"),
            )
            inserted += self.record_event(
                ticker=result.ticker,
                component="fundamental",
                event_type="financial_statement",
                effective_at=self._timestamp(statements.fiscal_date or observed, end_of_day=True),
                # A fiscal period is not its publication date. Until a filing
                # date is known, the conservative availability is observation.
                available_at=observed,
                observed_at=observed,
                source=statement_source,
                quality=result.status,
                knowledge_mode="observed",
                payload=statements.model_dump(mode="json"),
                run_id=run_id,
            )

        history_source = self._preferred_source(
            result,
            ("yfinance", "twelve_data", "tiingo", "alpha_vantage"),
        )
        with self._lock, self._conn:
            for point in result.historical_prices:
                bar_time = self._timestamp(point.date, end_of_day=True)
                inserted += self.record_event(
                    ticker=result.ticker,
                    component="market_data",
                    event_type="price_bar",
                    effective_at=bar_time,
                    available_at=bar_time,
                    observed_at=observed,
                    source=history_source,
                    quality="success",
                    knowledge_mode="reconstructed",
                    payload=point.model_dump(mode="json"),
                    run_id=run_id,
                    _commit=False,
                )
        return inserted

    def record_news(
        self,
        result: NewsResult,
        observed_at: str | datetime | None = None,
    ) -> int:
        observed = self._timestamp(observed_at)
        run_id = str(uuid.uuid4())
        source = ",".join(result.sources_used) or "unknown"
        inserted = self.record_event(
            ticker=result.ticker,
            component="news",
            event_type="news_snapshot",
            effective_at=observed,
            available_at=observed,
            observed_at=observed,
            source=source,
            quality=result.status,
            knowledge_mode="observed",
            payload=result.model_dump(mode="json"),
            run_id=run_id,
        )
        for article in result.articles:
            published = self._timestamp(article.published_at)
            mode = "observed" if self._seconds_between(published, observed) <= 300 else "reconstructed"
            inserted += self.record_event(
                ticker=result.ticker,
                component="news",
                event_type="news_article",
                effective_at=published,
                available_at=published,
                observed_at=observed,
                source=article.source or article.origin,
                quality="success",
                knowledge_mode=mode,
                payload=article.model_dump(mode="json"),
                run_id=run_id,
            )
        return inserted

    def record_price_history(
        self,
        ticker: str,
        prices: list[HistoricalPrice],
        source: str = "yfinance",
        observed_at: str | datetime | None = None,
    ) -> int:
        observed = self._timestamp(observed_at)
        run_id = str(uuid.uuid4())
        inserted = 0
        with self._lock, self._conn:
            for point in prices:
                bar_time = self._timestamp(point.date, end_of_day=True)
                inserted += self.record_event(
                    ticker=ticker,
                    component="market_data",
                    event_type="price_bar",
                    effective_at=bar_time,
                    available_at=bar_time,
                    observed_at=observed,
                    source=source,
                    quality="success",
                    knowledge_mode="reconstructed",
                    payload=point.model_dump(mode="json"),
                    run_id=run_id,
                    _commit=False,
                )
        return inserted

    def record_derived(
        self,
        ticker: str,
        component: str,
        payload: dict[str, Any],
        quality: str,
        observed_at: str | datetime | None = None,
    ) -> int:
        observed = self._timestamp(observed_at)
        return self.record_event(
            ticker=ticker,
            component=component,
            event_type=f"{component}_snapshot",
            effective_at=observed,
            available_at=observed,
            observed_at=observed,
            source="stock_ai_assistant",
            quality=quality,
            knowledge_mode="derived",
            payload=payload,
            run_id=str(uuid.uuid4()),
        )

    def record_document(
        self,
        ticker: str,
        form: str,
        filing_date: str | None,
        url: str,
        chunks_indexed: int,
        observed_at: str | datetime | None = None,
    ) -> int:
        observed = self._timestamp(observed_at)
        available = self._timestamp(filing_date or observed, end_of_day=True)
        return self.record_event(
            ticker=ticker,
            component="rag",
            event_type="financial_document",
            effective_at=available,
            available_at=available,
            observed_at=observed,
            source="sec",
            quality="success" if chunks_indexed else "partial",
            knowledge_mode="reconstructed" if available < observed else "observed",
            payload={
                "form": form,
                "filing_date": filing_date,
                "url": url,
                "chunks_indexed": chunks_indexed,
            },
            run_id=str(uuid.uuid4()),
        )

    def record_event(
        self,
        *,
        ticker: str,
        component: str,
        event_type: str,
        effective_at: str | datetime,
        available_at: str | datetime,
        observed_at: str | datetime,
        source: str,
        quality: str,
        knowledge_mode: str,
        payload: dict[str, Any],
        run_id: str | None = None,
        _commit: bool = True,
    ) -> int:
        normalized_ticker = ticker.strip().upper()
        canonical_payload = json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
            default=str,
        )
        payload_hash = hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest()
        effective = self._timestamp(effective_at)
        available = self._timestamp(available_at)
        observed = self._timestamp(observed_at)
        identity = "|".join(
            (
                normalized_ticker,
                component,
                event_type,
                effective,
                available,
                source,
                knowledge_mode,
                payload_hash,
            )
        )
        event_id = str(uuid.uuid5(_EVENT_NAMESPACE, identity))
        with self._lock:
            cursor = self._conn.execute(
                """
                INSERT OR IGNORE INTO point_in_time_events
                  (id, ticker, component, event_type, effective_at, available_at,
                   observed_at, source, quality, knowledge_mode, schema_version,
                   payload_hash, run_id, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    normalized_ticker,
                    component,
                    event_type,
                    effective,
                    available,
                    observed,
                    source,
                    quality,
                    knowledge_mode,
                    SCHEMA_VERSION,
                    payload_hash,
                    run_id,
                    canonical_payload,
                ),
            )
            if _commit:
                self._conn.commit()
        return 1 if cursor.rowcount > 0 else 0

    def query(
        self,
        ticker: str,
        *,
        component: str | None = None,
        event_type: str | None = None,
        as_of: str | datetime | None = None,
        observed_only: bool = False,
        limit: int = 100,
    ) -> PointInTimeQueryResult:
        normalized_ticker = ticker.strip().upper()
        clauses = ["ticker = ?"]
        parameters: list[Any] = [normalized_ticker]
        normalized_as_of = self._timestamp(as_of) if as_of else None
        if component:
            clauses.append("component = ?")
            parameters.append(component.strip().lower())
        if event_type:
            clauses.append("event_type = ?")
            parameters.append(event_type.strip().lower())
        if normalized_as_of:
            clauses.append("available_at <= ?")
            parameters.append(normalized_as_of)
        if observed_only:
            clauses.append("knowledge_mode IN ('observed', 'derived')")
        safe_limit = max(1, min(1000, limit))
        parameters.append(safe_limit)
        with self._lock:
            rows = self._conn.execute(
                f"""
                SELECT * FROM point_in_time_events
                WHERE {' AND '.join(clauses)}
                ORDER BY available_at DESC, observed_at DESC
                LIMIT ?
                """,
                parameters,
            ).fetchall()
        events = [self._row_to_event(row) for row in rows]
        return PointInTimeQueryResult(
            ticker=normalized_ticker,
            as_of=normalized_as_of,
            component=component.strip().lower() if component else None,
            event_type=event_type.strip().lower() if event_type else None,
            observed_only=observed_only,
            count=len(events),
            events=events,
        )

    def latest_event(
        self,
        ticker: str,
        *,
        component: str,
        event_type: str,
        as_of: str | datetime,
        observed_only: bool = True,
    ) -> PointInTimeEvent | None:
        result = self.query(
            ticker,
            component=component,
            event_type=event_type,
            as_of=as_of,
            observed_only=observed_only,
            limit=1,
        )
        return result.events[0] if result.events else None

    def price_history(
        self,
        ticker: str,
        *,
        as_of: str | datetime,
        observed_only: bool,
        limit: int = 2600,
    ) -> tuple[list[HistoricalPrice], list[PointInTimeEvent]]:
        normalized_ticker = ticker.strip().upper()
        normalized_as_of = self._timestamp(as_of)
        clauses = [
            "ticker = ?",
            "component = 'market_data'",
            "event_type = 'price_bar'",
            "available_at <= ?",
        ]
        parameters: list[Any] = [normalized_ticker, normalized_as_of]
        if observed_only:
            clauses.append("knowledge_mode IN ('observed', 'derived')")
        safe_limit = max(1, min(5000, limit))
        parameters.append(safe_limit)
        with self._lock:
            rows = self._conn.execute(
                f"""
                SELECT * FROM (
                    SELECT point_in_time_events.*,
                           ROW_NUMBER() OVER (
                               PARTITION BY effective_at
                               ORDER BY observed_at DESC
                           ) AS revision_rank
                    FROM point_in_time_events
                    WHERE {' AND '.join(clauses)}
                )
                WHERE revision_rank = 1
                ORDER BY effective_at DESC
                LIMIT ?
                """,
                parameters,
            ).fetchall()
        events = [self._row_to_event(row) for row in reversed(rows)]
        prices: list[HistoricalPrice] = []
        valid_events: list[PointInTimeEvent] = []
        for event in events:
            try:
                prices.append(HistoricalPrice.model_validate(event.payload))
            except Exception:
                continue
            valid_events.append(event)
        return prices, valid_events

    def summary(self, ticker: str) -> PointInTimeSummary:
        normalized_ticker = ticker.strip().upper()
        with self._lock:
            total = self._conn.execute(
                "SELECT COUNT(*) AS n FROM point_in_time_events WHERE ticker = ?",
                (normalized_ticker,),
            ).fetchone()["n"]
            components = self._group_counts(normalized_ticker, "component")
            event_types = self._group_counts(normalized_ticker, "event_type")
            modes = self._group_counts(normalized_ticker, "knowledge_mode")
            bounds = self._conn.execute(
                """
                SELECT MIN(available_at) AS first_available_at,
                       MAX(observed_at) AS last_observed_at
                FROM point_in_time_events WHERE ticker = ?
                """,
                (normalized_ticker,),
            ).fetchone()
        return PointInTimeSummary(
            ticker=normalized_ticker,
            total_events=total,
            components=components,
            event_types=event_types,
            knowledge_modes=modes,
            first_available_at=bounds["first_available_at"],
            last_observed_at=bounds["last_observed_at"],
        )

    def safe_record(self, callback, *args, **kwargs) -> None:
        try:
            callback(*args, **kwargs)
        except Exception as error:
            logger.warning("Point-in-time archive unavailable: %s", error)

    def _group_counts(self, ticker: str, column: str) -> dict[str, int]:
        rows = self._conn.execute(
            f"""
            SELECT {column} AS value, COUNT(*) AS n
            FROM point_in_time_events WHERE ticker = ?
            GROUP BY {column} ORDER BY {column}
            """,
            (ticker,),
        ).fetchall()
        return {row["value"]: row["n"] for row in rows}

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> PointInTimeEvent:
        return PointInTimeEvent(
            id=row["id"],
            ticker=row["ticker"],
            component=row["component"],
            event_type=row["event_type"],
            effective_at=row["effective_at"],
            available_at=row["available_at"],
            observed_at=row["observed_at"],
            source=row["source"],
            quality=row["quality"],
            knowledge_mode=row["knowledge_mode"],
            schema_version=row["schema_version"],
            payload_hash=row["payload_hash"],
            run_id=row["run_id"],
            payload=json.loads(row["payload_json"]),
        )

    @staticmethod
    def _market_source(result: MarketDataResult) -> str:
        if result.raw_price is not None:
            return result.raw_price.source
        return result.sources_used[0] if result.sources_used else "unknown"

    @staticmethod
    def _preferred_source(
        result: MarketDataResult,
        candidates: tuple[str, ...],
    ) -> str:
        return next(
            (source for source in candidates if source in result.sources_used),
            PointInTimeStore._market_source(result),
        )

    @staticmethod
    def _timestamp(value: str | datetime | date | None, end_of_day: bool = False) -> str:
        if value is None:
            parsed = datetime.now(timezone.utc)
        elif isinstance(value, datetime):
            parsed = value
        elif isinstance(value, date):
            parsed = datetime.combine(value, time.max if end_of_day else time.min)
        else:
            text = str(value).strip()
            if not text:
                parsed = datetime.now(timezone.utc)
            else:
                normalized = text.replace("Z", "+00:00")
                try:
                    parsed = datetime.fromisoformat(normalized)
                except ValueError:
                    parsed_date = date.fromisoformat(normalized[:10])
                    parsed = datetime.combine(
                        parsed_date,
                        time.max if end_of_day else time.min,
                    )
                else:
                    if len(text) <= 10:
                        parsed = datetime.combine(
                            parsed.date(),
                            time.max if end_of_day else time.min,
                        )
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()

    @staticmethod
    def _seconds_between(first: str, second: str) -> float:
        return abs(
            (
                datetime.fromisoformat(second)
                - datetime.fromisoformat(first)
            ).total_seconds()
        )

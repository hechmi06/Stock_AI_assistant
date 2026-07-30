import tempfile
import unittest
from pathlib import Path

from app.agents.schemas import (
    CompanyProfile,
    FinancialStatementsSummary,
    HistoricalPrice,
    MarketDataResult,
    NewsArticle,
    NewsResult,
)
from app.memory.point_in_time import PointInTimeStore


class PointInTimeStoreTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._tmp.cleanup)
        self.store = PointInTimeStore(Path(self._tmp.name) / "pit.db")

    def test_as_of_never_exposes_fundamentals_before_observation(self):
        result = MarketDataResult(
            ticker="MSFT",
            status="success",
            sources_used=["yfinance"],
            price=110,
            historical_prices=[
                HistoricalPrice(
                    date="2025-01-02",
                    open=99,
                    high=101,
                    low=98,
                    close=100,
                    volume=1_000,
                )
            ],
            company_profile=CompanyProfile(name="Microsoft Corporation"),
            financial_ratios={"pe_ratio": 31.2},
            financial_statements_summary=FinancialStatementsSummary(
                fiscal_date="2024-12-31",
                total_revenue=1000,
                net_income=250,
            ),
        )

        inserted = self.store.record_market_data(
            result,
            observed_at="2025-01-10T12:00:00+00:00",
        )

        self.assertGreaterEqual(inserted, 5)
        past = self.store.query("MSFT", as_of="2025-01-05T00:00:00+00:00")
        self.assertEqual([event.event_type for event in past.events], ["price_bar"])
        self.assertEqual(past.events[0].knowledge_mode, "reconstructed")

        strict_past = self.store.query(
            "MSFT",
            as_of="2025-01-05T00:00:00+00:00",
            observed_only=True,
        )
        self.assertEqual(strict_past.count, 0)

        current = self.store.query(
            "MSFT",
            event_type="financial_statement",
            as_of="2025-01-10T12:00:00+00:00",
        )
        self.assertEqual(current.count, 1)
        self.assertEqual(current.events[0].effective_at[:10], "2024-12-31")
        self.assertEqual(current.events[0].available_at[:10], "2025-01-10")

    def test_events_are_deduplicated_and_auditable(self):
        result = MarketDataResult(
            ticker="AAPL",
            status="success",
            sources_used=["yfinance"],
            price=200,
        )
        observed = "2025-02-03T15:30:00+00:00"

        first = self.store.record_market_data(result, observed)
        second = self.store.record_market_data(result, observed)
        summary = self.store.summary("AAPL")

        self.assertEqual(first, 2)
        self.assertEqual(second, 0)
        self.assertEqual(summary.total_events, 2)
        self.assertEqual(summary.knowledge_modes, {"observed": 2})
        self.assertEqual(summary.components, {"market_data": 2})

    def test_backfilled_news_is_marked_reconstructed(self):
        result = NewsResult(
            ticker="NVDA",
            status="success",
            sources_used=["finnhub"],
            articles=[
                NewsArticle(
                    title="Nvidia publishes results",
                    source="Example",
                    published_at="2025-01-01T09:00:00+00:00",
                    url="https://example.com/nvda",
                    origin="finnhub",
                )
            ],
        )
        self.store.record_news(result, observed_at="2025-01-10T12:00:00+00:00")

        articles = self.store.query("NVDA", event_type="news_article")
        strict = self.store.query(
            "NVDA",
            event_type="news_article",
            observed_only=True,
        )

        self.assertEqual(articles.count, 1)
        self.assertEqual(articles.events[0].knowledge_mode, "reconstructed")
        self.assertEqual(strict.count, 0)


if __name__ == "__main__":
    unittest.main()

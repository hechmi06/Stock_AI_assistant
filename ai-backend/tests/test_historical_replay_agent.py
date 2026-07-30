import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from app.agents.historical_replay_agent import HistoricalReplayAgent
from app.agents.risk_agent import RiskAgent
from app.agents.schemas import (
    CompanyProfile,
    HistoricalPrice,
    MarketDataResult,
    NewsArticle,
    NewsResult,
)
from app.agents.synthesis_agent import SynthesisAgent
from app.agents.technical_agent import TechnicalAgent
from app.memory import AgentMemory, SynthesisAgentMemory, TechnicalAgentMemory
from app.memory.point_in_time import PointInTimeStore


class HistoricalReplayAgentTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._tmp.cleanup)
        db_path = Path(self._tmp.name) / "replay.db"
        self.store = PointInTimeStore(db_path)
        market_memory = AgentMemory(db_path)
        technical = TechnicalAgent(
            memory=TechnicalAgentMemory(db_path),
        )
        technical.market_data_agent.memory = market_memory
        risk = RiskAgent(
            market_data_agent=technical.market_data_agent,
            technical_agent=technical,
        )
        synthesis = SynthesisAgent(memory=SynthesisAgentMemory(db_path))
        self.agent = HistoricalReplayAgent(
            point_in_time=self.store,
            technical_agent=technical,
            risk_agent=risk,
            synthesis_agent=synthesis,
        )
        self.technical_memory = technical.memory
        self.synthesis_memory = synthesis.memory

        prices = []
        value = 100.0
        start = date(2024, 8, 1)
        for index in range(150):
            value *= 1.001
            prices.append(
                HistoricalPrice(
                    date=(start + timedelta(days=index)).isoformat(),
                    open=value * 0.998,
                    high=value * 1.005,
                    low=value * 0.995,
                    close=value,
                    volume=1_000_000 + index * 100,
                )
            )
        market = MarketDataResult(
            ticker="MSFT",
            status="success",
            sources_used=["yfinance"],
            price=prices[-1].close,
            historical_prices=prices,
            company_profile=CompanyProfile(
                name="Microsoft Corporation",
                sector="Technology",
            ),
            financial_ratios={"profit_margin": 0.30},
        )
        self.store.record_market_data(
            market,
            observed_at="2025-01-10T12:00:00+00:00",
        )
        news = NewsResult(
            ticker="MSFT",
            status="success",
            sources_used=["finnhub"],
            sentiment_label="positive",
            sentiment_score=0.4,
            articles=[
                NewsArticle(
                    title="Microsoft update",
                    source="Example",
                    published_at="2025-01-10T11:59:00+00:00",
                    url="https://example.com/msft",
                    origin="finnhub",
                )
            ],
        )
        self.store.record_news(
            news,
            observed_at="2025-01-10T12:00:00+00:00",
        )
        self.store.record_event(
            ticker="MSFT",
            component="rag",
            event_type="financial_document",
            effective_at="2025-01-09T12:00:00+00:00",
            available_at="2025-01-09T12:00:00+00:00",
            observed_at="2025-01-09T12:00:00+00:00",
            source="sec",
            quality="success",
            knowledge_mode="observed",
            payload={
                "form": "10-Q",
                "filing_date": "2025-01-09",
                "url": "https://example.com/10q",
                "chunks_indexed": 20,
            },
        )

    def test_strict_replay_uses_only_events_available_before_cutoff(self):
        result = self.agent.run("MSFT", "2025-01-10T12:00:00+00:00")

        self.assertEqual(result.replay_mode, "strict")
        self.assertTrue(result.lookahead_guard_passed)
        self.assertEqual(result.archive_coverage_score, 100)
        self.assertEqual(result.market_data.price, result.market_data.historical_prices[-1].close)
        self.assertEqual(result.technical.status, "success")
        self.assertEqual(result.news.status, "success")
        self.assertEqual(result.rag.status, "partial")
        self.assertEqual(self.technical_memory.temporal.count("MSFT"), 0)
        self.assertEqual(self.synthesis_memory.session.count("MSFT"), 0)

    def test_strict_replay_fails_before_first_observed_market_snapshot(self):
        result = self.agent.run("MSFT", "2025-01-05T12:00:00+00:00")

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.market_data.status, "failed")
        self.assertEqual(result.technical.status, "failed")
        self.assertTrue(result.lookahead_guard_passed)

    def test_research_mode_can_use_reconstructed_prices_but_marks_the_limit(self):
        result = self.agent.run(
            "MSFT",
            "2025-01-05T12:00:00+00:00",
            allow_reconstructed_prices=True,
        )

        self.assertEqual(result.replay_mode, "research")
        self.assertEqual(result.market_data.status, "partial")
        self.assertEqual(result.technical.status, "success")
        self.assertTrue(result.lookahead_guard_passed)
        self.assertTrue(any("reconstruit" in warning for warning in result.warnings))
        self.assertTrue(
            all(point.date <= "2025-01-05" for point in result.market_data.historical_prices)
        )


if __name__ == "__main__":
    unittest.main()

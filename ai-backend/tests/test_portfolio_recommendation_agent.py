import unittest
from datetime import datetime, timedelta, timezone

from app.agents.portfolio_recommendation_agent import PortfolioRecommendationAgent
from app.agents.schemas import (
    CompanyProfile,
    FinancialStatementsSummary,
    HistoricalPrice,
    MarketDataResult,
    PortfolioAllocation,
    PortfolioAnalysisResult,
    PortfolioCompleteAnalysisResult,
    PortfolioPositionResult,
    PortfolioRecommendationRequest,
    PortfolioRiskSummary,
    PortfolioSummary,
    PortfolioSynthesisResult,
    TechnicalResult,
    UniverseInstrument,
)


SECTORS = {
    "AAPL": "Technology",
    "MSFT": "Technology",
    "NVDA": "Technology",
    "GOOGL": "Communication Services",
    "AMZN": "Consumer Cyclical",
    "META": "Communication Services",
    "TSLA": "Consumer Cyclical",
    "JPM": "Financial Services",
    "V": "Financial Services",
    "XOM": "Energy",
    "LLY": "Healthcare",
    "PG": "Consumer Defensive",
    "COST": "Consumer Defensive",
    "WMT": "Consumer Defensive",
    "KO": "Consumer Defensive",
}

TEST_UNIVERSE = list(SECTORS.keys())


class FakeUniverseProvider:
    """Univers deterministe injecte dans les tests (remplace le screener FMP)."""

    def for_profile(self, profile, excluded=None):
        blocked = {ticker.strip().upper() for ticker in (excluded or set())}
        return [
            UniverseInstrument(ticker=ticker, sector=SECTORS[ticker])
            for ticker in TEST_UNIVERSE
            if ticker not in blocked
        ]


class FakeMarketAgent:
    def run(self, ticker, period="6mo", with_slm=False, use_cache=True):
        index = TEST_UNIVERSE.index(ticker)
        start = datetime(2026, 1, 1)
        history = [
            HistoricalPrice(
                date=(start + timedelta(days=day)).date().isoformat(),
                close=100 + index + day * (0.15 + index / 500),
            )
            for day in range(40)
        ]
        return MarketDataResult(
            ticker=ticker,
            status="success",
            price=history[-1].close,
            change_percent=(index % 5) - 1,
            historical_prices=history,
            company_profile=CompanyProfile(
                name=f"{ticker} Corp.", sector=SECTORS[ticker], currency="USD"
            ),
            financial_ratios={
                "profit_margin": 0.18 + (index % 4) * 0.02,
                "return_on_equity": 0.20,
                "debt_to_equity": 0.8,
            },
            financial_statements_summary=FinancialStatementsSummary(
                net_income=10_000_000,
                operating_cashflow=12_000_000,
            ),
            sources_used=["twelve_data"],
        )


class FakeTechnicalAgent:
    def analyze(self, market_data, with_slm=False):
        index = TEST_UNIVERSE.index(market_data.ticker)
        return TechnicalResult(
            ticker=market_data.ticker,
            status="success",
            technical_score=55 + index % 5 * 5,
            volatility=1.2 + (index % 4) * 0.35,
            trend="bullish" if index % 3 else "neutral",
            rsi=55,
            signal="positive",
        )


class FakePortfolioOrchestrator:
    def run(self, request, use_cache=True, with_portfolio_slm=False):
        total = request.cash + sum(
            item.quantity * item.average_cost for item in request.holdings
        )
        positions = [
            PortfolioPositionResult(
                ticker=item.ticker,
                quantity=item.quantity,
                average_cost=item.average_cost,
                current_price=item.average_cost,
                cost_basis=item.quantity * item.average_cost,
                market_value=item.quantity * item.average_cost,
                weight=item.quantity * item.average_cost / total * 100,
                sector=SECTORS[item.ticker],
                data_status="success",
            )
            for item in request.holdings
        ]
        portfolio = PortfolioAnalysisResult(
            status="success",
            generated_at=datetime.now(timezone.utc),
            positions=positions,
            summary=PortfolioSummary(total_value=total, invested_value=total - request.cash, cash=request.cash),
            allocation_by_holding=[
                PortfolioAllocation(
                    label=item.ticker,
                    value=item.market_value or 0,
                    weight=item.weight,
                )
                for item in positions
            ],
            risk=PortfolioRiskSummary(
                diversification_score=75,
                diversification_level="high",
                data_confidence_score=90,
                data_confidence_level="high",
            ),
        )
        synthesis = PortfolioSynthesisResult(
            status="success",
            verdict="coherent",
            global_score=74,
            confidence_score=90,
            confidence_level="high",
            strengths=["Diversification sectorielle satisfaisante."],
            weaknesses=["Les conditions de marche peuvent evoluer."],
            analyzed_positions=len(positions),
            requested_positions=len(positions),
        )
        return PortfolioCompleteAnalysisResult(
            status="success",
            generated_at=datetime.now(timezone.utc),
            portfolio=portfolio,
            synthesis=synthesis,
        )


class FakeRecommendationSlm:
    def __init__(self):
        self.calls = 0

    def summarize_portfolio_recommendation_data(self, payload):
        self.calls += 1
        return {
            "provider": "test",
            "model": "recommendation-only",
            "summary": "La proposition associe des moteurs de croissance a des activites plus defensives, en coherence avec le profil retenu.",
            "data_quality": "bon",
            "key_points": ["Complementarite sectorielle", "Reserve de prudence"],
            "warnings": ["La composition doit etre reevaluee lorsque le contexte change"],
        }


class PortfolioRecommendationAgentTests(unittest.TestCase):
    def setUp(self):
        self.slm = FakeRecommendationSlm()
        self.agent = PortfolioRecommendationAgent(
            market_data_agent=FakeMarketAgent(),
            technical_agent=FakeTechnicalAgent(),
            portfolio_orchestrator=FakePortfolioOrchestrator(),
            slm_client=self.slm,
            universe_provider=FakeUniverseProvider(),
        )

    def test_composes_a_diversified_portfolio_whose_weights_sum_to_one_hundred(self):
        result = self.agent.run(
            PortfolioRecommendationRequest(
                budget=20_000,
                risk_profile="moderate",
                objective="balanced",
                horizon_years=5,
                max_positions=5,
            ),
            with_slm=False,
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(len(result.allocations), 5)
        self.assertGreaterEqual(len({item.sector for item in result.allocations}), 3)
        self.assertAlmostEqual(
            sum(item.weight for item in result.allocations) + result.cash_weight,
            100,
            places=1,
        )
        self.assertTrue(all(item.quantity > 0 for item in result.allocations))

    def test_risk_profile_controls_the_default_cash_reserve(self):
        conservative = self.agent.run(
            PortfolioRecommendationRequest(
                budget=10_000, risk_profile="conservative", max_positions=5
            ),
            with_slm=False,
        )
        dynamic = self.agent.run(
            PortfolioRecommendationRequest(
                budget=10_000, risk_profile="dynamic", max_positions=5
            ),
            with_slm=False,
        )

        self.assertGreaterEqual(conservative.cash_weight, 20)
        self.assertLessEqual(dynamic.cash_weight, 6)

    def test_dedicated_slm_only_rewrites_the_explanation(self):
        result = self.agent.run(
            PortfolioRecommendationRequest(budget=15_000, max_positions=5)
        )

        self.assertEqual(self.slm.calls, 1)
        self.assertIsNotNone(result.slm_summary)
        self.assertIn("moteurs de croissance", result.summary)
        self.assertEqual(len(result.allocations), 5)


if __name__ == "__main__":
    unittest.main()

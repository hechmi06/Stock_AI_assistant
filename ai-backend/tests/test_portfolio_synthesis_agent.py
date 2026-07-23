import unittest
from datetime import datetime, timezone

from app.agents.portfolio_synthesis_agent import PortfolioSynthesisAgent
from app.agents.schemas import (
    PortfolioAllocation,
    PortfolioAnalysisResult,
    PortfolioHoldingAnalysis,
    PortfolioPerformanceMetrics,
    PortfolioPositionResult,
    PortfolioRiskSummary,
    PortfolioSummary,
    PortfolioTechnicalSummary,
)


class FakePortfolioSlm:
    def __init__(self):
        self.calls = 0

    def summarize_portfolio_synthesis_data(self, payload):
        self.calls += 1
        return {
            "provider": "test",
            "model": "portfolio-only",
            "summary": "La combinaison reste interessante mais sa concentration sectorielle exige un reequilibrage.",
            "data_quality": "bon",
            "key_points": ["Qualite individuelle solide", "Diversification insuffisante"],
            "warnings": [],
        }


def sample_portfolio():
    return PortfolioAnalysisResult(
        status="success",
        generated_at=datetime.now(timezone.utc),
        positions=[
            PortfolioPositionResult(
                ticker="AAPL",
                sector="Technology",
                quantity=10,
                average_cost=100,
                cost_basis=1000,
                current_price=120,
                market_value=1200,
                weight=60,
                data_status="success",
            ),
            PortfolioPositionResult(
                ticker="MSFT",
                sector="Technology",
                quantity=5,
                average_cost=100,
                cost_basis=500,
                current_price=120,
                market_value=600,
                weight=30,
                data_status="success",
            ),
        ],
        summary=PortfolioSummary(total_value=2000, invested_value=1800, cash=200),
        allocation_by_holding=[
            PortfolioAllocation(label="AAPL", value=1200, weight=60),
            PortfolioAllocation(label="MSFT", value=600, weight=30),
            PortfolioAllocation(label="Cash", value=200, weight=10),
        ],
        allocation_by_sector=[
            PortfolioAllocation(label="Technology", value=1800, weight=90),
            PortfolioAllocation(label="Cash", value=200, weight=10),
        ],
        risk=PortfolioRiskSummary(
            concentration_score=50,
            concentration_level="high",
            diversification_score=42,
            diversification_level="medium",
            data_confidence_score=90,
            data_confidence_level="high",
        ),
        performance=PortfolioPerformanceMetrics(
            observation_count=120,
            sharpe_ratio=1.2,
            jensen_alpha_percent=5,
            max_drawdown_percent=-15,
            average_correlation=0.8,
        ),
        technical_summary=PortfolioTechnicalSummary(weighted_score=65),
    )


def sample_individual_analyses():
    return [
        PortfolioHoldingAnalysis(
            ticker="AAPL",
            status="success",
            global_score=80,
            recommendation="favorable",
            confidence_score=85,
            risk_score=25,
            risk_level="low",
            technical_score=75,
            fundamental_score=85,
            news_score=60,
        ),
        PortfolioHoldingAnalysis(
            ticker="MSFT",
            status="success",
            global_score=55,
            recommendation="prudence",
            confidence_score=80,
            risk_score=45,
            risk_level="medium",
            technical_score=50,
            fundamental_score=65,
            news_score=45,
        ),
    ]


class PortfolioSynthesisAgentTests(unittest.TestCase):
    def test_verdict_and_rebalancing_are_deterministic(self):
        agent = PortfolioSynthesisAgent(slm_client=FakePortfolioSlm())
        result = agent.run(
            sample_portfolio(),
            sample_individual_analyses(),
            with_slm=False,
        )

        self.assertEqual(result.verdict, "a_reequilibrer")
        self.assertEqual(result.analyzed_positions, 2)
        self.assertEqual(result.requested_positions, 2)
        self.assertAlmostEqual(
            sum(item.target_weight for item in result.rebalancing_plan),
            100,
            places=2,
        )
        self.assertTrue(any(item.action == "diversifier" for item in result.rebalancing_plan))

    def test_portfolio_slm_only_rewrites_the_narrative(self):
        slm = FakePortfolioSlm()
        agent = PortfolioSynthesisAgent(slm_client=slm)
        result = agent.run(sample_portfolio(), sample_individual_analyses())

        self.assertEqual(slm.calls, 1)
        self.assertEqual(result.global_score, 62)
        self.assertEqual(result.verdict, "a_reequilibrer")
        self.assertIsNotNone(result.slm_summary)
        self.assertIn("concentration sectorielle", result.summary)


if __name__ == "__main__":
    unittest.main()

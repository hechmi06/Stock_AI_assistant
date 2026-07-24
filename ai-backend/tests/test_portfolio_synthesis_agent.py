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


def robust_portfolio():
    portfolio = sample_portfolio()
    portfolio.positions[1].sector = "Healthcare"
    portfolio.allocation_by_sector = [
        PortfolioAllocation(label="Technology", value=1200, weight=60),
        PortfolioAllocation(label="Healthcare", value=600, weight=30),
        PortfolioAllocation(label="Cash", value=200, weight=10),
    ]
    portfolio.risk.concentration_score = 20
    portfolio.risk.concentration_level = "low"
    portfolio.risk.diversification_score = 85
    portfolio.risk.diversification_level = "high"
    portfolio.risk.data_confidence_score = 100
    portfolio.risk.data_confidence_level = "high"
    portfolio.performance.observation_count = 252
    portfolio.performance.sharpe_ratio = 1.8
    portfolio.performance.jensen_alpha_percent = 6
    portfolio.performance.max_drawdown_percent = -8
    portfolio.performance.average_correlation = 0.15
    portfolio.performance.beta = 1.0
    portfolio.technical_summary.weighted_score = 85
    return portfolio


def robust_individual_analyses():
    analyses = sample_individual_analyses()
    for analysis in analyses:
        analysis.global_score = 90
        analysis.recommendation = "favorable"
        analysis.confidence_score = 95
        analysis.risk_score = 20
        analysis.risk_level = "low"
        analysis.technical_score = 85
        analysis.fundamental_score = 90
        analysis.news_score = 75
    return analyses


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

    def test_robust_verdict_requires_high_decision_confidence(self):
        agent = PortfolioSynthesisAgent(slm_client=FakePortfolioSlm())
        portfolio = robust_portfolio()
        analyses = robust_individual_analyses()
        robust = agent.run(portfolio, analyses, with_slm=False)

        degraded_portfolio = portfolio.model_copy(deep=True)
        degraded_portfolio.risk.data_confidence_score = 50
        degraded_analyses = [item.model_copy(deep=True) for item in analyses]
        for analysis in degraded_analyses:
            analysis.confidence_score = 50
        degraded = agent.run(
            degraded_portfolio,
            degraded_analyses,
            with_slm=False,
        )

        self.assertEqual(robust.verdict, "robuste")
        self.assertGreaterEqual(robust.decision_confidence_score, 80)
        self.assertEqual(robust.confidence_score, robust.decision_confidence_score)
        self.assertNotEqual(degraded.verdict, "robuste")
        self.assertLess(
            degraded.decision_confidence_score,
            robust.decision_confidence_score,
        )

    def test_model_confidence_decreases_with_shorter_history(self):
        agent = PortfolioSynthesisAgent(slm_client=FakePortfolioSlm())
        long_history = agent.run(
            robust_portfolio(),
            robust_individual_analyses(),
            with_slm=False,
        )
        short_portfolio = robust_portfolio()
        short_portfolio.performance.observation_count = 20
        short_history = agent.run(
            short_portfolio,
            robust_individual_analyses(),
            with_slm=False,
        )

        self.assertLess(
            short_history.model_confidence_score,
            long_history.model_confidence_score,
        )
        self.assertLess(
            short_history.decision_confidence_score,
            long_history.decision_confidence_score,
        )
        self.assertNotEqual(short_history.verdict, "robuste")

    def test_high_risk_position_prevents_robust_verdict(self):
        agent = PortfolioSynthesisAgent(slm_client=FakePortfolioSlm())
        analyses = robust_individual_analyses()
        analyses[0].risk_level = "high"
        analyses[0].risk_score = 75
        result = agent.run(
            robust_portfolio(),
            analyses,
            with_slm=False,
        )

        self.assertNotEqual(result.verdict, "robuste")

    def test_worse_risk_metrics_cannot_improve_global_score(self):
        agent = PortfolioSynthesisAgent(slm_client=FakePortfolioSlm())
        healthy = agent.run(
            robust_portfolio(),
            robust_individual_analyses(),
            with_slm=False,
        )
        stressed_portfolio = robust_portfolio()
        stressed_portfolio.performance.sharpe_ratio = -0.5
        stressed_portfolio.performance.jensen_alpha_percent = -12
        stressed_portfolio.performance.max_drawdown_percent = -40
        stressed = agent.run(
            stressed_portfolio,
            robust_individual_analyses(),
            with_slm=False,
        )

        self.assertLess(stressed.global_score, healthy.global_score)


if __name__ == "__main__":
    unittest.main()

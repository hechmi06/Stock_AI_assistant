import tempfile
import unittest
from pathlib import Path

from app.agents.evaluation import evaluate_synthesis
from app.agents.schemas import (
    CompanyProfile,
    FinancialStatementsSummary,
    MarketDataResult,
    NewsResult,
    RagResult,
    RiskResult,
    TechnicalResult,
)
from app.agents.synthesis_agent import SynthesisAgent
from app.memory import SynthesisAgentMemory
from app.orchestrator import StockAnalysisOrchestrator


class DisabledSlm:
    def summarize_synthesis_data(self, payload):
        return None


class NumericSlm:
    """Simule un SLM qui desobeit a la consigne et recopie des chiffres."""

    def summarize_synthesis_data(self, payload):
        return {
            "provider": "nebius",
            "model": "test",
            "summary": "META affiche un score global de 76/100 avec une recommandation favorable.",
            "data_quality": "bon",
            "key_points": ["Fondamentaux solides (95/100)."],
            "warnings": [],
        }


class CountingSlm:
    def __init__(self):
        self.calls = 0

    def summarize_synthesis_data(self, payload):
        self.calls += 1
        return {
            "provider": "test",
            "model": "stock-only",
            "summary": "Le dossier individuel conserve une dynamique favorable et des fondamentaux solides.",
            "data_quality": "bon",
            "key_points": ["Dynamique favorable", "Risques contenus"],
            "warnings": [],
        }


def isolated_agent(tmp_dir: str) -> SynthesisAgent:
    """SynthesisAgent avec memoire sur base temporaire (pas d'ecriture dans data/)."""
    memory = SynthesisAgentMemory(Path(tmp_dir) / "test_agent_memory.db")
    return SynthesisAgent(slm_client=DisabledSlm(), memory=memory)


def sample_inputs():
    market = MarketDataResult(
        ticker="MSFT",
        status="success",
        sources_used=["twelve_data", "alpha_vantage"],
        price=500,
        change_percent=1.2,
        company_profile=CompanyProfile(name="Microsoft", sector="Technology", market_cap=3_000_000_000_000),
        financial_ratios={
            "profit_margin": 0.25,
            "return_on_equity": 0.30,
            "debt_to_equity": 0.50,
        },
        financial_statements_summary=FinancialStatementsSummary(
            total_revenue=200_000_000_000,
            net_income=50_000_000_000,
            total_assets=400_000_000_000,
            total_debt=80_000_000_000,
            operating_cashflow=70_000_000_000,
        ),
    )
    technical = TechnicalResult(
        ticker="MSFT",
        status="success",
        technical_score=80,
        trend="bullish",
        signal="positive",
    )
    news = NewsResult(
        ticker="MSFT",
        status="success",
        sentiment_label="positive",
        sentiment_score=0.60,
        sources_used=["finnhub", "google_news_rss"],
    )
    rag = RagResult(
        ticker="MSFT",
        question="material risks",
        status="success",
        indexed_chunks=60,
    )
    risk = RiskResult(
        ticker="MSFT",
        status="success",
        overall_risk_level="low",
        risk_score=20,
        data_confidence_score=90,
        data_confidence_level="high",
    )
    return market, technical, news, rag, risk


class SynthesisAgentTests(unittest.TestCase):
    def setUp(self):
        # ignore_cleanup_errors : sous Windows, la connexion SQLite encore
        # ouverte empeche la suppression immediate du repertoire temporaire.
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._tmp.cleanup)
        self.agent = isolated_agent(self._tmp.name)

    def test_scores_are_deterministic_and_bounded(self):
        market, technical, news, rag, risk = sample_inputs()
        result = self.agent.run("MSFT", market, technical, news, rag, risk)

        self.assertEqual(result.status, "success")
        self.assertEqual(result.scores.technical, 80)
        self.assertEqual(result.scores.fundamental, 100)
        self.assertEqual(result.scores.news, 74)
        self.assertEqual(result.scores.risk, 80)
        self.assertEqual(result.global_score, 84)
        self.assertEqual(result.recommendation, "favorable")
        self.assertEqual(result.confidence_score, 90)
        self.assertIn("sec_edgar_qdrant", result.sources)

    def test_low_confidence_blocks_directional_recommendation(self):
        market, technical, news, rag, risk = sample_inputs()
        risk.data_confidence_score = 30
        risk.data_confidence_level = "low"

        result = self.agent.run("MSFT", market, technical, news, rag, risk)

        self.assertEqual(result.recommendation, "donnees_insuffisantes")

    def test_memory_stores_sessions_and_flags_recommendation_change(self):
        market, technical, news, rag, risk = sample_inputs()
        first = self.agent.run("MSFT", market, technical, news, rag, risk)

        remembered = self.agent.memory.recall_latest("MSFT")
        self.assertIsNotNone(remembered)
        self.assertEqual(remembered[0].global_score, first.global_score)

        # Deuxieme session : le risque explose, la recommandation change.
        risk.risk_score = 80
        risk.overall_risk_level = "high"
        second = self.agent.run("MSFT", market, technical, news, rag, risk)

        self.assertNotEqual(second.recommendation, first.recommendation)
        self.assertTrue(
            any("Session precedente" in warning for warning in second.warnings),
            f"warnings: {second.warnings}",
        )
        summary = self.agent.memory.summary("MSFT")
        self.assertEqual(summary["session_count"], 2)
        predicates = {fact["predicate"] for fact in summary["knowledge_graph"]}
        self.assertIn("has_global_score", predicates)
        self.assertIn("has_recommendation", predicates)

    def test_evaluation_passes_on_clean_synthesis(self):
        market, technical, news, rag, risk = sample_inputs()
        result = self.agent.run("MSFT", market, technical, news, rag, risk)

        report = evaluate_synthesis(result)

        by_name = {metric.name: metric for metric in report.metrics}
        self.assertTrue(by_name["score_purity"].passed, by_name["score_purity"].message)
        self.assertTrue(
            by_name["recommendation_coherence"].passed,
            by_name["recommendation_coherence"].message,
        )
        self.assertTrue(by_name["component_coverage"].passed)
        self.assertTrue(report.passed, f"total_score={report.total_score}")

    def test_failed_components_become_explicit_weaknesses(self):
        """Scenario META : technique en echec + sentiment news absent.

        Les composants morts doivent apparaitre dans les points de vigilance au
        lieu du trompeur "aucun signal negatif dominant".
        """
        market, technical, news, rag, risk = sample_inputs()
        market.status = "partial"
        market.historical_prices = []
        technical.status = "failed"
        technical.technical_score = None
        technical.trend = "neutral"
        news.status = "partial"
        news.sentiment_label = None
        news.sentiment_score = None

        result = self.agent.run("META", market, technical, news, rag, risk)

        joined = " ".join(result.weaknesses)
        self.assertIn("Analyse technique indisponible", joined)
        self.assertIn("Sentiment des actualites non calcule", joined)
        # Le score neutre par defaut (50) ne doit produire aucun signal technique.
        self.assertNotIn("Signal technique", joined)
        self.assertNotIn("sans direction claire", result.summary)
        self.assertIn("n'a pas pu etre menee", result.summary)

    def test_slm_summary_with_digits_is_rejected(self):
        """Un prompt ne garantit rien : toute note SLM chiffree est ecartee."""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
            memory = SynthesisAgentMemory(Path(tmp_dir) / "test_agent_memory.db")
            agent = SynthesisAgent(slm_client=NumericSlm(), memory=memory)
            market, technical, news, rag, risk = sample_inputs()

            result = agent.run("MSFT", market, technical, news, rag, risk)

        self.assertIsNone(result.slm_summary)
        self.assertNotRegex(result.summary, r"\d")
        self.assertTrue(any("Note SLM ecartee" in warning for warning in result.warnings))

    def test_signals_and_summary_are_number_free(self):
        market, technical, news, rag, risk = sample_inputs()
        result = self.agent.run("MSFT", market, technical, news, rag, risk)

        self.assertNotRegex(result.summary, r"\d")
        for signal in [*result.strengths, *result.weaknesses]:
            self.assertNotRegex(signal, r"\d", signal)

    def test_evaluation_flags_tampered_score(self):
        market, technical, news, rag, risk = sample_inputs()
        result = self.agent.run("MSFT", market, technical, news, rag, risk)
        result.global_score = 99  # score falsifie, plus recalculable

        report = evaluate_synthesis(result)

        by_name = {metric.name: metric for metric in report.metrics}
        self.assertFalse(by_name["score_purity"].passed)


class FakeMarketAgent:
    def __init__(self):
        self.calls = 0

    def run(self, ticker, **kwargs):
        self.calls += 1
        return sample_inputs()[0]


class FakeTechnicalAgent:
    def analyze(self, market_data, **kwargs):
        return sample_inputs()[1]


class FakeNewsAgent:
    def run(self, ticker, **kwargs):
        return sample_inputs()[2]


class FakeRiskAgent:
    def query_rag_risks(self, ticker):
        return sample_inputs()[3]

    def analyze(self, ticker, market_data, technical, news, rag):
        return sample_inputs()[4]


class OrchestratorTests(unittest.TestCase):
    def test_graph_executes_all_agents_and_returns_trace(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
            orchestrator = StockAnalysisOrchestrator(
                market_data_agent=FakeMarketAgent(),
                technical_agent=FakeTechnicalAgent(),
                news_agent=FakeNewsAgent(),
                risk_agent=FakeRiskAgent(),
                synthesis_agent=isolated_agent(tmp_dir),
            )

            result = orchestrator.run("MSFT")

        self.assertEqual(result.workflow, "langgraph")
        self.assertEqual(result.synthesis.global_score, 84)
        self.assertEqual(
            {entry.agent for entry in result.execution_trace},
            {
                "MarketDataAgent",
                "TechnicalAgent",
                "NewsAgent",
                "RAGAgent",
                "RiskAgent",
                "SynthesisAgent",
            },
        )

    def test_prefetched_market_data_skips_collection(self):
        """Fix 3 : un MarketDataResult fourni evite une 2e collecte marche."""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
            market_agent = FakeMarketAgent()
            orchestrator = StockAnalysisOrchestrator(
                market_data_agent=market_agent,
                technical_agent=FakeTechnicalAgent(),
                news_agent=FakeNewsAgent(),
                risk_agent=FakeRiskAgent(),
                synthesis_agent=isolated_agent(tmp_dir),
            )
            prefetched = sample_inputs()[0]  # ticker MSFT

            result = orchestrator.run("MSFT", market_data=prefetched)

        self.assertEqual(market_agent.calls, 0)
        self.assertEqual(result.market_data.ticker, "MSFT")
        self.assertEqual(result.synthesis.global_score, 84)

    def test_portfolio_context_can_disable_only_the_stock_narration(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp_dir:
            slm = CountingSlm()
            synthesis_agent = SynthesisAgent(
                slm_client=slm,
                memory=SynthesisAgentMemory(Path(tmp_dir) / "stock_slm_isolation.db"),
            )
            orchestrator = StockAnalysisOrchestrator(
                market_data_agent=FakeMarketAgent(),
                technical_agent=FakeTechnicalAgent(),
                news_agent=FakeNewsAgent(),
                risk_agent=FakeRiskAgent(),
                synthesis_agent=synthesis_agent,
            )

            portfolio_result = orchestrator.run("MSFT", with_synthesis_slm=False)
            self.assertIsNone(portfolio_result.synthesis.slm_summary)
            self.assertEqual(slm.calls, 0)

            stock_result = orchestrator.run("MSFT")
            self.assertIsNotNone(stock_result.synthesis.slm_summary)
            self.assertEqual(slm.calls, 1)


if __name__ == "__main__":
    unittest.main()

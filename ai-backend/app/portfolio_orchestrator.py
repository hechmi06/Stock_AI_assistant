"""Workflow multi-actions dedie a l'analyse complete d'un portefeuille."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from .agents import PortfolioAgent
from .agents.portfolio_synthesis_agent import PortfolioSynthesisAgent
from .agents.schemas import (
    MarketDataResult,
    OrchestratedAnalysis,
    PortfolioAnalysisRequest,
    PortfolioCompleteAnalysisResult,
    PortfolioHoldingAnalysis,
)
from .orchestrator import StockAnalysisOrchestrator


class PortfolioAnalysisOrchestrator:
    """Analyse chaque ligne, puis seulement leur combinaison.

    La narration du SynthesisAgent mono-action est desactivee pendant ce workflow
    afin qu'un seul SLM distinct, PortfolioSynthesisAgent, redige le portefeuille.
    L'endpoint mono-action conserve son comportement par defaut.
    """

    def __init__(
        self,
        portfolio_agent: PortfolioAgent,
        stock_orchestrator: StockAnalysisOrchestrator,
        portfolio_synthesis_agent: PortfolioSynthesisAgent,
    ) -> None:
        self.portfolio_agent = portfolio_agent
        self.stock_orchestrator = stock_orchestrator
        self.portfolio_synthesis_agent = portfolio_synthesis_agent

    def run(
        self,
        request: PortfolioAnalysisRequest,
        use_cache: bool = True,
        with_portfolio_slm: bool = True,
    ) -> PortfolioCompleteAnalysisResult:
        # Collecte marche unique, partagee entre la valorisation du portefeuille
        # et les analyses par ligne (evite une double collecte par ticker).
        holdings = self.portfolio_agent._merge_holdings(request.holdings)
        benchmark_ticker = request.benchmark_ticker.strip().upper()
        market_results = self.portfolio_agent.collect_market_data(
            holdings, benchmark_ticker, use_cache
        )
        portfolio = self.portfolio_agent.run(
            request, use_cache=use_cache, market_results=market_results
        )
        tickers = list(dict.fromkeys(position.ticker for position in portfolio.positions))
        individual_analyses = self._analyze_positions(tickers, market_results, use_cache)
        synthesis = self.portfolio_synthesis_agent.run(
            portfolio,
            individual_analyses,
            with_slm=with_portfolio_slm,
        )
        return PortfolioCompleteAnalysisResult(
            status=synthesis.status,
            generated_at=datetime.now(timezone.utc),
            portfolio=portfolio,
            individual_analyses=individual_analyses,
            synthesis=synthesis,
        )

    def _analyze_positions(
        self,
        tickers: list[str],
        market_results: dict[str, MarketDataResult],
        use_cache: bool,
    ) -> list[PortfolioHoldingAnalysis]:
        results: dict[str, PortfolioHoldingAnalysis] = {}
        # Analyse chaque position retenue en parallele (News + RAG + Risk + Synthesis
        # par ligne domine le temps de reponse) : on parallelise toutes les lignes.
        with ThreadPoolExecutor(max_workers=max(1, min(8, len(tickers)))) as executor:
            future_by_ticker = {
                executor.submit(
                    self.stock_orchestrator.run,
                    ticker,
                    use_cache,
                    False,
                    market_results.get(ticker),
                ): ticker
                for ticker in tickers
            }
            for future in as_completed(future_by_ticker):
                ticker = future_by_ticker[future]
                try:
                    results[ticker] = self._compact(future.result())
                except Exception as error:
                    results[ticker] = PortfolioHoldingAnalysis(
                        ticker=ticker,
                        status="failed",
                        summary=f"Analyse individuelle indisponible: {error}",
                    )
        return [results[ticker] for ticker in tickers]

    @staticmethod
    def _compact(result: OrchestratedAnalysis) -> PortfolioHoldingAnalysis:
        synthesis = result.synthesis
        risk = result.risk
        return PortfolioHoldingAnalysis(
            ticker=result.ticker,
            status=synthesis.status,
            global_score=synthesis.global_score,
            recommendation=synthesis.recommendation,
            confidence_score=synthesis.confidence_score,
            risk_score=risk.risk_score,
            risk_level=risk.overall_risk_level,
            technical_score=synthesis.scores.technical,
            fundamental_score=synthesis.scores.fundamental,
            news_score=synthesis.scores.news,
            summary=synthesis.summary,
            key_risks=[item.title for item in synthesis.key_risks],
            sources=synthesis.sources,
        )

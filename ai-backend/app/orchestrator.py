"""Orchestrateur LangGraph du pipeline multi-agents boursier."""

from __future__ import annotations

import operator
from datetime import datetime, timezone
from time import perf_counter
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from .agents import (
    MarketDataAgent,
    NewsAgent,
    RiskAgent,
    SynthesisAgent,
    TechnicalAgent,
)
from .agents.schemas import (
    AgentExecution,
    MarketDataResult,
    NewsResult,
    OrchestratedAnalysis,
    RagResult,
    RiskResult,
    SynthesisResult,
    TechnicalResult,
)


class AnalysisState(TypedDict, total=False):
    ticker: str
    use_cache: bool
    market_data: MarketDataResult
    technical: TechnicalResult
    news: NewsResult
    rag: RagResult
    risk: RiskResult
    synthesis: SynthesisResult
    execution_trace: Annotated[list[AgentExecution], operator.add]


class StockAnalysisOrchestrator:
    def __init__(
        self,
        market_data_agent: MarketDataAgent,
        technical_agent: TechnicalAgent,
        news_agent: NewsAgent,
        risk_agent: RiskAgent,
        synthesis_agent: SynthesisAgent,
    ) -> None:
        # Le RAGAgent est consomme via risk_agent.query_rag_risks (question
        # materielle + ingestion a la demande) : pas de dependance directe ici.
        self.market_data_agent = market_data_agent
        self.technical_agent = technical_agent
        self.news_agent = news_agent
        self.risk_agent = risk_agent
        self.synthesis_agent = synthesis_agent
        self.graph = self._build_graph()

    def _build_graph(self):
        # NB : en invocation synchrone, LangGraph execute les branches d'un
        # meme superstep sequentiellement (fan-out logique, pas de threads).
        # `news` depend de `market_data` pour beneficier du filtre de
        # pertinence par nom d'entreprise, sans cout supplementaire.
        graph = StateGraph(AnalysisState)
        graph.add_node("market_data", self._market_data_node)
        graph.add_node("news", self._news_node)
        graph.add_node("rag", self._rag_node)
        graph.add_node("technical", self._technical_node)
        graph.add_node("risk", self._risk_node)
        graph.add_node("synthesis", self._synthesis_node)

        graph.add_edge(START, "market_data")
        graph.add_edge(START, "rag")
        graph.add_edge("market_data", "technical")
        graph.add_edge("market_data", "news")
        graph.add_edge(["technical", "news", "rag"], "risk")
        graph.add_edge("risk", "synthesis")
        graph.add_edge("synthesis", END)
        return graph.compile()

    def run(self, ticker: str, use_cache: bool = True) -> OrchestratedAnalysis:
        symbol = ticker.strip().upper()
        state = self.graph.invoke(
            {
                "ticker": symbol,
                "use_cache": use_cache,
                "execution_trace": [],
            }
        )
        synthesis = state["synthesis"]
        return OrchestratedAnalysis(
            ticker=symbol,
            status=synthesis.status,
            generated_at=datetime.now(timezone.utc),
            execution_trace=state.get("execution_trace", []),
            market_data=state["market_data"],
            technical=state["technical"],
            news=state["news"],
            rag=state["rag"],
            risk=state["risk"],
            synthesis=synthesis,
        )

    def run_synthesis_direct(self, ticker: str, use_cache: bool = True) -> SynthesisResult:
        """Validation du SynthesisAgent sans passer par le graphe LangGraph."""
        symbol = ticker.strip().upper()
        market_data = self.market_data_agent.run(symbol, use_cache=use_cache, with_slm=False)
        technical = self.technical_agent.analyze(market_data, with_slm=False)
        news = self.news_agent.run(
            symbol,
            use_cache=use_cache,
            with_slm=True,
            company_name=market_data.company_profile.name,
        )
        rag = self.risk_agent.query_rag_risks(symbol)
        risk = self.risk_agent.analyze(symbol, market_data, technical, news, rag)
        return self.synthesis_agent.run(symbol, market_data, technical, news, rag, risk)

    def _market_data_node(self, state: AnalysisState) -> dict:
        started = perf_counter()
        result = self.market_data_agent.run(
            state["ticker"],
            use_cache=state.get("use_cache", True),
            with_slm=False,
        )
        return self._node_result("MarketDataAgent", "market_data", result, started)

    def _news_node(self, state: AnalysisState) -> dict:
        started = perf_counter()
        market_data = state.get("market_data")
        result = self.news_agent.run(
            state["ticker"],
            use_cache=state.get("use_cache", True),
            with_slm=True,
            company_name=market_data.company_profile.name if market_data else None,
        )
        return self._node_result("NewsAgent", "news", result, started)

    def _rag_node(self, state: AnalysisState) -> dict:
        started = perf_counter()
        result = self.risk_agent.query_rag_risks(state["ticker"])
        return self._node_result("RAGAgent", "rag", result, started)

    def _technical_node(self, state: AnalysisState) -> dict:
        started = perf_counter()
        result = self.technical_agent.analyze(state["market_data"], with_slm=False)
        return self._node_result("TechnicalAgent", "technical", result, started)

    def _risk_node(self, state: AnalysisState) -> dict:
        started = perf_counter()
        result = self.risk_agent.analyze(
            state["ticker"],
            state["market_data"],
            state["technical"],
            state["news"],
            state["rag"],
        )
        return self._node_result("RiskAgent", "risk", result, started)

    def _synthesis_node(self, state: AnalysisState) -> dict:
        started = perf_counter()
        result = self.synthesis_agent.run(
            state["ticker"],
            state["market_data"],
            state["technical"],
            state["news"],
            state["rag"],
            state["risk"],
        )
        return self._node_result("SynthesisAgent", "synthesis", result, started)

    def _node_result(self, agent: str, key: str, result, started: float) -> dict:
        return {
            key: result,
            "execution_trace": [
                AgentExecution(
                    agent=agent,
                    status=result.status,
                    duration_ms=max(0, round((perf_counter() - started) * 1000)),
                )
            ],
        }

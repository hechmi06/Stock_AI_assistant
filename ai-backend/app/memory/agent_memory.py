"""Facades memoire des agents.

- AgentMemory (MarketDataAgent) : memoire structuree + knowledge graph.
- TechnicalAgentMemory (TechnicalAgent) : memoire temporelle + knowledge graph.
"""

from __future__ import annotations

from pathlib import Path

from app.agents.schemas import MarketDataResult, TechnicalResult

from .knowledge_graph import KnowledgeGraph
from .structured_memory import StructuredMemory
from .temporal_memory import TemporalMemory


class AgentMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        self.structured = StructuredMemory(db_path)
        self.graph = KnowledgeGraph(db_path)

    def remember(self, result: MarketDataResult) -> str:
        """Memorise un resultat de collecte (tables structurees + faits du graphe)."""
        collected_at = self.structured.store(result)
        self.graph.ingest_result(result)
        return collected_at

    def recall_latest(self, ticker: str) -> tuple[MarketDataResult, str] | None:
        """Derniere collecte connue pour un ticker, ou None si jamais vu."""
        return self.structured.latest_snapshot(ticker)

    def summary(self, ticker: str) -> dict[str, object]:
        """Vue complete de la memoire pour un ticker (tables + faits du graphe)."""
        summary = self.structured.summary(ticker)
        summary["knowledge_graph"] = self.graph.facts_for(ticker)
        return summary


class TechnicalAgentMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        self.temporal = TemporalMemory(db_path)
        self.graph = KnowledgeGraph(db_path)

    def remember(self, result: TechnicalResult) -> str:
        """Memorise les indicateurs dates + met a jour les faits techniques du graphe."""
        computed_at = self.temporal.store(result)
        self.graph.ingest_technical_result(result)
        return computed_at

    def recall_latest(self, ticker: str) -> tuple[TechnicalResult, str] | None:
        return self.temporal.latest(ticker)

    def summary(self, ticker: str) -> dict[str, object]:
        """Serie temporelle des indicateurs + faits techniques du graphe."""
        return {
            "ticker": ticker,
            "snapshot_count": self.temporal.count(ticker),
            "indicator_series": self.temporal.series(ticker),
            "knowledge_graph": self.graph.facts_for(ticker),
        }

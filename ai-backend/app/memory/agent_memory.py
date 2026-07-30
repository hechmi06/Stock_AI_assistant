"""Facades memoire des agents.

- AgentMemory (MarketDataAgent) : memoire structuree + knowledge graph.
- TechnicalAgentMemory (TechnicalAgent) : memoire temporelle + knowledge graph.
- NewsAgentMemory (NewsAgent) : memoire documentaire + knowledge graph.
- SynthesisAgentMemory (SynthesisAgent) : memoire de session + knowledge graph.
"""

from __future__ import annotations

from pathlib import Path

from app.agents.schemas import MarketDataResult, NewsResult, SynthesisResult, TechnicalResult

from .documentary_memory import DocumentaryMemory
from .knowledge_graph import KnowledgeGraph
from .point_in_time import PointInTimeStore
from .session_memory import SessionMemory
from .structured_memory import StructuredMemory
from .temporal_memory import TemporalMemory


class AgentMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        self.structured = StructuredMemory(db_path)
        self.graph = KnowledgeGraph(db_path)
        self.point_in_time = PointInTimeStore(db_path)

    def remember(self, result: MarketDataResult) -> str:
        """Memorise un resultat de collecte (tables structurees + faits du graphe)."""
        collected_at = self.structured.store(result)
        self.point_in_time.safe_record(
            self.point_in_time.record_market_data,
            result,
            collected_at,
        )
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


class NewsAgentMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        self.documentary = DocumentaryMemory(db_path)
        self.graph = KnowledgeGraph(db_path)
        self.point_in_time = PointInTimeStore(db_path)

    def remember(self, result: NewsResult) -> tuple[str, int]:
        """Memorise le run + les articles, met a jour les faits news du graphe."""
        collected_at, new_articles = self.documentary.store(result)
        self.point_in_time.safe_record(
            self.point_in_time.record_news,
            result,
            collected_at,
        )
        self.graph.ingest_news_result(result)
        return collected_at, new_articles

    def recall_latest(self, ticker: str) -> tuple[NewsResult, str] | None:
        return self.documentary.latest_run(ticker)

    def summary(self, ticker: str) -> dict[str, object]:
        """Articles connus + historique de sentiment + faits news du graphe."""
        summary = self.documentary.summary(ticker)
        summary["knowledge_graph"] = self.graph.facts_for(ticker)
        return summary


class SynthesisAgentMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        self.session = SessionMemory(db_path)
        self.graph = KnowledgeGraph(db_path)
        self.point_in_time = PointInTimeStore(db_path)

    def remember(self, result: SynthesisResult) -> str:
        """Memorise la synthese de la session + met a jour les faits du graphe."""
        generated_at = self.session.store(result)
        self.point_in_time.safe_record(
            self.point_in_time.record_derived,
            result.ticker,
            "synthesis",
            result.model_dump(mode="json"),
            result.status,
            generated_at,
        )
        self.graph.ingest_synthesis_result(result)
        return generated_at

    def recall_latest(self, ticker: str) -> tuple[SynthesisResult, str] | None:
        return self.session.latest(ticker)

    def summary(self, ticker: str) -> dict[str, object]:
        """Historique des syntheses (evolution du diagnostic) + faits du graphe."""
        return {
            "ticker": ticker,
            "session_count": self.session.count(ticker),
            "session_history": self.session.history(ticker),
            "knowledge_graph": self.graph.facts_for(ticker),
        }


class TechnicalAgentMemory:
    def __init__(self, db_path: Path | None = None) -> None:
        self.temporal = TemporalMemory(db_path)
        self.graph = KnowledgeGraph(db_path)
        self.point_in_time = PointInTimeStore(db_path)

    def remember(self, result: TechnicalResult) -> str:
        """Memorise les indicateurs dates + met a jour les faits techniques du graphe."""
        computed_at = self.temporal.store(result)
        self.point_in_time.safe_record(
            self.point_in_time.record_derived,
            result.ticker,
            "technical",
            result.model_dump(mode="json"),
            result.status,
            computed_at,
        )
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

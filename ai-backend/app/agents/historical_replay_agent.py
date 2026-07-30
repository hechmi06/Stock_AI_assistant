"""Deterministic replay of the analysis pipeline from point-in-time events."""

from __future__ import annotations

from datetime import datetime

from app.memory import PointInTimeStore

from .risk_agent import RiskAgent
from .schemas import (
    HistoricalReplayResult,
    HistoricalReplayTrace,
    MarketDataResult,
    NewsResult,
    PointInTimeEvent,
    RagResult,
    RiskResult,
    SynthesisResult,
    TechnicalResult,
)
from .synthesis_agent import SynthesisAgent
from .technical_agent import TechnicalAgent


class HistoricalReplayAgent:
    def __init__(
        self,
        point_in_time: PointInTimeStore,
        technical_agent: TechnicalAgent,
        risk_agent: RiskAgent,
        synthesis_agent: SynthesisAgent,
    ) -> None:
        self.point_in_time = point_in_time
        self.technical_agent = technical_agent
        self.risk_agent = risk_agent
        self.synthesis_agent = synthesis_agent

    def run(
        self,
        ticker: str,
        as_of: str,
        allow_reconstructed_prices: bool = False,
    ) -> HistoricalReplayResult:
        symbol = ticker.strip().upper()
        if not symbol:
            return self._failed("", as_of, allow_reconstructed_prices, "Ticker is required.")

        normalized_as_of = self.point_in_time.query(
            symbol,
            as_of=as_of,
            limit=1,
        ).as_of
        if normalized_as_of is None:
            return self._failed(
                symbol,
                as_of,
                allow_reconstructed_prices,
                "Date as_of is required.",
            )

        warnings: list[str] = []
        errors: list[str] = []
        trace: list[HistoricalReplayTrace] = []

        market_event = self.point_in_time.latest_event(
            symbol,
            component="market_data",
            event_type="market_snapshot",
            as_of=normalized_as_of,
            observed_only=True,
        )
        market_data = self._market_data_from_event(symbol, market_event)
        market_events: list[PointInTimeEvent] = [market_event] if market_event else []

        archive_prices, price_events = self.point_in_time.price_history(
            symbol,
            as_of=normalized_as_of,
            observed_only=not allow_reconstructed_prices,
        )
        cutoff_date = normalized_as_of[:10]
        snapshot_prices = [
            point
            for point in market_data.historical_prices
            if point.date[:10] <= cutoff_date
        ]
        if allow_reconstructed_prices and archive_prices:
            market_data.historical_prices = archive_prices
            market_data.price = archive_prices[-1].close
            if market_data.status == "failed":
                market_data.status = "partial"
            if not market_data.sources_used:
                source = price_events[-1].source if price_events else ""
                if source in {
                    "twelve_data",
                    "yfinance",
                    "alpha_vantage",
                    "financial_modeling_prep",
                    "tiingo",
                }:
                    market_data.sources_used = [source]
            market_data.warnings.append(
                "Replay recherche : historique de prix reconstruit a posteriori."
            )
            market_events.extend(price_events)
            warnings.append(
                "Les prix reconstruits sont autorises; ce replay ne qualifie pas un backtest strict complet."
            )
        else:
            market_data.historical_prices = snapshot_prices

        if market_event is None and not market_data.historical_prices:
            market_data.errors.append(
                "Aucun snapshot marche observe n'etait disponible a cette date."
            )
        trace.append(
            self._trace(
                "market_data",
                market_data.status,
                market_events,
                (
                    f"{len(market_data.historical_prices)} prix disponibles."
                    if market_data.historical_prices
                    else "Aucune donnee marche admissible."
                ),
            )
        )

        if len(market_data.historical_prices) >= 50:
            technical = self.technical_agent.analyze(
                market_data,
                with_slm=False,
                remember=False,
            )
        else:
            technical = TechnicalResult(
                ticker=symbol,
                status="failed",
                sources_used=market_data.sources_used,
                errors=[
                    "Au moins 50 prix anterieurs ou egaux a as_of sont requis pour le replay technique."
                ],
            )
        trace.append(
            HistoricalReplayTrace(
                component="technical",
                status=technical.status,
                event_count=len(market_data.historical_prices),
                knowledge_modes=(
                    ["reconstructed"]
                    if allow_reconstructed_prices and price_events
                    else ["derived"]
                ),
                message="Indicateurs recalcules sans SLM et sans memorisation.",
            )
        )

        news_event = self.point_in_time.latest_event(
            symbol,
            component="news",
            event_type="news_snapshot",
            as_of=normalized_as_of,
            observed_only=True,
        )
        news = self._news_from_event(symbol, news_event)
        trace.append(
            self._trace(
                "news",
                news.status,
                [news_event] if news_event else [],
                (
                    f"{len(news.articles)} articles dans le dernier snapshot admissible."
                    if news_event
                    else "Aucun snapshot NewsAgent observe a cette date."
                ),
            )
        )

        document_query = self.point_in_time.query(
            symbol,
            component="rag",
            event_type="financial_document",
            as_of=normalized_as_of,
            observed_only=True,
            limit=20,
        )
        if document_query.events:
            rag = RagResult(
                ticker=symbol,
                question="Replay historique des risques documentaires",
                status="partial",
                indexed_chunks=sum(
                    int(event.payload.get("chunks_indexed") or 0)
                    for event in document_query.events
                ),
                warnings=[
                    "Documents disponibles, mais les passages RAG historiques ne sont pas encore rejoues."
                ],
            )
        else:
            rag = RagResult(
                ticker=symbol,
                question="Replay historique des risques documentaires",
                status="failed",
                errors=["Aucun document RAG strictement observe a cette date."],
            )
        trace.append(
            self._trace(
                "rag",
                rag.status,
                document_query.events,
                (
                    f"{len(document_query.events)} documents admissibles."
                    if document_query.events
                    else "Aucun document admissible en mode strict."
                ),
            )
        )

        risk = self.risk_agent.analyze(
            symbol,
            market_data,
            technical,
            news,
            rag,
            with_slm=False,
            remember=False,
        )
        trace.append(
            HistoricalReplayTrace(
                component="risk",
                status=risk.status,
                knowledge_modes=["derived"],
                message="Risque recalcule uniquement depuis les composants rejoues.",
            )
        )

        synthesis = self.synthesis_agent.run(
            symbol,
            market_data,
            technical,
            news,
            rag,
            risk,
            with_slm=False,
            remember=False,
        )
        trace.append(
            HistoricalReplayTrace(
                component="synthesis",
                status=synthesis.status,
                knowledge_modes=["derived"],
                message="Synthese deterministe, sans SLM et sans comparaison a une session future.",
            )
        )

        archive_components = (market_event is not None, news_event is not None, bool(document_query.events))
        coverage_score = round(sum(archive_components) / len(archive_components) * 100)
        guard_passed = self._lookahead_guard(
            normalized_as_of,
            [*market_events, *([news_event] if news_event else []), *document_query.events],
            market_data,
        )
        if not guard_passed:
            errors.append("Le garde anti-lookahead a detecte une donnee posterieure a as_of.")
        if news_event is None:
            warnings.append("NewsAgent incomplet : aucun snapshot observe avant as_of.")
        if not document_query.events:
            warnings.append("RAGAgent incomplet : aucun document observe avant as_of.")

        if not guard_passed or market_data.status == "failed":
            status = "failed"
        elif synthesis.status == "success" and coverage_score == 100:
            status = "success"
        else:
            status = "partial"

        return HistoricalReplayResult(
            ticker=symbol,
            status=status,
            as_of=normalized_as_of,
            replay_mode="research" if allow_reconstructed_prices else "strict",
            allow_reconstructed_prices=allow_reconstructed_prices,
            lookahead_guard_passed=guard_passed,
            archive_coverage_score=coverage_score,
            trace=trace,
            market_data=market_data,
            technical=technical,
            news=news,
            rag=rag,
            risk=risk,
            synthesis=synthesis,
            warnings=warnings,
            errors=errors,
        )

    @staticmethod
    def _market_data_from_event(
        ticker: str,
        event: PointInTimeEvent | None,
    ) -> MarketDataResult:
        if event is None:
            return MarketDataResult(ticker=ticker, status="failed")
        try:
            return MarketDataResult.model_validate(event.payload)
        except Exception as error:
            return MarketDataResult(
                ticker=ticker,
                status="failed",
                errors=[f"Snapshot marche invalide: {error}"],
            )

    @staticmethod
    def _news_from_event(
        ticker: str,
        event: PointInTimeEvent | None,
    ) -> NewsResult:
        if event is None:
            return NewsResult(
                ticker=ticker,
                status="failed",
                errors=["Aucun snapshot NewsAgent observe a cette date."],
            )
        try:
            return NewsResult.model_validate(event.payload)
        except Exception as error:
            return NewsResult(
                ticker=ticker,
                status="failed",
                errors=[f"Snapshot news invalide: {error}"],
            )

    @staticmethod
    def _trace(
        component: str,
        status: str,
        events: list[PointInTimeEvent],
        message: str,
    ) -> HistoricalReplayTrace:
        return HistoricalReplayTrace(
            component=component,
            status=status,
            event_ids=[event.id for event in events[:20]],
            event_count=len(events),
            latest_available_at=max(
                (event.available_at for event in events),
                default=None,
            ),
            knowledge_modes=list(
                dict.fromkeys(event.knowledge_mode for event in events)
            ),
            message=message,
        )

    @staticmethod
    def _lookahead_guard(
        as_of: str,
        events: list[PointInTimeEvent],
        market_data: MarketDataResult,
    ) -> bool:
        cutoff = datetime.fromisoformat(as_of)
        if any(datetime.fromisoformat(event.available_at) > cutoff for event in events):
            return False
        cutoff_date = cutoff.date().isoformat()
        return all(point.date[:10] <= cutoff_date for point in market_data.historical_prices)

    @staticmethod
    def _failed(
        ticker: str,
        as_of: str,
        allow_reconstructed_prices: bool,
        error: str,
    ) -> HistoricalReplayResult:
        market = MarketDataResult(ticker=ticker, status="failed")
        technical = TechnicalResult(ticker=ticker, status="failed")
        news = NewsResult(ticker=ticker, status="failed")
        rag = RagResult(ticker=ticker, question="", status="failed")
        risk = RiskResult(
            ticker=ticker,
            status="failed",
            overall_risk_level="high",
            risk_score=100,
        )
        synthesis = SynthesisResult(ticker=ticker, status="failed")
        return HistoricalReplayResult(
            ticker=ticker,
            status="failed",
            as_of=as_of,
            replay_mode="research" if allow_reconstructed_prices else "strict",
            allow_reconstructed_prices=allow_reconstructed_prices,
            market_data=market,
            technical=technical,
            news=news,
            rag=rag,
            risk=risk,
            synthesis=synthesis,
            errors=[error],
        )

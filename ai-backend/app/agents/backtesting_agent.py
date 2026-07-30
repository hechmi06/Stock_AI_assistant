"""Walk-forward validation of the deterministic TechnicalAgent.

Each signal is calculated only from prices known on its signal date. The first
version intentionally excludes news, fundamentals and RAG because the project
does not yet store point-in-time archives for those inputs.
"""

from __future__ import annotations

import math
import time
from statistics import pstdev

from .mcp_client import McpClient
from .schemas import (
    BacktestCalibrationBucket,
    BacktestMetrics,
    BacktestObservation,
    BacktestResult,
    HistoricalPrice,
    MarketDataResult,
    QualificationCheck,
)
from .technical_agent import TechnicalAgent


class BacktestingAgent:
    PERIODS = {"2y", "5y", "10y"}

    def __init__(
        self,
        mcp_client: McpClient | None = None,
        technical_agent: TechnicalAgent | None = None,
    ) -> None:
        self.mcp_client = mcp_client or McpClient()
        self.technical_agent = technical_agent or TechnicalAgent()
        market_agent = getattr(self.technical_agent, "market_data_agent", None)
        memory = getattr(market_agent, "memory", None)
        self.point_in_time = getattr(memory, "point_in_time", None)
        self._history_cache: dict[tuple[str, str], tuple[float, list[HistoricalPrice]]] = {}

    def run(
        self,
        ticker: str,
        benchmark: str = "SPY",
        period: str = "5y",
        horizon_days: int = 20,
        min_history: int = 60,
        transaction_cost_bps: float = 5.0,
        slippage_bps: float = 5.0,
    ) -> BacktestResult:
        symbol = ticker.strip().upper()
        benchmark_symbol = benchmark.strip().upper()
        normalized_period = period.strip().lower()
        horizon = max(1, min(252, horizon_days))
        history_floor = max(50, min(500, min_history))
        transaction_cost = max(0.0, min(200.0, transaction_cost_bps))
        slippage = max(0.0, min(200.0, slippage_bps))
        round_trip_cost = 2 * (transaction_cost + slippage) / 10_000

        if not symbol or not benchmark_symbol:
            return self._failed(symbol, benchmark_symbol, normalized_period, horizon, history_floor, "Ticker et benchmark requis.")
        if normalized_period not in self.PERIODS:
            return self._failed(
                symbol,
                benchmark_symbol,
                normalized_period,
                horizon,
                history_floor,
                "Periode invalide. Valeurs acceptees : 2y, 5y, 10y.",
            )

        ticker_prices = self._load_history(symbol, normalized_period)
        benchmark_prices = self._load_history(benchmark_symbol, normalized_period)
        if len(ticker_prices) < history_floor + horizon:
            return self._failed(
                symbol,
                benchmark_symbol,
                normalized_period,
                horizon,
                history_floor,
                f"Historique {symbol} insuffisant ({len(ticker_prices)} points).",
                len(ticker_prices),
            )
        if len(benchmark_prices) < history_floor + horizon:
            return self._failed(
                symbol,
                benchmark_symbol,
                normalized_period,
                horizon,
                history_floor,
                f"Historique {benchmark_symbol} insuffisant ({len(benchmark_prices)} points).",
                len(ticker_prices),
            )

        benchmark_by_date = {point.date: point for point in benchmark_prices}
        aligned = [point for point in ticker_prices if point.date in benchmark_by_date]
        if len(aligned) < history_floor + horizon:
            return self._failed(
                symbol,
                benchmark_symbol,
                normalized_period,
                horizon,
                history_floor,
                "Pas assez de seances communes entre l'action et le benchmark.",
                len(ticker_prices),
            )

        observations: list[BacktestObservation] = []
        strategy_equity = ticker_equity = benchmark_equity = 1.0
        strategy_returns: list[float] = []
        ticker_returns: list[float] = []
        benchmark_returns: list[float] = []
        scores_and_returns: list[tuple[int, float]] = []

        for signal_index in range(history_floor - 1, len(aligned) - horizon, horizon):
            exit_index = signal_index + horizon
            known_prices = aligned[: signal_index + 1]
            entry = aligned[signal_index]
            exit_point = aligned[exit_index]
            benchmark_entry = benchmark_by_date[entry.date]
            benchmark_exit = benchmark_by_date[exit_point.date]

            technical = self.technical_agent.analyze(
                MarketDataResult(
                    ticker=symbol,
                    status="success",
                    sources_used=["yfinance"],
                    price=entry.close,
                    historical_prices=known_prices,
                ),
                with_slm=False,
                remember=False,
            )
            if technical.technical_score is None:
                continue

            ticker_return = self._return(entry.close, exit_point.close)
            benchmark_return = self._return(benchmark_entry.close, benchmark_exit.close)
            strategy_return = ticker_return - round_trip_cost if technical.signal == "positive" else 0.0

            strategy_equity *= 1 + strategy_return
            ticker_equity *= 1 + ticker_return
            benchmark_equity *= 1 + benchmark_return
            strategy_returns.append(strategy_return)
            ticker_returns.append(ticker_return)
            benchmark_returns.append(benchmark_return)
            scores_and_returns.append((technical.technical_score, ticker_return))

            observations.append(
                BacktestObservation(
                    signal_date=entry.date,
                    exit_date=exit_point.date,
                    technical_score=technical.technical_score,
                    signal=technical.signal,
                    entry_price=round(entry.close, 4),
                    exit_price=round(exit_point.close, 4),
                    forward_return_percent=self._percent(ticker_return),
                    strategy_return_percent=self._percent(strategy_return),
                    benchmark_return_percent=self._percent(benchmark_return),
                    execution_cost_percent=self._percent(round_trip_cost if technical.signal == "positive" else 0.0),
                    cumulative_strategy_percent=self._percent(strategy_equity - 1),
                    cumulative_ticker_percent=self._percent(ticker_equity - 1),
                    cumulative_benchmark_percent=self._percent(benchmark_equity - 1),
                    feature_signals=self._feature_signals(technical, entry.close),
                )
            )

        if not observations:
            return self._failed(
                symbol,
                benchmark_symbol,
                normalized_period,
                horizon,
                history_floor,
                "Aucune observation de backtest calculable.",
                len(aligned),
            )

        total_trading_days = len(observations) * horizon
        strategy_total = strategy_equity - 1
        benchmark_total = benchmark_equity - 1
        annual_factor = 252 / horizon
        annualized_return = strategy_equity ** (252 / total_trading_days) - 1
        annualized_volatility = pstdev(strategy_returns) * math.sqrt(annual_factor) if len(strategy_returns) > 1 else 0.0
        sharpe = annualized_return / annualized_volatility if annualized_volatility > 0 else None

        directional = [
            (observation.signal == "positive" and observation.forward_return_percent > 0)
            or (observation.signal == "negative" and observation.forward_return_percent < 0)
            for observation in observations
            if observation.signal != "neutral"
        ]
        invested = [
            observation.strategy_return_percent / 100
            for observation in observations
            if observation.signal == "positive"
        ]
        evaluation_count = len(observations)
        reliability = "high" if evaluation_count >= 45 else "medium" if evaluation_count >= 20 else "low"
        warnings = [
            "Le backtest valide uniquement le TechnicalAgent. News, fondamentaux, RAG, Risk et Synthesis sont exclus faute d'archives point-in-time.",
            "Les dividendes, taxes et impacts de marche non lineaires ne sont pas encore modelises.",
        ]
        if reliability == "low":
            warnings.append("Echantillon limite : les statistiques ne suffisent pas encore pour conclure avec confiance.")

        confidence_low, confidence_high = self._mean_confidence_interval(strategy_returns)
        metrics = BacktestMetrics(
            strategy_return_percent=self._percent(strategy_total),
            ticker_buy_hold_return_percent=self._percent(ticker_equity - 1),
            benchmark_return_percent=self._percent(benchmark_total),
            excess_return_percent=self._percent(strategy_total - benchmark_total),
            annualized_return_percent=self._percent(annualized_return),
            annualized_volatility_percent=self._percent(annualized_volatility),
            sharpe_ratio=round(sharpe, 2) if sharpe is not None else None,
            max_drawdown_percent=self._max_drawdown(observations),
            average_trade_return_percent=self._percent(sum(strategy_returns) / len(strategy_returns)),
            directional_accuracy_percent=round(sum(directional) / len(directional) * 100, 1) if directional else None,
            invested_win_rate_percent=round(sum(value > 0 for value in invested) / len(invested) * 100, 1) if invested else None,
            mean_return_ci_95_low_percent=self._percent(confidence_low) if confidence_low is not None else None,
            mean_return_ci_95_high_percent=self._percent(confidence_high) if confidence_high is not None else None,
        )
        qualification_checks = self._qualification_checks(evaluation_count, metrics)
        verdict = self._verdict(reliability, qualification_checks, metrics)

        return BacktestResult(
            ticker=symbol,
            benchmark=benchmark_symbol,
            status="success" if reliability != "low" else "partial",
            period=normalized_period,
            horizon_days=horizon,
            min_history=history_floor,
            transaction_cost_bps=transaction_cost,
            slippage_bps=slippage,
            period_start=aligned[0].date,
            period_end=aligned[-1].date,
            history_points=len(aligned),
            evaluation_count=evaluation_count,
            signal_counts={
                signal: sum(1 for observation in observations if observation.signal == signal)
                for signal in ("positive", "neutral", "negative")
            },
            reliability_level=reliability,
            verdict=verdict,
            qualification_checks=qualification_checks,
            metrics=metrics,
            calibration=self._calibration(scores_and_returns),
            observations=observations,
            excluded_components=["fundamental", "news", "rag", "risk", "synthesis", "slm"],
            warnings=warnings,
        )

    def _load_history(self, ticker: str, period: str) -> list[HistoricalPrice]:
        cache_key = (ticker.strip().upper(), period)
        cached = self._history_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < 15 * 60:
            return cached[1]
        payload = self.mcp_client.get(
            f"/tools/historical-prices/{ticker}?period={period}",
            timeout=45,
        )
        if not payload:
            return []
        rows = payload.get("historical_prices")
        if not isinstance(rows, list):
            return []
        parsed: list[HistoricalPrice] = []
        for row in rows:
            try:
                parsed.append(HistoricalPrice.model_validate(row))
            except Exception:
                continue
        result = sorted(parsed, key=lambda point: point.date)
        if result:
            self._history_cache[cache_key] = (time.monotonic(), result)
            if self.point_in_time is not None:
                self.point_in_time.safe_record(
                    self.point_in_time.record_price_history,
                    ticker,
                    result,
                    "yfinance",
                )
        return result

    @staticmethod
    def _return(start: float, end: float) -> float:
        return (end / start) - 1 if start else 0.0

    @staticmethod
    def _feature_signals(technical, last_close: float) -> dict[str, float]:
        """Directional factors normalized to [-1, 1] for transparent calibration."""
        factors: dict[str, float] = {}

        if technical.rsi is not None:
            factors["rsi_momentum"] = BacktestingAgent._clip((technical.rsi - 50) / 20)

        sma_50 = technical.moving_averages.sma_50
        if sma_50:
            factors["price_vs_sma50"] = BacktestingAgent._clip((last_close / sma_50 - 1) / 0.10)

        ema_200 = technical.moving_averages.ema_200
        if ema_200:
            factors["price_vs_ema200"] = BacktestingAgent._clip((last_close / ema_200 - 1) / 0.20)

        if technical.macd.histogram is not None and technical.atr_14:
            factors["macd_atr"] = BacktestingAgent._clip(
                technical.macd.histogram / technical.atr_14 / 2
            )

        position = technical.bollinger_bands.position_percent
        if position is not None:
            factors["bollinger_position"] = BacktestingAgent._clip((position - 50) / 50)

        volume_ratio = technical.volume_analysis.volume_ratio
        if volume_ratio is not None:
            trend_direction = 1 if technical.trend == "bullish" else -1 if technical.trend == "bearish" else 0
            factors["volume_confirmation"] = BacktestingAgent._clip(
                (volume_ratio - 1) * trend_direction
            )

        if technical.atr_percent is not None:
            factors["atr_regime"] = BacktestingAgent._clip((technical.atr_percent - 2) / 3)

        return {name: round(value, 6) for name, value in factors.items()}

    @staticmethod
    def _clip(value: float, minimum: float = -1.0, maximum: float = 1.0) -> float:
        return max(minimum, min(maximum, value))

    @staticmethod
    def _percent(value: float) -> float:
        return round(value * 100, 2)

    @staticmethod
    def _max_drawdown(observations: list[BacktestObservation]) -> float:
        peak = 1.0
        maximum = 0.0
        for observation in observations:
            equity = 1 + observation.cumulative_strategy_percent / 100
            peak = max(peak, equity)
            maximum = max(maximum, (peak - equity) / peak if peak else 0.0)
        return round(maximum * 100, 2)

    @staticmethod
    def _calibration(values: list[tuple[int, float]]) -> list[BacktestCalibrationBucket]:
        definitions = (("Faible", 0, 40), ("Neutre", 41, 64), ("Positif", 65, 100))
        buckets: list[BacktestCalibrationBucket] = []
        for label, minimum, maximum in definitions:
            returns = [forward for score, forward in values if minimum <= score <= maximum]
            buckets.append(
                BacktestCalibrationBucket(
                    label=label,
                    score_min=minimum,
                    score_max=maximum,
                    observations=len(returns),
                    average_forward_return_percent=round(sum(returns) / len(returns) * 100, 2) if returns else None,
                    positive_return_rate_percent=round(sum(value > 0 for value in returns) / len(returns) * 100, 1) if returns else None,
                )
            )
        return buckets

    @staticmethod
    def _mean_confidence_interval(values: list[float]) -> tuple[float | None, float | None]:
        if len(values) < 2:
            return None, None
        average = sum(values) / len(values)
        margin = 1.96 * pstdev(values) / math.sqrt(len(values))
        return average - margin, average + margin

    @staticmethod
    def _qualification_checks(
        evaluation_count: int,
        metrics: BacktestMetrics,
    ) -> list[QualificationCheck]:
        return [
            QualificationCheck(
                name="sample_size",
                passed=evaluation_count >= 45,
                actual=evaluation_count,
                threshold=">= 45 observations",
            ),
            QualificationCheck(
                name="excess_return",
                passed=metrics.excess_return_percent > 0,
                actual=metrics.excess_return_percent,
                threshold="> 0% vs benchmark",
            ),
            QualificationCheck(
                name="sharpe_ratio",
                passed=(metrics.sharpe_ratio or 0) >= 0.8,
                actual=metrics.sharpe_ratio,
                threshold=">= 0.80",
            ),
            QualificationCheck(
                name="directional_accuracy",
                passed=(metrics.directional_accuracy_percent or 0) >= 52,
                actual=metrics.directional_accuracy_percent,
                threshold=">= 52%",
            ),
            QualificationCheck(
                name="confidence_interval",
                passed=(metrics.mean_return_ci_95_low_percent or -1) >= 0,
                actual=metrics.mean_return_ci_95_low_percent,
                threshold="borne basse 95% >= 0%",
            ),
        ]

    @staticmethod
    def _verdict(
        reliability: str,
        checks: list[QualificationCheck],
        metrics: BacktestMetrics,
    ) -> str:
        if reliability == "low":
            return "insufficient"
        if all(check.passed for check in checks):
            return "validated"
        if metrics.excess_return_percent < 0 and (metrics.sharpe_ratio or 0) < 0.5:
            return "not_validated"
        return "recalibrate"

    @staticmethod
    def _failed(
        ticker: str,
        benchmark: str,
        period: str,
        horizon: int,
        min_history: int,
        error: str,
        history_points: int = 0,
    ) -> BacktestResult:
        return BacktestResult(
            ticker=ticker,
            benchmark=benchmark,
            status="failed",
            period=period,
            horizon_days=horizon,
            min_history=min_history,
            history_points=history_points,
            excluded_components=["fundamental", "news", "rag", "risk", "synthesis", "slm"],
            errors=[error],
        )

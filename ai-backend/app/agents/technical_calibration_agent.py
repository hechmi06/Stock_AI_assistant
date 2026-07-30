"""Chronological, multi-asset calibration of the TechnicalAgent entry threshold."""

from __future__ import annotations

import math
from statistics import pstdev

from .backtesting_agent import BacktestingAgent
from .schemas import (
    BacktestObservation,
    CalibrationHorizonResult,
    CalibrationSplitMetrics,
    CalibrationTickerCoverage,
    QualificationCheck,
    TechnicalCalibrationResult,
    TechnicalFeatureDiagnostic,
    TechnicalFeatureModel,
)


DEFAULT_CALIBRATION_UNIVERSE = [
    "AAPL",
    "MSFT",
    "NVDA",
    "GOOGL",
    "AMZN",
    "META",
    "TSLA",
    "JPM",
    "JNJ",
    "XOM",
    "UNH",
    "PG",
    "HD",
    "CAT",
    "COST",
]


class TechnicalCalibrationAgent:
    THRESHOLD_CANDIDATES = tuple(range(45, 81, 5))
    FEATURE_THRESHOLD_CANDIDATES = tuple(range(50, 76, 5))
    FEATURE_LABELS = {
        "rsi_momentum": "Momentum RSI",
        "price_vs_sma50": "Prix vs SMA 50",
        "price_vs_ema200": "Prix vs EMA 200",
        "macd_atr": "MACD normalise par ATR",
        "bollinger_position": "Position Bollinger",
        "volume_confirmation": "Confirmation volume",
        "atr_regime": "Regime de volatilite ATR",
    }

    def __init__(self, backtesting_agent: BacktestingAgent | None = None) -> None:
        self.backtesting_agent = backtesting_agent or BacktestingAgent()

    def run(
        self,
        tickers: list[str] | None = None,
        benchmark: str = "SPY",
        period: str = "5y",
        horizons: list[int] | None = None,
        transaction_cost_bps: float = 5.0,
        slippage_bps: float = 5.0,
    ) -> TechnicalCalibrationResult:
        universe = self._normalize_tickers(tickers or DEFAULT_CALIBRATION_UNIVERSE)
        selected_horizons = sorted(set(horizons or [5, 20, 60]))
        if not universe:
            return self._failed(benchmark, period, selected_horizons, transaction_cost_bps, slippage_bps, "Au moins un ticker est requis.")
        if any(horizon not in (5, 20, 60) for horizon in selected_horizons):
            return self._failed(
                benchmark,
                period,
                selected_horizons,
                transaction_cost_bps,
                slippage_bps,
                "Horizons acceptes : 5, 20 et 60 jours.",
            )

        pooled: dict[int, dict[str, list[BacktestObservation]]] = {
            horizon: {"train": [], "validation": [], "test": []}
            for horizon in selected_horizons
        }
        coverage_by_ticker: dict[str, CalibrationTickerCoverage] = {
            ticker: CalibrationTickerCoverage(ticker=ticker, status="failed")
            for ticker in universe
        }

        for ticker in universe:
            successful_horizons = 0
            errors: list[str] = []
            for horizon in selected_horizons:
                result = self.backtesting_agent.run(
                    ticker,
                    benchmark=benchmark,
                    period=period,
                    horizon_days=horizon,
                    transaction_cost_bps=transaction_cost_bps,
                    slippage_bps=slippage_bps,
                )
                coverage_by_ticker[ticker].observations_by_horizon[str(horizon)] = result.evaluation_count
                if result.status == "failed" or len(result.observations) < 5:
                    errors.extend(result.errors or [f"Historique insuffisant a {horizon} jours."])
                    continue
                train, validation, test = self._chronological_split(result.observations)
                pooled[horizon]["train"].extend(train)
                pooled[horizon]["validation"].extend(validation)
                pooled[horizon]["test"].extend(test)
                successful_horizons += 1

            coverage_by_ticker[ticker].status = (
                "success"
                if successful_horizons == len(selected_horizons)
                else "partial"
                if successful_horizons
                else "failed"
            )
            coverage_by_ticker[ticker].error = " | ".join(dict.fromkeys(errors)) or None

        completed = [
            ticker
            for ticker, coverage in coverage_by_ticker.items()
            if coverage.status != "failed"
        ]
        horizon_results: list[CalibrationHorizonResult] = []
        round_trip_cost = 2 * (max(0, transaction_cost_bps) + max(0, slippage_bps)) / 10_000

        for horizon in selected_horizons:
            train_rows = pooled[horizon]["train"]
            validation_rows = pooled[horizon]["validation"]
            test_rows = pooled[horizon]["test"]
            threshold = self._select_threshold(train_rows, horizon, round_trip_cost)
            train_metrics = self._metrics(train_rows, threshold, horizon, round_trip_cost)
            validation_metrics = self._metrics(validation_rows, threshold, horizon, round_trip_cost)
            test_metrics = self._metrics(test_rows, threshold, horizon, round_trip_cost)
            checks = self._qualification_checks(validation_metrics, test_metrics)
            feature_model = self._calibrate_feature_model(
                train_rows,
                validation_rows,
                test_rows,
                horizon,
                round_trip_cost,
                baseline_test=test_metrics,
            )
            passed_count = sum(check.passed for check in checks)
            if test_metrics.observations < 30 or test_metrics.invested_trades < 15:
                verdict = "insufficient"
            elif passed_count == len(checks):
                verdict = "validated"
            elif passed_count >= 4 and validation_metrics.average_excess_return_percent > 0:
                verdict = "promising"
            else:
                verdict = "not_validated"
            horizon_results.append(
                CalibrationHorizonResult(
                    horizon_days=horizon,
                    selected_threshold=threshold,
                    train=train_metrics,
                    validation=validation_metrics,
                    test=test_metrics,
                    verdict=verdict,
                    checks=checks,
                    feature_model=feature_model,
                )
            )

        verdicts = [result.verdict for result in horizon_results]
        if not completed or all(verdict == "insufficient" for verdict in verdicts):
            overall_verdict = "insufficient"
        elif sum(verdict == "validated" for verdict in verdicts) >= 2:
            overall_verdict = "validated"
        elif any(verdict in ("validated", "promising") for verdict in verdicts):
            overall_verdict = "promising"
        else:
            overall_verdict = "not_validated"

        status = "success" if len(completed) == len(universe) else "partial" if completed else "failed"
        warnings = [
            "Le seuil est optimise uniquement sur train, puis fige pour validation et test.",
            "Le modele de facteurs candidat selectionne les indicateurs sur train/validation; le test reste strictement hors echantillon.",
            "Le score de production actuel n'est jamais remplace automatiquement par un modele candidat.",
            "Les resultats agregent plusieurs titres; ils qualifient la regle technique, pas une action particuliere.",
            "Les dividendes, taxes et impacts de marche non lineaires restent exclus.",
        ]
        if len(completed) < 10:
            warnings.append("Couverture inferieure a 10 titres : prudence avant toute qualification globale.")

        return TechnicalCalibrationResult(
            status=status,
            benchmark=benchmark.strip().upper(),
            period=period,
            tickers_requested=universe,
            tickers_completed=completed,
            horizons=selected_horizons,
            transaction_cost_bps=max(0, transaction_cost_bps),
            slippage_bps=max(0, slippage_bps),
            split={"train": 0.60, "validation": 0.20, "test": 0.20},
            overall_verdict=overall_verdict,
            horizon_results=horizon_results,
            coverage=list(coverage_by_ticker.values()),
            warnings=warnings,
        )

    @staticmethod
    def _normalize_tickers(tickers: list[str]) -> list[str]:
        return list(
            dict.fromkeys(
                ticker.strip().upper()
                for ticker in tickers[:20]
                if ticker and ticker.strip()
            )
        )

    @staticmethod
    def _chronological_split(
        observations: list[BacktestObservation],
    ) -> tuple[list[BacktestObservation], list[BacktestObservation], list[BacktestObservation]]:
        ordered = sorted(observations, key=lambda row: row.signal_date)
        train_end = max(1, int(len(ordered) * 0.60))
        validation_end = max(train_end + 1, int(len(ordered) * 0.80))
        validation_end = min(validation_end, len(ordered) - 1)
        return ordered[:train_end], ordered[train_end:validation_end], ordered[validation_end:]

    def _select_threshold(
        self,
        rows: list[BacktestObservation],
        horizon: int,
        round_trip_cost: float,
    ) -> int:
        minimum_trades = max(10, int(len(rows) * 0.10))
        candidates: list[tuple[float, int]] = []
        for threshold in self.THRESHOLD_CANDIDATES:
            metrics = self._metrics(rows, threshold, horizon, round_trip_cost)
            if metrics.invested_trades < minimum_trades:
                continue
            sharpe = metrics.annualized_sharpe_ratio if metrics.annualized_sharpe_ratio is not None else -5.0
            objective = sharpe + 4 * (metrics.average_excess_return_percent / 100)
            candidates.append((objective, threshold))
        return max(candidates, default=(-999.0, 65), key=lambda value: value[0])[1]

    def _calibrate_feature_model(
        self,
        train_rows: list[BacktestObservation],
        validation_rows: list[BacktestObservation],
        test_rows: list[BacktestObservation],
        horizon: int,
        round_trip_cost: float,
        baseline_test: CalibrationSplitMetrics,
    ) -> TechnicalFeatureModel:
        diagnostics: list[TechnicalFeatureDiagnostic] = []
        selected_strengths: dict[str, float] = {}

        for name, label in self.FEATURE_LABELS.items():
            train_ic, train_coverage = self._feature_ic(train_rows, name)
            validation_ic, _ = self._feature_ic(validation_rows, name)
            test_ic, _ = self._feature_ic(test_rows, name)
            selected = False
            rejection_reason: str | None = None

            if train_coverage < 60:
                rejection_reason = "couverture train < 60%"
            elif train_ic is None or abs(train_ic) < 0.02:
                rejection_reason = "|IC train| < 0.02"
            elif validation_ic is None or abs(validation_ic) < 0.01:
                rejection_reason = "|IC validation| < 0.01"
            elif train_ic * validation_ic <= 0:
                rejection_reason = "sens instable entre train et validation"
            else:
                selected = True
                selected_strengths[name] = train_ic

            diagnostics.append(
                TechnicalFeatureDiagnostic(
                    name=name,
                    label=label,
                    train_information_coefficient=self._round_optional(train_ic),
                    validation_information_coefficient=self._round_optional(validation_ic),
                    test_information_coefficient=self._round_optional(test_ic),
                    train_coverage_percent=round(train_coverage, 1),
                    selected=selected,
                    rejection_reason=rejection_reason,
                )
            )

        if not selected_strengths:
            return TechnicalFeatureModel(
                status="insufficient",
                baseline_test=baseline_test,
                diagnostics=diagnostics,
                notes=[
                    "Aucun facteur ne conserve un coefficient d'information stable entre train et validation.",
                    "Le score de production reste inchange.",
                ],
            )

        total_strength = sum(abs(value) for value in selected_strengths.values())
        weights = {
            name: value / total_strength
            for name, value in selected_strengths.items()
        }
        for diagnostic in diagnostics:
            diagnostic.weight = round(weights.get(diagnostic.name, 0.0), 4)

        scored_train = self._score_feature_rows(train_rows, weights)
        scored_validation = self._score_feature_rows(validation_rows, weights)
        scored_test = self._score_feature_rows(test_rows, weights)
        threshold = self._select_feature_threshold(
            scored_train,
            horizon,
            round_trip_cost,
        )
        train_metrics = self._metrics(scored_train, threshold, horizon, round_trip_cost)
        validation_metrics = self._metrics(scored_validation, threshold, horizon, round_trip_cost)
        test_metrics = self._metrics(scored_test, threshold, horizon, round_trip_cost)
        uplift = round(
            test_metrics.average_excess_return_percent
            - baseline_test.average_excess_return_percent,
            3,
        )
        checks = self._feature_model_checks(validation_metrics, test_metrics, baseline_test)
        production_eligible = all(check.passed for check in checks)

        return TechnicalFeatureModel(
            status="candidate" if production_eligible else "rejected",
            production_eligible=production_eligible,
            selected_features=list(weights),
            weights={name: round(value, 4) for name, value in weights.items()},
            selected_threshold=threshold,
            train=train_metrics,
            validation=validation_metrics,
            test=test_metrics,
            baseline_test=baseline_test,
            test_excess_uplift_percent=uplift,
            diagnostics=diagnostics,
            checks=checks,
            notes=[
                "Les poids sont derives uniquement des IC du train.",
                "La validation sert a eliminer les facteurs instables; le test ne participe a aucun choix.",
                "Poids signes: une valeur negative inverse le signal normalise du facteur.",
            ],
        )

    def _select_feature_threshold(
        self,
        rows: list[BacktestObservation],
        horizon: int,
        round_trip_cost: float,
    ) -> int:
        minimum_trades = max(10, int(len(rows) * 0.10))
        candidates: list[tuple[float, int]] = []
        for threshold in self.FEATURE_THRESHOLD_CANDIDATES:
            metrics = self._metrics(rows, threshold, horizon, round_trip_cost)
            if metrics.invested_trades < minimum_trades:
                continue
            sharpe = metrics.annualized_sharpe_ratio if metrics.annualized_sharpe_ratio is not None else -5.0
            objective = sharpe + 4 * (metrics.average_excess_return_percent / 100)
            candidates.append((objective, threshold))
        return max(candidates, default=(-999.0, 65), key=lambda value: value[0])[1]

    @staticmethod
    def _score_feature_rows(
        rows: list[BacktestObservation],
        weights: dict[str, float],
    ) -> list[BacktestObservation]:
        scored: list[BacktestObservation] = []
        for row in rows:
            available = {
                name: value
                for name, value in row.feature_signals.items()
                if name in weights
            }
            available_weight = sum(abs(weights[name]) for name in available)
            if available_weight < 0.50:
                continue
            composite = sum(weights[name] * value for name, value in available.items()) / available_weight
            score = round(max(0, min(100, 50 + 50 * composite)))
            scored.append(
                row.model_copy(
                    update={
                        "technical_score": score,
                        "signal": "positive" if score >= 65 else "negative" if score <= 40 else "neutral",
                    }
                )
            )
        return scored

    @staticmethod
    def _feature_ic(
        rows: list[BacktestObservation],
        feature_name: str,
    ) -> tuple[float | None, float]:
        pairs = [
            (
                row.feature_signals[feature_name],
                row.forward_return_percent - row.benchmark_return_percent,
            )
            for row in rows
            if feature_name in row.feature_signals
        ]
        coverage = len(pairs) / len(rows) * 100 if rows else 0.0
        if len(pairs) < 3:
            return None, coverage
        xs = [pair[0] for pair in pairs]
        ys = [pair[1] for pair in pairs]
        mean_x = sum(xs) / len(xs)
        mean_y = sum(ys) / len(ys)
        numerator = sum((x - mean_x) * (y - mean_y) for x, y in pairs)
        denominator_x = sum((x - mean_x) ** 2 for x in xs)
        denominator_y = sum((y - mean_y) ** 2 for y in ys)
        denominator = math.sqrt(denominator_x * denominator_y)
        return (numerator / denominator if denominator else None), coverage

    @staticmethod
    def _feature_model_checks(
        validation: CalibrationSplitMetrics,
        test: CalibrationSplitMetrics,
        baseline_test: CalibrationSplitMetrics,
    ) -> list[QualificationCheck]:
        return [
            QualificationCheck(
                name="feature_validation_excess",
                passed=validation.average_excess_return_percent > 0,
                actual=validation.average_excess_return_percent,
                threshold="> 0% sur validation",
            ),
            QualificationCheck(
                name="feature_test_excess",
                passed=test.average_excess_return_percent > 0,
                actual=test.average_excess_return_percent,
                threshold="> 0% sur test",
            ),
            QualificationCheck(
                name="feature_test_uplift",
                passed=test.average_excess_return_percent
                > baseline_test.average_excess_return_percent,
                actual=round(
                    test.average_excess_return_percent
                    - baseline_test.average_excess_return_percent,
                    3,
                ),
                threshold="uplift > 0% vs score actuel",
            ),
            QualificationCheck(
                name="feature_test_sharpe",
                passed=(test.annualized_sharpe_ratio or 0) >= 0.5,
                actual=test.annualized_sharpe_ratio,
                threshold=">= 0.50",
            ),
            QualificationCheck(
                name="feature_test_confidence_interval",
                passed=(test.mean_return_ci_95_low_percent or -999) >= -0.25,
                actual=test.mean_return_ci_95_low_percent,
                threshold="borne basse 95% >= -0.25%",
            ),
            QualificationCheck(
                name="feature_test_sample",
                passed=test.observations >= 30 and test.invested_trades >= 15,
                actual=f"{test.observations}/{test.invested_trades}",
                threshold=">= 30 observations et >= 15 trades",
            ),
        ]

    @staticmethod
    def _round_optional(value: float | None) -> float | None:
        return round(value, 4) if value is not None else None

    @staticmethod
    def _metrics(
        rows: list[BacktestObservation],
        threshold: int,
        horizon: int,
        round_trip_cost: float,
    ) -> CalibrationSplitMetrics:
        if not rows:
            return CalibrationSplitMetrics()
        strategy_returns = [
            row.forward_return_percent / 100 - round_trip_cost
            if row.technical_score >= threshold
            else 0.0
            for row in rows
        ]
        benchmark_returns = [row.benchmark_return_percent / 100 for row in rows]
        excess_returns = [
            strategy - benchmark
            for strategy, benchmark in zip(strategy_returns, benchmark_returns)
        ]
        invested_returns = [
            row.forward_return_percent / 100 - round_trip_cost
            for row in rows
            if row.technical_score >= threshold
        ]
        average = sum(strategy_returns) / len(strategy_returns)
        volatility = pstdev(strategy_returns) if len(strategy_returns) > 1 else 0.0
        sharpe = average / volatility * math.sqrt(252 / horizon) if volatility > 0 else None
        excess_average = sum(excess_returns) / len(excess_returns)
        excess_std = pstdev(excess_returns) if len(excess_returns) > 1 else 0.0
        margin = 1.96 * excess_std / math.sqrt(len(excess_returns)) if len(excess_returns) > 1 else None
        return CalibrationSplitMetrics(
            observations=len(rows),
            invested_trades=len(invested_returns),
            average_strategy_return_percent=round(average * 100, 3),
            average_benchmark_return_percent=round(sum(benchmark_returns) / len(benchmark_returns) * 100, 3),
            average_excess_return_percent=round(excess_average * 100, 3),
            annualized_sharpe_ratio=round(sharpe, 2) if sharpe is not None else None,
            win_rate_percent=round(sum(value > 0 for value in invested_returns) / len(invested_returns) * 100, 1)
            if invested_returns
            else None,
            mean_return_ci_95_low_percent=round((excess_average - margin) * 100, 3) if margin is not None else None,
            mean_return_ci_95_high_percent=round((excess_average + margin) * 100, 3) if margin is not None else None,
        )

    @staticmethod
    def _qualification_checks(
        validation: CalibrationSplitMetrics,
        test: CalibrationSplitMetrics,
    ) -> list[QualificationCheck]:
        return [
            QualificationCheck(
                name="test_sample_size",
                passed=test.observations >= 30 and test.invested_trades >= 15,
                actual=f"{test.observations}/{test.invested_trades}",
                threshold=">= 30 observations et >= 15 trades",
            ),
            QualificationCheck(
                name="validation_excess",
                passed=validation.average_excess_return_percent > 0,
                actual=validation.average_excess_return_percent,
                threshold="> 0%",
            ),
            QualificationCheck(
                name="test_excess",
                passed=test.average_excess_return_percent > 0,
                actual=test.average_excess_return_percent,
                threshold="> 0%",
            ),
            QualificationCheck(
                name="test_sharpe",
                passed=(test.annualized_sharpe_ratio or 0) >= 0.5,
                actual=test.annualized_sharpe_ratio,
                threshold=">= 0.50",
            ),
            QualificationCheck(
                name="test_confidence_interval",
                passed=(test.mean_return_ci_95_low_percent or -999) >= -0.25,
                actual=test.mean_return_ci_95_low_percent,
                threshold="borne basse 95% >= -0.25%",
            ),
        ]

    @staticmethod
    def _failed(
        benchmark: str,
        period: str,
        horizons: list[int],
        transaction_cost_bps: float,
        slippage_bps: float,
        error: str,
    ) -> TechnicalCalibrationResult:
        return TechnicalCalibrationResult(
            status="failed",
            benchmark=benchmark.strip().upper(),
            period=period,
            tickers_requested=[],
            horizons=horizons,
            transaction_cost_bps=transaction_cost_bps,
            slippage_bps=slippage_bps,
            errors=[error],
        )

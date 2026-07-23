"""PortfolioAgent: deterministic valuation and concentration analysis."""

from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from math import prod, sqrt
from statistics import correlation, covariance, mean, stdev, variance

from .market_data_agent import MarketDataAgent
from .schemas import (
    MarketDataResult,
    PortfolioAllocation,
    PortfolioAnalysisRequest,
    PortfolioAnalysisResult,
    PortfolioCorrelation,
    PortfolioHoldingInput,
    PortfolioPerformanceMetrics,
    PortfolioPositionResult,
    PortfolioRiskSummary,
    PortfolioSummary,
    PortfolioTechnicalSnapshot,
    PortfolioTechnicalSummary,
    TechnicalResult,
)
from .technical_agent import TechnicalAgent


class PortfolioAgent:
    """Values a long-only equity portfolio using MarketDataAgent outputs.

    Hypothese de devise unique (assumee) : les valeurs de marche sont additionnees
    telles quelles, SANS conversion de change. `total_value`, les poids et le P&L
    ne sont exacts que si toutes les positions partagent la devise de base
    (defaut USD, focus marche US). Si plusieurs devises coexistent, un
    avertissement proeminent le signale et les agregats deviennent approximatifs
    (une brique de conversion FX serait requise pour un multi-devises exact).
    """

    def __init__(
        self,
        market_data_agent: MarketDataAgent | None = None,
        technical_agent: TechnicalAgent | None = None,
    ) -> None:
        self.market_data_agent = market_data_agent or MarketDataAgent()
        self.technical_agent = technical_agent or TechnicalAgent(
            market_data_agent=self.market_data_agent
        )

    def run(
        self,
        request: PortfolioAnalysisRequest,
        use_cache: bool = True,
        market_results: dict[str, MarketDataResult] | None = None,
    ) -> PortfolioAnalysisResult:
        base_currency = request.base_currency.strip().upper()
        benchmark_ticker = request.benchmark_ticker.strip().upper()
        holdings = self._merge_holdings(request.holdings)
        # market_results peut etre fourni par l'orchestrateur portefeuille pour
        # partager une unique collecte entre valorisation et analyses par ligne.
        if market_results is None:
            market_results = self.collect_market_data(holdings, benchmark_ticker, use_cache)
        technical_results = {
            holding.ticker: self.technical_agent.analyze(
                market_results[holding.ticker], with_slm=False
            )
            for holding in holdings
        }

        positions = [
            self._value_position(
                holding,
                market_results.get(holding.ticker),
                technical_results.get(holding.ticker),
            )
            for holding in holdings
        ]
        priced_positions = [position for position in positions if position.market_value is not None]

        invested_value = sum(position.market_value or 0 for position in positions)
        total_value = invested_value + request.cash
        total_cost = sum(position.cost_basis for position in priced_positions)
        unrealized_pnl = sum(position.unrealized_pnl or 0 for position in priced_positions)
        day_pnl = sum(position.day_pnl or 0 for position in priced_positions)
        previous_value = invested_value - day_pnl

        for position in positions:
            position.weight = self._percent(position.market_value or 0, total_value)

        allocation_by_holding = self._holding_allocation(positions, request.cash, total_value)
        allocation_by_sector = self._sector_allocation(positions, request.cash, total_value)
        risk = self._risk_summary(positions, priced_positions, invested_value)
        performance, correlations, performance_warnings = self._performance_metrics(
            positions=positions,
            market_results=market_results,
            benchmark_ticker=benchmark_ticker,
            risk_free_rate_percent=request.risk_free_rate_percent,
            total_value=total_value,
        )
        technical_summary = self._technical_summary(positions, invested_value)

        sources = sorted(
            {source for position in positions for source in position.sources_used}
        )
        warnings = self._portfolio_warnings(positions, base_currency)
        warnings.extend(performance_warnings)
        missing_count = len(positions) - len(priced_positions)
        if missing_count:
            warnings.append(
                f"{missing_count} position(s) exclue(s) de la valorisation faute de prix."
            )

        if not priced_positions:
            status = "failed"
            errors = ["Aucune position ne dispose d'un prix de marche exploitable."]
        elif missing_count or any(position.data_status != "success" for position in positions):
            status = "partial"
            errors = []
        else:
            status = "success"
            errors = []

        return PortfolioAnalysisResult(
            status=status,
            generated_at=datetime.now(timezone.utc),
            base_currency=base_currency,
            positions=positions,
            summary=PortfolioSummary(
                total_value=round(total_value, 2),
                invested_value=round(invested_value, 2),
                cash=round(request.cash, 2),
                total_cost=round(total_cost, 2),
                unrealized_pnl=round(unrealized_pnl, 2),
                unrealized_pnl_percent=self._optional_percent(unrealized_pnl, total_cost),
                day_pnl=round(day_pnl, 2),
                day_change_percent=self._optional_percent(day_pnl, previous_value),
            ),
            allocation_by_holding=allocation_by_holding,
            allocation_by_sector=allocation_by_sector,
            risk=risk,
            performance=performance,
            technical_summary=technical_summary,
            correlations=correlations,
            sources_used=sources,
            warnings=list(dict.fromkeys(warnings)),
            errors=errors,
        )

    def collect_market_data(
        self,
        holdings: list[PortfolioHoldingInput],
        benchmark_ticker: str,
        use_cache: bool,
    ) -> dict[str, MarketDataResult]:
        """Collecte parallele des donnees marche (positions + benchmark).

        Expose pour que l'orchestrateur partage une seule collecte entre la
        valorisation et les analyses individuelles.
        """
        results: dict[str, MarketDataResult] = {}
        tickers = list(dict.fromkeys([*(holding.ticker for holding in holdings), benchmark_ticker]))
        worker_count = min(5, len(tickers))
        with ThreadPoolExecutor(max_workers=max(1, worker_count)) as executor:
            future_by_ticker = {
                executor.submit(
                    self.market_data_agent.run,
                    ticker,
                    "6mo",
                    False,
                    use_cache,
                ): ticker
                for ticker in tickers
            }
            for future in as_completed(future_by_ticker):
                ticker = future_by_ticker[future]
                try:
                    results[ticker] = future.result()
                except Exception as exc:
                    results[ticker] = MarketDataResult(
                        ticker=ticker,
                        status="failed",
                        errors=[f"Collecte portefeuille impossible: {exc}"],
                    )
        return results

    def _value_position(
        self,
        holding: PortfolioHoldingInput,
        market_data: MarketDataResult | None,
        technical: TechnicalResult | None,
    ) -> PortfolioPositionResult:
        cost_basis = holding.quantity * holding.average_cost
        if market_data is None or market_data.price is None:
            errors = market_data.errors if market_data else ["Donnees de marche absentes."]
            return PortfolioPositionResult(
                ticker=holding.ticker,
                quantity=holding.quantity,
                average_cost=holding.average_cost,
                cost_basis=round(cost_basis, 2),
                data_status="failed",
                warnings=list(errors),
                technical=self._technical_snapshot(technical),
            )

        market_value = holding.quantity * market_data.price
        unrealized_pnl = market_value - cost_basis
        day_pnl = None
        if market_data.change_percent is not None and market_data.change_percent > -100:
            previous_price = market_data.price / (1 + market_data.change_percent / 100)
            day_pnl = (market_data.price - previous_price) * holding.quantity

        return PortfolioPositionResult(
            ticker=holding.ticker,
            name=market_data.company_profile.name,
            sector=market_data.company_profile.sector or "Unknown",
            quantity=holding.quantity,
            average_cost=holding.average_cost,
            current_price=round(market_data.price, 4),
            cost_basis=round(cost_basis, 2),
            market_value=round(market_value, 2),
            unrealized_pnl=round(unrealized_pnl, 2),
            unrealized_pnl_percent=self._optional_percent(unrealized_pnl, cost_basis),
            day_change_percent=market_data.change_percent,
            day_pnl=round(day_pnl, 2) if day_pnl is not None else None,
            currency=market_data.company_profile.currency,
            data_status=market_data.status,
            sources_used=market_data.sources_used,
            warnings=[*market_data.warnings, *market_data.errors],
            technical=self._technical_snapshot(technical),
        )

    def _risk_summary(
        self,
        positions: list[PortfolioPositionResult],
        priced_positions: list[PortfolioPositionResult],
        invested_value: float,
    ) -> PortfolioRiskSummary:
        invested_weights = [
            (position.market_value or 0) / invested_value
            for position in priced_positions
            if invested_value > 0
        ]
        hhi = sum(weight * weight for weight in invested_weights)
        concentration_score = round(hhi * 100)
        if concentration_score >= 40:
            concentration_level = "high"
        elif concentration_score >= 25:
            concentration_level = "medium"
        else:
            concentration_level = "low"

        diversification_score = round((1 - hhi) * 100) if invested_weights else 0
        if diversification_score >= 70:
            diversification_level = "high"
        elif diversification_score >= 40:
            diversification_level = "medium"
        else:
            diversification_level = "low"

        ordered = sorted(priced_positions, key=lambda item: item.market_value or 0, reverse=True)
        largest = ordered[0] if ordered else None
        top_three_value = sum(position.market_value or 0 for position in ordered[:3])
        confidence_points = [
            100 if position.data_status == "success" else 70 if position.current_price is not None else 0
            for position in positions
        ]
        confidence_score = round(sum(confidence_points) / len(confidence_points)) if confidence_points else 0
        confidence_level = "high" if confidence_score >= 80 else "medium" if confidence_score >= 50 else "low"

        return PortfolioRiskSummary(
            concentration_score=concentration_score,
            concentration_level=concentration_level,
            diversification_score=diversification_score,
            diversification_level=diversification_level,
            largest_position_ticker=largest.ticker if largest else None,
            largest_position_weight=self._percent(largest.market_value or 0, invested_value) if largest else 0,
            top_three_weight=self._percent(top_three_value, invested_value),
            effective_holdings=round(1 / hhi, 2) if hhi > 0 else 0,
            data_confidence_score=confidence_score,
            data_confidence_level=confidence_level,
        )

    def _performance_metrics(
        self,
        positions: list[PortfolioPositionResult],
        market_results: dict[str, MarketDataResult],
        benchmark_ticker: str,
        risk_free_rate_percent: float,
        total_value: float,
    ) -> tuple[
        PortfolioPerformanceMetrics,
        list[PortfolioCorrelation],
        list[str],
    ]:
        warnings = [
            "Metriques historiques calculees sur les prix, hors dividendes et frais.",
            "Simulation a ponderations constantes, sans reequilibrage sur la periode.",
        ]
        benchmark = market_results.get(benchmark_ticker)
        if benchmark is None or len(benchmark.historical_prices) < 20:
            warnings.append(
                f"Benchmark {benchmark_ticker} indisponible ou historique insuffisant."
            )
            return (
                PortfolioPerformanceMetrics(benchmark_ticker=benchmark_ticker),
                [],
                warnings,
            )

        eligible_positions = [
            position
            for position in positions
            if position.market_value is not None
            and len(market_results[position.ticker].historical_prices) >= 20
        ]
        excluded = len(positions) - len(eligible_positions)
        if excluded:
            warnings.append(
                f"{excluded} position(s) exclue(s) des metriques historiques faute de donnees."
            )
        if not eligible_positions or total_value <= 0:
            return (
                PortfolioPerformanceMetrics(benchmark_ticker=benchmark_ticker),
                [],
                warnings,
            )

        price_series = {
            position.ticker: {
                point.date: point.close
                for point in market_results[position.ticker].historical_prices
                if point.close > 0
            }
            for position in eligible_positions
        }
        benchmark_series = {
            point.date: point.close
            for point in benchmark.historical_prices
            if point.close > 0
        }
        common_dates = set(benchmark_series)
        for series in price_series.values():
            common_dates.intersection_update(series)
        dates = sorted(common_dates)
        if len(dates) < 20:
            warnings.append(
                "Moins de 20 dates communes entre les positions et le benchmark."
            )
            return (
                PortfolioPerformanceMetrics(benchmark_ticker=benchmark_ticker),
                [],
                warnings,
            )

        returns_by_ticker = {
            ticker: self._daily_returns(series, dates)
            for ticker, series in price_series.items()
        }
        benchmark_returns = self._daily_returns(benchmark_series, dates)
        position_weights = {
            position.ticker: (position.market_value or 0) / total_value
            for position in eligible_positions
        }
        portfolio_returns = [
            sum(
                position_weights[ticker] * returns[index]
                for ticker, returns in returns_by_ticker.items()
            )
            for index in range(len(dates) - 1)
        ]

        portfolio_annual_return = mean(portfolio_returns) * 252
        portfolio_volatility = stdev(portfolio_returns) * sqrt(252)
        benchmark_annual_return = mean(benchmark_returns) * 252
        benchmark_volatility = stdev(benchmark_returns) * sqrt(252)
        benchmark_variance = variance(benchmark_returns)
        beta = (
            covariance(portfolio_returns, benchmark_returns) / benchmark_variance
            if benchmark_variance > 0
            else None
        )
        risk_free_rate = risk_free_rate_percent / 100
        sharpe = (
            (portfolio_annual_return - risk_free_rate) / portfolio_volatility
            if portfolio_volatility > 0
            else None
        )
        treynor = (
            (portfolio_annual_return - risk_free_rate) / beta
            if beta not in (None, 0)
            else None
        )
        jensen_alpha = (
            portfolio_annual_return
            - (risk_free_rate + beta * (benchmark_annual_return - risk_free_rate))
            if beta is not None
            else None
        )

        correlations = self._correlations(returns_by_ticker)
        average_correlation = (
            mean(item.correlation for item in correlations)
            if correlations
            else None
        )
        metrics = PortfolioPerformanceMetrics(
            benchmark_ticker=benchmark_ticker,
            observation_count=len(portfolio_returns),
            period_start=dates[0],
            period_end=dates[-1],
            cumulative_return_percent=self._rounded_percent(
                prod(1 + value for value in portfolio_returns) - 1
            ),
            annualized_return_percent=self._rounded_percent(portfolio_annual_return),
            annualized_volatility_percent=self._rounded_percent(portfolio_volatility),
            benchmark_cumulative_return_percent=self._rounded_percent(
                prod(1 + value for value in benchmark_returns) - 1
            ),
            benchmark_annualized_return_percent=self._rounded_percent(
                benchmark_annual_return
            ),
            benchmark_annualized_volatility_percent=self._rounded_percent(
                benchmark_volatility
            ),
            beta=round(beta, 3) if beta is not None else None,
            sharpe_ratio=round(sharpe, 3) if sharpe is not None else None,
            treynor_ratio_percent=self._rounded_percent(treynor),
            jensen_alpha_percent=self._rounded_percent(jensen_alpha),
            max_drawdown_percent=self._rounded_percent(
                self._max_drawdown(portfolio_returns)
            ),
            average_correlation=(
                round(average_correlation, 3)
                if average_correlation is not None
                else None
            ),
        )
        return metrics, correlations, warnings

    def _technical_summary(
        self,
        positions: list[PortfolioPositionResult],
        invested_value: float,
    ) -> PortfolioTechnicalSummary:
        weighted_scores = [
            (
                (position.market_value or 0) / invested_value,
                position.technical.technical_score,
            )
            for position in positions
            if invested_value > 0 and position.technical.technical_score is not None
        ]
        return PortfolioTechnicalSummary(
            weighted_score=(
                round(sum(weight * score for weight, score in weighted_scores), 2)
                if weighted_scores
                else None
            ),
            bullish_positions=sum(
                position.technical.trend == "bullish" for position in positions
            ),
            neutral_positions=sum(
                position.technical.trend == "neutral" for position in positions
            ),
            bearish_positions=sum(
                position.technical.trend == "bearish" for position in positions
            ),
            overbought_positions=sum(
                position.technical.rsi is not None and position.technical.rsi >= 70
                for position in positions
            ),
            oversold_positions=sum(
                position.technical.rsi is not None and position.technical.rsi <= 30
                for position in positions
            ),
        )

    @staticmethod
    def _technical_snapshot(
        technical: TechnicalResult | None,
    ) -> PortfolioTechnicalSnapshot:
        if technical is None:
            return PortfolioTechnicalSnapshot()
        return PortfolioTechnicalSnapshot(
            status=technical.status,
            rsi=technical.rsi,
            sma_20=technical.moving_averages.sma_20,
            sma_50=technical.moving_averages.sma_50,
            volatility=technical.volatility,
            trend=technical.trend,
            support_level=technical.support_level,
            resistance_level=technical.resistance_level,
            technical_score=technical.technical_score,
            signal=technical.signal,
        )

    @staticmethod
    def _daily_returns(series: dict[str, float], dates: list[str]) -> list[float]:
        return [
            series[current] / series[previous] - 1
            for previous, current in zip(dates, dates[1:])
        ]

    @staticmethod
    def _correlations(
        returns_by_ticker: dict[str, list[float]],
    ) -> list[PortfolioCorrelation]:
        tickers = sorted(returns_by_ticker)
        values: list[PortfolioCorrelation] = []
        for index, ticker_a in enumerate(tickers):
            for ticker_b in tickers[index + 1 :]:
                try:
                    value = correlation(
                        returns_by_ticker[ticker_a], returns_by_ticker[ticker_b]
                    )
                except Exception:
                    continue
                values.append(
                    PortfolioCorrelation(
                        ticker_a=ticker_a,
                        ticker_b=ticker_b,
                        correlation=round(value, 3),
                    )
                )
        return values

    @staticmethod
    def _max_drawdown(returns: list[float]) -> float:
        wealth = 1.0
        peak = 1.0
        max_drawdown = 0.0
        for daily_return in returns:
            wealth *= 1 + daily_return
            peak = max(peak, wealth)
            max_drawdown = min(max_drawdown, wealth / peak - 1)
        return max_drawdown

    @staticmethod
    def _rounded_percent(value: float | None) -> float | None:
        return round(value * 100, 2) if value is not None else None

    def _holding_allocation(
        self,
        positions: list[PortfolioPositionResult],
        cash: float,
        total_value: float,
    ) -> list[PortfolioAllocation]:
        rows = [
            PortfolioAllocation(
                label=position.ticker,
                value=round(position.market_value or 0, 2),
                weight=self._percent(position.market_value or 0, total_value),
            )
            for position in positions
            if position.market_value is not None
        ]
        if cash > 0:
            rows.append(
                PortfolioAllocation(label="Cash", value=round(cash, 2), weight=self._percent(cash, total_value))
            )
        return sorted(rows, key=lambda row: row.value, reverse=True)

    def _sector_allocation(
        self,
        positions: list[PortfolioPositionResult],
        cash: float,
        total_value: float,
    ) -> list[PortfolioAllocation]:
        values: dict[str, float] = defaultdict(float)
        labels: dict[str, str] = {}
        for position in positions:
            if position.market_value is not None:
                label = self._sector_label(position.sector)
                key = label.casefold()
                values[key] += position.market_value
                labels[key] = label
        if cash > 0:
            values["cash"] += cash
            labels["cash"] = "Cash"
        return sorted(
            [
                PortfolioAllocation(
                    label=labels[key],
                    value=round(value, 2),
                    weight=self._percent(value, total_value),
                )
                for key, value in values.items()
            ],
            key=lambda row: row.value,
            reverse=True,
        )

    def _portfolio_warnings(
        self,
        positions: list[PortfolioPositionResult],
        base_currency: str,
    ) -> list[str]:
        warnings: list[str] = []
        warnings.extend(self._currency_warnings(positions, base_currency))
        for position in positions:
            warnings.extend(
                f"{position.ticker}: {warning}" for warning in position.warnings
            )
        return warnings

    @staticmethod
    def _currency_warnings(
        positions: list[PortfolioPositionResult],
        base_currency: str,
    ) -> list[str]:
        """Garde devise : consolide en un seul message proeminent (au lieu d'un par ligne).

        Voir l'hypothese de devise unique dans le docstring de la classe.
        """
        priced = [position for position in positions if position.market_value is not None]
        currencies = {position.currency for position in priced if position.currency}
        foreign = sorted(currency for currency in currencies if currency != base_currency)
        if not foreign:
            return []
        if len(currencies) > 1:
            return [
                f"ATTENTION devises multiples ({', '.join(sorted(currencies))}) additionnees "
                f"sans conversion de change : valeur totale et poids approximatifs."
            ]
        return [
            f"Positions libellees en {foreign[0]} agregees en {base_currency} "
            f"sans conversion de change : valeur totale approximative."
        ]

    @staticmethod
    def _merge_holdings(holdings: list[PortfolioHoldingInput]) -> list[PortfolioHoldingInput]:
        merged: dict[str, tuple[float, float]] = {}
        for holding in holdings:
            ticker = holding.ticker.strip().upper()
            quantity, cost = merged.get(ticker, (0.0, 0.0))
            merged[ticker] = (
                quantity + holding.quantity,
                cost + holding.quantity * holding.average_cost,
            )
        return [
            PortfolioHoldingInput(
                ticker=ticker,
                quantity=quantity,
                average_cost=cost / quantity,
            )
            for ticker, (quantity, cost) in merged.items()
        ]

    @staticmethod
    def _sector_label(value: str) -> str:
        normalized = " ".join((value or "Unknown").strip().split())
        if not normalized or normalized.casefold() == "unknown":
            return "Unknown"
        return normalized.title()

    @staticmethod
    def _percent(numerator: float, denominator: float) -> float:
        return round(numerator / denominator * 100, 2) if denominator else 0

    @classmethod
    def _optional_percent(cls, numerator: float, denominator: float) -> float | None:
        return cls._percent(numerator, denominator) if denominator else None

"""TechnicalAgent : signaux techniques calcules depuis les donnees du MarketDataAgent.

Cet agent n'appelle aucune API externe. Il consomme les historical_prices
deja collectes par MarketDataAgent et en derive RSI, moyennes mobiles,
volatilite, tendance, support/resistance, analyse de volume, score et signal.
"""

from __future__ import annotations

from app.memory import TechnicalAgentMemory

from .market_data_agent import MarketDataAgent
from .nebius_client import NebiusClient
from .schemas import (
    HistoricalPrice,
    MovingAverages,
    SlmSummary,
    TechnicalResult,
    TrendDirection,
    VolumeAnalysis,
)

RSI_PERIOD = 14
SMA_SHORT = 20
SMA_LONG = 50
VOLATILITY_WINDOW = 20
LEVELS_WINDOW = 30
VOLUME_WINDOW = 20


class TechnicalAgent:
    def __init__(
        self,
        market_data_agent: MarketDataAgent | None = None,
        slm_client: NebiusClient | None = None,
        memory: TechnicalAgentMemory | None = None,
    ) -> None:
        self.market_data_agent = market_data_agent or MarketDataAgent()
        self.slm_client = slm_client or NebiusClient()
        self.memory = memory or TechnicalAgentMemory()

    def run(
        self,
        ticker: str,
        period: str = "6mo",
        use_cache: bool = True,
        with_slm: bool = True,
    ) -> TechnicalResult:
        normalized_ticker = ticker.strip().upper()
        if not normalized_ticker:
            return TechnicalResult(ticker="", status="failed", errors=["Ticker is required."])

        # Appel interne : le resume SLM market-data est inutile ici,
        # seul le resume technique sera produit (un appel LLM economise).
        market_data = self.market_data_agent.run(
            normalized_ticker, period=period, with_slm=False, use_cache=use_cache
        )
        if market_data.status == "failed" or not market_data.historical_prices:
            return TechnicalResult(
                ticker=normalized_ticker,
                status="failed",
                sources_used=market_data.sources_used,
                errors=market_data.errors or ["No historical prices available for technical analysis."],
            )

        prices = market_data.historical_prices
        closes = [point.close for point in prices]
        errors: list[str] = []

        rsi = self._rsi(closes)
        if rsi is None:
            errors.append(f"Historique insuffisant pour le RSI {RSI_PERIOD} ({len(closes)} points).")

        sma_20 = self._sma(closes, SMA_SHORT)
        sma_50 = self._sma(closes, SMA_LONG)
        if sma_50 is None:
            errors.append(f"Historique insuffisant pour la SMA {SMA_LONG} ({len(closes)} points).")

        volatility = self._volatility(closes)
        trend = self._trend(closes[-1], sma_20, sma_50)
        support, resistance = self._support_resistance(prices)
        volume_analysis = self._volume_analysis(prices)
        score = self._technical_score(rsi, trend, closes[-1], sma_50, volume_analysis.volume_ratio)
        signal = "positive" if score >= 65 else "negative" if score <= 40 else "neutral"

        core_computed = rsi is not None and sma_20 is not None and sma_50 is not None
        status = "success" if core_computed and not errors else "partial"

        result = TechnicalResult(
            ticker=normalized_ticker,
            status=status,
            sources_used=market_data.sources_used,
            rsi=rsi,
            moving_averages=MovingAverages(sma_20=sma_20, sma_50=sma_50),
            volatility=volatility,
            trend=trend,
            support_level=support,
            resistance_level=resistance,
            volume_analysis=volume_analysis,
            technical_score=score,
            signal=signal,
            errors=errors,
        )

        if with_slm:
            self._add_slm_summary(result)
        self.memory.remember(result)
        return result

    def _add_slm_summary(self, result: TechnicalResult) -> None:
        try:
            summary = self.slm_client.summarize_technical_data(result.model_dump())
            if summary:
                result.slm_summary = SlmSummary.model_validate(summary)
        except Exception as error:
            result.errors.append(f"Nebius SLM unavailable: {error}")

    def _rsi(self, closes: list[float], period: int = RSI_PERIOD) -> float | None:
        """RSI de Wilder : moyenne lissee des gains/pertes sur `period` seances."""
        if len(closes) < period + 1:
            return None
        gains: list[float] = []
        losses: list[float] = []
        for previous, current in zip(closes, closes[1:]):
            delta = current - previous
            gains.append(max(delta, 0.0))
            losses.append(max(-delta, 0.0))
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        for gain, loss in zip(gains[period:], losses[period:]):
            avg_gain = (avg_gain * (period - 1) + gain) / period
            avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            return 100.0
        relative_strength = avg_gain / avg_loss
        return round(100 - 100 / (1 + relative_strength), 1)

    def _sma(self, closes: list[float], window: int) -> float | None:
        if len(closes) < window:
            return None
        return round(sum(closes[-window:]) / window, 2)

    def _volatility(self, closes: list[float], window: int = VOLATILITY_WINDOW) -> float | None:
        """Ecart type des rendements quotidiens (%) sur les `window` dernieres seances."""
        if len(closes) < window + 1:
            return None
        recent = closes[-(window + 1):]
        returns = [(current - previous) / previous * 100 for previous, current in zip(recent, recent[1:])]
        mean = sum(returns) / len(returns)
        variance = sum((value - mean) ** 2 for value in returns) / len(returns)
        return round(variance**0.5, 2)

    def _trend(self, last_close: float, sma_20: float | None, sma_50: float | None) -> TrendDirection:
        if sma_20 is not None and sma_50 is not None:
            if last_close > sma_20 > sma_50:
                return "bullish"
            if last_close < sma_20 < sma_50:
                return "bearish"
            return "neutral"
        if sma_20 is not None:
            if last_close > sma_20:
                return "bullish"
            if last_close < sma_20:
                return "bearish"
        return "neutral"

    def _support_resistance(
        self, prices: list[HistoricalPrice], window: int = LEVELS_WINDOW
    ) -> tuple[float | None, float | None]:
        """Support = plus bas, resistance = plus haut des `window` dernieres seances."""
        recent = prices[-window:]
        if not recent:
            return None, None
        lows = [point.low if point.low is not None else point.close for point in recent]
        highs = [point.high if point.high is not None else point.close for point in recent]
        return round(min(lows), 2), round(max(highs), 2)

    def _volume_analysis(self, prices: list[HistoricalPrice], window: int = VOLUME_WINDOW) -> VolumeAnalysis:
        volumes = [point.volume for point in prices[-window:] if point.volume]
        last_volume = prices[-1].volume
        if not volumes or not last_volume:
            return VolumeAnalysis()
        average = sum(volumes) / len(volumes)
        ratio = round(last_volume / average, 2) if average else None
        if ratio is None:
            interpretation = "volume indisponible"
        elif ratio >= 1.5:
            interpretation = "volume nettement superieur a la moyenne"
        elif ratio >= 1.2:
            interpretation = "volume superieur a la moyenne"
        elif ratio <= 0.5:
            interpretation = "volume nettement inferieur a la moyenne"
        elif ratio <= 0.8:
            interpretation = "volume inferieur a la moyenne"
        else:
            interpretation = "volume dans la moyenne"
        return VolumeAnalysis(
            last_volume=last_volume,
            average_volume=round(average, 0),
            volume_ratio=ratio,
            interpretation=interpretation,
        )

    def _technical_score(
        self,
        rsi: float | None,
        trend: TrendDirection,
        last_close: float,
        sma_50: float | None,
        volume_ratio: float | None,
    ) -> int:
        """Score 0-100 : tendance + zone RSI + position vs SMA 50 + confirmation volume."""
        score = 50
        if trend == "bullish":
            score += 15
        elif trend == "bearish":
            score -= 15
        if rsi is not None:
            if rsi > 70:
                score -= 10  # surachat
            elif rsi < 30:
                score -= 5  # survente : risque, mais rebond possible
            elif 40 <= rsi <= 70:
                score += 10  # zone saine
        if sma_50 is not None:
            score += 10 if last_close > sma_50 else -10
        if volume_ratio is not None and volume_ratio >= 1.2:
            score += 5 if trend == "bullish" else -5
        return max(0, min(100, score))

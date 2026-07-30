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
    BollingerBands,
    MacdIndicator,
    MarketDataResult,
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
        period: str = "1y",
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
        return self.analyze(market_data, with_slm=with_slm)

    def analyze(
        self,
        market_data: MarketDataResult,
        with_slm: bool = True,
        remember: bool = True,
    ) -> TechnicalResult:
        """Calcule les indicateurs depuis un resultat MarketData deja collecte."""
        normalized_ticker = market_data.ticker.strip().upper()
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
        ema_20 = self._ema(closes, 20)
        ema_50 = self._ema(closes, 50)
        ema_200 = self._ema(closes, 200)
        macd = self._macd(closes)
        atr_14 = self._atr(prices)
        atr_percent = round(atr_14 / closes[-1] * 100, 2) if atr_14 and closes[-1] else None
        bollinger = self._bollinger(closes)
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
            moving_averages=MovingAverages(
                sma_20=sma_20,
                sma_50=sma_50,
                ema_20=ema_20,
                ema_50=ema_50,
                ema_200=ema_200,
            ),
            macd=macd,
            atr_14=atr_14,
            atr_percent=atr_percent,
            bollinger_bands=bollinger,
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
        if remember:
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

    def _ema_series(self, values: list[float], window: int) -> list[float]:
        if len(values) < window:
            return []
        multiplier = 2 / (window + 1)
        series = [sum(values[:window]) / window]
        for value in values[window:]:
            series.append((value - series[-1]) * multiplier + series[-1])
        return series

    def _ema(self, closes: list[float], window: int) -> float | None:
        series = self._ema_series(closes, window)
        return round(series[-1], 2) if series else None

    def _macd(self, closes: list[float]) -> MacdIndicator:
        if len(closes) < 35:
            return MacdIndicator()
        ema_12 = self._ema_series(closes, 12)
        ema_26 = self._ema_series(closes, 26)
        offset = len(ema_12) - len(ema_26)
        macd_series = [
            ema_12[index + offset] - ema_26[index]
            for index in range(len(ema_26))
        ]
        signal_series = self._ema_series(macd_series, 9)
        if not signal_series:
            return MacdIndicator()
        macd_value = macd_series[-1]
        signal_value = signal_series[-1]
        return MacdIndicator(
            macd=round(macd_value, 3),
            signal=round(signal_value, 3),
            histogram=round(macd_value - signal_value, 3),
        )

    def _atr(self, prices: list[HistoricalPrice], period: int = 14) -> float | None:
        if len(prices) < period + 1:
            return None
        true_ranges: list[float] = []
        for previous, current in zip(prices, prices[1:]):
            high = current.high if current.high is not None else current.close
            low = current.low if current.low is not None else current.close
            true_ranges.append(
                max(
                    high - low,
                    abs(high - previous.close),
                    abs(low - previous.close),
                )
            )
        atr = sum(true_ranges[:period]) / period
        for value in true_ranges[period:]:
            atr = (atr * (period - 1) + value) / period
        return round(atr, 3)

    def _bollinger(self, closes: list[float], window: int = 20) -> BollingerBands:
        if len(closes) < window:
            return BollingerBands()
        recent = closes[-window:]
        middle = sum(recent) / window
        variance = sum((value - middle) ** 2 for value in recent) / window
        deviation = variance**0.5
        upper = middle + 2 * deviation
        lower = middle - 2 * deviation
        width = upper - lower
        position = (closes[-1] - lower) / width * 100 if width else None
        return BollingerBands(
            upper=round(upper, 2),
            middle=round(middle, 2),
            lower=round(lower, 2),
            position_percent=round(position, 1) if position is not None else None,
        )

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

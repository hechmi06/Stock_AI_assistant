import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from app.agents.backtesting_agent import BacktestingAgent
from app.agents.schemas import HistoricalPrice, MarketDataResult
from app.agents.technical_agent import TechnicalAgent
from app.memory import TechnicalAgentMemory


class SyntheticMcpClient:
    def __init__(self, points=520):
        self.points = points

    def get(self, path, timeout=20):
        is_benchmark = "/SPY?" in path
        rows = []
        value = 100.0
        current = date(2022, 1, 3)
        for index in range(self.points):
            drift = 0.0005 if is_benchmark else 0.0009
            cycle = ((index % 17) - 8) * (0.00008 if is_benchmark else 0.00014)
            value *= 1 + drift + cycle
            rows.append(
                {
                    "date": (current + timedelta(days=index)).isoformat(),
                    "open": value * 0.998,
                    "high": value * 1.006,
                    "low": value * 0.994,
                    "close": value,
                    "volume": 1_000_000 + index * 100,
                }
            )
        return {"historical_prices": rows}


class TrackingTechnicalAgent(TechnicalAgent):
    def __init__(self, memory):
        super().__init__(memory=memory)
        self.windows = []

    def analyze(self, market_data, with_slm=True, remember=True):
        self.windows.append((len(market_data.historical_prices), market_data.historical_prices[-1].date))
        return super().analyze(market_data, with_slm=with_slm, remember=remember)


class BacktestingAgentTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._tmp.cleanup)
        memory = TechnicalAgentMemory(Path(self._tmp.name) / "backtest-memory.db")
        self.technical = TrackingTechnicalAgent(memory)
        self.agent = BacktestingAgent(
            mcp_client=SyntheticMcpClient(),
            technical_agent=self.technical,
        )

    def test_walk_forward_is_auditable_and_does_not_see_future_prices(self):
        result = self.agent.run("TEST", benchmark="SPY", period="5y", horizon_days=20)

        self.assertEqual(result.status, "success")
        self.assertGreaterEqual(result.evaluation_count, 15)
        self.assertTrue(result.lookahead_guard)
        self.assertEqual(len(self.technical.windows), result.evaluation_count)
        for window, observation in zip(self.technical.windows, result.observations):
            _, last_known_date = window
            self.assertEqual(last_known_date, observation.signal_date)
            self.assertLess(observation.signal_date, observation.exit_date)

    def test_metrics_and_calibration_are_bounded(self):
        result = self.agent.run("TEST", benchmark="SPY", period="5y", horizon_days=20)

        self.assertGreater(result.metrics.strategy_return_percent, 0)
        self.assertGreaterEqual(result.metrics.max_drawdown_percent, 0)
        self.assertLessEqual(result.metrics.directional_accuracy_percent or 0, 100)
        self.assertEqual(sum(bucket.observations for bucket in result.calibration), result.evaluation_count)
        self.assertEqual(result.excluded_components, ["fundamental", "news", "rag", "risk", "synthesis", "slm"])
        self.assertIsNotNone(result.metrics.mean_return_ci_95_low_percent)
        self.assertIn(result.verdict, {"validated", "recalibrate", "not_validated", "insufficient"})

    def test_execution_costs_reduce_strategy_return(self):
        without_costs = self.agent.run(
            "TEST",
            benchmark="SPY",
            period="5y",
            horizon_days=20,
            transaction_cost_bps=0,
            slippage_bps=0,
        )
        with_costs = self.agent.run(
            "TEST",
            benchmark="SPY",
            period="5y",
            horizon_days=20,
            transaction_cost_bps=10,
            slippage_bps=10,
        )

        self.assertLess(
            with_costs.metrics.strategy_return_percent,
            without_costs.metrics.strategy_return_percent,
        )

    def test_extended_technical_indicators_are_computed(self):
        payload = SyntheticMcpClient().get("/tools/historical-prices/TEST?period=5y")
        prices = [HistoricalPrice.model_validate(row) for row in payload["historical_prices"]]
        result = self.technical.analyze(
            MarketDataResult(
                ticker="TEST",
                status="success",
                historical_prices=prices,
            ),
            with_slm=False,
            remember=False,
        )

        self.assertIsNotNone(result.moving_averages.ema_200)
        self.assertIsNotNone(result.macd.histogram)
        self.assertIsNotNone(result.atr_percent)
        self.assertIsNotNone(result.bollinger_bands.position_percent)


if __name__ == "__main__":
    unittest.main()

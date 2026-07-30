import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from app.agents.backtesting_agent import BacktestingAgent
from app.agents.technical_agent import TechnicalAgent
from app.agents.technical_calibration_agent import TechnicalCalibrationAgent
from app.agents.schemas import BacktestObservation, CalibrationSplitMetrics
from app.memory import TechnicalAgentMemory


class MultiAssetSyntheticMcp:
    def get(self, path, timeout=20):
        is_benchmark = "/SPY?" in path
        rows = []
        value = 100.0
        start = date(2021, 1, 4)
        for index in range(620):
            drift = 0.00035 if is_benchmark else 0.0008
            cycle = ((index % 23) - 11) * (0.00006 if is_benchmark else 0.00012)
            value *= 1 + drift + cycle
            rows.append(
                {
                    "date": (start + timedelta(days=index)).isoformat(),
                    "open": value * 0.998,
                    "high": value * 1.006,
                    "low": value * 0.994,
                    "close": value,
                    "volume": 2_000_000 + index * 250,
                }
            )
        return {"historical_prices": rows}


class TechnicalCalibrationAgentTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self._tmp.cleanup)
        technical = TechnicalAgent(
            memory=TechnicalAgentMemory(Path(self._tmp.name) / "calibration-memory.db")
        )
        backtesting = BacktestingAgent(
            mcp_client=MultiAssetSyntheticMcp(),
            technical_agent=technical,
        )
        self.agent = TechnicalCalibrationAgent(backtesting)

    def test_uses_chronological_splits_and_freezes_threshold_for_test(self):
        tickers = [f"T{index}" for index in range(8)]
        result = self.agent.run(tickers, horizons=[20])

        self.assertEqual(result.status, "success")
        self.assertEqual(result.split, {"train": 0.60, "validation": 0.20, "test": 0.20})
        horizon = result.horizon_results[0]
        self.assertIn(horizon.selected_threshold, self.agent.THRESHOLD_CANDIDATES)
        self.assertGreater(horizon.train.observations, horizon.validation.observations)
        self.assertGreaterEqual(horizon.test.observations, 30)
        self.assertGreaterEqual(horizon.test.invested_trades, 15)
        self.assertIn(horizon.verdict, {"validated", "promising", "not_validated"})

    def test_rejects_unapproved_horizon(self):
        result = self.agent.run(["AAPL"], horizons=[10])

        self.assertEqual(result.status, "failed")
        self.assertTrue(result.errors)

    def test_feature_model_selects_stable_factor_and_keeps_unstable_factor_out(self):
        train = self._feature_rows(80, "2021", stable_direction=1, unstable_direction=1)
        validation = self._feature_rows(40, "2022", stable_direction=1, unstable_direction=-1)
        test = self._feature_rows(40, "2023", stable_direction=1, unstable_direction=-1)

        model = self.agent._calibrate_feature_model(
            train,
            validation,
            test,
            horizon=20,
            round_trip_cost=0.0,
            baseline_test=CalibrationSplitMetrics(),
        )

        self.assertIn("price_vs_sma50", model.selected_features)
        self.assertNotIn("rsi_momentum", model.selected_features)
        unstable = next(item for item in model.diagnostics if item.name == "rsi_momentum")
        self.assertEqual(unstable.rejection_reason, "sens instable entre train et validation")
        self.assertGreater(model.weights["price_vs_sma50"], 0)
        self.assertGreaterEqual(model.test.observations, 30)

    @staticmethod
    def _feature_rows(
        count: int,
        year: str,
        stable_direction: int,
        unstable_direction: int,
    ) -> list[BacktestObservation]:
        rows = []
        for index in range(count):
            signal = -1.0 + 2.0 * index / max(1, count - 1)
            excess = signal * stable_direction * 4
            rows.append(
                BacktestObservation(
                    signal_date=f"{year}-01-{index % 28 + 1:02d}",
                    exit_date=f"{year}-02-{index % 28 + 1:02d}",
                    technical_score=50,
                    signal="neutral",
                    entry_price=100,
                    exit_price=100 + excess,
                    forward_return_percent=excess,
                    strategy_return_percent=0,
                    benchmark_return_percent=0,
                    cumulative_strategy_percent=0,
                    cumulative_ticker_percent=0,
                    cumulative_benchmark_percent=0,
                    feature_signals={
                        "price_vs_sma50": signal * stable_direction,
                        "rsi_momentum": signal * unstable_direction,
                    },
                )
            )
        return rows


if __name__ == "__main__":
    unittest.main()

import unittest

from app.agents.portfolio_agent import PortfolioAgent
from app.agents.schemas import (
    CompanyProfile,
    HistoricalPrice,
    MarketDataResult,
    PortfolioAnalysisRequest,
    PortfolioHoldingInput,
    TechnicalResult,
)


class FakeMarketDataAgent:
    def __init__(self, results):
        self.results = results

    def run(self, ticker, period="6mo", with_slm=False, use_cache=True):
        return self.results[ticker]


class FakeTechnicalAgent:
    def analyze(self, market_data, with_slm=False):
        return TechnicalResult(
            ticker=market_data.ticker,
            status="success" if market_data.historical_prices else "failed",
            trend="bullish",
            technical_score=60,
            signal="neutral",
        )


class PortfolioAgentTest(unittest.TestCase):
    def setUp(self):
        self.agent = PortfolioAgent(
            market_data_agent=FakeMarketDataAgent(
                {
                    "AAPL": MarketDataResult(
                        ticker="AAPL",
                        status="success",
                        price=200,
                        change_percent=2,
                        company_profile=CompanyProfile(
                            name="Apple Inc.", sector="Technology", currency="USD"
                        ),
                        sources_used=["yfinance"],
                    ),
                    "JPM": MarketDataResult(
                        ticker="JPM",
                        status="success",
                        price=100,
                        change_percent=-1,
                        company_profile=CompanyProfile(
                            name="JPMorgan Chase", sector="Financial Services", currency="USD"
                        ),
                        sources_used=["twelve_data"],
                    ),
                }
            ),
            technical_agent=FakeTechnicalAgent(),
        )

    def test_values_positions_and_allocations(self):
        result = self.agent.run(
            PortfolioAnalysisRequest(
                holdings=[
                    PortfolioHoldingInput(ticker="aapl", quantity=10, average_cost=150),
                    PortfolioHoldingInput(ticker="JPM", quantity=10, average_cost=110),
                ],
                cash=900,
            )
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(result.summary.invested_value, 3000)
        self.assertEqual(result.summary.total_value, 3900)
        self.assertEqual(result.summary.total_cost, 2600)
        self.assertEqual(result.summary.unrealized_pnl, 400)
        self.assertAlmostEqual(
            sum(row.weight for row in result.allocation_by_holding),
            100,
            places=1,
        )
        self.assertEqual(result.risk.largest_position_ticker, "AAPL")
        self.assertEqual(result.risk.data_confidence_score, 100)
        self.assertEqual(
            [allocation.label for allocation in result.allocation_by_sector],
            ["Technology", "Financial Services", "Cash"],
        )

    def test_mixed_currency_raises_prominent_warning(self):
        agent = PortfolioAgent(
            market_data_agent=FakeMarketDataAgent(
                {
                    "AAPL": MarketDataResult(
                        ticker="AAPL",
                        status="success",
                        price=200,
                        change_percent=1,
                        company_profile=CompanyProfile(sector="Technology", currency="USD"),
                        sources_used=["yfinance"],
                    ),
                    "ASML": MarketDataResult(
                        ticker="ASML",
                        status="success",
                        price=700,
                        change_percent=1,
                        company_profile=CompanyProfile(sector="Technology", currency="EUR"),
                        sources_used=["yfinance"],
                    ),
                }
            ),
            technical_agent=FakeTechnicalAgent(),
        )
        result = agent.run(
            PortfolioAnalysisRequest(
                holdings=[
                    PortfolioHoldingInput(ticker="AAPL", quantity=10, average_cost=150),
                    PortfolioHoldingInput(ticker="ASML", quantity=10, average_cost=600),
                ],
            )
        )

        self.assertTrue(
            any("ATTENTION devises multiples" in warning for warning in result.warnings),
            result.warnings,
        )
        # Une seule ligne consolidee, pas un warning devise par position.
        currency_warnings = [w for w in result.warnings if "devise" in w.lower() or "conversion de change" in w]
        self.assertEqual(len(currency_warnings), 1, currency_warnings)

    def test_merges_duplicate_tickers_with_weighted_cost(self):
        result = self.agent.run(
            PortfolioAnalysisRequest(
                holdings=[
                    PortfolioHoldingInput(ticker="AAPL", quantity=5, average_cost=100),
                    PortfolioHoldingInput(ticker="aapl", quantity=5, average_cost=200),
                ]
            )
        )

        self.assertEqual(len(result.positions), 1)
        self.assertEqual(result.positions[0].quantity, 10)
        self.assertEqual(result.positions[0].average_cost, 150)
        self.assertEqual(result.positions[0].unrealized_pnl, 500)

    def test_computes_pdf_performance_metrics_against_benchmark(self):
        market_returns = [0.01, -0.004, 0.006, -0.002, 0.008] * 6

        def history(start, returns, multiplier):
            closes = [start]
            for index, daily_return in enumerate(returns):
                adjusted_return = daily_return * multiplier + (0.0005 if index % 3 == 0 else -0.0002)
                closes.append(closes[-1] * (1 + adjusted_return))
            return [
                HistoricalPrice(date=f"2026-01-{index + 1:02d}", close=close)
                for index, close in enumerate(closes)
            ]

        results = {}
        for ticker, start, multiplier, sector in (
            ("AAPL", 100, 1.2, "Technology"),
            ("JPM", 100, 0.7, "Financial Services"),
            ("SPY", 100, 1.0, "ETF"),
        ):
            prices = history(start, market_returns, multiplier)
            results[ticker] = MarketDataResult(
                ticker=ticker,
                status="success",
                price=prices[-1].close,
                historical_prices=prices,
                company_profile=CompanyProfile(sector=sector, currency="USD"),
                sources_used=["yfinance"],
            )

        agent = PortfolioAgent(
            market_data_agent=FakeMarketDataAgent(results),
            technical_agent=FakeTechnicalAgent(),
        )
        result = agent.run(
            PortfolioAnalysisRequest(
                holdings=[
                    PortfolioHoldingInput(ticker="AAPL", quantity=10, average_cost=100),
                    PortfolioHoldingInput(ticker="JPM", quantity=10, average_cost=100),
                ],
                benchmark_ticker="SPY",
                risk_free_rate_percent=4,
            )
        )

        self.assertEqual(result.performance.observation_count, 30)
        self.assertIsNotNone(result.performance.annualized_return_percent)
        self.assertIsNotNone(result.performance.annualized_volatility_percent)
        self.assertIsNotNone(result.performance.beta)
        self.assertIsNotNone(result.performance.sharpe_ratio)
        self.assertIsNotNone(result.performance.treynor_ratio_percent)
        self.assertIsNotNone(result.performance.jensen_alpha_percent)
        self.assertEqual(len(result.correlations), 1)
        self.assertEqual(result.technical_summary.bullish_positions, 2)


if __name__ == "__main__":
    unittest.main()

import { mockStocks } from "../data/mockStocks";
import type { BacktestResult, EvaluationReport, HistoricalReplayResult, MarketDashboard, NewsResult, OrchestratedAnalysis, PortfolioAnalysis, PortfolioCompleteAnalysis, PortfolioHolding, PortfolioRecommendation, PortfolioRecommendationRequest, SocialMediaResult, StockAnalysis, TechnicalCalibrationResult, UsStockSearchResult } from "../types";

export async function analyzePortfolio(
  holdings: PortfolioHolding[],
  cash: number,
  fresh = false,
  benchmarkTicker = "SPY",
  riskFreeRatePercent = 0,
): Promise<PortfolioAnalysis> {
  const response = await fetch(`/api/portfolio/analyze?fresh=${fresh}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      holdings,
      cash,
      base_currency: "USD",
      benchmark_ticker: benchmarkTicker,
      risk_free_rate_percent: riskFreeRatePercent,
    }),
  });
  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }
  return await response.json();
}

export async function analyzeCompletePortfolio(
  holdings: PortfolioHolding[],
  cash: number,
  fresh = false,
  benchmarkTicker = "SPY",
  riskFreeRatePercent = 0,
  withPortfolioSlm = true,
): Promise<PortfolioCompleteAnalysis> {
  const response = await fetch(
    `/api/portfolio/full-analysis?fresh=${fresh}&withPortfolioSlm=${withPortfolioSlm}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holdings,
        cash,
        base_currency: "USD",
        benchmark_ticker: benchmarkTicker,
        risk_free_rate_percent: riskFreeRatePercent,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }
  return await response.json();
}

export async function recommendPortfolio(
  request: PortfolioRecommendationRequest,
  fresh = false,
  withSlm = true,
): Promise<PortfolioRecommendation> {
  const response = await fetch(
    `/api/portfolio/recommend?fresh=${fresh}&withSlm=${withSlm}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!response.ok) {
    let message = `Gateway returned ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      message = payload.message || message;
    } catch {
      // Keep the HTTP status when the gateway response is not JSON.
    }
    throw new Error(message);
  }
  return await response.json();
}

export async function fetchFullAnalysis(ticker: string, fresh = false): Promise<OrchestratedAnalysis> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const response = await fetch(`/api/stocks/${normalizedTicker}/full-analysis?fresh=${fresh}`);
  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }
  return await response.json();
}

export async function fetchNews(ticker: string): Promise<NewsResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const response = await fetch(`/api/stocks/${normalizedTicker}/news`);

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }

  return await response.json();
}

export async function fetchSocialMedia(
  ticker: string,
  fresh = false,
): Promise<SocialMediaResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const response = await fetch(
    `/api/stocks/${normalizedTicker}/social-media?fresh=${fresh}&withSlm=true`,
  );
  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }
  return await response.json();
}

export async function fetchStockAnalysis(ticker: string): Promise<StockAnalysis> {
  const normalizedTicker = ticker.trim().toUpperCase();

  try {
    const response = await fetch(`/api/stocks/${normalizedTicker}/analyze`);

    if (!response.ok) {
      throw new Error(`Gateway returned ${response.status}`);
    }

    return await response.json();
  } catch {
    return mockStocks[normalizedTicker] ?? mockStocks.AAPL;
  }
}

export const emptyDashboard: MarketDashboard = {
  source: "En attente",
  updated_at: new Date(0).toISOString(),
  total: 0,
  page: 1,
  limit: 25,
  total_pages: 0,
  rows: [],
  brief: [],
  positions: [],
  simulation: {
    symbol: "",
    spot: 0,
    notional: 0,
    horizon_days: 0,
    domestic_rate: 0,
    foreign_rate: 0,
    forward_rate: 0,
    swap_points: 0,
    differential: 0,
    counter_value: 0,
  },
};

export async function fetchMarketDashboard(options?: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<MarketDashboard> {
  const params = new URLSearchParams({
    page: String(options?.page ?? 1),
    limit: String(options?.limit ?? 25),
    search: options?.search ?? "",
  });

  const response = await fetch(`/api/stocks/market/dashboard?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }

  return await response.json();
}

export async function searchUsStocks(search: string, limit = 20): Promise<UsStockSearchResult> {
  const params = new URLSearchParams({
    search: search.trim(),
    limit: String(limit),
    offset: "0",
  });
  const response = await fetch(`/api/stocks/us?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }
  return await response.json();
}

export async function fetchAgentEvaluation(ticker: string): Promise<EvaluationReport> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const response = await fetch(`/api/stocks/${normalizedTicker}/evaluation`);

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }

  return await response.json();
}

export async function fetchTechnicalEvaluation(ticker: string): Promise<EvaluationReport> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const response = await fetch(`/api/stocks/${normalizedTicker}/technical/evaluation`);

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }

  return await response.json();
}

export async function fetchBacktest(
  ticker: string,
  options: {
    benchmark?: string;
    period?: "2y" | "5y" | "10y";
    horizonDays?: number;
    minHistory?: number;
    transactionCostBps?: number;
    slippageBps?: number;
  } = {},
): Promise<BacktestResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const params = new URLSearchParams({
    benchmark: (options.benchmark ?? "SPY").trim().toUpperCase(),
    period: options.period ?? "5y",
    horizonDays: String(options.horizonDays ?? 20),
    minHistory: String(options.minHistory ?? 60),
    transactionCostBps: String(options.transactionCostBps ?? 5),
    slippageBps: String(options.slippageBps ?? 5),
  });
  const response = await fetch(`/api/stocks/${normalizedTicker}/backtest?${params.toString()}`);
  if (!response.ok) {
    let message = `Gateway returned ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      message = payload.message || message;
    } catch {
      // Keep the HTTP status if the response is not JSON.
    }
    throw new Error(message);
  }
  return await response.json();
}

export async function fetchTechnicalCalibration(options: {
  tickers?: string;
  benchmark?: string;
  period?: "2y" | "5y" | "10y";
  horizons?: string;
  transactionCostBps?: number;
  slippageBps?: number;
} = {}): Promise<TechnicalCalibrationResult> {
  const params = new URLSearchParams({
    benchmark: (options.benchmark ?? "SPY").trim().toUpperCase(),
    period: options.period ?? "5y",
    horizons: options.horizons ?? "5,20,60",
    transactionCostBps: String(options.transactionCostBps ?? 5),
    slippageBps: String(options.slippageBps ?? 5),
  });
  if (options.tickers?.trim()) params.set("tickers", options.tickers);
  const response = await fetch(`/api/stocks/backtesting/calibration?${params.toString()}`);
  if (!response.ok) {
    let message = `Gateway returned ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      message = payload.message || message;
    } catch {
      // Keep the HTTP status if the response is not JSON.
    }
    throw new Error(message);
  }
  return await response.json();
}

export async function fetchHistoricalReplay(
  ticker: string,
  asOf: string,
  allowReconstructedPrices = false,
): Promise<HistoricalReplayResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const params = new URLSearchParams({
    asOf,
    allowReconstructedPrices: String(allowReconstructedPrices),
  });
  const response = await fetch(`/api/stocks/${normalizedTicker}/replay?${params.toString()}`);
  if (!response.ok) {
    let message = `Gateway returned ${response.status}`;
    try {
      const payload = await response.json() as { message?: string };
      message = payload.message || message;
    } catch {
      // Keep the HTTP status if the response is not JSON.
    }
    throw new Error(message);
  }
  return await response.json();
}

export async function fetchNewsEvaluation(ticker: string): Promise<EvaluationReport> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const response = await fetch(`/api/stocks/${normalizedTicker}/news/evaluation`);

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }

  return await response.json();
}

export async function fetchRiskEvaluation(ticker: string): Promise<EvaluationReport> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const response = await fetch(`/api/stocks/${normalizedTicker}/risk/evaluation`);

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}`);
  }

  return await response.json();
}

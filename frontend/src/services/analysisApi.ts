import { mockStocks } from "../data/mockStocks";
import type { EvaluationReport, MarketDashboard, NewsResult, OrchestratedAnalysis, StockAnalysis, UsStockSearchResult } from "../types";

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

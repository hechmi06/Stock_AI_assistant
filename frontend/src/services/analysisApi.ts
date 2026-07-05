import { mockStocks } from "../data/mockStocks";
import type { EvaluationReport, MarketDashboard, StockAnalysis } from "../types";

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

const fallbackDashboard: MarketDashboard = {
  source: "Fallback frontend",
  updated_at: new Date().toISOString(),
  rows: [
    { symbol: "AAPL", name: "Apple Inc.", bid: 213.31, mid: 213.4, ask: 213.49, spread: 0.18, variation: 1.84 },
    { symbol: "MSFT", name: "Microsoft Corp.", bid: 497.82, mid: 498.05, ask: 498.28, spread: 0.46, variation: 0.72 },
    { symbol: "NVDA", name: "NVIDIA Corp.", bid: 154.56, mid: 154.63, ask: 154.7, spread: 0.14, variation: 3.05 },
    { symbol: "TSLA", name: "Tesla, Inc.", bid: 327.65, mid: 327.8, ask: 327.95, spread: 0.3, variation: -2.12 },
  ],
  brief: [
    { tag: "DATA", title: "Mode fallback", text: "Le frontend affiche un panier local en attendant le backend." },
    { tag: "IA", title: "Analyse a brancher", text: "Les prochaines etapes ajoutent fondamentaux, news et scoring explicable." },
  ],
  positions: [
    { id: "D-2087", product: "Forward", symbol: "AAPL", side: "Achat", notional: "250 000 USD", entry: 209.13, maturity: "23/07/26", pnl: 4800 },
  ],
  simulation: {
    symbol: "AAPL",
    spot: 213.4,
    notional: 250000,
    horizon_days: 90,
    domestic_rate: 4.3,
    foreign_rate: 3.8,
    forward_rate: 213.66,
    swap_points: 0.26,
    differential: 0.12,
    counter_value: 53415000,
  },
};

export async function fetchMarketDashboard(): Promise<MarketDashboard> {
  try {
    const response = await fetch("/api/stocks/market/dashboard");

    if (!response.ok) {
      throw new Error(`Gateway returned ${response.status}`);
    }

    return await response.json();
  } catch {
    return fallbackDashboard;
  }
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

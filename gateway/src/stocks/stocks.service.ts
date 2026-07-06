import { Injectable } from "@nestjs/common";

type StockAnalysis = {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  score: number;
  signal: string;
  text: string;
  values: number[];
  metrics: { label: string; value: string }[];
  checks: { title: string; detail: string; done: boolean }[];
};

type MarketDashboard = {
  source: string;
  updated_at: string;
  rows: Array<{
    symbol: string;
    name: string;
    bid: number;
    mid: number;
    ask: number;
    spread: number;
    variation: number;
  }>;
  brief: Array<{ tag: string; title: string; text: string }>;
  positions: Array<{
    id: string;
    product: string;
    symbol: string;
    side: string;
    notional: string;
    entry: number;
    maturity: string;
    pnl: number;
  }>;
  simulation: {
    symbol: string;
    spot: number;
    notional: number;
    horizon_days: number;
    domestic_rate: number;
    foreign_rate: number;
    forward_rate: number;
    swap_points: number;
    differential: number;
    counter_value: number;
  };
};

type MarketDataResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  sources_used: Array<"twelve_data" | "yfinance" | "alpha_vantage" | "financial_modeling_prep">;
  used_fallback: boolean;
  price: number | null;
  change_percent: number | null;
  historical_prices: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: number | null;
  }>;
  company_profile: {
    name: string | null;
    sector: string | null;
    industry: string | null;
    country: string | null;
    website: string | null;
    market_cap: number | null;
    currency: string | null;
    exchange: string | null;
  };
  financial_ratios: Record<string, number | null>;
  financial_statements_summary: {
    fiscal_date: string | null;
    total_revenue: number | null;
    net_income: number | null;
    total_assets: number | null;
    total_debt: number | null;
    operating_cashflow: number | null;
  };
  warnings: string[];
  errors: string[];
  slm_summary: {
    provider: string;
    model: string;
    summary: string;
    data_quality: string;
    key_points: string[];
    warnings: string[];
  } | null;
};

type TechnicalResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  sources_used: Array<"twelve_data" | "yfinance" | "alpha_vantage" | "financial_modeling_prep">;
  rsi: number | null;
  moving_averages: { sma_20: number | null; sma_50: number | null };
  volatility: number | null;
  trend: "bullish" | "bearish" | "neutral";
  support_level: number | null;
  resistance_level: number | null;
  volume_analysis: {
    last_volume: number | null;
    average_volume: number | null;
    volume_ratio: number | null;
    interpretation: string;
  };
  technical_score: number | null;
  signal: "positive" | "negative" | "neutral";
  errors: string[];
  slm_summary: {
    provider: string;
    model: string;
    summary: string;
    data_quality: string;
    key_points: string[];
    warnings: string[];
  } | null;
};

type NewsOrigin = "financial_modeling_prep" | "yahoo_rss" | "finnhub" | "google_news_rss" | "newsdata_io";

type NewsResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  articles: Array<{
    title: string;
    source: string;
    published_at: string;
    url: string;
    summary: string | null;
    origin: NewsOrigin;
    sentiment: "positive" | "negative" | "neutral" | "mixed" | null;
  }>;
  sources_used: NewsOrigin[];
  sentiment_label: "positive" | "negative" | "neutral" | "mixed" | null;
  sentiment_score: number | null;
  key_events: string[];
  warnings: string[];
  errors: string[];
  slm_summary: {
    provider: string;
    model: string;
    summary: string;
    data_quality: string;
    key_points: string[];
    warnings: string[];
  } | null;
};

type MetricResult = {
  name: string;
  score: number;
  passed: boolean;
  message: string;
};

type EvaluationReport = {
  ticker: string;
  metrics: MetricResult[];
  total_score: number;
  grade: "excellent" | "good" | "partial" | "poor";
  passed: boolean;
};

const fallbackAnalysis: Record<string, StockAnalysis> = {
  AAPL: {
    ticker: "AAPL",
    name: "Apple Inc.",
    sector: "Technologie",
    price: 213.4,
    change: 1.84,
    score: 78,
    signal: "Acheter avec prudence",
    text: "Momentum positif, valorisation correcte et tendance technique favorable.",
    values: [188, 191, 189, 196, 201, 199, 205, 211, 208, 213],
    metrics: [
      { label: "PER", value: "31.2" },
      { label: "Croissance CA", value: "+6.1%" },
      { label: "Marge nette", value: "24.3%" },
      { label: "Dette / capitaux", value: "1.52" },
    ],
    checks: [
      { title: "Tendance 30 jours", detail: "Prix au-dessus de la moyenne mobile", done: true },
      { title: "Volume", detail: "Interet acheteur superieur a la moyenne", done: true },
      { title: "Valorisation", detail: "Prix encore defendable face aux resultats", done: true },
      { title: "Risque", detail: "Volatilite moderee", done: true },
      { title: "Timing", detail: "Attendre un repli pour renforcer", done: false },
    ],
  },
};

@Injectable()
export class StocksService {
  private readonly aiBackendUrl = process.env.AI_BACKEND_URL ?? "http://localhost:8000";

  async getMarketDashboard(): Promise<MarketDashboard> {
    try {
      const response = await fetch(`${this.aiBackendUrl}/market-dashboard`);

      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }

      return (await response.json()) as MarketDashboard;
    } catch {
      return {
        source: "Fallback gateway",
        updated_at: new Date().toISOString(),
        rows: [
          { symbol: "AAPL", name: "Apple Inc.", bid: 213.31, mid: 213.4, ask: 213.49, spread: 0.18, variation: 1.84 },
          { symbol: "MSFT", name: "Microsoft Corp.", bid: 497.82, mid: 498.05, ask: 498.28, spread: 0.46, variation: 0.72 },
          { symbol: "NVDA", name: "NVIDIA Corp.", bid: 154.56, mid: 154.63, ask: 154.7, spread: 0.14, variation: 3.05 },
          { symbol: "TSLA", name: "Tesla, Inc.", bid: 327.65, mid: 327.8, ask: 327.95, spread: 0.3, variation: -2.12 },
        ],
        brief: [
          { tag: "DATA", title: "Mode fallback", text: "Le gateway affiche un panier local car le backend IA ne repond pas." },
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
    }
  }

  async analyzeTicker(ticker: string): Promise<StockAnalysis> {
    const normalizedTicker = ticker.trim().toUpperCase();

    try {
      const response = await fetch(`${this.aiBackendUrl}/analyze/${normalizedTicker}`);

      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }

      return (await response.json()) as StockAnalysis;
    } catch {
      return fallbackAnalysis[normalizedTicker] ?? {
        ...fallbackAnalysis.AAPL,
        ticker: normalizedTicker || "AAPL",
        name: `${normalizedTicker || "AAPL"} Corp.`,
      };
    }
  }

  async getMarketData(ticker: string): Promise<MarketDataResult> {
    const normalizedTicker = ticker.trim().toUpperCase();

    try {
      const response = await fetch(`${this.aiBackendUrl}/agents/market-data/${normalizedTicker}`);

      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }

      return (await response.json()) as MarketDataResult;
    } catch {
      return {
        ticker: normalizedTicker || "AAPL",
        status: "failed",
        sources_used: [],
        used_fallback: false,
        price: null,
        change_percent: null,
        historical_prices: [],
        company_profile: {
          name: null,
          sector: null,
          industry: null,
          country: null,
          website: null,
          market_cap: null,
          currency: null,
          exchange: null,
        },
        financial_ratios: {},
        financial_statements_summary: {
          fiscal_date: null,
          total_revenue: null,
          net_income: null,
          total_assets: null,
          total_debt: null,
          operating_cashflow: null,
        },
        warnings: [],
        errors: ["Gateway could not reach the AI backend MarketDataAgent endpoint."],
        slm_summary: null,
      };
    }
  }

  async getTechnicalAnalysis(ticker: string): Promise<TechnicalResult> {
    const normalizedTicker = ticker.trim().toUpperCase();

    try {
      const response = await fetch(`${this.aiBackendUrl}/agents/technical/${normalizedTicker}`);

      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }

      return (await response.json()) as TechnicalResult;
    } catch {
      return {
        ticker: normalizedTicker || "AAPL",
        status: "failed",
        sources_used: [],
        rsi: null,
        moving_averages: { sma_20: null, sma_50: null },
        volatility: null,
        trend: "neutral",
        support_level: null,
        resistance_level: null,
        volume_analysis: {
          last_volume: null,
          average_volume: null,
          volume_ratio: null,
          interpretation: "volume indisponible",
        },
        technical_score: null,
        signal: "neutral",
        errors: ["Gateway could not reach the AI backend TechnicalAgent endpoint."],
        slm_summary: null,
      };
    }
  }

  async getNews(ticker: string): Promise<NewsResult> {
    const normalizedTicker = ticker.trim().toUpperCase();

    try {
      const response = await fetch(`${this.aiBackendUrl}/agents/news/${normalizedTicker}`);

      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }

      return (await response.json()) as NewsResult;
    } catch {
      return {
        ticker: normalizedTicker || "AAPL",
        status: "failed",
        articles: [],
        sources_used: [],
        sentiment_label: null,
        sentiment_score: null,
        key_events: [],
        warnings: [],
        errors: ["Gateway could not reach the AI backend NewsAgent endpoint."],
        slm_summary: null,
      };
    }
  }

  async getAgentEvaluation(ticker: string): Promise<EvaluationReport> {
    return this.fetchEvaluation(ticker, "market-data");
  }

  async getTechnicalEvaluation(ticker: string): Promise<EvaluationReport> {
    return this.fetchEvaluation(ticker, "technical");
  }

  async getNewsEvaluation(ticker: string): Promise<EvaluationReport> {
    return this.fetchEvaluation(ticker, "news");
  }

  private async fetchEvaluation(
    ticker: string,
    agent: "market-data" | "technical" | "news",
  ): Promise<EvaluationReport> {
    const normalizedTicker = ticker.trim().toUpperCase();

    try {
      const response = await fetch(
        `${this.aiBackendUrl}/agents/${agent}/${normalizedTicker}/evaluation`,
      );

      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }

      return (await response.json()) as EvaluationReport;
    } catch {
      return {
        ticker: normalizedTicker || "AAPL",
        metrics: [
          {
            name: "agent_availability",
            score: 0,
            passed: false,
            message: "Gateway could not reach the AI backend evaluation endpoint.",
          },
        ],
        total_score: 0,
        grade: "poor",
        passed: false,
      };
    }
  }
}

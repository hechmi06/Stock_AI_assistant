import { Injectable, ServiceUnavailableException } from "@nestjs/common";

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
  total: number;
  page: number;
  limit: number;
  total_pages: number;
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
  moving_averages: {
    sma_20: number | null;
    sma_50: number | null;
    ema_20: number | null;
    ema_50: number | null;
    ema_200: number | null;
  };
  macd: { macd: number | null; signal: number | null; histogram: number | null };
  atr_14: number | null;
  atr_percent: number | null;
  bollinger_bands: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
    position_percent: number | null;
  };
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

type BacktestResult = {
  ticker: string;
  benchmark: string;
  status: "success" | "partial" | "failed";
  methodology: "walk_forward_long_cash";
  period: string;
  horizon_days: number;
  min_history: number;
  period_start: string | null;
  period_end: string | null;
  history_points: number;
  evaluation_count: number;
  signal_counts: Record<string, number>;
  reliability_level: "low" | "medium" | "high";
  lookahead_guard: boolean;
  metrics: Record<string, number | null>;
  calibration: Array<Record<string, string | number | null>>;
  observations: Array<Record<string, string | number>>;
  excluded_components: string[];
  warnings: string[];
  errors: string[];
};

type TechnicalCalibrationResult = {
  status: "success" | "partial" | "failed";
  benchmark: string;
  period: string;
  tickers_requested: string[];
  tickers_completed: string[];
  horizons: number[];
  transaction_cost_bps: number;
  slippage_bps: number;
  split: Record<string, number>;
  methodology: "chronological_train_validation_test";
  overall_verdict: "validated" | "promising" | "not_validated" | "insufficient";
  horizon_results: Array<Record<string, unknown>>;
  coverage: Array<Record<string, unknown>>;
  warnings: string[];
  errors: string[];
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

type SocialMediaResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  collected_at: string | null;
  posts: Array<{
    id: string;
    source: "reddit";
    author: string;
    text: string;
    url: string;
    published_at: string;
    engagement: {
      score?: number | null;
      comments?: number | null;
    };
    sentiment: "positive" | "negative" | "neutral" | "mixed" | null;
  }>;
  sources_used: Array<"reddit">;
  source_status: Record<
    "reddit",
    {
      status: "success" | "empty" | "unavailable" | "failed";
      posts_count: number;
      error?: string | null;
    }
  >;
  sentiment_label: "positive" | "negative" | "neutral" | "mixed" | null;
  sentiment_score: number | null;
  themes: string[];
  summary: string | null;
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

type RiskResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  overall_risk_level: "low" | "medium" | "high";
  risk_score: number;
  risk_score_breakdown: Record<string, number>;
  data_confidence_score: number;
  data_confidence_level: "low" | "medium" | "high";
  risks: Array<{
    category: "market" | "technical" | "fundamental" | "news" | "documentary" | "data_quality";
    level: "low" | "medium" | "high";
    title: string;
    description: string;
    evidence: string[];
    score_impact: number;
  }>;
  component_status: {
    market_data_status: "success" | "partial" | "failed";
    technical_status: "success" | "partial" | "failed";
    news_status: "success" | "partial" | "failed";
    rag_status: "success" | "partial" | "failed";
    market_data_errors: string[];
    technical_errors: string[];
    news_errors: string[];
    rag_errors: string[];
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

type SynthesisResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  global_score: number;
  recommendation: "favorable" | "a_surveiller" | "prudence" | "defavorable" | "donnees_insuffisantes";
  confidence_score: number;
  confidence_level: "low" | "medium" | "high";
  scores: { technical: number; fundamental: number; news: number; risk: number };
  weights: Record<string, number>;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  key_risks: RiskResult["risks"];
  sources: string[];
  agent_status: Record<string, "success" | "partial" | "failed">;
  warnings: string[];
  errors: string[];
  slm_summary: object | null;
};

type OrchestratedAnalysis = {
  ticker: string;
  status: "success" | "partial" | "failed";
  workflow: "langgraph";
  generated_at: string;
  execution_trace: Array<{ agent: string; status: "success" | "partial" | "failed"; duration_ms: number }>;
  market_data: MarketDataResult;
  technical: TechnicalResult;
  news: NewsResult;
  rag: RagResult;
  risk: RiskResult;
  synthesis: SynthesisResult;
};

type RagResult = {
  ticker: string;
  question: string;
  status: "success" | "partial" | "failed";
  answer: string | null;
  passages: Array<{
    text: string;
    form: string | null;
    filing_date: string | null;
    url: string | null;
    score: number;
  }>;
  indexed_chunks: number;
  warnings: string[];
  errors: string[];
};

type RagIngestResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  documents: Array<{ form: string; filing_date: string | null; url: string; chunks_indexed: number }>;
  chunks_indexed: number;
  warnings: string[];
  errors: string[];
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
  private readonly aiBackendUrl =
    process.env.AI_BACKEND_URL ?? "http://127.0.0.1:8000";

  async getMarketDashboard(options?: { page?: number; limit?: number; search?: string }): Promise<MarketDashboard> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 25;
    const search = options?.search ?? "";
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      search,
    });

    try {
      const response = await fetch(`${this.aiBackendUrl}/market-dashboard?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }

      return (await response.json()) as MarketDashboard;
    } catch {
      throw new ServiceUnavailableException("Market dashboard indisponible — aucune donnee statique de secours.");
    }
  }

  async searchUsStocks(options?: { search?: string; limit?: number; offset?: number }) {
    const search = options?.search ?? "";
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const params = new URLSearchParams({
      search,
      limit: String(limit),
      offset: String(offset),
    });

    try {
      const response = await fetch(`${this.aiBackendUrl}/stocks/us?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return await response.json();
    } catch {
      return { total: 0, offset, limit, symbols: [] };
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

  async getSynthesis(ticker: string, fresh = false): Promise<SynthesisResult> {
    return this.fetchRequired<SynthesisResult>(
      `/agents/synthesis/${ticker.trim().toUpperCase()}?fresh=${fresh}`,
      "SynthesisAgent indisponible.",
    );
  }

  async getFullAnalysis(ticker: string, fresh = false): Promise<OrchestratedAnalysis> {
    return this.fetchRequired<OrchestratedAnalysis>(
      `/analysis/${ticker.trim().toUpperCase()}?fresh=${fresh}`,
      "Analyse multi-agents indisponible.",
    );
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
        moving_averages: {
          sma_20: null,
          sma_50: null,
          ema_20: null,
          ema_50: null,
          ema_200: null,
        },
        macd: { macd: null, signal: null, histogram: null },
        atr_14: null,
        atr_percent: null,
        bollinger_bands: {
          upper: null,
          middle: null,
          lower: null,
          position_percent: null,
        },
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

  async getBacktest(
    ticker: string,
    options: {
      benchmark: string;
      period: string;
      horizonDays: number;
      minHistory: number;
      transactionCostBps: number;
      slippageBps: number;
    },
  ): Promise<BacktestResult> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const params = new URLSearchParams({
      benchmark: options.benchmark.trim().toUpperCase(),
      period: options.period,
      horizon_days: String(options.horizonDays),
      min_history: String(options.minHistory),
      transaction_cost_bps: String(options.transactionCostBps),
      slippage_bps: String(options.slippageBps),
    });
    return this.fetchRequired<BacktestResult>(
      `/agents/backtesting/${normalizedTicker}?${params.toString()}`,
      "BacktestingAgent indisponible.",
    );
  }

  async getTechnicalCalibration(options: {
    tickers?: string;
    benchmark: string;
    period: string;
    horizons: string;
    transactionCostBps: number;
    slippageBps: number;
  }): Promise<TechnicalCalibrationResult> {
    const params = new URLSearchParams({
      benchmark: options.benchmark.trim().toUpperCase(),
      period: options.period,
      horizons: options.horizons,
      transaction_cost_bps: String(options.transactionCostBps),
      slippage_bps: String(options.slippageBps),
    });
    if (options.tickers?.trim()) {
      params.set("tickers", options.tickers);
    }
    return this.fetchRequired<TechnicalCalibrationResult>(
      `/agents/backtesting/calibration/run?${params.toString()}`,
      "Calibration du TechnicalAgent indisponible.",
    );
  }

  async getPointInTimeEvents(
    ticker: string,
    options: {
      component?: string;
      eventType?: string;
      asOf?: string;
      observedOnly: boolean;
      limit: number;
    },
  ): Promise<Record<string, unknown>> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const params = new URLSearchParams({
      observed_only: String(options.observedOnly),
      limit: String(Math.max(1, Math.min(1000, options.limit || 100))),
    });
    if (options.component?.trim()) params.set("component", options.component.trim());
    if (options.eventType?.trim()) params.set("event_type", options.eventType.trim());
    if (options.asOf?.trim()) params.set("as_of", options.asOf.trim());
    return this.fetchRequired<Record<string, unknown>>(
      `/agents/point-in-time/${normalizedTicker}?${params.toString()}`,
      "Archive point-in-time indisponible.",
    );
  }

  async getPointInTimeSummary(ticker: string): Promise<Record<string, unknown>> {
    const normalizedTicker = ticker.trim().toUpperCase();
    return this.fetchRequired<Record<string, unknown>>(
      `/agents/point-in-time/${normalizedTicker}/summary`,
      "Resume point-in-time indisponible.",
    );
  }

  async replayHistoricalAnalysis(
    ticker: string,
    asOf: string,
    allowReconstructedPrices = false,
  ): Promise<Record<string, unknown>> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const params = new URLSearchParams({
      as_of: asOf,
      allow_reconstructed_prices: String(allowReconstructedPrices),
    });
    return this.fetchRequired<Record<string, unknown>>(
      `/agents/replay/${normalizedTicker}?${params.toString()}`,
      "Replay historique indisponible.",
    );
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

  async getSocialMedia(
    ticker: string,
    fresh = false,
    withSlm = true,
  ): Promise<SocialMediaResult> {
    const normalizedTicker = ticker.trim().toUpperCase();

    try {
      const params = new URLSearchParams({
        fresh: String(fresh),
        with_slm: String(withSlm),
      });
      const response = await fetch(
        `${this.aiBackendUrl}/agents/social-media/${normalizedTicker}?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return (await response.json()) as SocialMediaResult;
    } catch {
      return {
        ticker: normalizedTicker || "AAPL",
        status: "failed",
        collected_at: null,
        posts: [],
        sources_used: [],
        source_status: {
          reddit: { status: "failed", posts_count: 0 },
        },
        sentiment_label: null,
        sentiment_score: null,
        themes: [],
        summary: null,
        warnings: [],
        errors: [
          "Gateway could not reach the independent SocialMediaAgent endpoint.",
        ],
        slm_summary: null,
      };
    }
  }

  async getRisk(ticker: string): Promise<RiskResult> {
    const normalizedTicker = ticker.trim().toUpperCase();

    try {
      const response = await fetch(`${this.aiBackendUrl}/agents/risk/${normalizedTicker}`);

      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }

      return (await response.json()) as RiskResult;
    } catch {
      return {
        ticker: normalizedTicker || "AAPL",
        status: "failed",
        overall_risk_level: "high",
        risk_score: 100,
        risk_score_breakdown: {},
        data_confidence_score: 0,
        data_confidence_level: "low",
        risks: [],
        component_status: {
          market_data_status: "failed",
          technical_status: "failed",
          news_status: "failed",
          rag_status: "failed",
          market_data_errors: [],
          technical_errors: [],
          news_errors: [],
          rag_errors: [],
        },
        warnings: [],
        errors: ["Gateway could not reach the AI backend RiskAgent endpoint."],
        slm_summary: null,
      };
    }
  }

  async queryRag(ticker: string, question: string): Promise<RagResult> {
    const normalizedTicker = ticker.trim().toUpperCase();
    try {
      const response = await fetch(
        `${this.aiBackendUrl}/agents/rag/${normalizedTicker}/query?q=${encodeURIComponent(question)}`,
      );
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return (await response.json()) as RagResult;
    } catch {
      return {
        ticker: normalizedTicker || "AAPL",
        question,
        status: "failed",
        answer: null,
        passages: [],
        indexed_chunks: 0,
        warnings: [],
        errors: ["Gateway could not reach the AI backend RAGAgent query endpoint."],
      };
    }
  }

  async ingestRag(ticker: string, limit = 2): Promise<RagIngestResult> {
    const normalizedTicker = ticker.trim().toUpperCase();
    try {
      const response = await fetch(
        `${this.aiBackendUrl}/agents/rag/${normalizedTicker}/ingest?limit=${limit}`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return (await response.json()) as RagIngestResult;
    } catch {
      return {
        ticker: normalizedTicker || "AAPL",
        status: "failed",
        documents: [],
        chunks_indexed: 0,
        warnings: [],
        errors: ["Gateway could not reach the AI backend RAGAgent ingest endpoint."],
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

  async getRiskEvaluation(ticker: string): Promise<EvaluationReport> {
    return this.fetchEvaluation(ticker, "risk");
  }

  async getRagEvaluation(ticker: string): Promise<EvaluationReport> {
    return this.fetchEvaluation(ticker, "rag");
  }

  async getSynthesisEvaluation(ticker: string): Promise<EvaluationReport> {
    return this.fetchEvaluation(ticker, "synthesis");
  }

  private async fetchEvaluation(
    ticker: string,
    agent: "market-data" | "technical" | "news" | "risk" | "rag" | "synthesis",
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

  private async fetchRequired<T>(path: string, message: string): Promise<T> {
    try {
      const response = await fetch(`${this.aiBackendUrl}${path}`);
      if (!response.ok) {
        throw new Error(`AI backend returned ${response.status}`);
      }
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException(message);
    }
  }
}

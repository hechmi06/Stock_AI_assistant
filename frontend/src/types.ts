export type Metric = {
  label: string;
  value: string;
};

export type ChecklistItem = {
  title: string;
  detail: string;
  done: boolean;
};

export type StockAnalysis = {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  score: number;
  signal: string;
  text: string;
  values: number[];
  metrics: Metric[];
  checks: ChecklistItem[];
};

export type MarketRow = {
  symbol: string;
  name: string;
  bid: number;
  mid: number;
  ask: number;
  spread: number;
  variation: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  previous_close?: number | null;
  volume?: number | null;
};

export type BriefItem = {
  tag: string;
  title: string;
  text: string;
};

export type Position = {
  id: string;
  product: string;
  symbol: string;
  side: string;
  notional: string;
  entry: number;
  maturity: string;
  pnl: number;
};

export type ForwardSimulation = {
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

export type MarketDashboard = {
  source: string;
  updated_at: string;
  rows: MarketRow[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  brief: BriefItem[];
  positions: Position[];
  simulation: ForwardSimulation;
};

export type UsStockSymbol = {
  symbol: string;
  name: string;
};

export type UsStockSearchResult = {
  total: number;
  offset: number;
  limit: number;
  symbols: UsStockSymbol[];
};

export type NewsSentiment = "positive" | "negative" | "neutral" | "mixed";

export type NewsOrigin =
  | "financial_modeling_prep"
  | "yahoo_rss"
  | "finnhub"
  | "google_news_rss"
  | "newsdata_io";

export type NewsArticle = {
  title: string;
  source: string;
  published_at: string;
  url: string;
  summary: string | null;
  content: string | null;
  origin: NewsOrigin;
  sentiment: NewsSentiment | null;
};

export type NewsResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  articles: NewsArticle[];
  sources_used: NewsOrigin[];
  sentiment_label: NewsSentiment | null;
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

export type MetricResult = {
  name: string;
  score: number;
  passed: boolean;
  message: string;
};

export type EvaluationGrade = "excellent" | "good" | "partial" | "poor";

export type EvaluationReport = {
  ticker: string;
  metrics: MetricResult[];
  total_score: number;
  grade: EvaluationGrade;
  passed: boolean;
};

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
  brief: BriefItem[];
  positions: Position[];
  simulation: ForwardSimulation;
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

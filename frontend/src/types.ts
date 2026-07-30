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

export type SocialSource = "reddit";
export type SocialSourceState = "success" | "empty" | "unavailable" | "failed";

export type SocialPost = {
  id: string;
  source: SocialSource;
  author: string;
  text: string;
  url: string;
  published_at: string;
  engagement: {
    score?: number | null;
    comments?: number | null;
  };
  sentiment: NewsSentiment | null;
};

export type SocialMediaResult = {
  ticker: string;
  status: "success" | "partial" | "failed";
  collected_at: string | null;
  posts: SocialPost[];
  sources_used: SocialSource[];
  source_status: Record<
    SocialSource,
    {
      status: SocialSourceState;
      posts_count: number;
      error?: string | null;
    }
  >;
  sentiment_label: NewsSentiment | null;
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

export type BacktestObservation = {
  signal_date: string;
  exit_date: string;
  technical_score: number;
  signal: "positive" | "negative" | "neutral";
  entry_price: number;
  exit_price: number;
  forward_return_percent: number;
  strategy_return_percent: number;
  benchmark_return_percent: number;
  execution_cost_percent: number;
  cumulative_strategy_percent: number;
  cumulative_ticker_percent: number;
  cumulative_benchmark_percent: number;
  feature_signals: Record<string, number>;
};

export type BacktestResult = {
  ticker: string;
  benchmark: string;
  status: "success" | "partial" | "failed";
  methodology: "walk_forward_long_cash";
  period: string;
  horizon_days: number;
  min_history: number;
  transaction_cost_bps: number;
  slippage_bps: number;
  period_start: string | null;
  period_end: string | null;
  history_points: number;
  evaluation_count: number;
  signal_counts: Record<string, number>;
  reliability_level: "low" | "medium" | "high";
  verdict: "validated" | "recalibrate" | "not_validated" | "insufficient";
  lookahead_guard: boolean;
  qualification_checks: QualificationCheck[];
  metrics: {
    strategy_return_percent: number;
    ticker_buy_hold_return_percent: number;
    benchmark_return_percent: number;
    excess_return_percent: number;
    annualized_return_percent: number;
    annualized_volatility_percent: number;
    sharpe_ratio: number | null;
    max_drawdown_percent: number;
    average_trade_return_percent: number;
    directional_accuracy_percent: number | null;
    invested_win_rate_percent: number | null;
    mean_return_ci_95_low_percent: number | null;
    mean_return_ci_95_high_percent: number | null;
  };
  calibration: Array<{
    label: string;
    score_min: number;
    score_max: number;
    observations: number;
    average_forward_return_percent: number | null;
    positive_return_rate_percent: number | null;
  }>;
  observations: BacktestObservation[];
  excluded_components: string[];
  warnings: string[];
  errors: string[];
};

export type QualificationCheck = {
  name: string;
  passed: boolean;
  actual: number | string | null;
  threshold: string;
};

export type CalibrationSplitMetrics = {
  observations: number;
  invested_trades: number;
  average_strategy_return_percent: number;
  average_benchmark_return_percent: number;
  average_excess_return_percent: number;
  annualized_sharpe_ratio: number | null;
  win_rate_percent: number | null;
  mean_return_ci_95_low_percent: number | null;
  mean_return_ci_95_high_percent: number | null;
};

export type TechnicalFeatureDiagnostic = {
  name: string;
  label: string;
  train_information_coefficient: number | null;
  validation_information_coefficient: number | null;
  test_information_coefficient: number | null;
  train_coverage_percent: number;
  selected: boolean;
  rejection_reason: string | null;
  weight: number;
};

export type TechnicalFeatureModel = {
  status: "candidate" | "rejected" | "insufficient";
  production_eligible: boolean;
  selected_features: string[];
  weights: Record<string, number>;
  selected_threshold: number;
  train: CalibrationSplitMetrics;
  validation: CalibrationSplitMetrics;
  test: CalibrationSplitMetrics;
  baseline_test: CalibrationSplitMetrics;
  test_excess_uplift_percent: number;
  diagnostics: TechnicalFeatureDiagnostic[];
  checks: QualificationCheck[];
  notes: string[];
};

export type TechnicalCalibrationResult = {
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
  horizon_results: Array<{
    horizon_days: number;
    selected_threshold: number;
    train: CalibrationSplitMetrics;
    validation: CalibrationSplitMetrics;
    test: CalibrationSplitMetrics;
    verdict: "validated" | "promising" | "not_validated" | "insufficient";
    checks: QualificationCheck[];
    feature_model: TechnicalFeatureModel;
  }>;
  coverage: Array<{
    ticker: string;
    status: "success" | "partial" | "failed";
    observations_by_horizon: Record<string, number>;
    error: string | null;
  }>;
  warnings: string[];
  errors: string[];
};

export type AnalysisStatus = "success" | "partial" | "failed";
export type RiskLevel = "low" | "medium" | "high";

export type RiskItem = {
  category: "market" | "technical" | "fundamental" | "news" | "documentary" | "data_quality";
  level: RiskLevel;
  title: string;
  description: string;
  evidence: string[];
  score_impact: number;
};

export type SynthesisResult = {
  ticker: string;
  status: AnalysisStatus;
  global_score: number;
  recommendation: "favorable" | "a_surveiller" | "prudence" | "defavorable" | "donnees_insuffisantes";
  confidence_score: number;
  confidence_level: RiskLevel;
  scores: {
    technical: number;
    fundamental: number;
    news: number;
    risk: number;
  };
  weights: Record<string, number>;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  key_risks: RiskItem[];
  sources: string[];
  agent_status: Record<string, AnalysisStatus>;
  warnings: string[];
  errors: string[];
};

export type OrchestratedAnalysis = {
  ticker: string;
  status: AnalysisStatus;
  workflow: "langgraph";
  generated_at: string;
  execution_trace: Array<{
    agent: string;
    status: AnalysisStatus;
    duration_ms: number;
  }>;
  market_data: {
    status: AnalysisStatus;
    price: number | null;
    change_percent: number | null;
    sources_used: string[];
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
    raw_price: {
      ticker: string;
      price: number | null;
      change_percent: number | null;
      currency: string | null;
      exchange: string | null;
      market_state: string | null;
      source: string;
    } | null;
  };
  technical: {
    status: AnalysisStatus;
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
  };
  news: NewsResult;
  rag: {
    status: AnalysisStatus;
    indexed_chunks: number;
    passages: Array<{
      text: string;
      form: string | null;
      filing_date: string | null;
      url: string | null;
      score: number;
    }>;
    warnings: string[];
    errors: string[];
  };
  risk: {
    status: AnalysisStatus;
    overall_risk_level: RiskLevel;
    risk_score: number;
    risk_score_breakdown: Record<string, number>;
    data_confidence_score: number;
    data_confidence_level: RiskLevel;
    risks: RiskItem[];
  };
  synthesis: SynthesisResult;
};

export type HistoricalReplayResult = {
  ticker: string;
  status: AnalysisStatus;
  as_of: string;
  replay_mode: "strict" | "research";
  allow_reconstructed_prices: boolean;
  lookahead_guard_passed: boolean;
  archive_coverage_score: number;
  trace: Array<{
    component: string;
    status: AnalysisStatus;
    event_ids: string[];
    event_count: number;
    latest_available_at: string | null;
    knowledge_modes: Array<"observed" | "reconstructed" | "derived">;
    message: string;
  }>;
  market_data: OrchestratedAnalysis["market_data"];
  technical: OrchestratedAnalysis["technical"];
  news: NewsResult;
  rag: OrchestratedAnalysis["rag"];
  risk: OrchestratedAnalysis["risk"];
  synthesis: SynthesisResult;
  warnings: string[];
  errors: string[];
};

export type PortfolioHolding = {
  ticker: string;
  quantity: number;
  average_cost: number;
};

export type PortfolioPosition = PortfolioHolding & {
  name: string | null;
  sector: string;
  current_price: number | null;
  cost_basis: number;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_percent: number | null;
  day_change_percent: number | null;
  day_pnl: number | null;
  weight: number;
  currency: string | null;
  data_status: AnalysisStatus;
  sources_used: string[];
  warnings: string[];
  technical: {
    status: AnalysisStatus;
    rsi: number | null;
    sma_20: number | null;
    sma_50: number | null;
    volatility: number | null;
    trend: "bullish" | "bearish" | "neutral";
    support_level: number | null;
    resistance_level: number | null;
    technical_score: number | null;
    signal: "positive" | "negative" | "neutral";
  };
  fundamentals: {
    fiscal_date: string | null;
    market_cap: number | null;
    trailing_pe: number | null;
    forward_pe: number | null;
    price_to_book: number | null;
    peg_ratio: number | null;
    profit_margin_percent: number | null;
    return_on_equity_percent: number | null;
    debt_to_equity: number | null;
    revenue_growth_percent: number | null;
    earnings_growth_percent: number | null;
    total_revenue: number | null;
    net_income: number | null;
    total_debt: number | null;
    operating_cashflow: number | null;
    data_completeness_score: number;
  };
  company: {
    industry: string | null;
    country: string | null;
    website: string | null;
    exchange: string | null;
    market_cap: number | null;
  };
  historical_prices: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: number | null;
  }>;
};

export type PortfolioAllocation = {
  label: string;
  value: number;
  weight: number;
};

export type PortfolioAnalysis = {
  status: AnalysisStatus;
  generated_at: string;
  base_currency: string;
  positions: PortfolioPosition[];
  summary: {
    total_value: number;
    invested_value: number;
    cash: number;
    total_cost: number;
    unrealized_pnl: number;
    unrealized_pnl_percent: number | null;
    day_pnl: number;
    day_change_percent: number | null;
  };
  allocation_by_holding: PortfolioAllocation[];
  allocation_by_sector: PortfolioAllocation[];
  risk: {
    concentration_score: number;
    concentration_level: RiskLevel;
    diversification_score: number;
    diversification_level: "low" | "medium" | "high";
    largest_position_ticker: string | null;
    largest_position_weight: number;
    top_three_weight: number;
    effective_holdings: number;
    data_confidence_score: number;
    data_confidence_level: RiskLevel;
  };
  performance: {
    benchmark_ticker: string;
    observation_count: number;
    period_start: string | null;
    period_end: string | null;
    cumulative_return_percent: number | null;
    annualized_return_percent: number | null;
    annualized_volatility_percent: number | null;
    benchmark_cumulative_return_percent: number | null;
    benchmark_annualized_return_percent: number | null;
    benchmark_annualized_volatility_percent: number | null;
    beta: number | null;
    sharpe_ratio: number | null;
    treynor_ratio_percent: number | null;
    jensen_alpha_percent: number | null;
    max_drawdown_percent: number | null;
    average_correlation: number | null;
    curve: Array<{
      date: string;
      portfolio_return_percent: number;
      benchmark_return_percent: number;
    }>;
  };
  technical_summary: {
    weighted_score: number | null;
    bullish_positions: number;
    neutral_positions: number;
    bearish_positions: number;
    overbought_positions: number;
    oversold_positions: number;
  };
  correlations: Array<{
    ticker_a: string;
    ticker_b: string;
    correlation: number;
  }>;
  sources_used: string[];
  warnings: string[];
  errors: string[];
};

export type PortfolioVerdict = "robuste" | "coherent" | "a_reequilibrer" | "fragile" | "donnees_insuffisantes";
export type PortfolioDecision = "renforcer" | "conserver" | "reduire" | "ecarter" | "non_evaluable";

export type PortfolioCompleteAnalysis = {
  status: AnalysisStatus;
  generated_at: string;
  workflow: "portfolio_multi_agent";
  portfolio: PortfolioAnalysis;
  individual_analyses: Array<{
    ticker: string;
    status: AnalysisStatus;
    global_score: number;
    recommendation: SynthesisResult["recommendation"];
    confidence_score: number;
    risk_score: number;
    risk_level: RiskLevel;
    technical_score: number;
    fundamental_score: number;
    news_score: number;
    summary: string;
    key_risks: string[];
    sources: string[];
  }>;
  synthesis: {
    status: AnalysisStatus;
    verdict: PortfolioVerdict;
    global_score: number;
    data_confidence_score: number;
    model_confidence_score: number;
    decision_confidence_score: number;
    confidence_score: number;
    confidence_level: RiskLevel;
    scores: {
      individual_quality: number;
      diversification: number;
      risk_adjusted_performance: number;
      technical_alignment: number;
      data_quality: number;
    };
    weights: Record<string, number>;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    position_assessments: Array<{
      ticker: string;
      current_weight: number;
      target_weight: number;
      global_score: number | null;
      confidence_score: number;
      risk_level: RiskLevel;
      decision: PortfolioDecision;
      rationale: string;
    }>;
    rebalancing_plan: Array<{
      label: string;
      current_weight: number;
      target_weight: number;
      change_percent: number;
      action: PortfolioDecision | "reserve" | "diversifier";
      rationale: string;
    }>;
    analyzed_positions: number;
    requested_positions: number;
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
};

export type InvestorRiskProfile = "conservative" | "moderate" | "dynamic";
export type InvestmentObjective = "preservation" | "balanced" | "growth";

export type PortfolioRecommendationRequest = {
  budget: number;
  risk_profile: InvestorRiskProfile;
  objective: InvestmentObjective;
  horizon_years: number;
  max_positions: number;
  cash_reserve_percent: number | null;
  benchmark_ticker: string;
  risk_free_rate_percent: number;
  base_currency: "USD";
  excluded_tickers: string[];
};

export type PortfolioRecommendation = {
  status: AnalysisStatus;
  generated_at: string;
  workflow: "portfolio_recommendation";
  methodology_version: string;
  profile: PortfolioRecommendationRequest;
  universe: string[];
  candidates: Array<{
    ticker: string;
    name: string | null;
    sector: string;
    status: AnalysisStatus;
    total_score: number;
    potential_score: number;
    fundamental_score: number;
    technical_score: number;
    stability_score: number;
    momentum_score: number;
    data_quality_score: number;
    value_score: number;
    growth_score: number;
    potential_label: string | null;
    current_price: number | null;
    volatility: number | null;
    quality_gate_passed: boolean;
    quality_issues: string[];
    reasons: string[];
    rejection_reason: string | null;
  }>;
  allocations: Array<{
    ticker: string;
    name: string | null;
    sector: string;
    weight: number;
    amount: number;
    quantity: number;
    reference_price: number;
    screening_score: number;
    potential_label: string | null;
    role: string;
    reasons: string[];
  }>;
  cash_amount: number;
  cash_weight: number;
  summary: string;
  selection_method: string[];
  strengths: string[];
  risks: string[];
  validation_rounds: number;
  validation_records: Array<{
    round: number;
    ticker: string;
    decision: "accepted" | "rejected";
    recommendation:
      | "favorable"
      | "a_surveiller"
      | "prudence"
      | "defavorable"
      | "donnees_insuffisantes";
    global_score: number;
    confidence_score: number;
    risk_level: "low" | "medium" | "high";
    reasons: string[];
  }>;
  portfolio_analysis: PortfolioCompleteAnalysis | null;
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

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


MarketDataStatus = Literal["success", "partial", "failed"]
MarketDataSource = Literal["twelve_data", "yfinance", "alpha_vantage", "financial_modeling_prep", "tiingo"]
PriceSource = Literal["twelve_data", "yfinance", "alpha_vantage", "financial_modeling_prep", "fallback"]


class PriceQuote(BaseModel):
    ticker: str
    price: float | None = None
    change_percent: float | None = None
    currency: str | None = None
    exchange: str | None = None
    market_state: str | None = None
    source: PriceSource


class HistoricalPrice(BaseModel):
    date: str
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float
    volume: int | None = None


class CompanyProfile(BaseModel):
    name: str | None = None
    sector: str | None = None
    industry: str | None = None
    country: str | None = None
    website: str | None = None
    market_cap: float | None = None
    currency: str | None = None
    exchange: str | None = None


class FinancialStatementsSummary(BaseModel):
    fiscal_date: str | None = None
    total_revenue: float | None = None
    net_income: float | None = None
    total_assets: float | None = None
    total_debt: float | None = None
    operating_cashflow: float | None = None


class SlmSummary(BaseModel):
    provider: str = "nebius"
    model: str
    summary: str
    data_quality: str
    key_points: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


TrendDirection = Literal["bullish", "bearish", "neutral"]
TechnicalSignal = Literal["positive", "negative", "neutral"]


class MovingAverages(BaseModel):
    sma_20: float | None = None
    sma_50: float | None = None


class VolumeAnalysis(BaseModel):
    last_volume: int | None = None
    average_volume: float | None = None
    volume_ratio: float | None = None
    interpretation: str = "volume indisponible"


class TechnicalResult(BaseModel):
    ticker: str
    status: MarketDataStatus
    sources_used: list[MarketDataSource] = Field(default_factory=list)
    rsi: float | None = None
    moving_averages: MovingAverages = Field(default_factory=MovingAverages)
    volatility: float | None = None
    trend: TrendDirection = "neutral"
    support_level: float | None = None
    resistance_level: float | None = None
    volume_analysis: VolumeAnalysis = Field(default_factory=VolumeAnalysis)
    technical_score: int | None = None
    signal: TechnicalSignal = "neutral"
    errors: list[str] = Field(default_factory=list)
    slm_summary: SlmSummary | None = None


NewsSentiment = Literal["positive", "negative", "neutral", "mixed"]
NewsOrigin = Literal[
    "financial_modeling_prep",
    "yahoo_rss",
    "finnhub",
    "google_news_rss",
    "newsdata_io",
]


class NewsArticle(BaseModel):
    title: str
    source: str
    published_at: str
    url: str
    summary: str | None = None
    content: str | None = None
    origin: NewsOrigin
    sentiment: NewsSentiment | None = None


class NewsResult(BaseModel):
    ticker: str
    status: MarketDataStatus
    articles: list[NewsArticle] = Field(default_factory=list)
    sources_used: list[NewsOrigin] = Field(default_factory=list)
    sentiment_label: NewsSentiment | None = None
    sentiment_score: float | None = Field(default=None, ge=-1.0, le=1.0)
    key_events: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    slm_summary: SlmSummary | None = None


RiskLevel = Literal["low", "medium", "high"]
RiskCategory = Literal["market", "technical", "fundamental", "news", "documentary", "data_quality"]


class RiskItem(BaseModel):
    category: RiskCategory
    level: RiskLevel
    title: str
    description: str
    evidence: list[str] = Field(default_factory=list)
    score_impact: int = Field(default=0, ge=0, le=100)


class AgentRiskSnapshot(BaseModel):
    market_data_status: MarketDataStatus = "failed"
    technical_status: MarketDataStatus = "failed"
    news_status: MarketDataStatus = "failed"
    rag_status: MarketDataStatus = "failed"
    market_data_errors: list[str] = Field(default_factory=list)
    technical_errors: list[str] = Field(default_factory=list)
    news_errors: list[str] = Field(default_factory=list)
    rag_errors: list[str] = Field(default_factory=list)


class RiskResult(BaseModel):
    ticker: str
    status: MarketDataStatus
    overall_risk_level: RiskLevel
    risk_score: int = Field(default=0, ge=0, le=100)
    risk_score_breakdown: dict[str, int] = Field(default_factory=dict)
    data_confidence_score: int = Field(default=0, ge=0, le=100)
    data_confidence_level: RiskLevel = "low"
    risks: list[RiskItem] = Field(default_factory=list)
    component_status: AgentRiskSnapshot = Field(default_factory=AgentRiskSnapshot)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    slm_summary: SlmSummary | None = None


class RagPassage(BaseModel):
    text: str
    form: str | None = None
    filing_date: str | None = None
    url: str | None = None
    score: float = 0.0


class RagDocument(BaseModel):
    form: str
    filing_date: str | None = None
    url: str
    chunks_indexed: int = 0


class RagIngestResult(BaseModel):
    ticker: str
    status: MarketDataStatus
    documents: list[RagDocument] = Field(default_factory=list)
    chunks_indexed: int = 0
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class RagResult(BaseModel):
    ticker: str
    question: str
    status: MarketDataStatus
    answer: str | None = None
    passages: list[RagPassage] = Field(default_factory=list)
    indexed_chunks: int = 0
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class MarketDataResult(BaseModel):
    ticker: str
    status: MarketDataStatus
    sources_used: list[MarketDataSource] = Field(default_factory=list)
    used_fallback: bool = False
    price: float | None = None
    change_percent: float | None = None
    historical_prices: list[HistoricalPrice] = Field(default_factory=list)
    company_profile: CompanyProfile = Field(default_factory=CompanyProfile)
    financial_ratios: dict[str, float | None] = Field(default_factory=dict)
    financial_statements_summary: FinancialStatementsSummary = Field(default_factory=FinancialStatementsSummary)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    raw_price: PriceQuote | None = None
    slm_summary: SlmSummary | None = None


SynthesisRecommendation = Literal[
    "favorable",
    "a_surveiller",
    "prudence",
    "defavorable",
    "donnees_insuffisantes",
]


class SynthesisScores(BaseModel):
    technical: int = Field(default=50, ge=0, le=100)
    fundamental: int = Field(default=50, ge=0, le=100)
    news: int = Field(default=50, ge=0, le=100)
    risk: int = Field(default=50, ge=0, le=100)


class AgentStatusSummary(BaseModel):
    market_data: MarketDataStatus = "failed"
    technical: MarketDataStatus = "failed"
    news: MarketDataStatus = "failed"
    rag: MarketDataStatus = "failed"
    risk: MarketDataStatus = "failed"


class SynthesisResult(BaseModel):
    ticker: str
    status: MarketDataStatus
    global_score: int = Field(default=0, ge=0, le=100)
    recommendation: SynthesisRecommendation = "donnees_insuffisantes"
    confidence_score: int = Field(default=0, ge=0, le=100)
    confidence_level: RiskLevel = "low"
    scores: SynthesisScores = Field(default_factory=SynthesisScores)
    weights: dict[str, float] = Field(default_factory=dict)
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    key_risks: list[RiskItem] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    agent_status: AgentStatusSummary = Field(default_factory=AgentStatusSummary)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    slm_summary: SlmSummary | None = None


class AgentExecution(BaseModel):
    agent: str
    status: MarketDataStatus
    duration_ms: int = Field(default=0, ge=0)


class OrchestratedAnalysis(BaseModel):
    ticker: str
    status: MarketDataStatus
    workflow: str = "langgraph"
    generated_at: datetime
    execution_trace: list[AgentExecution] = Field(default_factory=list)
    market_data: MarketDataResult
    technical: TechnicalResult
    news: NewsResult
    rag: RagResult
    risk: RiskResult
    synthesis: SynthesisResult


PortfolioDiversificationLevel = Literal["low", "medium", "high"]


class PortfolioHoldingInput(BaseModel):
    ticker: str = Field(min_length=1, max_length=15)
    quantity: float = Field(gt=0)
    average_cost: float = Field(ge=0)


class PortfolioAnalysisRequest(BaseModel):
    holdings: list[PortfolioHoldingInput] = Field(min_length=1, max_length=50)
    cash: float = Field(default=0, ge=0)
    base_currency: str = Field(default="USD", min_length=3, max_length=3)
    benchmark_ticker: str = Field(default="SPY", min_length=1, max_length=15)
    risk_free_rate_percent: float = Field(default=0, ge=-100, le=100)


class PortfolioTechnicalSnapshot(BaseModel):
    status: MarketDataStatus = "failed"
    rsi: float | None = None
    sma_20: float | None = None
    sma_50: float | None = None
    volatility: float | None = None
    trend: TrendDirection = "neutral"
    support_level: float | None = None
    resistance_level: float | None = None
    technical_score: int | None = None
    signal: TechnicalSignal = "neutral"


class PortfolioPositionResult(BaseModel):
    ticker: str
    name: str | None = None
    sector: str = "Unknown"
    quantity: float
    average_cost: float
    current_price: float | None = None
    cost_basis: float
    market_value: float | None = None
    unrealized_pnl: float | None = None
    unrealized_pnl_percent: float | None = None
    day_change_percent: float | None = None
    day_pnl: float | None = None
    weight: float = Field(default=0, ge=0, le=100)
    currency: str | None = None
    data_status: MarketDataStatus = "failed"
    sources_used: list[MarketDataSource] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    technical: PortfolioTechnicalSnapshot = Field(default_factory=PortfolioTechnicalSnapshot)


class PortfolioAllocation(BaseModel):
    label: str
    value: float = Field(ge=0)
    weight: float = Field(ge=0, le=100)


class PortfolioSummary(BaseModel):
    total_value: float = 0
    invested_value: float = 0
    cash: float = 0
    total_cost: float = 0
    unrealized_pnl: float = 0
    unrealized_pnl_percent: float | None = None
    day_pnl: float = 0
    day_change_percent: float | None = None


class PortfolioRiskSummary(BaseModel):
    concentration_score: int = Field(default=0, ge=0, le=100)
    concentration_level: RiskLevel = "low"
    diversification_score: int = Field(default=0, ge=0, le=100)
    diversification_level: PortfolioDiversificationLevel = "low"
    largest_position_ticker: str | None = None
    largest_position_weight: float = Field(default=0, ge=0, le=100)
    top_three_weight: float = Field(default=0, ge=0, le=100)
    effective_holdings: float = Field(default=0, ge=0)
    data_confidence_score: int = Field(default=0, ge=0, le=100)
    data_confidence_level: RiskLevel = "low"


class PortfolioCorrelation(BaseModel):
    ticker_a: str
    ticker_b: str
    correlation: float = Field(ge=-1, le=1)


class PortfolioPerformanceMetrics(BaseModel):
    benchmark_ticker: str = "SPY"
    observation_count: int = Field(default=0, ge=0)
    period_start: str | None = None
    period_end: str | None = None
    cumulative_return_percent: float | None = None
    annualized_return_percent: float | None = None
    annualized_volatility_percent: float | None = None
    benchmark_cumulative_return_percent: float | None = None
    benchmark_annualized_return_percent: float | None = None
    benchmark_annualized_volatility_percent: float | None = None
    beta: float | None = None
    sharpe_ratio: float | None = None
    treynor_ratio_percent: float | None = None
    jensen_alpha_percent: float | None = None
    max_drawdown_percent: float | None = None
    average_correlation: float | None = None


class PortfolioTechnicalSummary(BaseModel):
    weighted_score: float | None = None
    bullish_positions: int = 0
    neutral_positions: int = 0
    bearish_positions: int = 0
    overbought_positions: int = 0
    oversold_positions: int = 0


class PortfolioAnalysisResult(BaseModel):
    status: MarketDataStatus
    generated_at: datetime
    base_currency: str = "USD"
    positions: list[PortfolioPositionResult] = Field(default_factory=list)
    summary: PortfolioSummary = Field(default_factory=PortfolioSummary)
    allocation_by_holding: list[PortfolioAllocation] = Field(default_factory=list)
    allocation_by_sector: list[PortfolioAllocation] = Field(default_factory=list)
    risk: PortfolioRiskSummary = Field(default_factory=PortfolioRiskSummary)
    performance: PortfolioPerformanceMetrics = Field(default_factory=PortfolioPerformanceMetrics)
    technical_summary: PortfolioTechnicalSummary = Field(default_factory=PortfolioTechnicalSummary)
    correlations: list[PortfolioCorrelation] = Field(default_factory=list)
    sources_used: list[MarketDataSource] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


PortfolioVerdict = Literal[
    "robuste",
    "coherent",
    "a_reequilibrer",
    "fragile",
    "donnees_insuffisantes",
]
PortfolioPositionDecision = Literal[
    "renforcer",
    "conserver",
    "reduire",
    "ecarter",
    "non_evaluable",
]


class PortfolioHoldingAnalysis(BaseModel):
    """Vue compacte d'une analyse mono-action, figee pour le portefeuille."""

    ticker: str
    status: MarketDataStatus
    global_score: int = Field(default=0, ge=0, le=100)
    recommendation: SynthesisRecommendation = "donnees_insuffisantes"
    confidence_score: int = Field(default=0, ge=0, le=100)
    risk_score: int = Field(default=100, ge=0, le=100)
    risk_level: RiskLevel = "high"
    technical_score: int = Field(default=50, ge=0, le=100)
    fundamental_score: int = Field(default=50, ge=0, le=100)
    news_score: int = Field(default=50, ge=0, le=100)
    summary: str = ""
    key_risks: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)


class PortfolioSynthesisScores(BaseModel):
    individual_quality: int = Field(default=0, ge=0, le=100)
    diversification: int = Field(default=0, ge=0, le=100)
    risk_adjusted_performance: int = Field(default=0, ge=0, le=100)
    technical_alignment: int = Field(default=0, ge=0, le=100)
    data_quality: int = Field(default=0, ge=0, le=100)


class PortfolioPositionAssessment(BaseModel):
    ticker: str
    current_weight: float = Field(default=0, ge=0, le=100)
    target_weight: float = Field(default=0, ge=0, le=100)
    global_score: int | None = Field(default=None, ge=0, le=100)
    confidence_score: int = Field(default=0, ge=0, le=100)
    risk_level: RiskLevel = "high"
    decision: PortfolioPositionDecision = "non_evaluable"
    rationale: str = ""


class PortfolioRebalancingItem(BaseModel):
    label: str
    current_weight: float = Field(default=0, ge=0, le=100)
    target_weight: float = Field(default=0, ge=0, le=100)
    change_percent: float = Field(default=0, ge=-100, le=100)
    action: PortfolioPositionDecision | Literal["reserve", "diversifier"]
    rationale: str = ""


class PortfolioSynthesisResult(BaseModel):
    status: MarketDataStatus
    verdict: PortfolioVerdict = "donnees_insuffisantes"
    global_score: int = Field(default=0, ge=0, le=100)
    confidence_score: int = Field(default=0, ge=0, le=100)
    confidence_level: RiskLevel = "low"
    scores: PortfolioSynthesisScores = Field(default_factory=PortfolioSynthesisScores)
    weights: dict[str, float] = Field(default_factory=dict)
    summary: str = ""
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    position_assessments: list[PortfolioPositionAssessment] = Field(default_factory=list)
    rebalancing_plan: list[PortfolioRebalancingItem] = Field(default_factory=list)
    analyzed_positions: int = Field(default=0, ge=0)
    requested_positions: int = Field(default=0, ge=0)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    slm_summary: SlmSummary | None = None


class PortfolioCompleteAnalysisResult(BaseModel):
    status: MarketDataStatus
    generated_at: datetime
    workflow: str = "portfolio_multi_agent"
    portfolio: PortfolioAnalysisResult
    individual_analyses: list[PortfolioHoldingAnalysis] = Field(default_factory=list)
    synthesis: PortfolioSynthesisResult


InvestorRiskProfile = Literal["conservative", "moderate", "dynamic"]
InvestmentObjective = Literal["preservation", "balanced", "growth"]


class UniverseInstrument(BaseModel):
    """Un candidat de l'univers de screening (le plateau d'entree des agents).

    Ne contient aucune donnee de marche : uniquement le ticker, son secteur et les
    profils auxquels il peut convenir. Le jugement (scores, selection, ponderation)
    est fait par les agents sur des donnees reelles collectees a l'execution.
    """

    ticker: str
    name: str | None = None
    sector: str = "Unknown"
    eligible_profiles: list[InvestorRiskProfile] = Field(
        default_factory=lambda: ["conservative", "moderate", "dynamic"]
    )
    currency: str = "USD"


class PortfolioRecommendationRequest(BaseModel):
    budget: float = Field(gt=0)
    risk_profile: InvestorRiskProfile = "moderate"
    objective: InvestmentObjective = "balanced"
    horizon_years: int = Field(default=5, ge=1, le=30)
    max_positions: int = Field(default=5, ge=3, le=8)
    cash_reserve_percent: float | None = Field(default=None, ge=0, le=50)
    benchmark_ticker: str = Field(default="SPY", min_length=1, max_length=15)
    risk_free_rate_percent: float = Field(default=0, ge=-100, le=100)
    base_currency: str = Field(default="USD", min_length=3, max_length=3)
    excluded_tickers: list[str] = Field(default_factory=list, max_length=20)


class RecommendationCandidateScore(BaseModel):
    ticker: str
    name: str | None = None
    sector: str = "Unknown"
    status: MarketDataStatus = "failed"
    total_score: int = Field(default=0, ge=0, le=100)
    fundamental_score: int = Field(default=0, ge=0, le=100)
    technical_score: int = Field(default=0, ge=0, le=100)
    stability_score: int = Field(default=0, ge=0, le=100)
    momentum_score: int = Field(default=0, ge=0, le=100)
    data_quality_score: int = Field(default=0, ge=0, le=100)
    value_score: int = Field(default=0, ge=0, le=100)
    growth_score: int = Field(default=0, ge=0, le=100)
    potential_label: str | None = None
    current_price: float | None = None
    volatility: float | None = None
    reasons: list[str] = Field(default_factory=list)
    rejection_reason: str | None = None


class RecommendedAllocation(BaseModel):
    ticker: str
    name: str | None = None
    sector: str = "Unknown"
    weight: float = Field(ge=0, le=100)
    amount: float = Field(ge=0)
    quantity: float = Field(ge=0)
    reference_price: float = Field(gt=0)
    screening_score: int = Field(ge=0, le=100)
    potential_label: str | None = None
    role: str
    reasons: list[str] = Field(default_factory=list)


class PortfolioRecommendationResult(BaseModel):
    status: MarketDataStatus
    generated_at: datetime
    workflow: str = "portfolio_recommendation"
    profile: PortfolioRecommendationRequest
    universe: list[str] = Field(default_factory=list)
    candidates: list[RecommendationCandidateScore] = Field(default_factory=list)
    allocations: list[RecommendedAllocation] = Field(default_factory=list)
    cash_amount: float = Field(default=0, ge=0)
    cash_weight: float = Field(default=0, ge=0, le=100)
    summary: str = ""
    selection_method: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    portfolio_analysis: PortfolioCompleteAnalysisResult | None = None
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    slm_summary: SlmSummary | None = None

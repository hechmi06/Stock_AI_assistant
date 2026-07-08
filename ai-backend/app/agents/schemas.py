from typing import Literal

from pydantic import BaseModel, Field


MarketDataStatus = Literal["success", "partial", "failed"]
MarketDataSource = Literal["twelve_data", "yfinance", "alpha_vantage", "financial_modeling_prep"]
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
RiskCategory = Literal["market", "technical", "fundamental", "news", "data_quality"]


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
    market_data_errors: list[str] = Field(default_factory=list)
    technical_errors: list[str] = Field(default_factory=list)
    news_errors: list[str] = Field(default_factory=list)


class RiskResult(BaseModel):
    ticker: str
    status: MarketDataStatus
    overall_risk_level: RiskLevel
    risk_score: int = Field(default=0, ge=0, le=100)
    risks: list[RiskItem] = Field(default_factory=list)
    component_status: AgentRiskSnapshot = Field(default_factory=AgentRiskSnapshot)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    slm_summary: SlmSummary | None = None


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

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
    provider: str = "ollama"
    model: str
    summary: str
    data_quality: str
    key_points: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


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
    errors: list[str] = Field(default_factory=list)
    raw_price: PriceQuote | None = None
    slm_summary: SlmSummary | None = None

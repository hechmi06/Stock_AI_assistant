import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type MarketRow = {
  symbol: string;
  name: string;
  bid: number;
  mid: number;
  ask: number;
  spread: number;
  variation: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previous_close: number | null;
  volume: number | null;
};

export type MarketDashboard = {
  source: string;
  updated_at: string;
  rows: MarketRow[];
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
  metrics: Array<{ label: string; value: string }>;
  checks: Array<{ title: string; detail: string; done: boolean }>;
};

export type MarketDataSource = "twelve_data" | "yfinance" | "alpha_vantage" | "financial_modeling_prep";
export type PriceSource = MarketDataSource | "fallback";

export type PriceQuote = {
  ticker: string;
  price: number | null;
  change_percent: number | null;
  currency: string | null;
  exchange: string | null;
  market_state: string | null;
  source: PriceSource;
};

export type HistoricalPrice = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export type CompanyProfile = {
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  website: string | null;
  market_cap: number | null;
  currency: string | null;
  exchange: string | null;
};

export type FinancialRatios = Record<string, number | null>;

export type FinancialStatementsSummary = {
  fiscal_date: string | null;
  total_revenue: number | null;
  net_income: number | null;
  total_assets: number | null;
  total_debt: number | null;
  operating_cashflow: number | null;
};

export type MarketDataPayload = {
  ticker: string;
  price: PriceQuote | null;
  historical_prices: HistoricalPrice[];
  company_profile: CompanyProfile;
  financial_ratios: FinancialRatios;
  financial_statements_summary: FinancialStatementsSummary;
  sources_used: MarketDataSource[];
  used_fallback: boolean;
  errors: string[];
};

const MARKET_SYMBOLS: Record<string, string> = {
  // ── Magnificent 7 ──
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  NVDA: "NVIDIA Corp.",
  GOOGL: "Alphabet Inc.",
  AMZN: "Amazon.com Inc.",
  META: "Meta Platforms",
  TSLA: "Tesla, Inc.",
  // ── Tech / Semiconductors ──
  AVGO: "Broadcom Inc.",
  AMD: "Advanced Micro Devices",
  CRM: "Salesforce Inc.",
  ORCL: "Oracle Corp.",
  NFLX: "Netflix Inc.",
  INTC: "Intel Corp.",
  // ── Finance ──
  JPM: "JPMorgan Chase",
  V: "Visa Inc.",
  MA: "Mastercard Inc.",
  BAC: "Bank of America",
  GS: "Goldman Sachs",
  // ── Healthcare ──
  UNH: "UnitedHealth Group",
  JNJ: "Johnson & Johnson",
  LLY: "Eli Lilly & Co.",
  PFE: "Pfizer Inc.",
  // ── Consumer / Retail ──
  WMT: "Walmart Inc.",
  KO: "Coca-Cola Co.",
  PEP: "PepsiCo Inc.",
  DIS: "Walt Disney Co.",
  // ── Energy / Industrial ──
  XOM: "Exxon Mobil Corp.",
  CVX: "Chevron Corp.",
  BA: "Boeing Co.",
  CAT: "Caterpillar Inc.",
};

const LIVE_MARKET_SYMBOLS = Object.keys(MARKET_SYMBOLS);
let marketCache: { timestamp: number; dashboard: MarketDashboard } | undefined;
let marketDataCache: Record<string, { timestamp: number; payload: MarketDataPayload }> = {};
let alphaFundamentalsCache: Record<
  string,
  {
    timestamp: number;
    payload: {
      company_profile: CompanyProfile;
      financial_ratios: FinancialRatios;
      financial_statements_summary: FinancialStatementsSummary;
      errors: string[];
      used: boolean;
    };
  }
> = {};
let alphaFundamentalsInFlight: Partial<Record<string, Promise<{
  company_profile: CompanyProfile;
  financial_ratios: FinancialRatios;
  financial_statements_summary: FinancialStatementsSummary;
  errors: string[];
  used: boolean;
}>>> = {};
let fmpFundamentalsCache: Record<
  string,
  {
    timestamp: number;
    payload: {
      company_profile: CompanyProfile;
      financial_ratios: FinancialRatios;
      financial_statements_summary: FinancialStatementsSummary;
      errors: string[];
      used: boolean;
    };
  }
> = {};
let fmpFundamentalsInFlight: Partial<Record<string, Promise<{
  company_profile: CompanyProfile;
  financial_ratios: FinancialRatios;
  financial_statements_summary: FinancialStatementsSummary;
  errors: string[];
  used: boolean;
}>>> = {};

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "" || value === "None") {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue = toNullableNumber(value);
    if (numberValue !== null) {
      return numberValue;
    }
  }

  return null;
}

function sumNumbers(...values: unknown[]) {
  const numbers = values.map((value) => toNullableNumber(value)).filter((value): value is number => value !== null);
  return numbers.length > 0 ? numbers.reduce((total, value) => total + value, 0) : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function hasAnyValue(payload: Record<string, unknown>) {
  return Object.values(payload).some((value) => value !== null && value !== undefined && value !== "");
}

async function twelveDataGet(path: string, params: Record<string, string>) {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();

  if (!apiKey) {
    return undefined;
  }

  const url = new URL(`https://api.twelvedata.com/${path}`);
  Object.entries({ ...params, apikey: apiKey }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "stock-ai-assistant-mcp/0.1" },
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json();

    if (!response.ok || payload?.status === "error") {
      return undefined;
    }

    return payload;
  } catch {
    return undefined;
  }
}

async function alphaVantageGet(params: Record<string, string>) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();

  if (!apiKey) {
    return undefined;
  }

  const url = new URL("https://www.alphavantage.co/query");
  Object.entries({ ...params, apikey: apiKey }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "stock-ai-assistant-mcp/0.1" },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json();

    if (!response.ok || payload?.["Error Message"] || payload?.Note || payload?.Information) {
      return undefined;
    }

    return payload as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function fmpGet(path: string, params: Record<string, string> = {}) {
  const apiKey = process.env.FMP_API_KEY?.trim();

  if (!apiKey) {
    return undefined;
  }

  const url = new URL(`https://financialmodelingprep.com/stable/${path}`);
  Object.entries({ ...params, apikey: apiKey }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "stock-ai-assistant-mcp/0.1" },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json();

    if (!response.ok || payload?.Error || payload?.["Error Message"] || payload?.message) {
      return undefined;
    }

    return payload as unknown;
  } catch {
    return undefined;
  }
}

function firstAlphaReport(payload: Record<string, unknown> | undefined) {
  const annual = Array.isArray(payload?.annualReports) ? (payload.annualReports[0] as Record<string, unknown> | undefined) : undefined;
  const quarterly = Array.isArray(payload?.quarterlyReports) ? (payload.quarterlyReports[0] as Record<string, unknown> | undefined) : undefined;

  return annual ?? quarterly;
}

function firstArrayItem(payload: unknown) {
  return Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined) : undefined;
}

async function fetchQuotesBatch(symbols: string[]): Promise<Record<string, unknown>> {
  const payload = await twelveDataGet("quote", { symbol: symbols.join(",") });

  if (!payload) {
    return {};
  }

  // Single symbol → Twelve Data returns the object directly
  if (payload.symbol) {
    return { [String(payload.symbol).toUpperCase()]: payload };
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      return typeof value === "object" && value != null && (value as { status?: string }).status !== "error";
    }),
  );
}

const BATCH_SIZE = 8;

async function fetchQuotes(symbols: string[]): Promise<Record<string, unknown>> {
  if (symbols.length <= BATCH_SIZE) {
    return fetchQuotesBatch(symbols);
  }

  // Split into chunks to avoid Twelve Data free-plan limits
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    chunks.push(symbols.slice(i, i + BATCH_SIZE));
  }

  const results = await Promise.all(chunks.map((chunk) => fetchQuotesBatch(chunk)));
  return Object.assign({}, ...results);
}

async function fetchTimeSeries(symbol: string) {
  const payload = await twelveDataGet("time_series", {
    symbol,
    interval: "1day",
    outputsize: "30",
  });
  const values = Array.isArray(payload?.values) ? payload.values : [];

  return values
    .slice()
    .reverse()
    .map((item: { close?: unknown }) => toNumber(item.close))
    .filter((value: number) => value > 0)
    .map((value: number) => Number(value.toFixed(2)));
}

async function fetchTwelveHistoricalPrices(symbol: string, outputsize = "90"): Promise<HistoricalPrice[]> {
  const payload = await twelveDataGet("time_series", {
    symbol,
    interval: "1day",
    outputsize,
  });
  const values = Array.isArray(payload?.values) ? payload.values : [];

  return values
    .slice()
    .reverse()
    .map((item: { datetime?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown }) => {
      const close = toNumber(item.close);
      if (close <= 0) {
        return undefined;
      }

      return {
        date: String(item.datetime ?? ""),
        open: toNumber(item.open) || null,
        high: toNumber(item.high) || null,
        low: toNumber(item.low) || null,
        close: Number(close.toFixed(4)),
        volume: toNumber(item.volume) || null,
      };
    })
    .filter((item: HistoricalPrice | undefined): item is HistoricalPrice => Boolean(item));
}

function helperPath() {
  const srcPath = new URL("./yfinance_helper.py", import.meta.url);
  if (existsSync(srcPath)) {
    return fileURLToPath(srcPath);
  }

  return fileURLToPath(new URL("../src/yfinance_helper.py", import.meta.url));
}

async function fetchYfinanceData(ticker: string, period = "6mo") {
  const pythonPath = process.env.YFINANCE_PYTHON_PATH ?? process.env.PYTHON_PATH ?? "python";
  const { stdout } = await execFileAsync(
    pythonPath,
    [helperPath(), "--ticker", ticker, "--period", period],
    {
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    },
  );

  return JSON.parse(stdout) as {
    ticker: string;
    price?: PriceQuote | null;
    historical_prices?: HistoricalPrice[];
    company_profile?: CompanyProfile;
    financial_ratios?: FinancialRatios;
    financial_statements_summary?: FinancialStatementsSummary;
    errors?: string[];
  };
}

function quoteFromTwelveData(symbol: string, quote: Record<string, unknown> | undefined): PriceQuote | undefined {
  const price = toNumber(quote?.close ?? quote?.price);

  if (!quote || price <= 0) {
    return undefined;
  }

  const previous = toNumber(quote.previous_close);
  let changePercent = toNumber(quote.percent_change);

  if (changePercent === 0 && previous > 0) {
    changePercent = ((price - previous) / previous) * 100;
  }

  return {
    ticker: symbol,
    price: Number(price.toFixed(4)),
    change_percent: Number(changePercent.toFixed(2)),
    currency: typeof quote.currency === "string" ? quote.currency : null,
    exchange: typeof quote.exchange === "string" ? quote.exchange : null,
    market_state: typeof quote.is_market_open === "boolean" ? (quote.is_market_open ? "open" : "closed") : null,
    source: "twelve_data",
  };
}

function emptyProfile(): CompanyProfile {
  return {
    name: null,
    sector: null,
    industry: null,
    country: null,
    website: null,
    market_cap: null,
    currency: null,
    exchange: null,
  };
}

function emptyStatements(): FinancialStatementsSummary {
  return {
    fiscal_date: null,
    total_revenue: null,
    net_income: null,
    total_assets: null,
    total_debt: null,
    operating_cashflow: null,
  };
}

async function fetchAlphaVantageFundamentals(symbol: string): Promise<{
  company_profile: CompanyProfile;
  financial_ratios: FinancialRatios;
  financial_statements_summary: FinancialStatementsSummary;
  errors: string[];
  used: boolean;
}> {
  const now = Date.now();
  const cached = alphaFundamentalsCache[symbol];
  const cacheTtl = cached?.payload.errors.length ? 60_000 : 6 * 60 * 60 * 1000;
  if (cached && now - cached.timestamp < cacheTtl) {
    return cached.payload;
  }

  if (alphaFundamentalsInFlight[symbol]) {
    return alphaFundamentalsInFlight[symbol];
  }

  alphaFundamentalsInFlight[symbol] = fetchAlphaVantageFundamentalsUncached(symbol).finally(() => {
    delete alphaFundamentalsInFlight[symbol];
  });

  const payload = await alphaFundamentalsInFlight[symbol];
  if (payload.used) {
    alphaFundamentalsCache[symbol] = { timestamp: now, payload };
  }

  return payload;
}

async function fetchAlphaVantageFundamentalsUncached(symbol: string): Promise<{
  company_profile: CompanyProfile;
  financial_ratios: FinancialRatios;
  financial_statements_summary: FinancialStatementsSummary;
  errors: string[];
  used: boolean;
}> {
  const overview = await alphaVantageGet({ function: "OVERVIEW", symbol });
  await sleep(400);
  const income = await alphaVantageGet({ function: "INCOME_STATEMENT", symbol });
  await sleep(400);
  const balance = await alphaVantageGet({ function: "BALANCE_SHEET", symbol });
  await sleep(400);
  const cashflow = await alphaVantageGet({ function: "CASH_FLOW", symbol });
  const errors: string[] = [];

  if (!overview) {
    errors.push("Alpha Vantage overview unavailable.");
  }

  const incomeReport = firstAlphaReport(income);
  const balanceReport = firstAlphaReport(balance);
  const cashflowReport = firstAlphaReport(cashflow);

  if (!incomeReport) {
    errors.push("Alpha Vantage income statement unavailable.");
  }
  if (!balanceReport) {
    errors.push("Alpha Vantage balance sheet unavailable.");
  }
  if (!cashflowReport) {
    errors.push("Alpha Vantage cash flow unavailable.");
  }

  const companyProfile: CompanyProfile = {
    name: typeof overview?.Name === "string" ? overview.Name : null,
    sector: typeof overview?.Sector === "string" ? overview.Sector : null,
    industry: typeof overview?.Industry === "string" ? overview.Industry : null,
    country: typeof overview?.Country === "string" ? overview.Country : null,
    website: null,
    market_cap: toNullableNumber(overview?.MarketCapitalization),
    currency: typeof overview?.Currency === "string" ? overview.Currency : null,
    exchange: typeof overview?.Exchange === "string" ? overview.Exchange : null,
  };

  const financialRatios: FinancialRatios = {
    trailing_pe: toNullableNumber(overview?.TrailingPE),
    forward_pe: toNullableNumber(overview?.ForwardPE),
    price_to_book: toNullableNumber(overview?.PriceToBookRatio),
    debt_to_equity: toNullableNumber(overview?.DebtToEquityRatio),
    profit_margin: toNullableNumber(overview?.ProfitMargin),
    return_on_equity: toNullableNumber(overview?.ReturnOnEquityTTM),
    beta: toNullableNumber(overview?.Beta),
    dividend_yield: toNullableNumber(overview?.DividendYield),
    eps: toNullableNumber(overview?.EPS),
  };

  const statements: FinancialStatementsSummary = {
    fiscal_date: firstString(incomeReport?.fiscalDateEnding, balanceReport?.fiscalDateEnding, cashflowReport?.fiscalDateEnding),
    total_revenue: firstNumber(incomeReport?.totalRevenue, incomeReport?.revenue, overview?.RevenueTTM),
    net_income: firstNumber(incomeReport?.netIncome, incomeReport?.netIncomeFromContinuingOperations, incomeReport?.comprehensiveIncomeNetOfTax),
    total_assets: firstNumber(balanceReport?.totalAssets),
    total_debt:
      firstNumber(balanceReport?.shortLongTermDebtTotal, balanceReport?.totalDebt) ??
      sumNumbers(balanceReport?.shortTermDebt, balanceReport?.currentLongTermDebt, balanceReport?.longTermDebtNoncurrent, balanceReport?.longTermDebt),
    operating_cashflow: firstNumber(cashflowReport?.operatingCashflow, cashflowReport?.operatingCashFlow, cashflowReport?.cashflowFromOperatingActivities, cashflowReport?.cashFlowFromOperatingActivities),
  };

  return {
    company_profile: companyProfile,
    financial_ratios: financialRatios,
    financial_statements_summary: statements,
    errors,
    used: hasAnyValue(companyProfile) || hasAnyValue(financialRatios) || hasAnyValue(statements),
  };
}

async function fetchFmpFundamentals(symbol: string): Promise<{
  company_profile: CompanyProfile;
  financial_ratios: FinancialRatios;
  financial_statements_summary: FinancialStatementsSummary;
  errors: string[];
  used: boolean;
}> {
  const now = Date.now();
  const cached = fmpFundamentalsCache[symbol];
  const cacheTtl = cached?.payload.errors.length ? 60_000 : 6 * 60 * 60 * 1000;
  if (cached && now - cached.timestamp < cacheTtl) {
    return cached.payload;
  }

  if (fmpFundamentalsInFlight[symbol]) {
    return fmpFundamentalsInFlight[symbol];
  }

  fmpFundamentalsInFlight[symbol] = fetchFmpFundamentalsUncached(symbol).finally(() => {
    delete fmpFundamentalsInFlight[symbol];
  });

  const payload = await fmpFundamentalsInFlight[symbol];
  if (payload.used || payload.errors.length > 0) {
    fmpFundamentalsCache[symbol] = { timestamp: now, payload };
  }

  return payload;
}

async function fetchFmpFundamentalsUncached(symbol: string): Promise<{
  company_profile: CompanyProfile;
  financial_ratios: FinancialRatios;
  financial_statements_summary: FinancialStatementsSummary;
  errors: string[];
  used: boolean;
}> {
  const errors: string[] = [];
  const [profilePayload, ratiosPayload, incomePayload, balancePayload, cashflowPayload] = await Promise.all([
    fmpGet("profile", { symbol }),
    fmpGet("ratios-ttm", { symbol }),
    fmpGet("income-statement", { symbol, period: "annual", limit: "1" }),
    fmpGet("balance-sheet-statement", { symbol, period: "annual", limit: "1" }),
    fmpGet("cash-flow-statement", { symbol, period: "annual", limit: "1" }),
  ]);

  const profile = firstArrayItem(profilePayload);
  const ratios = firstArrayItem(ratiosPayload);
  const income = firstArrayItem(incomePayload);
  const balance = firstArrayItem(balancePayload);
  const cashflow = firstArrayItem(cashflowPayload);

  if (!profile) {
    errors.push("Financial Modeling Prep profile unavailable.");
  }
  if (!ratios) {
    errors.push("Financial Modeling Prep ratios unavailable.");
  }
  if (!income) {
    errors.push("Financial Modeling Prep income statement unavailable.");
  }
  if (!balance) {
    errors.push("Financial Modeling Prep balance sheet unavailable.");
  }
  if (!cashflow) {
    errors.push("Financial Modeling Prep cash flow unavailable.");
  }

  const companyProfile: CompanyProfile = {
    name: firstString(profile?.companyName, profile?.companyNameLong, profile?.name),
    sector: firstString(profile?.sector),
    industry: firstString(profile?.industry),
    country: firstString(profile?.country),
    website: firstString(profile?.website),
    market_cap: firstNumber(profile?.mktCap, profile?.marketCap),
    currency: firstString(profile?.currency),
    exchange: firstString(profile?.exchangeShortName, profile?.exchange),
  };

  const financialRatios: FinancialRatios = {
    trailing_pe: firstNumber(ratios?.peRatioTTM, ratios?.priceEarningsRatioTTM),
    price_to_book: firstNumber(ratios?.priceToBookRatioTTM),
    debt_to_equity: firstNumber(ratios?.debtEquityRatioTTM, ratios?.debtToEquityTTM),
    profit_margin: firstNumber(ratios?.netProfitMarginTTM),
    return_on_equity: firstNumber(ratios?.returnOnEquityTTM),
    dividend_yield: firstNumber(ratios?.dividendYielPercentageTTM, ratios?.dividendYieldTTM),
  };

  const statements: FinancialStatementsSummary = {
    fiscal_date: firstString(income?.date, balance?.date, cashflow?.date, income?.calendarYear),
    total_revenue: firstNumber(income?.revenue, income?.totalRevenue),
    net_income: firstNumber(income?.netIncome, income?.netIncomeApplicableToCommonShares),
    total_assets: firstNumber(balance?.totalAssets),
    total_debt:
      firstNumber(balance?.totalDebt, balance?.shortAndLongTermDebtTotal) ??
      sumNumbers(balance?.shortTermDebt, balance?.longTermDebt, balance?.longTermDebtNonCurrent),
    operating_cashflow: firstNumber(cashflow?.operatingCashFlow, cashflow?.netCashProvidedByOperatingActivities),
  };

  return {
    company_profile: companyProfile,
    financial_ratios: financialRatios,
    financial_statements_summary: statements,
    errors,
    used: hasAnyValue(companyProfile) || hasAnyValue(financialRatios) || hasAnyValue(statements),
  };
}

function mergeProfile(base: CompanyProfile, next: CompanyProfile): CompanyProfile {
  return {
    name: base.name ?? next.name,
    sector: base.sector ?? next.sector,
    industry: base.industry ?? next.industry,
    country: base.country ?? next.country,
    website: base.website ?? next.website,
    market_cap: base.market_cap ?? next.market_cap,
    currency: base.currency ?? next.currency,
    exchange: base.exchange ?? next.exchange,
  };
}

function mergeRatios(base: FinancialRatios, next: FinancialRatios): FinancialRatios {
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(base), ...Object.keys(next)])).map((key) => [key, base[key] ?? next[key] ?? null]),
  );
}

function mergeStatements(base: FinancialStatementsSummary, next: FinancialStatementsSummary): FinancialStatementsSummary {
  return {
    fiscal_date: base.fiscal_date ?? next.fiscal_date,
    total_revenue: base.total_revenue ?? next.total_revenue,
    net_income: base.net_income ?? next.net_income,
    total_assets: base.total_assets ?? next.total_assets,
    total_debt: base.total_debt ?? next.total_debt,
    operating_cashflow: base.operating_cashflow ?? next.operating_cashflow,
  };
}

function fallbackHistoricalPrices(symbol: string, price: number | null | undefined): HistoricalPrice[] {
  if (!price || price <= 0 || !MARKET_SYMBOLS[symbol]) {
    return [];
  }

  const points: HistoricalPrice[] = [];
  for (let index = 9; index >= 0; index -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - index);
    const drift = (9 - index - 4) * 0.006;
    const close = Number((price * (1 + drift)).toFixed(4));
    points.push({
      date: date.toISOString().slice(0, 10),
      open: Number((close * 0.996).toFixed(4)),
      high: Number((close * 1.006).toFixed(4)),
      low: Number((close * 0.992).toFixed(4)),
      close,
      volume: null,
    });
  }

  return points;
}

export async function getStockPrice(ticker: string): Promise<PriceQuote | null> {
  const symbol = ticker.trim().toUpperCase();
  const quotes = await fetchQuotes([symbol]);
  const twelveQuote = quoteFromTwelveData(symbol, quotes[symbol] as Record<string, unknown> | undefined);

  if (twelveQuote) {
    return twelveQuote;
  }

  try {
    const yfinance = await fetchYfinanceData(symbol, "5d");
    return yfinance.price ?? null;
  } catch {
    return null;
  }
}

export async function getHistoricalPrices(ticker: string, period = "6mo"): Promise<HistoricalPrice[]> {
  const symbol = ticker.trim().toUpperCase();

  try {
    const yfinance = await fetchYfinanceData(symbol, period);
    const history = yfinance.historical_prices ?? [];
    if (history.length > 0) {
      return history;
    }
  } catch {
    // Fall through to Twelve Data historical fallback.
  }

  return fetchTwelveHistoricalPrices(symbol);
}

export async function getCompanyProfile(ticker: string): Promise<CompanyProfile> {
  const symbol = ticker.trim().toUpperCase();

  try {
    const yfinance = await fetchYfinanceData(symbol, "1mo");
    const profile = yfinance.company_profile ?? emptyProfile();
    if (profile.name) {
      return profile;
    }
  } catch {
    // Fall through to Alpha Vantage.
  }

  const alpha = await fetchAlphaVantageFundamentals(symbol);
  return alpha.company_profile;
}

export async function getFinancialStatements(ticker: string): Promise<{
  financial_ratios: FinancialRatios;
  financial_statements_summary: FinancialStatementsSummary;
}> {
  const symbol = ticker.trim().toUpperCase();

  try {
    const yfinance = await fetchYfinanceData(symbol, "1mo");
    const result = {
      financial_ratios: yfinance.financial_ratios ?? {},
      financial_statements_summary: yfinance.financial_statements_summary ?? emptyStatements(),
    };
    if (
      Object.values(result.financial_ratios).some((value) => value != null) ||
      Object.values(result.financial_statements_summary).some((value) => value != null)
    ) {
      return result;
    }
  } catch {
    // Fall through to Alpha Vantage.
  }

  const alpha = await fetchAlphaVantageFundamentals(symbol);
  const fmp = await fetchFmpFundamentals(symbol);

  return {
    financial_ratios: mergeRatios(alpha.financial_ratios, fmp.financial_ratios),
    financial_statements_summary: mergeStatements(fmp.financial_statements_summary, alpha.financial_statements_summary),
  };
}

export async function getMarketData(ticker: string, period = "6mo"): Promise<MarketDataPayload> {
  const symbol = ticker.trim().toUpperCase();
  const cacheKey = `${symbol}:${period}`;
  const now = Date.now();
  const cached = marketDataCache[cacheKey];
  if (cached && now - cached.timestamp < 60_000) {
    return cached.payload;
  }

  const sources = new Set<MarketDataSource>();
  const errors: string[] = [];
  let usedFallback = false;
  let price: PriceQuote | null = null;
  let historicalPrices: HistoricalPrice[] = [];
  let companyProfile = emptyProfile();
  let financialRatios: FinancialRatios = {};
  let financialStatementsSummary = emptyStatements();

  // Les 4 sources sont interrogees en parallele : la latence totale devient
  // celle de la source la plus lente au lieu de la somme des quatre.
  const [quoteSettled, yfinanceSettled, alphaSettled, fmpSettled] = await Promise.allSettled([
    fetchQuotes([symbol]),
    fetchYfinanceData(symbol, period),
    fetchAlphaVantageFundamentals(symbol),
    fetchFmpFundamentals(symbol),
  ]);

  const quotePayload = quoteSettled.status === "fulfilled" ? quoteSettled.value : {};
  price = quoteFromTwelveData(symbol, quotePayload[symbol] as Record<string, unknown> | undefined) ?? null;

  if (price) {
    sources.add("twelve_data");
  } else {
    errors.push("Twelve Data price unavailable.");
  }

  if (yfinanceSettled.status === "fulfilled") {
    const yfinance = yfinanceSettled.value;
    const yfinanceUsed =
      Boolean(yfinance.price) ||
      Boolean(yfinance.historical_prices?.length) ||
      Boolean(yfinance.company_profile?.name) ||
      Object.values(yfinance.financial_ratios ?? {}).some((value) => value != null) ||
      Object.values(yfinance.financial_statements_summary ?? {}).some((value) => value != null);

    if (!price && yfinance.price) {
      price = yfinance.price;
    }

    historicalPrices = yfinance.historical_prices ?? [];
    companyProfile = yfinance.company_profile ?? companyProfile;
    financialRatios = yfinance.financial_ratios ?? {};
    financialStatementsSummary = yfinance.financial_statements_summary ?? financialStatementsSummary;
    if (yfinanceUsed) {
      sources.add("yfinance");
    }
    errors.push(...(yfinance.errors ?? []));
  } else {
    const reason = yfinanceSettled.reason;
    errors.push(`yfinance unavailable: ${reason instanceof Error ? reason.message : "unknown error"}`);
  }

  if (alphaSettled.status === "fulfilled") {
    const alpha = alphaSettled.value;
    if (alpha.used) {
      sources.add("alpha_vantage");
      companyProfile = mergeProfile(companyProfile, alpha.company_profile);
      financialRatios = mergeRatios(financialRatios, alpha.financial_ratios);
      financialStatementsSummary = mergeStatements(financialStatementsSummary, alpha.financial_statements_summary);
    }
    errors.push(...alpha.errors);
  } else {
    const reason = alphaSettled.reason;
    errors.push(`Alpha Vantage unavailable: ${reason instanceof Error ? reason.message : "unknown error"}`);
  }

  if (fmpSettled.status === "fulfilled") {
    const fmp = fmpSettled.value;
    if (fmp.used) {
      sources.add("financial_modeling_prep");
      companyProfile = mergeProfile(companyProfile, fmp.company_profile);
      financialRatios = mergeRatios(financialRatios, fmp.financial_ratios);
      financialStatementsSummary = mergeStatements(fmp.financial_statements_summary, financialStatementsSummary);
    }
    if (process.env.FMP_API_KEY?.trim()) {
      errors.push(...fmp.errors);
    }
  } else {
    const reason = fmpSettled.reason;
    errors.push(`Financial Modeling Prep unavailable: ${reason instanceof Error ? reason.message : "unknown error"}`);
  }

  if (historicalPrices.length === 0) {
    const twelveHistory = await fetchTwelveHistoricalPrices(symbol);
    if (twelveHistory.length > 0) {
      sources.add("twelve_data");
      historicalPrices = twelveHistory;
    } else {
      errors.push("Twelve Data historical prices unavailable.");
    }
  }

  if (historicalPrices.length === 0 && price?.price) {
    const fallbackHistory = fallbackHistoricalPrices(symbol, price.price);
    if (fallbackHistory.length > 0) {
      usedFallback = true;
      historicalPrices = fallbackHistory;
      errors.push("Using generated fallback history because external history was unavailable.");
    }
  }

  if (!companyProfile.name && MARKET_SYMBOLS[symbol]) {
    usedFallback = true;
    companyProfile = {
      ...companyProfile,
      name: MARKET_SYMBOLS[symbol],
      currency: companyProfile.currency ?? price?.currency ?? "USD",
      exchange: companyProfile.exchange ?? price?.exchange ?? null,
    };
  }

  if (!price) {
    const fallback = fallbackMarketRows().find((row) => row.symbol === symbol);
    if (fallback) {
      usedFallback = true;
      price = {
        ticker: symbol,
        price: fallback.mid,
        change_percent: fallback.variation,
        currency: "USD",
        exchange: null,
        market_state: null,
        source: "fallback",
      };
      companyProfile = { ...companyProfile, name: companyProfile.name ?? fallback.name };
    }
  }

  const payload = {
    ticker: symbol,
    price,
    historical_prices: historicalPrices,
    company_profile: companyProfile,
    financial_ratios: financialRatios,
    financial_statements_summary: financialStatementsSummary,
    sources_used: Array.from(sources),
    used_fallback: usedFallback,
    errors,
  };

  marketDataCache[cacheKey] = { timestamp: now, payload };
  return payload;
}

function rowFromQuote(symbol: string, quote: Record<string, unknown> | undefined): MarketRow | undefined {
  const mid = toNumber(quote?.close ?? quote?.price);

  if (!quote || mid <= 0) {
    return undefined;
  }

  const previous = toNumber(quote.previous_close);
  const spread = Math.max(mid * 0.0008, 0.01);
  let variation = toNumber(quote.percent_change);

  if (variation === 0 && previous > 0) {
    variation = ((mid - previous) / previous) * 100;
  }

  return {
    symbol,
    name: String(quote.name ?? MARKET_SYMBOLS[symbol] ?? `${symbol} Corp.`),
    bid: Number((mid - spread / 2).toFixed(4)),
    mid: Number(mid.toFixed(4)),
    ask: Number((mid + spread / 2).toFixed(4)),
    spread: Number(spread.toFixed(4)),
    variation: Number(variation.toFixed(2)),
    open: toNullableNumber(quote.open),
    high: toNullableNumber(quote.high),
    low: toNullableNumber(quote.low),
    previous_close: previous > 0 ? previous : null,
    volume: toNullableNumber(quote.volume),
  };
}

export function fallbackMarketRows(): MarketRow[] {
  const base = [
    // Magnificent 7
    { symbol: "AAPL", name: "Apple Inc.", bid: 213.31, mid: 213.4, ask: 213.49, spread: 0.18, variation: 1.84 },
    { symbol: "MSFT", name: "Microsoft Corp.", bid: 497.82, mid: 498.05, ask: 498.28, spread: 0.46, variation: 0.72 },
    { symbol: "NVDA", name: "NVIDIA Corp.", bid: 154.56, mid: 154.63, ask: 154.7, spread: 0.14, variation: 3.05 },
    { symbol: "GOOGL", name: "Alphabet Inc.", bid: 179.16, mid: 179.24, ask: 179.32, spread: 0.16, variation: -0.64 },
    { symbol: "AMZN", name: "Amazon.com Inc.", bid: 222.11, mid: 222.22, ask: 222.33, spread: 0.22, variation: 1.12 },
    { symbol: "META", name: "Meta Platforms", bid: 602.8, mid: 603.08, ask: 603.36, spread: 0.56, variation: -1.03 },
    { symbol: "TSLA", name: "Tesla, Inc.", bid: 327.65, mid: 327.8, ask: 327.95, spread: 0.3, variation: -2.12 },
    // Tech / Semiconductors
    { symbol: "AVGO", name: "Broadcom Inc.", bid: 224.5, mid: 224.68, ask: 224.86, spread: 0.36, variation: 1.45 },
    { symbol: "AMD", name: "Advanced Micro Devices", bid: 164.2, mid: 164.33, ask: 164.46, spread: 0.26, variation: 2.18 },
    { symbol: "CRM", name: "Salesforce Inc.", bid: 340.1, mid: 340.37, ask: 340.64, spread: 0.54, variation: 0.95 },
    { symbol: "ORCL", name: "Oracle Corp.", bid: 178.44, mid: 178.58, ask: 178.72, spread: 0.28, variation: 0.62 },
    { symbol: "NFLX", name: "Netflix Inc.", bid: 1098.5, mid: 1099.38, ask: 1100.26, spread: 1.76, variation: 1.33 },
    { symbol: "INTC", name: "Intel Corp.", bid: 20.14, mid: 20.18, ask: 20.22, spread: 0.08, variation: -1.85 },
    // Finance
    { symbol: "JPM", name: "JPMorgan Chase", bid: 239.7, mid: 239.82, ask: 239.94, spread: 0.24, variation: 0.38 },
    { symbol: "V", name: "Visa Inc.", bid: 316.8, mid: 317.05, ask: 317.3, spread: 0.5, variation: 0.52 },
    { symbol: "MA", name: "Mastercard Inc.", bid: 538.2, mid: 538.63, ask: 539.06, spread: 0.86, variation: 0.41 },
    { symbol: "BAC", name: "Bank of America", bid: 45.82, mid: 45.86, ask: 45.9, spread: 0.08, variation: -0.22 },
    { symbol: "GS", name: "Goldman Sachs", bid: 636.1, mid: 636.61, ask: 637.12, spread: 1.02, variation: 0.78 },
    // Healthcare
    { symbol: "UNH", name: "UnitedHealth Group", bid: 312.5, mid: 312.75, ask: 313.0, spread: 0.5, variation: -3.41 },
    { symbol: "JNJ", name: "Johnson & Johnson", bid: 155.3, mid: 155.42, ask: 155.54, spread: 0.24, variation: 0.15 },
    { symbol: "LLY", name: "Eli Lilly & Co.", bid: 952.8, mid: 953.56, ask: 954.32, spread: 1.52, variation: 2.67 },
    { symbol: "PFE", name: "Pfizer Inc.", bid: 25.64, mid: 25.68, ask: 25.72, spread: 0.08, variation: -0.58 },
    // Consumer / Retail
    { symbol: "WMT", name: "Walmart Inc.", bid: 97.2, mid: 97.28, ask: 97.36, spread: 0.16, variation: 0.82 },
    { symbol: "KO", name: "Coca-Cola Co.", bid: 72.34, mid: 72.4, ask: 72.46, spread: 0.12, variation: 0.28 },
    { symbol: "PEP", name: "PepsiCo Inc.", bid: 129.1, mid: 129.2, ask: 129.3, spread: 0.2, variation: -0.35 },
    { symbol: "DIS", name: "Walt Disney Co.", bid: 112.45, mid: 112.54, ask: 112.63, spread: 0.18, variation: 1.05 },
    // Energy / Industrial
    { symbol: "XOM", name: "Exxon Mobil Corp.", bid: 104.3, mid: 104.38, ask: 104.46, spread: 0.16, variation: -0.74 },
    { symbol: "CVX", name: "Chevron Corp.", bid: 151.8, mid: 151.92, ask: 152.04, spread: 0.24, variation: -0.48 },
    { symbol: "BA", name: "Boeing Co.", bid: 188.6, mid: 188.75, ask: 188.9, spread: 0.3, variation: 1.92 },
    { symbol: "CAT", name: "Caterpillar Inc.", bid: 352.4, mid: 352.68, ask: 352.96, spread: 0.56, variation: 0.65 },
  ];

  return base.map((row) => ({
    ...row,
    open: null,
    high: null,
    low: null,
    previous_close: Number((row.mid / (1 + row.variation / 100)).toFixed(4)),
    volume: null,
  }));
}

function buildSimulation(row: MarketRow) {
  const notional = 250000;
  const horizonDays = 90;
  const domesticRate = 4.3;
  const foreignRate = 3.8;
  const yearFraction = horizonDays / 360;
  const forwardRate = row.mid * (1 + (domesticRate / 100) * yearFraction) / (1 + (foreignRate / 100) * yearFraction);
  const swapPoints = forwardRate - row.mid;
  const differential = row.mid ? (forwardRate / row.mid - 1) * 100 : 0;

  return {
    symbol: row.symbol,
    spot: row.mid,
    notional,
    horizon_days: horizonDays,
    domestic_rate: domesticRate,
    foreign_rate: foreignRate,
    forward_rate: Number(forwardRate.toFixed(4)),
    swap_points: Number(swapPoints.toFixed(4)),
    differential: Number(differential.toFixed(2)),
    counter_value: Number((notional * forwardRate).toFixed(2)),
  };
}

export async function getMarketDashboard(): Promise<MarketDashboard> {
  const now = Date.now();
  if (marketCache && now - marketCache.timestamp < 120_000) {
    return marketCache.dashboard;
  }

  const quotes = await fetchQuotes(LIVE_MARKET_SYMBOLS);
  let rows = LIVE_MARKET_SYMBOLS.map((symbol) => rowFromQuote(symbol, quotes[symbol] as Record<string, unknown> | undefined)).filter(
    (row): row is MarketRow => Boolean(row),
  );
  let source = "Twelve Data via MCP";

  if (rows.length === 0) {
    rows = fallbackMarketRows();
    source = "Fallback MCP";
  } else if (rows.length < LIVE_MARKET_SYMBOLS.length) {
    // Keep live rows, fill missing symbols from fallback
    const liveSymbols = new Set(rows.map((r) => r.symbol));
    const fallbackFills = fallbackMarketRows().filter((r) => !liveSymbols.has(r.symbol));
    rows = [...rows, ...fallbackFills];
    source = `Twelve Data via MCP (${rows.length - fallbackFills.length} live)`;
  }

  const leader = rows.reduce((best, row) => (row.variation > best.variation ? row : best), rows[0]);
  const laggard = rows.reduce((worst, row) => (row.variation < worst.variation ? row : worst), rows[0]);

  const dashboard: MarketDashboard = {
    source,
    updated_at: new Date().toISOString(),
    rows,
    brief: [
      {
        tag: "MARCHE",
        title: `${leader.symbol} mene le panier`,
        text: `${leader.name} progresse de ${leader.variation >= 0 ? "+" : ""}${leader.variation.toFixed(2)}% sur la derniere cotation disponible.`,
      },
      {
        tag: "RISQUE",
        title: `Pression sur ${laggard.symbol}`,
        text: `${laggard.name} recule de ${laggard.variation.toFixed(2)}%. Surveiller tendance, volume et supports.`,
      },
      {
        tag: "MCP",
        title: "Outil market data actif",
        text: `Les cotations passent par le serveur MCP. Source actuelle : ${source}.`,
      },
      {
        tag: "IA",
        title: "Prochaine couche",
        text: "Ajouter fondamentaux, news et scoring explicable pour passer de la cotation a la decision.",
      },
    ],
    positions: [
      { id: "D-2087", product: "Forward", symbol: rows[0].symbol, side: "Achat", notional: "250 000 USD", entry: Number((rows[0].mid * 0.98).toFixed(4)), maturity: "23/07/26", pnl: 4800 },
      { id: "D-2091", product: "Spot", symbol: rows[1].symbol, side: "Vente", notional: "100 000 USD", entry: Number((rows[1].mid * 1.01).toFixed(4)), maturity: "25/04/26", pnl: -1250 },
      { id: "D-2094", product: "Swap", symbol: leader.symbol, side: "Achat", notional: "1 000 000 USD", entry: Number((leader.mid * 0.97).toFixed(4)), maturity: "23/05/26", pnl: 9200 },
      { id: "D-2098", product: "Option", symbol: laggard.symbol, side: "Vente", notional: "50 000 USD", entry: Number((laggard.mid * 1.02).toFixed(4)), maturity: "30/06/26", pnl: 780 },
    ],
    simulation: buildSimulation(rows[0]),
  };

  marketCache = { timestamp: now, dashboard };
  return dashboard;
}

export async function analyzeStock(ticker: string): Promise<StockAnalysis | undefined> {
  const symbol = ticker.trim().toUpperCase();
  const quotePayload = await fetchQuotes([symbol]);
  const quote = quotePayload[symbol] as Record<string, unknown> | undefined;
  const values = await fetchTimeSeries(symbol);

  if (!quote || values.length < 2) {
    return undefined;
  }

  const price = toNumber(quote.close ?? quote.price, values[values.length - 1]);
  const previous = toNumber(quote.previous_close, values[values.length - 2]);
  let change = toNumber(quote.percent_change);

  if (change === 0 && previous > 0) {
    change = ((price - previous) / previous) * 100;
  }

  const score = Math.max(15, Math.min(95, Math.round(58 + change * 6)));
  const signal =
    score >= 80 ? "Acheter" : score >= 65 ? "Acheter avec prudence" : score >= 50 ? "Surveiller" : "Eviter pour le moment";

  return {
    ticker: symbol,
    name: String(quote.name ?? MARKET_SYMBOLS[symbol] ?? `${symbol} Corp.`),
    sector: "Marche actions",
    price: Number(price.toFixed(2)),
    change: Number(change.toFixed(2)),
    score,
    signal,
    text: `Analyse dynamique fournie par l'outil MCP market data. Derniere variation disponible : ${change >= 0 ? "+" : ""}${change.toFixed(2)}%.`,
    values: values.slice(-10),
    metrics: [
      { label: "Source", value: "Twelve Data via MCP" },
      { label: "Cloture precedente", value: previous.toFixed(2) },
      { label: "Plus haut 30j", value: Math.max(...values).toFixed(2) },
      { label: "Plus bas 30j", value: Math.min(...values).toFixed(2) },
    ],
    checks: [
      {
        title: "Tendance 30j",
        detail: values[values.length - 1] >= values[0] ? "Prix au-dessus du debut de periode" : "Prix sous le debut de periode",
        done: values[values.length - 1] >= values[0],
      },
      { title: "Momentum", detail: change >= 0 ? "Derniere variation positive" : "Derniere variation negative", done: change >= 0 },
      { title: "Donnees", detail: "Serie recue via MCP depuis l'API de marche", done: true },
      { title: "Risque", detail: "Scoring provisoire avant fondamentaux et news", done: score >= 50 },
      { title: "Timing", detail: "A confirmer avec RSI, volumes et supports", done: false },
    ],
  };
}

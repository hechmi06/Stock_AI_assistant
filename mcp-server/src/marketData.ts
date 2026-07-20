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
  total: number;
  page: number;
  limit: number;
  total_pages: number;
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

export type MarketDataSource = "twelve_data" | "yfinance" | "alpha_vantage" | "financial_modeling_prep" | "tiingo";
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
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  NVDA: "NVIDIA Corp.",
  GOOGL: "Alphabet Inc.",
  AMZN: "Amazon.com Inc.",
  META: "Meta Platforms",
  TSLA: "Tesla, Inc.",
  JPM: "JPMorgan Chase",
};

const FEATURED_US_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK.B", "JPM", "V",
  "UNH", "XOM", "LLY", "MA", "PG", "HD", "AVGO", "COST", "MRK", "ABBV",
  "PEP", "KO", "WMT", "BAC", "CRM", "AMD", "NFLX", "DIS", "INTC", "CSCO",
  "ORCL", "IBM", "QCOM", "TXN", "ADBE", "NKE", "SBUX", "MCD", "GS", "MS",
  "BA", "CAT", "GE", "F", "GM", "UBER", "ABNB", "COIN", "PLTR", "SOFI",
];
const US_SYMBOLS_CACHE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;
const QUOTE_BATCH_SIZE = 8;
const QUOTE_BATCH_DELAY_MS = 900;
const FINNHUB_QUOTE_DELAY_MS = 120;
const MARKET_DASHBOARD_CACHE_MS = 60_000;
const configuredMarketDataCacheSeconds = Number(process.env.MCP_MARKET_DATA_CACHE_TTL_SECONDS ?? 900);
const MARKET_DATA_CACHE_MS = Number.isFinite(configuredMarketDataCacheSeconds)
  ? Math.max(0, configuredMarketDataCacheSeconds * 1000)
  : 15 * 60 * 1000;

export type UsStockEntry = { symbol: string; name: string };

export type MarketDashboardOptions = {
  page?: number;
  limit?: number;
  search?: string;
};

let usSymbolsCache: { timestamp: number; entries: UsStockEntry[] } | undefined;
let marketCache: Record<string, { timestamp: number; dashboard: MarketDashboard }> = {};
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

function normalizeTwelveQuotes(payload: Record<string, unknown>): Record<string, Record<string, unknown>> {
  if (payload.symbol) {
    return { [String(payload.symbol).toUpperCase()]: payload };
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      return typeof value === "object" && value != null && (value as { status?: string }).status !== "error";
    }),
  ) as Record<string, Record<string, unknown>>;
}

async function fetchFmpQuotes(symbols: string[]): Promise<Record<string, Record<string, unknown>>> {
  if (symbols.length === 0) return {};
  const payload = await fmpGet("quote", { symbol: symbols.join(",") });
  const items = Array.isArray(payload) ? payload : payload ? [payload] : [];
  const quotes: Record<string, Record<string, unknown>> = {};
  for (const item of items) {
    if (typeof item !== "object" || item == null || typeof item.symbol !== "string") continue;
    const symbol = item.symbol.toUpperCase();
    quotes[symbol] = {
      ...item,
      close: item.price,
      previous_close: item.previousClose ?? item.previous_close,
      percent_change: item.changesPercentage ?? item.changePercentage,
      high: item.dayHigh ?? item.high,
      low: item.dayLow ?? item.low,
      open: item.open,
      volume: item.volume,
      name: item.name,
    };
  }
  return quotes;
}

async function fetchFinnhubQuote(symbol: string): Promise<Record<string, unknown> | undefined> {
  const apiKey = (process.env.FINNHUB_API_KEY ?? "").trim();
  if (!apiKey) return undefined;
  const url = new URL("https://finnhub.io/api/v1/quote");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", apiKey);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { c?: unknown; pc?: unknown; dp?: unknown; h?: unknown; l?: unknown; o?: unknown };
    const mid = toNumber(payload.c);
    if (mid <= 0) return undefined;
    return {
      close: mid,
      previous_close: toNumber(payload.pc),
      percent_change: toNumber(payload.dp),
      high: toNullableNumber(payload.h),
      low: toNullableNumber(payload.l),
      open: toNullableNumber(payload.o),
    };
  } catch {
    return undefined;
  }
}

async function fetchQuotes(symbols: string[]): Promise<Record<string, Record<string, unknown>>> {
  const normalizedSymbols = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (normalizedSymbols.length === 0) return {};

  const quotes: Record<string, Record<string, unknown>> = {};
  const twelvePayload = await twelveDataGet("quote", { symbol: normalizedSymbols.join(",") });
  if (twelvePayload) {
    Object.assign(quotes, normalizeTwelveQuotes(twelvePayload as Record<string, unknown>));
  }

  const missingAfterTwelve = normalizedSymbols.filter((symbol) => !rowFromQuote(symbol, quotes[symbol]));
  if (missingAfterTwelve.length > 0) {
    Object.assign(quotes, await fetchFmpQuotes(missingAfterTwelve));
  }

  const missingAfterFmp = normalizedSymbols.filter((symbol) => !rowFromQuote(symbol, quotes[symbol]));
  for (const symbol of missingAfterFmp) {
    const finnhubQuote = await fetchFinnhubQuote(symbol);
    if (finnhubQuote) quotes[symbol] = finnhubQuote;
    await sleep(FINNHUB_QUOTE_DELAY_MS);
  }

  return quotes;
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

function periodToCutoffDays(period: string): number {
  switch (period) {
    case "5d":
      return 10;
    case "1mo":
      return 35;
    case "3mo":
      return 100;
    case "6mo":
      return 200;
    case "1y":
      return 380;
    case "2y":
      return 760;
    default:
      return 200;
  }
}

// Tiingo : historique EOD gratuit avec quota genereux (vraie API JSON). Sert de
// source historique fiable quand yfinance est rate-limited (le maillon faible).
// Inerte tant que TIINGO_API_KEY n'est pas configuree (meme pattern que FMP).
async function fetchTiingoHistoricalPrices(symbol: string, period = "6mo"): Promise<HistoricalPrice[]> {
  const token = (process.env.TIINGO_API_KEY ?? "").trim();
  if (!token) {
    return [];
  }

  const startDate = new Date(Date.now() - periodToCutoffDays(period) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const url = new URL(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices`);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("token", token);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "stock-ai-assistant-mcp/0.1", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }

    // Tiingo renvoie les points par date croissante, ce qui est deja l'ordre attendu.
    return payload
      .map((item: Record<string, unknown>): HistoricalPrice | undefined => {
        const close = toNumber(item.close);
        if (close <= 0) {
          return undefined;
        }
        return {
          date: String(item.date ?? "").slice(0, 10),
          open: toNullableNumber(item.open),
          high: toNullableNumber(item.high),
          low: toNullableNumber(item.low),
          close: Number(close.toFixed(4)),
          volume: toNumber(item.volume) || null,
        };
      })
      .filter((item): item is HistoricalPrice => Boolean(item?.date));
  } catch {
    return [];
  }
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
    // Fall through to Stooq / Twelve Data historical fallback.
  }

  const tiingo = await fetchTiingoHistoricalPrices(symbol, period);
  if (tiingo.length > 0) {
    return tiingo;
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
  if (cached && now - cached.timestamp < MARKET_DATA_CACHE_MS) {
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
    // yfinance vide (souvent rate-limited) : Tiingo d'abord (quota genereux),
    // puis Twelve Data en dernier recours.
    const tiingoHistory = await fetchTiingoHistoricalPrices(symbol, period);
    if (tiingoHistory.length > 0) {
      sources.add("tiingo");
      historicalPrices = tiingoHistory;
    } else {
      const twelveHistory = await fetchTwelveHistoricalPrices(symbol);
      if (twelveHistory.length > 0) {
        sources.add("twelve_data");
        historicalPrices = twelveHistory;
      } else {
        errors.push("Historical prices unavailable (yfinance, Tiingo, Twelve Data).");
      }
    }
  }

  if (historicalPrices.length === 0 && price?.price) {
    errors.push("Historical prices unavailable from external providers.");
  }

  if (!companyProfile.name && MARKET_SYMBOLS[symbol]) {
    companyProfile = {
      ...companyProfile,
      name: MARKET_SYMBOLS[symbol],
      currency: companyProfile.currency ?? price?.currency ?? "USD",
      exchange: companyProfile.exchange ?? price?.exchange ?? null,
    };
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

function rowFromQuote(
  symbol: string,
  quote: Record<string, unknown> | undefined,
  displayName?: string,
): MarketRow | undefined {
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
    name: String(quote.name ?? displayName ?? MARKET_SYMBOLS[symbol] ?? `${symbol} Corp.`),
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

function placeholderRow(entry: UsStockEntry): MarketRow {
  return {
    symbol: entry.symbol,
    name: entry.name,
    bid: 0,
    mid: 0,
    ask: 0,
    spread: 0,
    variation: 0,
    open: null,
    high: null,
    low: null,
    previous_close: null,
    volume: null,
  };
}

function filterUsEntries(entries: UsStockEntry[], search: string): UsStockEntry[] {
  const query = search.trim().toUpperCase();
  if (!query) return sortUsEntriesFeaturedFirst(entries);
  return entries.filter(
    (entry) => entry.symbol.toUpperCase().includes(query) || entry.name.toUpperCase().includes(query),
  );
}

function sortUsEntriesFeaturedFirst(entries: UsStockEntry[]): UsStockEntry[] {
  const featuredRank = new Map(FEATURED_US_SYMBOLS.map((symbol, index) => [symbol, index]));
  return [...entries].sort((left, right) => {
    const leftRank = featuredRank.get(left.symbol);
    const rightRank = featuredRank.get(right.symbol);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return left.symbol.localeCompare(right.symbol);
  });
}

async function fetchUsStockSymbolsFromFinnhub(): Promise<UsStockEntry[]> {
  const apiKey = (process.env.FINNHUB_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("FINNHUB_API_KEY is not configured.");
  const url = new URL("https://finnhub.io/api/v1/stock/symbol");
  url.searchParams.set("exchange", "US");
  url.searchParams.set("token", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Finnhub stock/symbol returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Finnhub stock/symbol returned an unexpected payload.");
  const allowedTypes = new Set(["Common Stock", "ADR"]);
  return payload
    .map((item: Record<string, unknown>): UsStockEntry | undefined => {
      const type = typeof item.type === "string" ? item.type : "";
      if (!allowedTypes.has(type)) return undefined;
      const symbol = typeof item.symbol === "string" ? item.symbol.trim().toUpperCase() : "";
      if (!symbol) return undefined;
      const name =
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : MARKET_SYMBOLS[symbol] ?? symbol;
      return { symbol, name };
    })
    .filter((entry): entry is UsStockEntry => Boolean(entry));
}

async function fetchUsStockSymbolsFromFmp(): Promise<UsStockEntry[]> {
  const payload = await fmpGet("stock-list");
  if (!Array.isArray(payload)) throw new Error("FMP stock-list unavailable.");
  return payload
    .map((item: Record<string, unknown>): UsStockEntry | undefined => {
      const symbol = typeof item.symbol === "string" ? item.symbol.trim().toUpperCase() : "";
      if (!symbol) return undefined;
      const exchange = typeof item.exchangeShortName === "string" ? item.exchangeShortName.toUpperCase() : "";
      if (exchange && !["NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "BATS"].includes(exchange)) return undefined;
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : symbol;
      return { symbol, name };
    })
    .filter((entry): entry is UsStockEntry => Boolean(entry));
}

export async function fetchUsStockSymbols(): Promise<UsStockEntry[]> {
  const now = Date.now();
  if (usSymbolsCache && now - usSymbolsCache.timestamp < US_SYMBOLS_CACHE_MS) {
    return usSymbolsCache.entries;
  }
  let entries: UsStockEntry[] = [];
  try {
    entries = await fetchUsStockSymbolsFromFinnhub();
  } catch {
    entries = await fetchUsStockSymbolsFromFmp();
  }
  usSymbolsCache = { timestamp: now, entries };
  return entries;
}

export async function searchUsStocks(
  search: string,
  limit: number,
  offset: number,
): Promise<{ total: number; offset: number; limit: number; symbols: UsStockEntry[] }> {
  const all = await fetchUsStockSymbols();
  const filtered = filterUsEntries(all, search);
  const safeLimit = Math.min(MAX_PAGE_LIMIT, Math.max(1, limit));
  const safeOffset = Math.max(0, offset);
  return {
    total: filtered.length,
    offset: safeOffset,
    limit: safeLimit,
    symbols: filtered.slice(safeOffset, safeOffset + safeLimit),
  };
}

async function fetchQuotesForEntries(entries: UsStockEntry[]): Promise<MarketRow[]> {
  if (entries.length === 0) return [];
  const rows: MarketRow[] = [];
  for (let index = 0; index < entries.length; index += QUOTE_BATCH_SIZE) {
    const batch = entries.slice(index, index + QUOTE_BATCH_SIZE);
    const quotes = await fetchQuotes(batch.map((entry) => entry.symbol));
    rows.push(
      ...batch.map((entry) => {
        const row = rowFromQuote(entry.symbol, quotes[entry.symbol.toUpperCase()], entry.name);
        return row ?? placeholderRow(entry);
      }),
    );
    if (index + QUOTE_BATCH_SIZE < entries.length) await sleep(QUOTE_BATCH_DELAY_MS);
  }
  return rows;
}

function dashboardCacheKey(options: MarketDashboardOptions): string {
  return `${options.page ?? 1}|${options.limit ?? DEFAULT_PAGE_LIMIT}|${(options.search ?? "").trim().toUpperCase()}`;
}

function emptySimulation(): MarketDashboard["simulation"] {
  return {
    symbol: "",
    spot: 0,
    notional: 0,
    horizon_days: 0,
    domestic_rate: 0,
    foreign_rate: 0,
    forward_rate: 0,
    swap_points: 0,
    differential: 0,
    counter_value: 0,
  };
}

function emptyMarketDashboard(source: string, errorMessage: string, options: MarketDashboardOptions = {}): MarketDashboard {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, options.limit ?? DEFAULT_PAGE_LIMIT));
  return {
    source,
    updated_at: new Date().toISOString(),
    rows: [],
    total: 0,
    page,
    limit,
    total_pages: 0,
    brief: [{ tag: "ERREUR", title: "Donnees live indisponibles", text: errorMessage }],
    positions: [],
    simulation: emptySimulation(),
  };
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

export async function getMarketDashboard(options: MarketDashboardOptions = {}): Promise<MarketDashboard> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, options.limit ?? DEFAULT_PAGE_LIMIT));
  const search = options.search ?? "";
  const cacheKey = dashboardCacheKey({ page, limit, search });
  const now = Date.now();
  const cached = marketCache[cacheKey];
  if (cached && now - cached.timestamp < MARKET_DASHBOARD_CACHE_MS) return cached.dashboard;

  let rows: MarketRow[] = [];
  let total = 0;
  let totalPages = 1;
  let source = "Finnhub + Twelve Data via MCP";

  try {
    const universe = await fetchUsStockSymbols();
    const filtered = filterUsEntries(universe, search);
    total = filtered.length;
    totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * limit;
    rows = await fetchQuotesForEntries(filtered.slice(offset, offset + limit));
    const pricedCount = rows.filter((row) => row.mid > 0).length;
    source =
      pricedCount > 0
        ? `Finnhub US (${total.toLocaleString("en-US")} titres) + Twelve Data/FMP/Finnhub`
        : `Finnhub US (${total.toLocaleString("en-US")} titres) · cotations indisponibles (quota API)`;
  } catch {
    return emptyMarketDashboard(
      "MCP",
      "Impossible de charger l'univers US. Verifiez FINNHUB_API_KEY et la connexion reseau.",
      { page, limit, search },
    );
  }

  const pricedRows = rows.filter((row) => row.mid > 0);
  const leader = pricedRows.reduce((best, row) => (row.variation > best.variation ? row : best), pricedRows[0]) ?? rows[0];
  const laggard = pricedRows.reduce((worst, row) => (row.variation < worst.variation ? row : worst), pricedRows[0]) ?? rows[0];

  const dashboard: MarketDashboard = {
    source,
    updated_at: new Date().toISOString(),
    rows,
    total,
    page: Math.min(page, totalPages),
    limit,
    total_pages: totalPages,
    brief: [
      {
        tag: "MARCHE",
        title: total > 0 ? `${total.toLocaleString("en-US")} titres US disponibles` : "Univers US indisponible",
        text:
          total > 0
            ? `Page ${Math.min(page, totalPages)}/${totalPages} · ${limit} lignes affichees${search ? ` · filtre « ${search.trim().toUpperCase()} »` : ""}.`
            : "Impossible de charger la liste Finnhub/FMP.",
      },
      {
        tag: "LEADER",
        title: leader ? `${leader.symbol} en tete de page` : "Aucune cotation",
        text:
          leader && leader.mid > 0
            ? `${leader.name} : ${leader.variation >= 0 ? "+" : ""}${leader.variation.toFixed(2)}%.`
            : leader
              ? `${leader.name} : cotation indisponible.`
              : "Aucun prix live sur cette page.",
      },
      {
        tag: "RISQUE",
        title: laggard ? `Pression sur ${laggard.symbol}` : "Aucune cotation",
        text:
          laggard && laggard.mid > 0
            ? `${laggard.name} : ${laggard.variation.toFixed(2)}%.`
            : laggard
              ? `${laggard.name} : pas de prix live.`
              : "Les APIs de cotation ne renvoient pas de donnees.",
      },
      {
        tag: "MCP",
        title: "Donnees live uniquement",
        text: "Aucune cotation statique de secours. Si les prix manquent, verifiez les cles API ou reessayez.",
      },
    ],
    positions:
      pricedRows.length > 0 && leader && leader.mid > 0
        ? [
            {
              id: "D-2087",
              product: "Forward",
              symbol: leader.symbol,
              side: "Achat",
              notional: "250 000 USD",
              entry: Number(leader.mid.toFixed(4)),
              maturity: "23/07/26",
              pnl: 4800,
            },
            {
              id: "D-2091",
              product: "Spot",
              symbol: rows[1]?.symbol ?? leader.symbol,
              side: "Vente",
              notional: "100 000 USD",
              entry: Number(((rows[1]?.mid ?? leader.mid) * 1.01).toFixed(4)),
              maturity: "25/04/26",
              pnl: -1250,
            },
          ]
        : [],
    simulation: pricedRows.length > 0 && leader && leader.mid > 0 ? buildSimulation(leader) : emptySimulation(),
  };

  if (pricedRows.length > 0) marketCache[cacheKey] = { timestamp: now, dashboard };
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

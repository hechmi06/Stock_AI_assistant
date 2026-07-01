export type MarketRow = {
  symbol: string;
  name: string;
  bid: number;
  mid: number;
  ask: number;
  spread: number;
  variation: number;
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

const LIVE_MARKET_SYMBOLS = ["AAPL", "MSFT", "NVDA", "GOOGL"];
let marketCache: { timestamp: number; dashboard: MarketDashboard } | undefined;

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
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

async function fetchQuotes(symbols: string[]) {
  const payload = await twelveDataGet("quote", { symbol: symbols.join(",") });

  if (!payload) {
    return {};
  }

  if (payload.symbol) {
    return { [String(payload.symbol).toUpperCase()]: payload };
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      return typeof value === "object" && value != null && (value as { status?: string }).status !== "error";
    }),
  );
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
  };
}

export function fallbackMarketRows(): MarketRow[] {
  return [
    { symbol: "AAPL", name: "Apple Inc.", bid: 213.31, mid: 213.4, ask: 213.49, spread: 0.18, variation: 1.84 },
    { symbol: "MSFT", name: "Microsoft Corp.", bid: 497.82, mid: 498.05, ask: 498.28, spread: 0.46, variation: 0.72 },
    { symbol: "NVDA", name: "NVIDIA Corp.", bid: 154.56, mid: 154.63, ask: 154.7, spread: 0.14, variation: 3.05 },
    { symbol: "GOOGL", name: "Alphabet Inc.", bid: 179.16, mid: 179.24, ask: 179.32, spread: 0.16, variation: -0.64 },
    { symbol: "AMZN", name: "Amazon.com Inc.", bid: 222.11, mid: 222.22, ask: 222.33, spread: 0.22, variation: 1.12 },
    { symbol: "META", name: "Meta Platforms", bid: 602.8, mid: 603.08, ask: 603.36, spread: 0.56, variation: -1.03 },
    { symbol: "TSLA", name: "Tesla, Inc.", bid: 327.65, mid: 327.8, ask: 327.95, spread: 0.3, variation: -2.12 },
    { symbol: "JPM", name: "JPMorgan Chase", bid: 239.7, mid: 239.82, ask: 239.94, spread: 0.24, variation: 0.38 },
  ];
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
  if (marketCache && now - marketCache.timestamp < 60_000) {
    return marketCache.dashboard;
  }

  const quotes = await fetchQuotes(LIVE_MARKET_SYMBOLS);
  let rows = LIVE_MARKET_SYMBOLS.map((symbol) => rowFromQuote(symbol, quotes[symbol] as Record<string, unknown> | undefined)).filter(
    (row): row is MarketRow => Boolean(row),
  );
  let source = "Twelve Data via MCP";

  if (rows.length < LIVE_MARKET_SYMBOLS.length) {
    rows = fallbackMarketRows();
    source = "Fallback MCP";
  } else {
    const fallbackBySymbol = new Map(fallbackMarketRows().map((row) => [row.symbol, row]));
    rows = [...rows, ...fallbackMarketRows().filter((row) => !LIVE_MARKET_SYMBOLS.includes(row.symbol) && fallbackBySymbol.has(row.symbol))];
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

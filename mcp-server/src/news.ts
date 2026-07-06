import { fmpGet } from "./marketData.js";

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
};

export type NewsPayload = {
  ticker: string;
  articles: NewsArticle[];
  sources_used: NewsOrigin[];
  errors: string[];
};

const MAX_ARTICLES = 20;
// Chaque source est plafonnee avant fusion pour qu'une source tres prolixe
// (ex. Yahoo RSS) n'evince pas totalement les autres du top 20 final.
const MAX_PER_SOURCE = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;

let newsCache: Record<string, { timestamp: number; payload: NewsPayload }> = {};

function decodeXmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function extractTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1]) : null;
}

function toIsoDate(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function fetchYahooRssNews(symbol: string): Promise<NewsArticle[]> {
  const url = new URL("https://feeds.finance.yahoo.com/rss/2.0/headline");
  url.searchParams.set("s", symbol);
  url.searchParams.set("region", "US");
  url.searchParams.set("lang", "en-US");

  const response = await fetch(url, {
    headers: { "User-Agent": "stock-ai-assistant-mcp/0.1" },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Yahoo RSS returned ${response.status}`);
  }

  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  return items
    .map((block): NewsArticle | undefined => {
      const title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const publishedAt = toIsoDate(extractTag(block, "pubDate"));
      if (!title || !link || !publishedAt) {
        return undefined;
      }
      return {
        title,
        source: extractTag(block, "source") ?? "Yahoo Finance",
        published_at: publishedAt,
        url: link,
        summary: extractTag(block, "description"),
        origin: "yahoo_rss",
      };
    })
    .filter((item): item is NewsArticle => Boolean(item));
}

async function fetchFmpNews(symbol: string): Promise<NewsArticle[]> {
  const payload = await fmpGet("news/stock", { symbols: symbol, limit: String(MAX_ARTICLES) });

  if (!Array.isArray(payload)) {
    throw new Error("Financial Modeling Prep news unavailable (missing key, plan without news access, or quota).");
  }

  return payload
    .map((item: Record<string, unknown>): NewsArticle | undefined => {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const url = typeof item.url === "string" ? item.url : "";
      const publishedAt = toIsoDate(typeof item.publishedDate === "string" ? item.publishedDate : null);
      if (!title || !url || !publishedAt) {
        return undefined;
      }
      return {
        title,
        source: typeof item.site === "string" && item.site.trim() ? item.site : "Financial Modeling Prep",
        published_at: publishedAt,
        url,
        summary: typeof item.text === "string" && item.text.trim() ? item.text.trim() : null,
        origin: "financial_modeling_prep",
      };
    })
    .filter((item): item is NewsArticle => Boolean(item));
}

async function fetchGoogleNewsRss(symbol: string): Promise<NewsArticle[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `${symbol} stock`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const response = await fetch(url, {
    headers: { "User-Agent": "stock-ai-assistant-mcp/0.1" },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Google News RSS returned ${response.status}`);
  }

  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  return items
    .map((block): NewsArticle | undefined => {
      let title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const publishedAt = toIsoDate(extractTag(block, "pubDate"));
      if (!title || !link || !publishedAt) {
        return undefined;
      }
      const source = extractTag(block, "source") ?? "Google News";
      // Google News suffixe les titres avec " - Source" : on le retire.
      if (title.toLowerCase().endsWith(` - ${source.toLowerCase()}`)) {
        title = title.slice(0, title.length - source.length - 3).trim();
      }
      return {
        title,
        source,
        published_at: publishedAt,
        url: link,
        summary: null,
        origin: "google_news_rss",
      };
    })
    .filter((item): item is NewsArticle => Boolean(item));
}

async function fetchNewsDataIo(symbol: string): Promise<NewsArticle[]> {
  const apiKey = (process.env.NEWSDATA_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("NEWSDATA_API_KEY is not configured.");
  }

  const url = new URL("https://newsdata.io/api/1/latest");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("q", `${symbol} stock`);
  url.searchParams.set("language", "en");
  url.searchParams.set("category", "business");

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`NewsData.io returned ${response.status}`);
  }

  const payload = await response.json();
  const results = payload?.results;
  if (!Array.isArray(results)) {
    throw new Error("NewsData.io returned an unexpected payload.");
  }

  return results
    .map((item: Record<string, unknown>): NewsArticle | undefined => {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const link = typeof item.link === "string" ? item.link : "";
      // pubDate NewsData est en UTC au format "YYYY-MM-DD HH:mm:ss".
      const rawDate = typeof item.pubDate === "string" ? `${item.pubDate.replace(" ", "T")}Z` : null;
      const publishedAt = toIsoDate(rawDate);
      if (!title || !link || !publishedAt) {
        return undefined;
      }
      return {
        title,
        source:
          typeof item.source_name === "string" && item.source_name.trim() ? item.source_name : "NewsData.io",
        published_at: publishedAt,
        url: link,
        summary:
          typeof item.description === "string" && item.description.trim() ? item.description.trim() : null,
        origin: "newsdata_io",
      };
    })
    .filter((item): item is NewsArticle => Boolean(item));
}

async function fetchFinnhubNews(symbol: string): Promise<NewsArticle[]> {
  const apiKey = (process.env.FINNHUB_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("FINNHUB_API_KEY is not configured.");
  }

  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);

  const url = new URL("https://finnhub.io/api/v1/company-news");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("from", formatDate(from));
  url.searchParams.set("to", formatDate(to));
  url.searchParams.set("token", apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`Finnhub returned ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Finnhub returned an unexpected payload.");
  }

  return payload
    .map((item: Record<string, unknown>): NewsArticle | undefined => {
      const title = typeof item.headline === "string" ? item.headline.trim() : "";
      const url = typeof item.url === "string" ? item.url : "";
      const timestamp = typeof item.datetime === "number" ? item.datetime : null;
      if (!title || !url || !timestamp) {
        return undefined;
      }
      return {
        title,
        source: typeof item.source === "string" && item.source.trim() ? item.source : "Finnhub",
        published_at: new Date(timestamp * 1000).toISOString(),
        url,
        summary: typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : null,
        origin: "finnhub",
      };
    })
    .filter((item): item is NewsArticle => Boolean(item))
    .slice(0, MAX_ARTICLES);
}

function dedupeKey(article: NewsArticle) {
  return article.title.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function getStockNews(ticker: string): Promise<NewsPayload> {
  const symbol = ticker.trim().toUpperCase();
  const now = Date.now();
  const cached = newsCache[symbol];
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.payload;
  }

  const sources = new Set<NewsOrigin>();
  const errors: string[] = [];

  const settled = await Promise.allSettled([
    fetchFmpNews(symbol),
    fetchYahooRssNews(symbol),
    fetchFinnhubNews(symbol),
    fetchGoogleNewsRss(symbol),
    fetchNewsDataIo(symbol),
  ]);
  const sourceLabels: Array<{ origin: NewsOrigin; label: string }> = [
    { origin: "financial_modeling_prep", label: "FMP news" },
    { origin: "yahoo_rss", label: "Yahoo RSS" },
    { origin: "finnhub", label: "Finnhub news" },
    { origin: "google_news_rss", label: "Google News RSS" },
    { origin: "newsdata_io", label: "NewsData.io" },
  ];

  const collected: NewsArticle[] = [];

  settled.forEach((outcome, index) => {
    const { origin, label } = sourceLabels[index];
    if (outcome.status === "fulfilled") {
      if (outcome.value.length > 0) {
        sources.add(origin);
        collected.push(
          ...outcome.value
            .sort((a, b) => b.published_at.localeCompare(a.published_at))
            .slice(0, MAX_PER_SOURCE),
        );
      } else {
        errors.push(`${label} returned no news for this ticker.`);
      }
    } else {
      const reason = outcome.reason;
      errors.push(`${label} unavailable: ${reason instanceof Error ? reason.message : "unknown error"}`);
    }
  });

  const seen = new Set<string>();
  const articles = collected
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .filter((article) => {
      const key = dedupeKey(article);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ARTICLES);

  const payload: NewsPayload = {
    ticker: symbol,
    articles,
    sources_used: Array.from(sources),
    errors,
  };

  if (articles.length > 0) {
    newsCache[symbol] = { timestamp: now, payload };
  }

  return payload;
}

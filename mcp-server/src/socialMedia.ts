export type SocialSource = "reddit";

export type SocialPost = {
  id: string;
  source: SocialSource;
  author: string;
  text: string;
  url: string;
  published_at: string;
  engagement: {
    score?: number;
    comments?: number;
  };
};

type SourceStatus = {
  status: "success" | "empty" | "unavailable" | "failed";
  posts_count: number;
  error?: string;
};

type SocialMediaPayload = {
  ticker: string;
  collected_at: string;
  posts: SocialPost[];
  sources_used: SocialSource[];
  source_status: Record<SocialSource, SourceStatus>;
  errors: string[];
};

const MAX_POSTS_PER_SOURCE = 20;
const MAX_POST_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_SOURCE_CACHE_TTL_MS = 300_000;
let redditAccessToken: { value: string; expiresAt: number } | null = null;
const socialPayloadCache = new Map<
  string,
  { expiresAt: number; payload: SocialMediaPayload }
>();

function sourceCacheTtlMs() {
  const raw = Number(process.env.SOCIAL_MEDIA_SOURCE_CACHE_TTL_SECONDS ?? "300");
  return Number.isFinite(raw) && raw >= 0
    ? raw * 1000
    : DEFAULT_SOURCE_CACHE_TTL_MS;
}

function compactText(value: unknown, maxLength = 1200) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function buildRedditQuery(ticker: string, companyName?: string) {
  const company = compactText(companyName, 80);
  const identities = [ticker, `$${ticker}`];
  if (company) identities.push(`"${company}"`);
  return `(${identities.join(" OR ")}) AND (stock OR shares OR earnings OR investor OR market)`;
}

function isRelevantPost(
  text: string,
  ticker: string,
  companyName?: string,
) {
  const normalized = text.toLowerCase();
  const tickerLower = ticker.toLowerCase();
  if (
    normalized.includes(`$${tickerLower}`)
    || normalized.includes(`${tickerLower} stock`)
    || normalized.includes(`${tickerLower} shares`)
  ) {
    return true;
  }
  if (
    ticker.length >= 3
    && new RegExp(`\\b${tickerLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
      .test(text)
  ) {
    return true;
  }
  const companyKeyword = compactText(companyName, 80)
    .replace(
      /\b(?:incorporated|inc|corporation|corp|company|plc|class [a-z])\.?\b/gi,
      "",
    )
    .trim()
    .split(/\s+/)
    .find((word) => word.length >= 4);
  if (!companyKeyword || !normalized.includes(companyKeyword.toLowerCase())) {
    return false;
  }
  return [
    "stock",
    "share",
    "earning",
    "market",
    "invest",
    "trading",
    "dividend",
    "valuation",
    "option",
    "portfolio",
    "nasdaq",
  ].some((term) => normalized.includes(term));
}

function isRecentPost(post: SocialPost) {
  const publishedAt = Date.parse(post.published_at);
  return (
    Number.isFinite(publishedAt)
    && publishedAt >= Date.now() - MAX_POST_AGE_MS
    && publishedAt <= Date.now() + 5 * 60 * 1000
  );
}

function deduplicatePosts(posts: SocialPost[]) {
  const seen = new Set<string>();
  return posts.filter((post) => {
    const fingerprint = post.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!fingerprint || seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function getRedditAccessToken() {
  if (redditAccessToken && redditAccessToken.expiresAt > Date.now() + 60_000) {
    return redditAccessToken.value;
  }
  const clientId = (process.env.REDDIT_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.REDDIT_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;

  const payload = await fetchJson(
    "https://www.reddit.com/api/v1/access_token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "StockAIAssistant/1.0 (educational market research)",
      },
      body: "grant_type=client_credentials",
    },
  ) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error("Reddit OAuth did not return an access token.");
  }
  redditAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
  };
  return redditAccessToken.value;
}

function normalizeRedditJson(payload: {
  data?: {
    children?: Array<{
      data?: Record<string, unknown>;
    }>;
  };
}, ticker: string, companyName?: string) {
  return (payload.data?.children ?? [])
    .map((child): SocialPost | null => {
      const post = child.data;
      if (!post) return null;
      const id = compactText(post.id, 100);
      const title = compactText(post.title);
      const selfText = compactText(post.selftext);
      const text = compactText(
        selfText && selfText !== title ? `${title}\n${selfText}` : title,
      );
      const permalink = compactText(post.permalink, 500);
      const created = Number(post.created_utc);
      if (!id || !text || !permalink || !Number.isFinite(created)) return null;
      return {
        id: `reddit-${id}`,
        source: "reddit",
        author: compactText(post.author, 100) || "Reddit",
        text,
        url: `https://www.reddit.com${permalink}`,
        published_at: new Date(created * 1000).toISOString(),
        engagement: {
          score: Number(post.score) || 0,
          comments: Number(post.num_comments) || 0,
        },
      };
    })
    .filter((post): post is SocialPost => post !== null)
    .filter((post) => isRelevantPost(post.text, ticker, companyName))
    .filter(isRecentPost);
}

async function fetchRedditJsonPosts(
  ticker: string,
  companyName?: string,
): Promise<SocialPost[]> {
  const query = buildRedditQuery(ticker, companyName);
  const params = new URLSearchParams({
    q: query,
    sort: "new",
    t: "week",
    limit: String(MAX_POSTS_PER_SOURCE),
    raw_json: "1",
  });
  const accessToken = await getRedditAccessToken();
  const baseUrl = accessToken
    ? "https://oauth.reddit.com/search"
    : "https://www.reddit.com/search.json";
  const payload = await fetchJson(
    `${baseUrl}?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "StockAIAssistant/1.0 (educational market research)",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    },
  ) as {
    data?: {
      children?: Array<{
        data?: Record<string, unknown>;
      }>;
    };
  };
  return normalizeRedditJson(payload, ticker, companyName);
}

function extractXmlTag(block: string, tag: string) {
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match ? compactText(match[1]) : "";
}

async function fetchRedditRssPosts(
  ticker: string,
  companyName?: string,
): Promise<SocialPost[]> {
  const query = buildRedditQuery(ticker, companyName);
  const params = new URLSearchParams({
    q: query,
    sort: "new",
    t: "week",
  });
  const xml = await fetchText(
    `https://www.reddit.com/search.rss?${params.toString()}`,
    {
      headers: {
        Accept: "application/atom+xml, application/rss+xml, application/xml",
        "User-Agent": "StockAIAssistant/1.0 (educational market research)",
      },
    },
  );
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return entries
    .map((entry, index): SocialPost => {
      const rawId = extractXmlTag(entry, "id") || `${ticker}-${index}`;
      const linkMatch = entry.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      const authorBlock = entry.match(/<author\b[\s\S]*?<\/author>/i)?.[0] ?? "";
      return {
        id: `reddit-${compactText(rawId, 100)}`,
        source: "reddit",
        author: extractXmlTag(authorBlock, "name") || "Reddit",
        text: extractXmlTag(entry, "title") || "Publication Reddit",
        url: compactText(linkMatch?.[1], 500) || "https://www.reddit.com",
        published_at: extractXmlTag(entry, "updated") || new Date().toISOString(),
        engagement: {},
      };
    })
    .filter((post) => isRelevantPost(post.text, ticker, companyName))
    .filter(isRecentPost)
    .slice(0, MAX_POSTS_PER_SOURCE);
}

async function fetchRedditPosts(
  ticker: string,
  companyName?: string,
): Promise<SocialPost[]> {
  try {
    return await fetchRedditJsonPosts(ticker, companyName);
  } catch {
    return await fetchRedditRssPosts(ticker, companyName);
  }
}

export async function getSocialMediaPosts(
  rawTicker: string,
  companyName?: string,
): Promise<SocialMediaPayload> {
  const ticker = rawTicker.trim().toUpperCase();
  const cacheKey = `${ticker}:${compactText(companyName, 80).toLowerCase()}`;
  const cached = socialPayloadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return structuredClone(cached.payload);
  }
  const posts: SocialPost[] = [];
  const errors: string[] = [];
  const sourceStatus: Record<SocialSource, SourceStatus> = {
    reddit: { status: "empty", posts_count: 0 },
  };
  try {
    const redditPosts = deduplicatePosts(
      await fetchRedditPosts(ticker, companyName),
    );
    posts.push(...redditPosts);
    sourceStatus.reddit = {
      status: redditPosts.length ? "success" : "empty",
      posts_count: redditPosts.length,
    };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    sourceStatus.reddit = {
      status: "failed",
      posts_count: 0,
      error: message,
    };
    errors.push(`Reddit unavailable: ${message}`);
  }

  posts.sort(
    (left, right) =>
      Date.parse(right.published_at) - Date.parse(left.published_at),
  );
  const sourcesUsed = (["reddit"] as SocialSource[]).filter(
    (source) => sourceStatus[source].status === "success",
  );
  const payload = {
    ticker,
    collected_at: new Date().toISOString(),
    posts,
    sources_used: sourcesUsed,
    source_status: sourceStatus,
    errors,
  };
  if (posts.length && sourceCacheTtlMs() > 0) {
    socialPayloadCache.set(cacheKey, {
      expiresAt: Date.now() + sourceCacheTtlMs(),
      payload: structuredClone(payload),
    });
  }
  return payload;
}

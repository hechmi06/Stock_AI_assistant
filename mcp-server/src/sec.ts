// Outil MCP : documents financiers officiels via SEC EDGAR (gratuit, illimite).
//
// Deux fonctions :
//  - getSecFilings(ticker)   : ticker -> CIK -> liste des 10-K / 10-Q recents
//                              avec l'URL du document principal ;
//  - getSecDocumentText(url) : telecharge le depot HTML et renvoie le texte brut
//                              (nettoye) pour alimenter le RAGAgent.
//
// SEC exige un User-Agent identifiant l'appelant (SEC_USER_AGENT).

export type SecFiling = {
  form: string;
  filing_date: string;
  accession_number: string;
  primary_document: string;
  document_url: string;
};

export type SecFilingsPayload = {
  ticker: string;
  cik: string;
  company_name: string | null;
  filings: SecFiling[];
  errors: string[];
};

export type SecDocumentPayload = {
  url: string;
  text: string;
  length: number;
  errors: string[];
};

const DEFAULT_FORMS = ["10-K", "10-Q"];
const TICKER_MAP_CACHE_MS = 24 * 60 * 60 * 1000;

let tickerMapCache: { timestamp: number; map: Record<string, { cik: string; name: string }> } | undefined;

function secUserAgent(): string {
  return (process.env.SEC_USER_AGENT ?? "").trim() || "Bourse_IA/0.1 (contact@example.com)";
}

async function secFetch(url: string, timeoutMs = 20_000): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": secUserAgent(), Accept: "application/json, text/html" },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function loadTickerMap(): Promise<Record<string, { cik: string; name: string }>> {
  const now = Date.now();
  if (tickerMapCache && now - tickerMapCache.timestamp < TICKER_MAP_CACHE_MS) {
    return tickerMapCache.map;
  }
  const response = await secFetch("https://www.sec.gov/files/company_tickers.json");
  if (!response.ok) {
    throw new Error(`SEC company_tickers returned ${response.status}`);
  }
  const payload = (await response.json()) as Record<string, { ticker: string; cik_str: number; title: string }>;
  const map: Record<string, { cik: string; name: string }> = {};
  for (const row of Object.values(payload)) {
    if (row && typeof row.ticker === "string") {
      map[row.ticker.toUpperCase()] = { cik: String(row.cik_str).padStart(10, "0"), name: row.title };
    }
  }
  tickerMapCache = { timestamp: now, map };
  return map;
}

export async function getSecFilings(
  ticker: string,
  forms: string[] = DEFAULT_FORMS,
  limit = 4,
): Promise<SecFilingsPayload> {
  const symbol = ticker.trim().toUpperCase();
  const errors: string[] = [];

  let entry: { cik: string; name: string } | undefined;
  try {
    entry = (await loadTickerMap())[symbol];
  } catch (error) {
    errors.push(`SEC ticker map unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (!entry) {
    return { ticker: symbol, cik: "", company_name: null, filings: [], errors: [...errors, `Ticker ${symbol} introuvable dans SEC EDGAR.`] };
  }

  const filings: SecFiling[] = [];
  try {
    const response = await secFetch(`https://data.sec.gov/submissions/CIK${entry.cik}.json`);
    if (!response.ok) {
      throw new Error(`submissions returned ${response.status}`);
    }
    const payload = (await response.json()) as {
      filings?: { recent?: { form?: string[]; filingDate?: string[]; accessionNumber?: string[]; primaryDocument?: string[] } };
    };
    const recent = payload.filings?.recent;
    const formArr = recent?.form ?? [];
    const dateArr = recent?.filingDate ?? [];
    const accnArr = recent?.accessionNumber ?? [];
    const docArr = recent?.primaryDocument ?? [];
    const cikNoZeros = String(Number(entry.cik));

    for (let index = 0; index < formArr.length && filings.length < limit; index += 1) {
      if (!forms.includes(formArr[index])) {
        continue;
      }
      const accession = accnArr[index] ?? "";
      const primaryDocument = docArr[index] ?? "";
      const accessionNoDashes = accession.replace(/-/g, "");
      if (!accession || !primaryDocument) {
        continue;
      }
      filings.push({
        form: formArr[index],
        filing_date: dateArr[index] ?? "",
        accession_number: accession,
        primary_document: primaryDocument,
        document_url: `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${accessionNoDashes}/${primaryDocument}`,
      });
    }
  } catch (error) {
    errors.push(`SEC submissions unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return { ticker: symbol, cik: entry.cik, company_name: entry.name, filings, errors };
}

// Nettoyage HTML -> texte : suffisant pour un depot SEC (paragraphes + tableaux).
function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ix:hidden[^>]*>[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<ix:header[^>]*>[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<xbrli:context[^>]*>[\s\S]*?<\/xbrli:context>/gi, " ")
    .replace(/<xbrli:unit[^>]*>[\s\S]*?<\/xbrli:unit>/gi, " ")
    .replace(/<link:[^>]*>[\s\S]*?<\/link:[^>]*>/gi, " ")
    .replace(/<xbrldi:[^>]*>[\s\S]*?<\/xbrldi:[^>]*>/gi, " ")
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, " ")
    .replace(/<\/(p|div|tr|table|li|h[1-6]|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#8217;|&#39;|&apos;/gi, "'")
    .replace(/&#8220;|&#8221;|&quot;/gi, '"')
    .replace(/&#8212;|&#8211;/gi, "-")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export async function getSecDocumentText(url: string): Promise<SecDocumentPayload> {
  const errors: string[] = [];
  if (!/^https:\/\/www\.sec\.gov\/Archives\/edgar\//.test(url)) {
    return { url, text: "", length: 0, errors: ["URL invalide : seuls les documents sec.gov/Archives/edgar sont acceptes."] };
  }
  try {
    const response = await secFetch(url, 30_000);
    if (!response.ok) {
      return { url, text: "", length: 0, errors: [`SEC document returned ${response.status}`] };
    }
    const html = await response.text();
    const text = htmlToText(html);
    return { url, text, length: text.length, errors };
  } catch (error) {
    return { url, text: "", length: 0, errors: [`SEC document fetch failed: ${error instanceof Error ? error.message : "unknown error"}`] };
  }
}

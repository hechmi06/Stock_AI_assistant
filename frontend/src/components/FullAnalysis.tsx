import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  Building2,
  CheckCircle2,
  Database,
  ExternalLink,
  FileText,
  Gauge,
  Globe2,
  History,
  Newspaper,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchFullAnalysis } from "../services/analysisApi";
import type { OrchestratedAnalysis, RiskItem } from "../types";
import {
  ANALYSIS_TTL_MS,
  readSnapshot,
  snapshotAgeLabel,
  writeSnapshot,
} from "../utils/persistedAnalysis";
import { RiskScale } from "./RiskScale";

const analysisStorageKey = (ticker: string) =>
  `stock-ai-analysis-v1:${ticker.trim().toUpperCase()}`;

const RECOMMENDATION_LABELS = {
  favorable: "Favorable",
  a_surveiller: "À surveiller",
  prudence: "Prudence",
  defavorable: "Défavorable",
  donnees_insuffisantes: "Données insuffisantes",
};

const STATUS_LABELS = { success: "Validé", partial: "Partiel", failed: "Échec" };

const CATEGORY_LABELS: Record<RiskItem["category"], string> = {
  market: "Marché",
  technical: "Technique",
  fundamental: "Fondamental",
  news: "Actualités",
  documentary: "Documents SEC",
  data_quality: "Qualité des données",
};

const RATIO_LABELS: Record<string, string> = {
  trailingPE: "PER courant",
  forwardPE: "PER estimé",
  priceToBook: "Prix / actif net",
  priceToSalesTrailing12Months: "Prix / ventes",
  enterpriseToEbitda: "VE / EBITDA",
  profitMargins: "Marge nette",
  operatingMargins: "Marge opérationnelle",
  returnOnEquity: "ROE",
  returnOnAssets: "ROA",
  debtToEquity: "Dette / fonds propres",
  currentRatio: "Ratio de liquidité",
  dividendYield: "Rendement du dividende",
  beta: "Bêta",
};

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const fullDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" });

type HistoryPoint = OrchestratedAnalysis["market_data"]["historical_prices"][number];

function valueOrDash(value: number | null | undefined, suffix = "") {
  return value == null || !Number.isFinite(value) ? "-" : `${number.format(value)}${suffix}`;
}

function compactValue(value: number | null | undefined, suffix = "") {
  return value == null || !Number.isFinite(value) ? "-" : `${compact.format(value)}${suffix}`;
}

function asDate(value: string | null | undefined, formatter = fullDate) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : formatter.format(parsed);
}

function formatRatio(key: string, value: number | null) {
  if (value == null) return "-";
  const isPercent = /(margin|yield|returnon)/i.test(key);
  const normalized = isPercent && Math.abs(value) <= 2 ? value * 100 : value;
  return `${number.format(normalized)}${isPercent ? "%" : ""}`;
}

function ScoreCell({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="analysis-score-cell">
      <span>{label}</span>
      <strong>{value}<small>/100</small></strong>
      <em>{detail}</em>
      <div className="analysis-score-track"><i style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function PriceChart({ prices, currency }: { prices: HistoryPoint[]; currency: string }) {
  const [period, setPeriod] = useState("3M");
  const [hovered, setHovered] = useState<number | null>(null);
  const periods = [
    { label: "1M", count: 20 },
    { label: "3M", count: 60 },
    { label: "6M", count: 120 },
    { label: "Tout", count: prices.length },
  ];
  const selected = periods.find((item) => item.label === period) ?? periods[1];
  const visible = useMemo(() => prices.slice(-Math.min(selected.count, prices.length)), [prices, selected.count]);

  if (visible.length < 2) {
    return <div className="asset-chart-empty">Historique insuffisant pour afficher le graphique.</div>;
  }

  const width = 900;
  const height = 285;
  const left = 52;
  const right = 14;
  const top = 14;
  const bottom = 34;
  const lows = visible.map((point) => point.low ?? point.close);
  const highs = visible.map((point) => point.high ?? point.close);
  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  const padding = Math.max((rawMax - rawMin) * 0.12, rawMax * 0.005, 1);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index: number) => left + (index / Math.max(visible.length - 1, 1)) * plotWidth;
  const y = (value: number) => top + ((max - value) / Math.max(max - min, 1)) * plotHeight;
  const line = visible.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.close).toFixed(1)}`).join(" ");
  const area = `${line} L${x(visible.length - 1)},${height - bottom} L${x(0)},${height - bottom} Z`;
  const activeIndex = hovered ?? visible.length - 1;
  const active = visible[activeIndex];
  const first = visible[0].close;
  const variation = first ? ((active.close - first) / first) * 100 : 0;

  return (
    <div className="asset-chart-tool">
      <div className="asset-chart-toolbar">
        <div>
          <strong>{valueOrDash(active.close, ` ${currency}`)}</strong>
          <span className={variation >= 0 ? "positive" : "negative"}>
            {variation >= 0 ? "+" : ""}{valueOrDash(variation, "%")}
          </span>
          <small>{asDate(active.date)}</small>
        </div>
        <div className="asset-periods" role="tablist" aria-label="Période du graphique">
          {periods.map((item) => (
            <button
              key={item.label}
              type="button"
              className={period === item.label ? "active" : ""}
              onClick={() => { setPeriod(item.label); setHovered(null); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="asset-chart-stage">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Évolution du cours sur ${period}`}
          onMouseLeave={() => setHovered(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            setHovered(Math.round(ratio * (visible.length - 1)));
          }}
        >
          {[0, 1, 2, 3, 4].map((step) => {
            const gy = top + (step / 4) * plotHeight;
            const label = max - (step / 4) * (max - min);
            return (
              <g key={step}>
                <line className="asset-chart-grid" x1={left} x2={width - right} y1={gy} y2={gy} />
                <text className="asset-chart-axis" x={left - 8} y={gy + 4} textAnchor="end">{number.format(label)}</text>
              </g>
            );
          })}
          <path className="asset-chart-area" d={area} />
          <path className="asset-chart-line" d={line} />
          {hovered != null ? (
            <g>
              <line className="asset-chart-crosshair" x1={x(activeIndex)} x2={x(activeIndex)} y1={top} y2={height - bottom} />
              <circle className="asset-chart-dot" cx={x(activeIndex)} cy={y(active.close)} r="4" />
            </g>
          ) : null}
        </svg>
        <div className="asset-chart-dates">
          <span>{asDate(visible[0].date, shortDate)}</span>
          <span>{asDate(visible[Math.floor(visible.length / 2)].date, shortDate)}</span>
          <span>{asDate(visible[visible.length - 1].date, shortDate)}</span>
        </div>
      </div>
    </div>
  );
}

function HistoricalTable({ prices }: { prices: HistoryPoint[] }) {
  const ranges = [
    { label: "1 semaine", count: 5 },
    { label: "1 mois", count: 20 },
    { label: "3 mois", count: 60 },
    { label: "Historique disponible", count: prices.length },
  ];

  return (
    <div className="asset-history-table">
      <div className="asset-table-row asset-table-head"><span>Période</span><span>Variation</span><span>Plus haut</span><span>Plus bas</span></div>
      {ranges.map(({ label, count }) => {
        const rows = prices.slice(-Math.min(count, prices.length));
        const start = rows[0]?.close;
        const end = rows[rows.length - 1]?.close;
        const change = start && end ? ((end - start) / start) * 100 : null;
        const high = rows.length ? Math.max(...rows.map((point) => point.high ?? point.close)) : null;
        const low = rows.length ? Math.min(...rows.map((point) => point.low ?? point.close)) : null;
        return (
          <div className="asset-table-row" key={label}>
            <strong>{label}</strong>
            <span className={(change ?? 0) >= 0 ? "positive" : "negative"}>{change != null && change >= 0 ? "+" : ""}{valueOrDash(change, "%")}</span>
            <span>{valueOrDash(high)}</span>
            <span>{valueOrDash(low)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FullAnalysis({ ticker }: { ticker: string }) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const initialSnapshot = useRef(
    readSnapshot<OrchestratedAnalysis>(analysisStorageKey(normalizedTicker)),
  );
  const activeTickerRef = useRef(normalizedTicker);
  const [analysis, setAnalysis] = useState<OrchestratedAnalysis | null>(
    initialSnapshot.current?.value ?? null,
  );
  const [savedAt, setSavedAt] = useState<number | null>(
    initialSnapshot.current?.savedAt ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("cours");

  async function load(fresh = false, requestedTicker = normalizedTicker) {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFullAnalysis(requestedTicker, fresh);
      const snapshot = writeSnapshot(
        analysisStorageKey(requestedTicker),
        result,
        ANALYSIS_TTL_MS,
      );
      if (activeTickerRef.current === requestedTicker) {
        setAnalysis(result);
        setSavedAt(snapshot?.savedAt ?? Date.now());
      }
    } catch {
      setError("L'analyse multi-agents est indisponible. Vérifiez les services MCP, AI Backend et Gateway.");
    } finally {
      if (activeTickerRef.current === requestedTicker) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    activeTickerRef.current = normalizedTicker;
    const cached = readSnapshot<OrchestratedAnalysis>(
      analysisStorageKey(normalizedTicker),
    );
    setAnalysis(cached?.value ?? null);
    setSavedAt(cached?.savedAt ?? null);
    setActiveSection("cours");
    if (!cached || cached.isExpired) {
      void load(Boolean(cached), normalizedTicker);
    } else {
      setLoading(false);
      setError(null);
    }
    // The normalized ticker is the cache identity for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedTicker]);

  useEffect(() => {
    if (!savedAt) return;
    const remaining = savedAt + ANALYSIS_TTL_MS - Date.now();
    const timer = window.setTimeout(
      () => void load(true, normalizedTicker),
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
    // A successful refresh changes savedAt and schedules the next refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedTicker, savedAt]);

  function goTo(section: string) {
    setActiveSection(section);
    document.getElementById(`asset-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!analysis && loading) {
    return (
      <section className="full-analysis-page analysis-state-page">
        <BrainCircuit size={28} className="spin" />
        <strong>Analyse de {ticker} en cours</strong>
        <span>Collecte marché, actualités et documents, puis calcul technique, risque et synthèse.</span>
      </section>
    );
  }

  if (!analysis) {
    return (
      <section className="full-analysis-page analysis-state-page">
        <AlertTriangle size={28} />
        <strong>Analyse indisponible</strong>
        <span>{error}</span>
        <button type="button" onClick={() => void load(true)}>Réessayer</button>
      </section>
    );
  }

  const { synthesis, market_data: market, technical, news, rag, risk } = analysis;
  const company = market.company_profile;
  const prices = market.historical_prices ?? [];
  const latest = prices[prices.length - 1];
  const previous = prices[prices.length - 2];
  const currency = market.raw_price?.currency ?? company.currency ?? "USD";
  const exchange = market.raw_price?.exchange ?? company.exchange ?? "Marché non renseigné";
  const statement = market.financial_statements_summary;
  const ratios = Object.entries(market.financial_ratios ?? {}).filter(([, value]) => value != null).slice(0, 8);
  const navigation = [
    ["cours", "Cours"], ["synthese", "Analyse IA"], ["technique", "Technique"],
    ["fondamentaux", "Fondamentaux"], ["actualites", "Actualités"], ["risques", "Risques & RAG"],
  ];

  return (
    <section className="full-analysis-page asset-sheet">
      <header className="asset-masthead">
        <div className="analysis-identity">
          <div className="analysis-symbol">{analysis.ticker.slice(0, 4)}</div>
          <div>
            <span className="asset-kicker">Action · {exchange}</span>
            <h2>{company.name ?? analysis.ticker}</h2>
            <p>{analysis.ticker} · {company.sector ?? "Secteur non renseigné"} · {company.country ?? "Pays non renseigné"}</p>
          </div>
        </div>
        <div className="asset-live-quote">
          <div>
            <strong>{valueOrDash(market.price, ` ${currency}`)}</strong>
            <span className={(market.change_percent ?? 0) >= 0 ? "positive" : "negative"}>
              {(market.change_percent ?? 0) >= 0 ? "+" : ""}{valueOrDash(market.change_percent, "%")}
            </span>
          </div>
          <small>{market.raw_price?.market_state ?? "Données différées"} · {market.sources_used.join(", ")}</small>
        </div>
        <span className={`analysis-freshness ${loading ? "refreshing" : ""}`}>
          {loading ? "Actualisation en cours" : snapshotAgeLabel(savedAt)}
        </span>
        <button className="analysis-refresh" type="button" onClick={() => void load(true)} disabled={loading} title="Actualiser les données">
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          Actualiser
        </button>
      </header>

      <nav className="asset-navigation" aria-label="Navigation de la fiche action">
        {navigation.map(([id, label]) => (
          <button key={id} type="button" className={activeSection === id ? "active" : ""} onClick={() => goTo(id)}>{label}</button>
        ))}
      </nav>

      {error ? <div className="analysis-inline-warning">{error}</div> : null}

      <div id="asset-cours" className="asset-overview-grid">
        <section className="analysis-section asset-chart-panel">
          <div className="analysis-section-title"><Activity size={17} /><strong>Évolution du cours</strong><span>{prices.length} séances</span></div>
          <PriceChart prices={prices} currency={currency} />
        </section>

        <aside className="analysis-section asset-session-panel">
          <div className="analysis-section-title"><Gauge size={17} /><strong>Cotation</strong><span>{asDate(latest?.date)}</span></div>
          <dl className="analysis-kv-list asset-quote-list">
            <div><dt>Ouverture</dt><dd>{valueOrDash(latest?.open)}</dd></div>
            <div><dt>Clôture précédente</dt><dd>{valueOrDash(previous?.close)}</dd></div>
            <div><dt>Plus haut</dt><dd>{valueOrDash(latest?.high)}</dd></div>
            <div><dt>Plus bas</dt><dd>{valueOrDash(latest?.low)}</dd></div>
            <div><dt>Volume</dt><dd>{compactValue(latest?.volume)}</dd></div>
            <div><dt>Capitalisation</dt><dd>{compactValue(company.market_cap, ` ${currency}`)}</dd></div>
          </dl>
          <div className="asset-session-range">
            <span style={{ left: `${technical.support_level && technical.resistance_level && market.price ? Math.max(0, Math.min(100, ((market.price - technical.support_level) / (technical.resistance_level - technical.support_level)) * 100)) : 50}%` }} />
          </div>
          <div className="asset-range-labels"><small>Support {valueOrDash(technical.support_level)}</small><small>Résistance {valueOrDash(technical.resistance_level)}</small></div>
        </aside>
      </div>

      <div className="analysis-score-grid">
        <ScoreCell label="Score global" value={synthesis.global_score} detail={RECOMMENDATION_LABELS[synthesis.recommendation]} />
        <ScoreCell label="Confiance" value={synthesis.confidence_score} detail={synthesis.confidence_level} />
        <ScoreCell label="Technique" value={synthesis.scores.technical} detail={technical.trend} />
        <ScoreCell label="Maîtrise du risque" value={synthesis.scores.risk} detail={`Risque ${risk.risk_score}/100`} />
      </div>

      <div className="asset-content-grid">
        <main className="asset-main-column">
          <section id="asset-synthese" className="analysis-section analysis-conclusion asset-anchor">
            <div className="analysis-section-title">
              <BrainCircuit size={17} /><strong>La valeur vue par l'IA</strong>
              <span className={`recommendation-badge ${synthesis.recommendation}`}>{RECOMMENDATION_LABELS[synthesis.recommendation]}</span>
            </div>
            <p>{synthesis.summary}</p>
            <div className="analysis-signal-grid">
              <div>
                <h3><TrendingUp size={15} /> Points favorables</h3>
                {synthesis.strengths.length ? synthesis.strengths.map((item) => <p key={item}>{item}</p>) : <p>Aucun signal favorable dominant.</p>}
              </div>
              <div>
                <h3><TrendingDown size={15} /> Points de vigilance</h3>
                {synthesis.weaknesses.length ? synthesis.weaknesses.map((item) => <p key={item}>{item}</p>) : <p>Aucun signal négatif dominant.</p>}
              </div>
            </div>
            <div className="analysis-source-line"><Database size={14} />{synthesis.sources.length ? synthesis.sources.join(" · ") : "Aucune source exploitable"}</div>
          </section>

          <section className="analysis-section">
            <div className="analysis-section-title"><History size={17} /><strong>Données historiques</strong><span>Calculées sur les cours disponibles</span></div>
            <HistoricalTable prices={prices} />
          </section>

          <section id="asset-technique" className="analysis-section asset-anchor">
            <div className="analysis-section-title"><BarChart3 size={17} /><strong>Analyse technique</strong><span>{technical.trend}</span></div>
            <div className="asset-metric-grid">
              <div><span>RSI 14</span><strong>{valueOrDash(technical.rsi)}</strong><small>{(technical.rsi ?? 50) > 70 ? "Zone de surachat" : (technical.rsi ?? 50) < 30 ? "Zone de survente" : "Zone neutre"}</small></div>
              <div><span>SMA 20</span><strong>{valueOrDash(technical.moving_averages.sma_20)}</strong><small>Tendance courte</small></div>
              <div><span>SMA 50</span><strong>{valueOrDash(technical.moving_averages.sma_50)}</strong><small>Tendance moyenne</small></div>
              <div><span>EMA 200</span><strong>{valueOrDash(technical.moving_averages.ema_200)}</strong><small>Tendance longue</small></div>
              <div><span>MACD histogramme</span><strong>{valueOrDash(technical.macd?.histogram)}</strong><small>Momentum croise</small></div>
              <div><span>ATR 14</span><strong>{valueOrDash(technical.atr_percent, "%")}</strong><small>Amplitude moyenne</small></div>
              <div><span>Bollinger</span><strong>{valueOrDash(technical.bollinger_bands?.position_percent, "%")}</strong><small>Position dans le canal</small></div>
              <div><span>Volatilité</span><strong>{valueOrDash(technical.volatility, "%")}</strong><small>20 dernières séances</small></div>
              <div><span>Volume relatif</span><strong>{valueOrDash(technical.volume_analysis?.volume_ratio, "×")}</strong><small>{technical.volume_analysis?.interpretation ?? "Indisponible"}</small></div>
              <div><span>Signal</span><strong className={technical.signal}>{technical.signal}</strong><small>Score {valueOrDash(technical.technical_score, "/100")}</small></div>
            </div>
          </section>

          <section id="asset-fondamentaux" className="analysis-section asset-anchor">
            <div className="analysis-section-title"><Building2 size={17} /><strong>Fondamentaux</strong><span>Exercice {statement.fiscal_date ?? "-"}</span></div>
            <div className="asset-fundamental-grid">
              <div className="asset-statement-grid">
                <div><span>Chiffre d'affaires</span><strong>{compactValue(statement.total_revenue, ` ${currency}`)}</strong></div>
                <div><span>Résultat net</span><strong>{compactValue(statement.net_income, ` ${currency}`)}</strong></div>
                <div><span>Actifs</span><strong>{compactValue(statement.total_assets, ` ${currency}`)}</strong></div>
                <div><span>Dette totale</span><strong>{compactValue(statement.total_debt, ` ${currency}`)}</strong></div>
                <div><span>Cash-flow opérationnel</span><strong>{compactValue(statement.operating_cashflow, ` ${currency}`)}</strong></div>
              </div>
              <dl className="analysis-kv-list asset-ratio-list">
                {ratios.length ? ratios.map(([key, value]) => <div key={key}><dt>{RATIO_LABELS[key] ?? key.replace(/_/g, " ")}</dt><dd>{formatRatio(key, value)}</dd></div>) : <div><dt>Ratios financiers</dt><dd>-</dd></div>}
              </dl>
            </div>
          </section>

          <section id="asset-actualites" className="analysis-section asset-anchor">
            <div className="analysis-section-title"><Newspaper size={17} /><strong>Dernières actualités</strong><span>{news.sentiment_label ?? "Sentiment indisponible"}</span></div>
            <div className="asset-news-list">
              {news.articles.slice(0, 6).map((article) => (
                <a key={article.url} href={article.url} target="_blank" rel="noreferrer">
                  <span className={`asset-news-sentiment ${article.sentiment ?? "neutral"}`} />
                  <div><strong>{article.title}</strong><p>{article.summary ?? "Consulter l'article pour lire le détail."}</p><small>{article.source} · {asDate(article.published_at)}</small></div>
                  <ExternalLink size={14} />
                </a>
              ))}
              {!news.articles.length ? <div className="analysis-empty-row">Aucune actualité disponible pour cette valeur.</div> : null}
            </div>
          </section>

          <section id="asset-risques" className="analysis-section asset-anchor">
            <div className="analysis-section-title"><ShieldCheck size={17} /><strong>Risques et documents</strong><span>Risque {risk.overall_risk_level}</span></div>
            <div className="asset-risk-overview">
              <RiskScale score={risk.risk_score} />
              <div className="asset-risk-key-data">
                <h3>Données clés</h3>
                <div><span>Confiance dans les données</span><strong>{risk.data_confidence_score}/100 · {risk.data_confidence_level}</strong></div>
                <div><span>Risques matériels détectés</span><strong>{synthesis.key_risks.length}</strong></div>
                <div><span>Passages documentaires indexés</span><strong>{rag.indexed_chunks}</strong></div>
                <div><span>Actualités analysées</span><strong>{news.articles.length}</strong></div>
              </div>
            </div>
            <div className="asset-risk-document-grid">
              <div className="analysis-risk-list">
                {synthesis.key_risks.length ? synthesis.key_risks.map((item) => (
                  <div className="analysis-risk-row" key={`${item.category}-${item.title}`}>
                    <span className={`risk-level ${item.level}`}>{item.level}</span>
                    <div><strong>{item.title}</strong><p>{item.description}</p><small>{CATEGORY_LABELS[item.category]} · impact {item.score_impact}</small></div>
                  </div>
                )) : <div className="analysis-empty-row">Aucun risque matériel dominant détecté.</div>}
              </div>
              <div className="asset-rag-list">
                {rag.passages.slice(0, 4).map((passage, index) => (
                  <article key={`${passage.url}-${index}`}>
                    <div><FileText size={14} /><strong>{passage.form ?? "Document SEC"}</strong><span>{Math.round(passage.score * 100)}%</span></div>
                    <p>{passage.text}</p>
                    <small>{passage.filing_date ?? "Date inconnue"}</small>
                  </article>
                ))}
                {!rag.passages.length ? <div className="analysis-empty-row">Aucun passage documentaire exploitable.</div> : null}
              </div>
            </div>
          </section>
        </main>

        <aside className="asset-side-column">
          <section className="analysis-section">
            <div className="analysis-section-title"><Globe2 size={17} /><strong>Société</strong></div>
            <dl className="analysis-kv-list">
              <div><dt>Secteur</dt><dd>{company.sector ?? "-"}</dd></div>
              <div><dt>Industrie</dt><dd>{company.industry ?? "-"}</dd></div>
              <div><dt>Pays</dt><dd>{company.country ?? "-"}</dd></div>
              <div><dt>Marché</dt><dd>{exchange}</dd></div>
              <div><dt>Devise</dt><dd>{currency}</dd></div>
            </dl>
            {company.website ? <a className="asset-company-link" href={company.website} target="_blank" rel="noreferrer">Site de l'entreprise <ExternalLink size={13} /></a> : null}
          </section>

          <section className="analysis-section">
            <div className="analysis-section-title"><BrainCircuit size={17} /><strong>Exécution des agents</strong></div>
            <div className="analysis-agent-trace">
              {analysis.execution_trace.map((entry) => (
                <div key={entry.agent}><CheckCircle2 size={14} /><span>{entry.agent}</span><em className={entry.status}>{STATUS_LABELS[entry.status]}</em><small>{entry.duration_ms} ms</small></div>
              ))}
            </div>
          </section>

          <section className="analysis-section">
            <div className="analysis-section-title"><AlertTriangle size={17} /><strong>Qualité des données</strong><span>{risk.data_confidence_score}/100</span></div>
            <div className="analysis-compact-list">
              {[...(market.warnings ?? []), ...(synthesis.warnings ?? [])].slice(0, 5).map((warning) => <p key={warning}>{warning}</p>)}
              {!market.warnings?.length && !synthesis.warnings?.length ? <p>Aucun avertissement majeur.</p> : null}
            </div>
          </section>
        </aside>
      </div>

      <footer className="analysis-disclaimer">Simulation analytique à but informatif. Elle ne constitue pas un conseil financier personnalisé.</footer>
    </section>
  );
}

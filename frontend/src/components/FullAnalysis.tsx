import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  Newspaper,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import { fetchFullAnalysis } from "../services/analysisApi";
import type { OrchestratedAnalysis, RiskItem } from "../types";

const RECOMMENDATION_LABELS = {
  favorable: "Favorable",
  a_surveiller: "A surveiller",
  prudence: "Prudence",
  defavorable: "Defavorable",
  donnees_insuffisantes: "Donnees insuffisantes",
};

const STATUS_LABELS = {
  success: "Valide",
  partial: "Partiel",
  failed: "Echec",
};

const CATEGORY_LABELS: Record<RiskItem["category"], string> = {
  market: "Marche",
  technical: "Technique",
  fundamental: "Fondamental",
  news: "Actualites",
  documentary: "Documents SEC",
  data_quality: "Qualite des donnees",
};

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});

function valueOrDash(value: number | null, suffix = "") {
  return value == null ? "-" : `${number.format(value)}${suffix}`;
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

export function FullAnalysis({ ticker }: { ticker: string }) {
  const [analysis, setAnalysis] = useState<OrchestratedAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(fresh = false) {
    setLoading(true);
    setError(null);
    try {
      setAnalysis(await fetchFullAnalysis(ticker, fresh));
    } catch {
      setError("L'analyse multi-agents est indisponible. Verifiez les services MCP, AI Backend et Gateway.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, [ticker]);

  if (!analysis && loading) {
    return (
      <section className="full-analysis-page analysis-state-page">
        <BrainCircuit size={28} className="spin" />
        <strong>Analyse de {ticker} en cours</strong>
        <span>Collecte marche, actualites et documents, puis calcul technique, risque et synthese.</span>
      </section>
    );
  }

  if (!analysis) {
    return (
      <section className="full-analysis-page analysis-state-page">
        <AlertTriangle size={28} />
        <strong>Analyse indisponible</strong>
        <span>{error}</span>
        <button type="button" onClick={() => void load(true)}>Reessayer</button>
      </section>
    );
  }

  const { synthesis, market_data: market, technical, news, rag, risk } = analysis;
  const company = market.company_profile;

  return (
    <section className="full-analysis-page">
      <header className="analysis-header">
        <div className="analysis-identity">
          <div className="analysis-symbol">{analysis.ticker}</div>
          <div>
            <h2>{company.name ?? analysis.ticker}</h2>
            <p>{company.sector ?? "Secteur non renseigne"} - {company.industry ?? "Industrie non renseignee"}</p>
          </div>
        </div>
        <div className="analysis-market-snapshot">
          <strong>{valueOrDash(market.price, " USD")}</strong>
          <span className={(market.change_percent ?? 0) >= 0 ? "positive" : "negative"}>
            {(market.change_percent ?? 0) >= 0 ? "+" : ""}{valueOrDash(market.change_percent, "%")}
          </span>
          <span>{company.market_cap ? compactMoney.format(company.market_cap) : "Capitalisation -"}</span>
        </div>
        <button className="analysis-refresh" type="button" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          Actualiser
        </button>
      </header>

      {error ? <div className="analysis-inline-warning">{error}</div> : null}

      <div className="analysis-score-grid">
        <ScoreCell label="Score global" value={synthesis.global_score} detail={RECOMMENDATION_LABELS[synthesis.recommendation]} />
        <ScoreCell label="Confiance" value={synthesis.confidence_score} detail={synthesis.confidence_level} />
        <ScoreCell label="Technique" value={synthesis.scores.technical} detail={technical.trend} />
        <ScoreCell label="Maitrise du risque" value={synthesis.scores.risk} detail={`risque ${risk.risk_score}/100`} />
      </div>

      <div className="analysis-workspace">
        <div className="analysis-primary-column">
          <section className="analysis-section analysis-conclusion">
            <div className="analysis-section-title">
              <BrainCircuit size={17} />
              <strong>Synthese multi-agents</strong>
              <span className={`recommendation-badge ${synthesis.recommendation}`}>
                {RECOMMENDATION_LABELS[synthesis.recommendation]}
              </span>
            </div>
            <p>{synthesis.summary}</p>
            <div className="analysis-source-line">
              <Database size={14} />
              {synthesis.sources.length ? synthesis.sources.join(" - ") : "Aucune source exploitable"}
            </div>
          </section>

          <section className="analysis-section">
            <div className="analysis-section-title"><Gauge size={17} /><strong>Signaux retenus</strong></div>
            <div className="analysis-signal-grid">
              <div>
                <h3><TrendingUp size={15} /> Points favorables</h3>
                {synthesis.strengths.length ? synthesis.strengths.map((item) => <p key={item}>{item}</p>) : <p>Aucun signal favorable dominant.</p>}
              </div>
              <div>
                <h3><TrendingDown size={15} /> Points de vigilance</h3>
                {synthesis.weaknesses.length ? synthesis.weaknesses.map((item) => <p key={item}>{item}</p>) : <p>Aucun signal negatif dominant.</p>}
              </div>
            </div>
          </section>

          <section className="analysis-section">
            <div className="analysis-section-title"><ShieldCheck size={17} /><strong>Risques principaux</strong><span>{risk.overall_risk_level}</span></div>
            <div className="analysis-risk-list">
              {synthesis.key_risks.length ? synthesis.key_risks.map((item) => (
                <div className="analysis-risk-row" key={`${item.category}-${item.title}`}>
                  <span className={`risk-level ${item.level}`}>{item.level}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <small>{CATEGORY_LABELS[item.category]} - impact {item.score_impact}</small>
                  </div>
                </div>
              )) : <div className="analysis-empty-row">Aucun risque materiel dominant detecte.</div>}
            </div>
          </section>
        </div>

        <aside className="analysis-secondary-column">
          <section className="analysis-section">
            <div className="analysis-section-title"><BarChart3 size={17} /><strong>Indicateurs techniques</strong></div>
            <dl className="analysis-kv-list">
              <div><dt>RSI 14</dt><dd>{valueOrDash(technical.rsi)}</dd></div>
              <div><dt>SMA 20</dt><dd>{valueOrDash(technical.moving_averages.sma_20)}</dd></div>
              <div><dt>SMA 50</dt><dd>{valueOrDash(technical.moving_averages.sma_50)}</dd></div>
              <div><dt>Volatilite</dt><dd>{valueOrDash(technical.volatility, "%")}</dd></div>
              <div><dt>Support</dt><dd>{valueOrDash(technical.support_level)}</dd></div>
              <div><dt>Resistance</dt><dd>{valueOrDash(technical.resistance_level)}</dd></div>
            </dl>
          </section>

          <section className="analysis-section">
            <div className="analysis-section-title"><Newspaper size={17} /><strong>Actualites</strong><span>{news.sentiment_label ?? "indisponible"}</span></div>
            <div className="analysis-compact-list">
              {news.key_events.slice(0, 3).map((event) => <p key={event}>{event}</p>)}
              {!news.key_events.length ? <p>Aucun evenement majeur extrait.</p> : null}
            </div>
          </section>

          <section className="analysis-section">
            <div className="analysis-section-title"><FileText size={17} /><strong>Documents RAG</strong><span>{rag.indexed_chunks} chunks</span></div>
            <div className="analysis-compact-list">
              {rag.passages.slice(0, 3).map((passage, index) => (
                <p key={`${passage.url}-${index}`}>
                  <strong>{passage.form ?? "SEC"} {passage.filing_date ?? ""}</strong>
                  Pertinence {Math.round(passage.score * 100)}%
                </p>
              ))}
              {!rag.passages.length ? <p>Aucun passage documentaire exploitable.</p> : null}
            </div>
          </section>

          <section className="analysis-section">
            <div className="analysis-section-title"><BrainCircuit size={17} /><strong>Execution LangGraph</strong></div>
            <div className="analysis-agent-trace">
              {analysis.execution_trace.map((entry) => (
                <div key={entry.agent}>
                  <CheckCircle2 size={14} />
                  <span>{entry.agent}</span>
                  <em className={entry.status}>{STATUS_LABELS[entry.status]}</em>
                  <small>{entry.duration_ms} ms</small>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <footer className="analysis-disclaimer">
        Simulation analytique a but informatif. Elle ne constitue pas un conseil financier personnalise.
      </footer>
    </section>
  );
}

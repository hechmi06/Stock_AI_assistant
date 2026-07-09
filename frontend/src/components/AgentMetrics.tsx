import { Activity, Bot, CheckCircle2, GaugeCircle, LineChart, Newspaper, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchAgentEvaluation, fetchNewsEvaluation, fetchRiskEvaluation, fetchTechnicalEvaluation, searchUsStocks } from "../services/analysisApi";
import type { EvaluationGrade, EvaluationReport, UsStockSymbol } from "../types";

const QUICK_TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM"];

type AgentKind = "market-data" | "technical" | "news" | "risk";

const AGENTS: Array<{ id: AgentKind; label: string; description: string }> = [
  {
    id: "market-data",
    label: "MarketDataAgent",
    description: "Agent de collecte de données de marché (prix, historique, profil, fondamentaux).",
  },
  {
    id: "technical",
    label: "TechnicalAgent",
    description: "Agent d'analyse technique (RSI, SMA, volatilité, tendance, support/résistance, volume).",
  },
  {
    id: "news",
    label: "NewsAgent",
    description: "Agent d'actualités (FMP + Yahoo RSS) avec analyse de sentiment via SLM.",
  },
  {
    id: "risk",
    label: "RiskAgent",
    description: "Agent de risque : cohérence du diagnostic, séparation risque / confiance des données, traçabilité.",
  },
];

const METRIC_LABELS: Record<string, string> = {
  agent_availability: "Disponibilité de l'agent",
  status_validity: "Validité du statut",
  source_coverage: "Couverture des sources",
  no_internal_fallback: "Absence de fallback interne",
  price_completeness: "Complétude du prix",
  historical_completeness: "Complétude de l'historique",
  company_profile_completeness: "Complétude du profil société",
  financial_ratios_completeness: "Complétude des ratios financiers",
  financial_statements_completeness: "Complétude des états financiers",
  controlled_errors: "Erreurs maîtrisées",
  slm_summary_availability: "Résumé SLM disponible",
  rsi_availability: "RSI calculé",
  moving_averages_completeness: "Moyennes mobiles (SMA 20/50)",
  volatility_availability: "Volatilité calculée",
  levels_availability: "Support / résistance",
  volume_analysis_completeness: "Analyse des volumes",
  score_and_signal_validity: "Score et signal valides",
  articles_count: "Nombre d'articles",
  articles_freshness: "Fraîcheur des articles",
  summaries_coverage: "Résumés d'articles",
  sentiment_availability: "Sentiment global disponible",
  article_sentiment_coverage: "Sentiment par article",
  key_events_detected: "Événements importants détectés",
  component_coverage: "Couverture des agents amont",
  risk_score_validity: "Score de risque cohérent",
  risk_score_purity: "Score de risque non pollué",
  confidence_score_validity: "Confiance des données cohérente",
  news_dimension_active: "Dimension news active",
  evidence_coverage: "Preuves des risques",
  risk_explainability: "Risques explicables",
  confidence_explained: "Confiance justifiée",
};

const GRADE_LABELS: Record<EvaluationGrade, string> = {
  excellent: "Excellent",
  good: "Bon",
  partial: "Partiel",
  poor: "Insuffisant",
};

function metricLabel(name: string): string {
  return METRIC_LABELS[name] ?? name;
}

export function AgentMetrics() {
  const [agent, setAgent] = useState<AgentKind>("market-data");
  const [ticker, setTicker] = useState("AAPL");
  const [tickerQuery, setTickerQuery] = useState("AAPL");
  const [suggestions, setSuggestions] = useState<UsStockSymbol[]>([]);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadEvaluation(kind: AgentKind, symbol: string) {
    setLoading(true);
    setError(null);
    try {
      const data =
        kind === "technical"
          ? await fetchTechnicalEvaluation(symbol)
          : kind === "news"
            ? await fetchNewsEvaluation(symbol)
            : kind === "risk"
              ? await fetchRiskEvaluation(symbol)
              : await fetchAgentEvaluation(symbol);
      setReport(data);
    } catch {
      setReport(null);
      setError("Impossible de récupérer l'évaluation de l'agent. Vérifiez que le backend est démarré.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEvaluation(agent, ticker);
  }, [agent, ticker]);

  useEffect(() => {
    const query = tickerQuery.trim();
    if (query.length < 1) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchUsStocks(query, 12)
        .then((result) => setSuggestions(result.symbols))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [tickerQuery]);

  const activeAgent = AGENTS.find((entry) => entry.id === agent) ?? AGENTS[0];
  const passedCount = report?.metrics.filter((metric) => metric.passed).length ?? 0;
  const totalCount = report?.metrics.length ?? 0;

  return (
    <section className="metrics-page">
      <header className="metrics-header">
        <div className="metrics-title">
          <Activity size={22} />
          <div>
            <h2>Métriques des agents</h2>
            <p>
              Évaluation qualité de <strong>{activeAgent.label}</strong> — {activeAgent.description}
            </p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void loadEvaluation(agent, ticker)}
          aria-label="Rafraîchir l'évaluation"
        >
          <RefreshCw size={17} className={loading ? "spin" : ""} />
        </button>
      </header>

      <div className="agent-tabs" role="tablist" aria-label="Choisir un agent à évaluer">
        {AGENTS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === agent}
            className={`agent-tab ${entry.id === agent ? "active" : ""}`}
            onClick={() => setAgent(entry.id)}
          >
            {entry.id === "technical" ? (
              <LineChart size={15} />
            ) : entry.id === "news" ? (
              <Newspaper size={15} />
            ) : entry.id === "risk" ? (
              <ShieldAlert size={15} />
            ) : (
              <Bot size={15} />
            )}
            {entry.label}
          </button>
        ))}
      </div>

      <div className="metrics-ticker-search">
        <input
          className="market-search"
          type="search"
          placeholder="Ticker US (ex. JPM, Apple…)"
          value={tickerQuery}
          onChange={(event) => setTickerQuery(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter" && tickerQuery.trim()) {
              setTicker(tickerQuery.trim().toUpperCase());
            }
          }}
        />
        <button type="button" className="market-search-btn" onClick={() => setTicker(tickerQuery.trim().toUpperCase())}>
          Évaluer
        </button>
      </div>

      {suggestions.length > 0 ? (
        <div className="metrics-suggestions">
          {suggestions.map((entry) => (
            <button
              key={entry.symbol}
              type="button"
              className={`ticker-chip ${entry.symbol === ticker ? "active" : ""}`}
              onClick={() => {
                setTicker(entry.symbol);
                setTickerQuery(entry.symbol);
                setSuggestions([]);
              }}
            >
              {entry.symbol}
            </button>
          ))}
        </div>
      ) : null}

      <div className="metrics-tickers" role="tablist" aria-label="Raccourcis tickers populaires">
        {QUICK_TICKERS.map((symbol) => (
          <button
            key={symbol}
            type="button"
            className={`ticker-chip ${symbol === ticker ? "active" : ""}`}
            onClick={() => {
              setTicker(symbol);
              setTickerQuery(symbol);
            }}
          >
            {symbol}
          </button>
        ))}
      </div>

      {error ? <div className="metrics-error">{error}</div> : null}

      {report ? (
        <>
          <div className="metrics-summary">
            <div className={`score-card grade-${report.grade}`}>
              <GaugeCircle size={26} />
              <div className="score-value">{report.total_score.toFixed(1)}</div>
              <div className="score-unit">/ 100</div>
            </div>
            <div className="summary-facts">
              <div className={`grade-badge grade-${report.grade}`}>{GRADE_LABELS[report.grade]}</div>
              <div className={`pass-badge ${report.passed ? "ok" : "ko"}`}>
                {report.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                {report.passed ? "Évaluation validée" : "Évaluation non validée"}
              </div>
              <div className="summary-meta">
                {passedCount}/{totalCount} métriques réussies · {report.ticker} · {activeAgent.label}
              </div>
            </div>
          </div>

          <div className="metrics-grid">
            {report.metrics.map((metric) => (
              <div className={`metric-card ${metric.passed ? "pass" : "fail"}`} key={metric.name}>
                <div className="metric-top">
                  <span className="metric-name">{metricLabel(metric.name)}</span>
                  <span className={`metric-flag ${metric.passed ? "ok" : "ko"}`}>
                    {metric.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                    {metric.passed ? "PASS" : "FAIL"}
                  </span>
                </div>
                <div className="metric-bar">
                  <div
                    className={`metric-bar-fill ${metric.passed ? "ok" : "ko"}`}
                    style={{ width: `${Math.round(metric.score * 100)}%` }}
                  />
                </div>
                <div className="metric-bottom">
                  <span className="metric-score">{(metric.score * 100).toFixed(0)}%</span>
                  <span className="metric-message">{metric.message}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        !error && <div className="metrics-loading">Chargement de l'évaluation…</div>
      )}
    </section>
  );
}

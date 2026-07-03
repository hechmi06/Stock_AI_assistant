import { Activity, CheckCircle2, GaugeCircle, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchAgentEvaluation } from "../services/analysisApi";
import type { EvaluationGrade, EvaluationReport } from "../types";

const DEMO_TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM"];

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
  const [ticker, setTicker] = useState("AAPL");
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadEvaluation(symbol: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAgentEvaluation(symbol);
      setReport(data);
    } catch {
      setReport(null);
      setError("Impossible de récupérer l'évaluation de l'agent. Vérifiez que le backend est démarré.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEvaluation(ticker);
  }, [ticker]);

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
              Page dédiée à l'évaluation qualité des agents IA. Actuellement : <strong>MarketDataAgent</strong> (agent de
              collecte de données de marché).
            </p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => void loadEvaluation(ticker)}
          aria-label="Rafraîchir l'évaluation"
        >
          <RefreshCw size={17} className={loading ? "spin" : ""} />
        </button>
      </header>

      <div className="metrics-tickers" role="tablist" aria-label="Choisir un ticker à évaluer">
        {DEMO_TICKERS.map((symbol) => (
          <button
            key={symbol}
            type="button"
            className={`ticker-chip ${symbol === ticker ? "active" : ""}`}
            onClick={() => setTicker(symbol)}
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
                {passedCount}/{totalCount} métriques réussies · {report.ticker}
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

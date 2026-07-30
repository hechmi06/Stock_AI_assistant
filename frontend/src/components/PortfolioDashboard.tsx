import {
  Activity,
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  CircleDollarSign,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { analyzeCompletePortfolio, analyzePortfolio } from "../services/analysisApi";
import type { PortfolioAnalysis, PortfolioCompleteAnalysis, PortfolioHolding, PortfolioVerdict } from "../types";
import {
  DRAFT_TTL_MS,
  PORTFOLIO_TTL_MS,
  readSnapshot,
  snapshotAgeLabel,
  writeSnapshot,
} from "../utils/persistedAnalysis";
import { PortfolioInsights } from "./PortfolioInsights";

const STORAGE_KEY = "stock-ai-portfolio-v1";
const ANALYSIS_STORAGE_KEY = "stock-ai-portfolio-analysis-v2";
const DEFAULT_HOLDINGS: PortfolioHolding[] = [
  { ticker: "AAPL", quantity: 20, average_cost: 190 },
  { ticker: "MSFT", quantity: 10, average_cost: 380 },
  { ticker: "NVDA", quantity: 15, average_cost: 125 },
];

const currencyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

type SavedPortfolio = {
  holdings: PortfolioHolding[];
  cash: number;
  benchmarkTicker: string;
  riskFreeRatePercent: number;
};

type SavedPortfolioAnalysis = {
  fingerprint: string;
  analysis: PortfolioAnalysis;
  completeAnalysis: PortfolioCompleteAnalysis | null;
};

type InitialPortfolioState = SavedPortfolio & {
  restoredAnalysis: PortfolioAnalysis | null;
  restoredCompleteAnalysis: PortfolioCompleteAnalysis | null;
  restoredSavedAt: number | null;
  restoredExpired: boolean;
};

function portfolioFingerprint(portfolio: SavedPortfolio) {
  return JSON.stringify({
    holdings: portfolio.holdings
      .filter((holding) => holding.ticker.trim() && holding.quantity > 0)
      .map((holding) => ({
        ticker: holding.ticker.trim().toUpperCase(),
        quantity: Number(holding.quantity),
        average_cost: Number(holding.average_cost),
      })),
    cash: Number(portfolio.cash),
    benchmarkTicker: portfolio.benchmarkTicker.trim().toUpperCase() || "SPY",
    riskFreeRatePercent: Number(portfolio.riskFreeRatePercent),
  });
}

function readSavedPortfolio(): SavedPortfolio {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as
      | SavedPortfolio
      | { version?: number; value?: SavedPortfolio }
      | null;
    const saved = raw && "version" in raw
      ? readSnapshot<SavedPortfolio>(STORAGE_KEY)?.value
      : raw as SavedPortfolio | null;
    if (saved?.holdings?.length) {
      return {
        holdings: saved.holdings,
        cash: Number(saved.cash) || 0,
        benchmarkTicker: saved.benchmarkTicker || "SPY",
        riskFreeRatePercent: Number.isFinite(Number(saved.riskFreeRatePercent))
          ? Number(saved.riskFreeRatePercent)
          : 4,
      };
    }
  } catch {
    // The default portfolio remains available when local storage is corrupted.
  }
  return {
    holdings: DEFAULT_HOLDINGS,
    cash: 5000,
    benchmarkTicker: "SPY",
    riskFreeRatePercent: 4,
  };
}

function readInitialPortfolioState(): InitialPortfolioState {
  const portfolio = readSavedPortfolio();
  const cached = readSnapshot<SavedPortfolioAnalysis>(ANALYSIS_STORAGE_KEY);
  const matchesCurrentPortfolio =
    cached?.value.fingerprint === portfolioFingerprint(portfolio);
  return {
    ...portfolio,
    restoredAnalysis: matchesCurrentPortfolio ? cached?.value.analysis ?? null : null,
    restoredCompleteAnalysis: matchesCurrentPortfolio
      ? cached?.value.completeAnalysis ?? null
      : null,
    restoredSavedAt: matchesCurrentPortfolio ? cached?.savedAt ?? null : null,
    restoredExpired: matchesCurrentPortfolio ? cached?.isExpired ?? false : false,
  };
}

function formatMoney(value: number | null | undefined) {
  return value == null ? "-" : currencyFormatter.format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return "-";
  return `${value >= 0 ? "+" : ""}${numberFormatter.format(value)}%`;
}

function riskLabel(value: string) {
  if (value === "high") return "Eleve";
  if (value === "medium") return "Moyen";
  return "Faible";
}

function verdictLabel(value: PortfolioVerdict) {
  return {
    robuste: "Robuste",
    coherent: "Coherent",
    a_reequilibrer: "A reequilibrer",
    fragile: "Fragile",
    donnees_insuffisantes: "Donnees insuffisantes",
  }[value];
}

export function PortfolioDashboard({ onOpenAnalysis }: { onOpenAnalysis: (ticker: string) => void }) {
  const [initial] = useState(readInitialPortfolioState);
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(initial.holdings);
  const [cash, setCash] = useState(initial.cash);
  const [benchmarkTicker, setBenchmarkTicker] = useState(initial.benchmarkTicker);
  const [riskFreeRatePercent, setRiskFreeRatePercent] = useState(initial.riskFreeRatePercent);
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(
    initial.restoredAnalysis,
  );
  const [completeAnalysis, setCompleteAnalysis] = useState<PortfolioCompleteAnalysis | null>(
    initial.restoredCompleteAnalysis,
  );
  const [savedAt, setSavedAt] = useState<number | null>(initial.restoredSavedAt);
  const [loading, setLoading] = useState(false);
  const [completeLoading, setCompleteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipInitialInvalidation = useRef(true);
  const initialized = useRef(false);

  useEffect(() => {
    writeSnapshot(
      STORAGE_KEY,
      { holdings, cash, benchmarkTicker, riskFreeRatePercent },
      DRAFT_TTL_MS,
    );
  }, [holdings, cash, benchmarkTicker, riskFreeRatePercent]);

  useEffect(() => {
    if (skipInitialInvalidation.current) {
      skipInitialInvalidation.current = false;
      return;
    }
    setCompleteAnalysis(null);
  }, [holdings, cash, benchmarkTicker, riskFreeRatePercent]);

  function snapshotPortfolio(validHoldings: PortfolioHolding[]): SavedPortfolio {
    return {
      holdings: validHoldings,
      cash: Math.max(0, cash),
      benchmarkTicker: benchmarkTicker.trim().toUpperCase() || "SPY",
      riskFreeRatePercent,
    };
  }

  function persistAnalysis(
    portfolio: SavedPortfolio,
    nextAnalysis: PortfolioAnalysis,
    nextCompleteAnalysis: PortfolioCompleteAnalysis | null,
  ) {
    const snapshot = writeSnapshot<SavedPortfolioAnalysis>(
      ANALYSIS_STORAGE_KEY,
      {
        fingerprint: portfolioFingerprint(portfolio),
        analysis: nextAnalysis,
        completeAnalysis: nextCompleteAnalysis,
      },
      PORTFOLIO_TTL_MS,
    );
    setSavedAt(snapshot?.savedAt ?? Date.now());
  }

  async function runAnalysis(fresh = false) {
    const validHoldings = holdings.filter(
      (holding) => holding.ticker.trim() && holding.quantity > 0 && holding.average_cost >= 0,
    );
    if (!validHoldings.length) {
      setError("Ajoutez au moins une position valide.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const portfolio = snapshotPortfolio(validHoldings);
      const result = await analyzePortfolio(
        validHoldings,
        portfolio.cash,
        fresh,
        portfolio.benchmarkTicker,
        portfolio.riskFreeRatePercent,
      );
      setAnalysis(result);
      setCompleteAnalysis(null);
      persistAnalysis(portfolio, result, null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analyse indisponible.");
    } finally {
      setLoading(false);
    }
  }

  async function runCompleteAnalysis(fresh = false) {
    const validHoldings = holdings.filter(
      (holding) => holding.ticker.trim() && holding.quantity > 0 && holding.average_cost >= 0,
    );
    if (!validHoldings.length) {
      setError("Ajoutez au moins une position valide.");
      return;
    }
    setCompleteLoading(true);
    setError(null);
    try {
      const portfolio = snapshotPortfolio(validHoldings);
      const result = await analyzeCompletePortfolio(
        validHoldings,
        portfolio.cash,
        fresh,
        portfolio.benchmarkTicker,
        portfolio.riskFreeRatePercent,
        true,
      );
      setCompleteAnalysis(result);
      setAnalysis(result.portfolio);
      persistAnalysis(portfolio, result.portfolio, result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analyse complete indisponible.");
    } finally {
      setCompleteLoading(false);
    }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (initial.restoredAnalysis && !initial.restoredExpired) return;
    if (initial.restoredExpired && initial.restoredCompleteAnalysis) {
      void runCompleteAnalysis(true);
    } else {
      void runAnalysis(initial.restoredExpired);
    }
    // Restore a fresh snapshot; only expired or missing data triggers a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!savedAt) return;
    const remaining = savedAt + PORTFOLIO_TTL_MS - Date.now();
    const timer = window.setTimeout(() => {
      if (completeAnalysis) {
        void runCompleteAnalysis(true);
      } else {
        void runAnalysis(true);
      }
    }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
    // New results update savedAt and replace this timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeAnalysis, savedAt]);

  function updateHolding(index: number, field: keyof PortfolioHolding, value: string) {
    setHoldings((current) =>
      current.map((holding, holdingIndex) => {
        if (holdingIndex !== index) return holding;
        if (field === "ticker") return { ...holding, ticker: value.toUpperCase().replace(/[^A-Z0-9.\-]/g, "") };
        return { ...holding, [field]: Number(value) || 0 };
      }),
    );
  }

  function addHolding() {
    setHoldings((current) => [...current, { ticker: "", quantity: 1, average_cost: 0 }]);
  }

  function removeHolding(index: number) {
    setHoldings((current) => current.filter((_, holdingIndex) => holdingIndex !== index));
  }

  const summary = analysis?.summary;
  const pnlPositive = (summary?.unrealized_pnl ?? 0) >= 0;

  return (
    <section className="portfolio-workspace">
      <header className="portfolio-page-head">
        <div>
          <span className="portfolio-eyebrow">PortfolioAgent</span>
          <h2>Portefeuille d&apos;actions</h2>
          <p>Valorisation, performance et exposition consolidees.</p>
        </div>
        <div className="portfolio-head-actions">
          <label className="portfolio-cash-input">
            <span>Liquidites USD</span>
            <input
              type="number"
              min="0"
              step="100"
              value={cash}
              onChange={(event) => setCash(Number(event.target.value) || 0)}
            />
          </label>
          <label className="portfolio-method-input">
            <span>Benchmark</span>
            <input
              value={benchmarkTicker}
              maxLength={15}
              onChange={(event) => setBenchmarkTicker(event.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, ""))}
            />
          </label>
          <label className="portfolio-method-input">
            <span>Taux sans risque</span>
            <div><input type="number" step="0.1" value={riskFreeRatePercent} onChange={(event) => setRiskFreeRatePercent(Number(event.target.value) || 0)} /><em>%</em></div>
          </label>
          <span className={`analysis-freshness ${loading || completeLoading ? "refreshing" : ""}`}>
            {loading || completeLoading ? "Actualisation en cours" : snapshotAgeLabel(savedAt)}
          </span>
          <button className="portfolio-refresh" type="button" onClick={() => void runAnalysis(true)} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            {loading ? "Valorisation..." : "Actualiser"}
          </button>
        </div>
      </header>

      {error ? <div className="portfolio-error"><AlertTriangle size={16} /> {error}</div> : null}

      <div className="portfolio-summary-band">
        <div>
          <span>Valeur totale</span>
          <strong>{formatMoney(summary?.total_value)}</strong>
          <small>{analysis?.positions.length ?? 0} positions valorisees</small>
        </div>
        <div>
          <span>P&amp;L latent</span>
          <strong className={pnlPositive ? "positive" : "negative"}>{formatMoney(summary?.unrealized_pnl)}</strong>
          <small className={pnlPositive ? "positive" : "negative"}>{formatPercent(summary?.unrealized_pnl_percent)}</small>
        </div>
        <div>
          <span>Variation du jour</span>
          <strong className={(summary?.day_pnl ?? 0) >= 0 ? "positive" : "negative"}>{formatMoney(summary?.day_pnl)}</strong>
          <small>{formatPercent(summary?.day_change_percent)}</small>
        </div>
        <div>
          <span>Confiance donnees</span>
          <strong>{analysis?.risk.data_confidence_score ?? 0}/100</strong>
          <small>{riskLabel(analysis?.risk.data_confidence_level ?? "low")}</small>
        </div>
      </div>

      {completeAnalysis ? (
        <section className={`portfolio-verdict-section verdict-${completeAnalysis.synthesis.verdict}`}>
          <div className="portfolio-verdict-main">
            <div className="portfolio-section-head">
              <div><BrainCircuit size={18} /><strong>Analyse complete du portefeuille</strong></div>
              <span>PortfolioSynthesisAgent · SLM independant</span>
            </div>
            <div className="portfolio-verdict-copy">
              <div className="portfolio-verdict-score">
                <span>{verdictLabel(completeAnalysis.synthesis.verdict)}</span>
                <strong>{completeAnalysis.synthesis.global_score}/100</strong>
                <small>Score global d'analyse</small>
              </div>
              <div>
                <p>{completeAnalysis.synthesis.summary}</p>
                <div className="portfolio-confidence-breakdown">
                  <span>Donnees <strong>{completeAnalysis.synthesis.data_confidence_score ?? completeAnalysis.synthesis.confidence_score}/100</strong></span>
                  <span>Modele <strong>{completeAnalysis.synthesis.model_confidence_score ?? completeAnalysis.synthesis.confidence_score}/100</strong></span>
                  <span>Decision <strong>{completeAnalysis.synthesis.decision_confidence_score ?? completeAnalysis.synthesis.confidence_score}/100</strong></span>
                </div>
                <small>
                  {completeAnalysis.synthesis.analyzed_positions}/{completeAnalysis.synthesis.requested_positions} actions analysees · recommandation simulee
                </small>
              </div>
            </div>
            <div className="portfolio-synthesis-signals">
              <div>
                <strong>Points favorables</strong>
                {(completeAnalysis.synthesis.strengths.length ? completeAnalysis.synthesis.strengths : ["Aucun avantage suffisamment documente."]).map((item) => <p key={item}>{item}</p>)}
              </div>
              <div>
                <strong>Points de vigilance</strong>
                {(completeAnalysis.synthesis.weaknesses.length ? completeAnalysis.synthesis.weaknesses : ["Aucun risque majeur detecte dans les donnees disponibles."]).map((item) => <p key={item}>{item}</p>)}
              </div>
            </div>
          </div>
          <div className="portfolio-component-scores">
            {Object.entries({
              "Qualite des actions": completeAnalysis.synthesis.scores.individual_quality,
              Diversification: completeAnalysis.synthesis.scores.diversification,
              "Performance / risque": completeAnalysis.synthesis.scores.risk_adjusted_performance,
              "Alignement technique": completeAnalysis.synthesis.scores.technical_alignment,
              "Qualite des donnees": completeAnalysis.synthesis.scores.data_quality,
            }).map(([label, value]) => (
              <div key={label}>
                <span>{label}</span><strong>{value}/100</strong>
                <div><i style={{ width: `${value}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="portfolio-analysis-invitation">
          <BrainCircuit size={20} />
          <div><strong>Analyse multi-agents non lancee</strong><span>Le calcul rapide ci-dessous ne remplace pas le verdict global.</span></div>
          <button type="button" onClick={() => void runCompleteAnalysis(false)} disabled={completeLoading}>
            <Sparkles size={16} /> {completeLoading ? "Analyse en cours..." : "Lancer l'analyse complete"}
          </button>
        </section>
      )}

      <section className="portfolio-analytics-section">
        <div className="portfolio-section-head">
          <div><BarChart3 size={17} /><strong>Performance ajustee du risque</strong></div>
          <span>
            {analysis?.performance.observation_count ?? 0} seances · benchmark {analysis?.performance.benchmark_ticker ?? benchmarkTicker}
          </span>
        </div>
        <div className="portfolio-metric-grid">
          <div><span>Rendement cumule</span><strong>{formatPercent(analysis?.performance.cumulative_return_percent)}</strong><small>Portefeuille</small></div>
          <div><span>Rendement annualise</span><strong>{formatPercent(analysis?.performance.annualized_return_percent)}</strong><small>Moyenne journaliere × 252</small></div>
          <div><span>Volatilite annualisee</span><strong>{formatPercent(analysis?.performance.annualized_volatility_percent)}</strong><small>Ecart-type × racine de 252</small></div>
          <div><span>Beta</span><strong>{analysis?.performance.beta == null ? "-" : numberFormatter.format(analysis.performance.beta)}</strong><small>vs {analysis?.performance.benchmark_ticker ?? benchmarkTicker}</small></div>
          <div><span>Sharpe</span><strong>{analysis?.performance.sharpe_ratio == null ? "-" : numberFormatter.format(analysis.performance.sharpe_ratio)}</strong><small>Rendement par unite de risque</small></div>
          <div><span>Treynor</span><strong>{formatPercent(analysis?.performance.treynor_ratio_percent)}</strong><small>Rendement par unite de beta</small></div>
          <div><span>Alpha de Jensen</span><strong>{formatPercent(analysis?.performance.jensen_alpha_percent)}</strong><small>Surperformance ajustee</small></div>
          <div><span>Drawdown maximal</span><strong className="negative">{formatPercent(analysis?.performance.max_drawdown_percent)}</strong><small>Perte depuis un sommet</small></div>
        </div>
        <div className="portfolio-analysis-footer">
          <div>
            <Activity size={16} />
            <span>Score technique pondere</span>
            <strong>{analysis?.technical_summary.weighted_score == null ? "-" : `${numberFormatter.format(analysis.technical_summary.weighted_score)}/100`}</strong>
            <small>{analysis?.technical_summary.bullish_positions ?? 0} haussier · {analysis?.technical_summary.neutral_positions ?? 0} neutre · {analysis?.technical_summary.bearish_positions ?? 0} baissier</small>
          </div>
          <div>
            <span>Correlation moyenne</span>
            <strong>{analysis?.performance.average_correlation == null ? "-" : numberFormatter.format(analysis.performance.average_correlation)}</strong>
            <small>{analysis?.correlations.length ?? 0} paires mesurees</small>
          </div>
          <div className="portfolio-correlation-list">
            {(analysis?.correlations ?? []).slice(0, 4).map((item) => (
              <span key={`${item.ticker_a}-${item.ticker_b}`}>
                {item.ticker_a}/{item.ticker_b} <strong>{numberFormatter.format(item.correlation)}</strong>
              </span>
            ))}
          </div>
        </div>
      </section>

      {analysis ? (
        <PortfolioInsights
          analysis={analysis}
          individualAnalyses={completeAnalysis?.individual_analyses}
          onOpenAnalysis={onOpenAnalysis}
          title="Analyse financiere du portefeuille"
        />
      ) : null}

      <div className="portfolio-desktop-grid">
        <section className="portfolio-editor-section">
          <div className="portfolio-section-head">
            <div><BriefcaseBusiness size={17} /><strong>Composition</strong></div>
            <button type="button" onClick={addHolding}><Plus size={15} /> Ajouter</button>
          </div>
          <div className="portfolio-input-table">
            <div className="portfolio-input-row portfolio-input-header">
              <span>Action</span><span>Quantite</span><span>Prix moyen</span><span />
            </div>
            {holdings.map((holding, index) => (
              <div className="portfolio-input-row" key={`holding-${index}`}>
                <input
                  aria-label={`Ticker position ${index + 1}`}
                  value={holding.ticker}
                  placeholder="AAPL"
                  maxLength={15}
                  onChange={(event) => updateHolding(index, "ticker", event.target.value)}
                />
                <input
                  aria-label={`Quantite ${holding.ticker || index + 1}`}
                  type="number"
                  min="0.000001"
                  step="1"
                  value={holding.quantity}
                  onChange={(event) => updateHolding(index, "quantity", event.target.value)}
                />
                <input
                  aria-label={`Prix moyen ${holding.ticker || index + 1}`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={holding.average_cost}
                  onChange={(event) => updateHolding(index, "average_cost", event.target.value)}
                />
                <button className="portfolio-delete" type="button" title="Supprimer" onClick={() => removeHolding(index)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button className="portfolio-calculate" type="button" onClick={() => void runAnalysis(false)} disabled={loading || completeLoading}>
            <CircleDollarSign size={17} /> Recalculer le portefeuille
          </button>
          <button className="portfolio-complete-analysis" type="button" onClick={() => void runCompleteAnalysis(false)} disabled={loading || completeLoading}>
            <BrainCircuit size={17} /> {completeLoading ? "Agents en cours..." : "Analyser la combinaison"}
          </button>
        </section>

        <section className="portfolio-allocation-section">
          <div className="portfolio-section-head">
            <div><ShieldCheck size={17} /><strong>Allocation sectorielle</strong></div>
          </div>
          <div className="portfolio-allocation-list">
            {(analysis?.allocation_by_sector ?? []).map((allocation, index) => (
              <div className="portfolio-allocation-row" key={allocation.label}>
                <div><span>{allocation.label}</span><strong>{numberFormatter.format(allocation.weight)}%</strong></div>
                <div className="portfolio-allocation-track">
                  <span style={{ width: `${Math.min(100, allocation.weight)}%`, background: `var(--portfolio-color-${(index % 5) + 1})` }} />
                </div>
                <small>{formatMoney(allocation.value)}</small>
              </div>
            ))}
          </div>
          <div className="portfolio-risk-grid">
            <div><span>Concentration</span><strong>{analysis?.risk.concentration_score ?? 0}/100</strong><small>{riskLabel(analysis?.risk.concentration_level ?? "low")}</small></div>
            <div><span>Diversification</span><strong>{analysis?.risk.diversification_score ?? 0}/100</strong><small>{riskLabel(analysis?.risk.diversification_level ?? "low")}</small></div>
            <div><span>Premiere ligne</span><strong>{analysis?.risk.largest_position_ticker ?? "-"}</strong><small>{numberFormatter.format(analysis?.risk.largest_position_weight ?? 0)}%</small></div>
          </div>
        </section>
      </div>

      {completeAnalysis ? (
        <section className="portfolio-rebalancing-section">
          <div className="portfolio-section-head">
            <div><Sparkles size={17} /><strong>Plan de reequilibrage simule</strong></div>
            <span>Poids actuels vs poids cibles</span>
          </div>
          <div className="portfolio-rebalancing-table">
            <div className="portfolio-rebalancing-row portfolio-rebalancing-header">
              <span>Position</span><span>Actuel</span><span>Cible</span><span>Ecart</span><span>Decision analytique</span><span>Justification</span>
            </div>
            {completeAnalysis.synthesis.rebalancing_plan.map((item) => (
              <div className="portfolio-rebalancing-row" key={item.label}>
                <strong>{item.label}</strong>
                <span>{numberFormatter.format(item.current_weight)}%</span>
                <span>{numberFormatter.format(item.target_weight)}%</span>
                <span className={item.change_percent >= 0 ? "positive" : "negative"}>{item.change_percent >= 0 ? "+" : ""}{numberFormatter.format(item.change_percent)}%</span>
                <span className={`portfolio-decision decision-${item.action}`}>{item.action.replace(/_/g, " ")}</span>
                <small>{item.rationale}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="portfolio-positions-section">
        <div className="portfolio-section-head">
          <div><BriefcaseBusiness size={17} /><strong>Positions valorisees</strong></div>
          <span>{analysis?.sources_used.join(" · ") || "En attente des sources"}</span>
        </div>
        <div className="portfolio-results-table">
          <div className="portfolio-result-row portfolio-result-header">
            <span>Titre</span><span>Cours</span><span>Valeur</span><span>Poids</span><span>P&amp;L latent</span><span>RSI / moyennes</span><span>Technique</span><span>Jour</span>
          </div>
          {(analysis?.positions ?? []).map((position) => (
            <button className="portfolio-result-row" type="button" key={position.ticker} onClick={() => onOpenAnalysis(position.ticker)}>
              <span className="portfolio-result-name"><strong>{position.ticker}</strong><small>{position.name ?? position.sector}</small></span>
              <span>{formatMoney(position.current_price)}</span>
              <span>{formatMoney(position.market_value)}</span>
              <span>{numberFormatter.format(position.weight)}%</span>
              <span className={(position.unrealized_pnl ?? 0) >= 0 ? "positive" : "negative"}>{formatMoney(position.unrealized_pnl)}<small>{formatPercent(position.unrealized_pnl_percent)}</small></span>
              <span>{position.technical.rsi == null ? "-" : numberFormatter.format(position.technical.rsi)}<small>SMA20 {position.technical.sma_20 == null ? "-" : numberFormatter.format(position.technical.sma_20)} · SMA50 {position.technical.sma_50 == null ? "-" : numberFormatter.format(position.technical.sma_50)}</small></span>
              <span>{position.technical.technical_score == null ? "-" : `${position.technical.technical_score}/100`}<small>{position.technical.trend} · {position.technical.signal}</small></span>
              <span className={(position.day_pnl ?? 0) >= 0 ? "positive" : "negative"}>{formatMoney(position.day_pnl)}<small>{formatPercent(position.day_change_percent)}</small></span>
            </button>
          ))}
        </div>
      </section>

      {analysis?.warnings.length ? (
        <details className="portfolio-warnings">
          <summary><AlertTriangle size={15} /> {analysis.warnings.length} avertissement(s) de donnees</summary>
          {analysis.warnings.slice(0, 8).map((warning) => <p key={warning}>{warning}</p>)}
        </details>
      ) : null}
    </section>
  );
}

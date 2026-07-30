import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Gauge,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { recommendPortfolio } from "../services/analysisApi";
import type {
  InvestmentObjective,
  InvestorRiskProfile,
  PortfolioRecommendation as PortfolioRecommendationResult,
  PortfolioRecommendationRequest,
} from "../types";
import {
  DRAFT_TTL_MS,
  readSnapshot,
  RECOMMENDATION_TTL_MS,
  removeSnapshot,
  snapshotAgeLabel,
  writeSnapshot,
} from "../utils/persistedAnalysis";
import { PortfolioInsights } from "./PortfolioInsights";

const RECOMMENDATION_STORAGE_KEY = "stock-ai-recommendation-analysis-v2";
const RECOMMENDATION_DRAFT_KEY = "stock-ai-recommendation-draft-v2";

const money = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

const PROFILE_LABELS: Record<InvestorRiskProfile, string> = {
  conservative: "Prudent",
  moderate: "Modere",
  dynamic: "Dynamique",
};
const OBJECTIVE_LABELS: Record<InvestmentObjective, string> = {
  preservation: "Preservation",
  balanced: "Equilibre",
  growth: "Croissance",
};

const DEFAULT_REQUEST: PortfolioRecommendationRequest = {
  budget: 25_000,
  risk_profile: "moderate",
  objective: "balanced",
  horizon_years: 5,
  max_positions: 5,
  cash_reserve_percent: null,
  benchmark_ticker: "SPY",
  risk_free_rate_percent: 4,
  base_currency: "USD",
  excluded_tickers: [],
};

type RecommendationSession = {
  request: PortfolioRecommendationRequest;
  withSlm: boolean;
  result: PortfolioRecommendationResult;
};

type RecommendationDraft = {
  request: PortfolioRecommendationRequest;
  withSlm: boolean;
};

function recommendationFingerprint(
  request: PortfolioRecommendationRequest,
  withSlm: boolean,
) {
  return JSON.stringify({
    ...request,
    excluded_tickers: [...request.excluded_tickers].sort(),
    withSlm,
  });
}

function readInitialRecommendation() {
  const draft = readSnapshot<RecommendationDraft>(RECOMMENDATION_DRAFT_KEY)?.value;
  const cached = readSnapshot<RecommendationSession>(RECOMMENDATION_STORAGE_KEY);
  const request = draft?.request ?? cached?.value.request ?? DEFAULT_REQUEST;
  const withSlm = draft?.withSlm ?? cached?.value.withSlm ?? true;
  const cacheMatches =
    cached
    && recommendationFingerprint(cached.value.request, cached.value.withSlm)
      === recommendationFingerprint(request, withSlm);
  return {
    request,
    withSlm,
    cached: cacheMatches ? cached : null,
  };
}

const POTENTIAL_LABELS: Record<string, string> = {
  "Tres eleve": "Très élevé",
  Eleve: "Élevé",
  Modere: "Modéré",
  Faible: "Faible",
};
const POTENTIAL_CLASS: Record<string, string> = {
  "Tres eleve": "potential-top",
  Eleve: "potential-high",
  Modere: "potential-mid",
  Faible: "potential-low",
};
function potentialDisplay(value: string | null | undefined) {
  return value ? POTENTIAL_LABELS[value] ?? value : "-";
}

function percent(value: number | null | undefined) {
  return value == null ? "-" : `${value >= 0 ? "+" : ""}${number.format(value)}%`;
}

function verdictLabel(value: string | undefined) {
  return {
    robuste: "Robuste",
    coherent: "Coherent",
    a_reequilibrer: "A reequilibrer",
    fragile: "Fragile",
    donnees_insuffisantes: "Donnees insuffisantes",
  }[value ?? ""] ?? "En attente";
}

function recommendationLabel(value: string) {
  return {
    favorable: "Favorable",
    a_surveiller: "A surveiller",
    prudence: "Prudence",
    defavorable: "Defavorable",
    donnees_insuffisantes: "Donnees insuffisantes",
  }[value] ?? value;
}

export function PortfolioRecommendation({ onOpenAnalysis }: { onOpenAnalysis: (ticker: string) => void }) {
  const [initial] = useState(readInitialRecommendation);
  const [budget, setBudget] = useState(initial.request.budget);
  const [riskProfile, setRiskProfile] = useState<InvestorRiskProfile>(initial.request.risk_profile);
  const [objective, setObjective] = useState<InvestmentObjective>(initial.request.objective);
  const [horizonYears, setHorizonYears] = useState(initial.request.horizon_years);
  const [maxPositions, setMaxPositions] = useState(initial.request.max_positions);
  const [cashReserve, setCashReserve] = useState<string>(
    initial.request.cash_reserve_percent == null
      ? ""
      : String(initial.request.cash_reserve_percent),
  );
  const [benchmark, setBenchmark] = useState(initial.request.benchmark_ticker);
  const [riskFreeRate, setRiskFreeRate] = useState(initial.request.risk_free_rate_percent);
  const [excludedTickers, setExcludedTickers] = useState(
    initial.request.excluded_tickers.join(", "),
  );
  const [withSlm, setWithSlm] = useState(initial.withSlm);
  const [result, setResult] = useState<PortfolioRecommendationResult | null>(
    initial.cached?.value.result ?? null,
  );
  const [selectedRecommendedTicker, setSelectedRecommendedTicker] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(
    initial.cached?.savedAt ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insightsRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const skipInitialDraftEffect = useRef(true);

  const selectedTickers = useMemo(
    () => new Set(result?.allocations.map((item) => item.ticker) ?? []),
    [result],
  );
  const request = useMemo<PortfolioRecommendationRequest>(() => ({
    budget,
    risk_profile: riskProfile,
    objective,
    horizon_years: Math.max(1, Math.min(30, horizonYears)),
    max_positions: Math.max(3, Math.min(8, maxPositions)),
    cash_reserve_percent: cashReserve.trim() === ""
      ? null
      : Math.max(0, Math.min(50, Number(cashReserve))),
    benchmark_ticker: benchmark.trim().toUpperCase() || "SPY",
    risk_free_rate_percent: riskFreeRate,
    base_currency: "USD",
    excluded_tickers: excludedTickers
      .split(/[,;\s]+/)
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean),
  }), [
    benchmark,
    budget,
    cashReserve,
    excludedTickers,
    horizonYears,
    maxPositions,
    objective,
    riskFreeRate,
    riskProfile,
  ]);

  useEffect(() => {
    const firstTicker = result?.allocations[0]?.ticker ?? "";
    if (!result?.allocations.some((item) => item.ticker === selectedRecommendedTicker)) {
      setSelectedRecommendedTicker(firstTicker);
    }
  }, [result, selectedRecommendedTicker]);

  useEffect(() => {
    writeSnapshot<RecommendationDraft>(
      RECOMMENDATION_DRAFT_KEY,
      { request, withSlm },
      DRAFT_TTL_MS,
    );
    if (skipInitialDraftEffect.current) {
      skipInitialDraftEffect.current = false;
      return;
    }
    if (
      result
      && recommendationFingerprint(result.profile, withSlm)
        !== recommendationFingerprint(request, withSlm)
    ) {
      setResult(null);
      setSavedAt(null);
      removeSnapshot(RECOMMENDATION_STORAGE_KEY);
    }
  }, [request, result, withSlm]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (initial.cached?.isExpired) {
      void generate(true);
    }
    // A fresh matching recommendation is restored without another API call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!savedAt || !result) return;
    const remaining = savedAt + RECOMMENDATION_TTL_MS - Date.now();
    const timer = window.setTimeout(
      () => void generate(true),
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
    // New recommendations update savedAt and replace this timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, savedAt]);

  function selectRecommendedPosition(ticker: string) {
    setSelectedRecommendedTicker(ticker);
    requestAnimationFrame(() => {
      insightsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function generate(fresh = false) {
    if (request.budget <= 0) {
      setError("Le budget doit etre superieur a zero.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextResult = await recommendPortfolio(request, fresh, withSlm);
      setResult(nextResult);
      const snapshot = writeSnapshot<RecommendationSession>(
        RECOMMENDATION_STORAGE_KEY,
        { request, withSlm, result: nextResult },
        RECOMMENDATION_TTL_MS,
      );
      setSavedAt(snapshot?.savedAt ?? Date.now());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recommandation indisponible.");
    } finally {
      setLoading(false);
    }
  }

  const synthesis = result?.portfolio_analysis?.synthesis;
  const performance = result?.portfolio_analysis?.portfolio.performance;

  return (
    <section className="recommendation-workspace">
      <header className="recommendation-head">
        <div>
          <span>PortfolioRecommendationAgent</span>
          <h2>Portefeuille recommande</h2>
          <p>Composition simulee selon votre profil et les analyses multi-agents.</p>
        </div>
        {result ? (
          <div className="recommendation-head-actions">
            <span className={`analysis-freshness ${loading ? "refreshing" : ""}`}>
              {loading ? "Actualisation en cours" : snapshotAgeLabel(savedAt)}
            </span>
            <button type="button" onClick={() => void generate(true)} disabled={loading} title="Actualiser les sources">
              <RefreshCw size={16} className={loading ? "spin" : ""} /> Actualiser
            </button>
          </div>
        ) : null}
      </header>

      <section className="recommendation-config">
        <div className="recommendation-config-row">
          <label>
            <span><WalletCards size={14} /> Budget USD</span>
            <input type="number" min="100" step="500" value={budget} onChange={(event) => setBudget(Number(event.target.value) || 0)} />
          </label>
          <fieldset>
            <legend><Gauge size={14} /> Profil de risque</legend>
            <div className="recommendation-segmented">
              {(Object.keys(PROFILE_LABELS) as InvestorRiskProfile[]).map((profile) => (
                <button className={riskProfile === profile ? "selected" : ""} type="button" key={profile} onClick={() => setRiskProfile(profile)}>
                  {PROFILE_LABELS[profile]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend><Target size={14} /> Objectif</legend>
            <div className="recommendation-segmented">
              {(Object.keys(OBJECTIVE_LABELS) as InvestmentObjective[]).map((item) => (
                <button className={objective === item ? "selected" : ""} type="button" key={item} onClick={() => setObjective(item)}>
                  {OBJECTIVE_LABELS[item]}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="recommendation-config-row secondary">
          <label><span><Clock3 size={14} /> Horizon</span><div><input type="number" min="1" max="30" value={horizonYears} onChange={(event) => setHorizonYears(Number(event.target.value) || 1)} /><em>ans</em></div></label>
          <label><span><Layers3 size={14} /> Positions</span><input type="number" min="3" max="8" value={maxPositions} onChange={(event) => setMaxPositions(Number(event.target.value) || 3)} /></label>
          <label><span>Liquidites cible</span><div><input type="number" min="0" max="50" placeholder="Auto" value={cashReserve} onChange={(event) => setCashReserve(event.target.value)} /><em>%</em></div></label>
          <label><span>Benchmark</span><input value={benchmark} maxLength={15} onChange={(event) => setBenchmark(event.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, ""))} /></label>
          <label><span>Taux sans risque</span><div><input type="number" step="0.1" value={riskFreeRate} onChange={(event) => setRiskFreeRate(Number(event.target.value) || 0)} /><em>%</em></div></label>
          <label className="recommendation-exclusions"><span>Exclusions</span><input placeholder="TSLA, XOM" value={excludedTickers} onChange={(event) => setExcludedTickers(event.target.value.toUpperCase())} /></label>
        </div>
        <div className="recommendation-runbar">
          <div><span>Argumentaire SLM</span><button type="button" role="switch" aria-checked={withSlm} className={withSlm ? "enabled" : ""} onClick={() => setWithSlm((value) => !value)}><i /></button></div>
          <button className="recommendation-generate" type="button" onClick={() => void generate(false)} disabled={loading}>
            <Sparkles size={17} /> {loading ? "Analyse des entreprises en cours..." : "Generer le portefeuille"}
          </button>
        </div>
      </section>

      {error ? <div className="recommendation-error"><AlertTriangle size={16} /> {error}</div> : null}

      {!result && !loading ? (
        <div className="recommendation-empty">
          <BrainCircuit size={26} />
          <strong>Aucune recommandation generee</strong>
          <span>Univers d'actions americaines screene dynamiquement selon votre profil.</span>
        </div>
      ) : null}

      {loading ? (
        <div className="recommendation-loading">
          <RefreshCw size={22} className="spin" />
          <strong>Screening, analyse multi-agents et composition</strong>
          <span>Les actualites et les documents financiers des finalistes sont egalement controles.</span>
        </div>
      ) : null}

      {result?.status === "failed" ? (
        <>
          <section className="recommendation-blocked">
            <AlertTriangle size={20} />
            <div>
              <strong>Aucune recommandation suffisamment fiable</strong>
              {result.errors.map((item) => <p key={item}>{item}</p>)}
              <small>Methode {result.methodology_version ?? "non communiquee"} · {result.validation_rounds ?? 0} tour(s) de validation</small>
            </div>
          </section>
          <details className="recommendation-candidates">
            <summary><Layers3 size={15} /> Diagnostic des {result.candidates.length} entreprises</summary>
            <div className="recommendation-candidate-grid">
              {result.candidates.map((candidate) => (
                <div key={candidate.ticker}>
                  <span><strong>{candidate.ticker}</strong><em>{candidate.data_quality_score}/100</em></span>
                  <small>{candidate.sector} · Selection {candidate.total_score}/100 · Donnees {candidate.data_quality_score}/100</small>
                  <p>{candidate.rejection_reason || (candidate.quality_issues ?? []).join(" · ")}</p>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : result ? (
        <>
          <section className="recommendation-verdict">
            <div className="recommendation-verdict-score">
              <span>{verdictLabel(synthesis?.verdict)}</span>
              <strong>{synthesis?.global_score ?? 0}/100</strong>
              <small>Score global d'analyse</small>
            </div>
            <div className="recommendation-summary">
              <div><BrainCircuit size={17} /><strong>Argumentaire</strong><span>{result.slm_summary ? `${result.slm_summary.provider} · ${result.slm_summary.model}` : "Synthese deterministe"}</span></div>
              <p>{result.summary}</p>
              <div className="portfolio-confidence-breakdown">
                <span>Donnees <strong>{synthesis?.data_confidence_score ?? synthesis?.confidence_score ?? 0}/100</strong></span>
                <span>Modele <strong>{synthesis?.model_confidence_score ?? synthesis?.confidence_score ?? 0}/100</strong></span>
                <span>Decision <strong>{synthesis?.decision_confidence_score ?? synthesis?.confidence_score ?? 0}/100</strong></span>
              </div>
            </div>
            <div className="recommendation-kpis">
              <div><span>Rendement annualise</span><strong>{percent(performance?.annualized_return_percent)}</strong></div>
              <div><span>Volatilite</span><strong>{percent(performance?.annualized_volatility_percent)}</strong></div>
              <div><span>Sharpe</span><strong>{performance?.sharpe_ratio == null ? "-" : number.format(performance.sharpe_ratio)}</strong></div>
              <div><span>Liquidites</span><strong>{number.format(result.cash_weight)}%</strong></div>
            </div>
          </section>

          <section className="recommendation-allocation-section">
            <div className="recommendation-section-head">
              <div><WalletCards size={17} /><strong>Composition proposee</strong></div>
              <span>{money.format(result.profile.budget)} · {PROFILE_LABELS[result.profile.risk_profile]} · {result.profile.horizon_years} ans</span>
            </div>
            <div className="recommendation-allocation-table">
              <div className="recommendation-allocation-row header">
                <span>Entreprise</span><span>Secteur</span><span>Poids</span><span>Montant</span><span>Quantite</span><span>Potentiel</span><span>Role et these</span>
              </div>
              {result.allocations.map((item) => (
                <button
                  type="button"
                  className={`recommendation-allocation-row ${selectedRecommendedTicker === item.ticker ? "selected" : ""}`}
                  key={item.ticker}
                  aria-pressed={selectedRecommendedTicker === item.ticker}
                  onClick={() => selectRecommendedPosition(item.ticker)}
                >
                  <span><strong>{item.ticker}</strong><small>{item.name}</small></span>
                  <span>{item.sector}</span>
                  <span><strong>{number.format(item.weight)}%</strong><i><b style={{ width: `${item.weight}%` }} /></i></span>
                  <span>{money.format(item.amount)}</span>
                  <span>{number.format(item.quantity)}</span>
                  <span className={`recommendation-potential ${POTENTIAL_CLASS[item.potential_label ?? ""] ?? ""}`}>
                    <strong>{potentialDisplay(item.potential_label)}</strong><small>{item.screening_score}/100</small>
                  </span>
                  <span><strong>{item.role}</strong><small>{item.reasons.join(" · ")}</small></span>
                </button>
              ))}
              <div className="recommendation-allocation-row cash">
                <span><strong>Liquidites</strong><small>Reserve</small></span><span>-</span><span>{number.format(result.cash_weight)}%</span><span>{money.format(result.cash_amount)}</span><span>-</span><span>-</span><span>Reserve adaptee au profil de risque.</span>
              </div>
            </div>
          </section>

          {result.portfolio_analysis ? (
            <div ref={insightsRef} className="recommendation-portfolio-insights">
              <PortfolioInsights
                analysis={result.portfolio_analysis.portfolio}
                individualAnalyses={result.portfolio_analysis.individual_analyses}
                onOpenAnalysis={onOpenAnalysis}
                selectedTicker={selectedRecommendedTicker}
                onSelectedTickerChange={setSelectedRecommendedTicker}
                title="Analyse financiere de la recommandation"
              />
            </div>
          ) : null}

          <div className="recommendation-analysis-grid">
            <section>
              <div className="recommendation-section-head"><div><CheckCircle2 size={17} /><strong>Pourquoi cette combinaison</strong></div></div>
              <div className="recommendation-points positive-points">
                {result.strengths.map((item) => <p key={item}><CheckCircle2 size={14} /> {item}</p>)}
              </div>
            </section>
            <section>
              <div className="recommendation-section-head"><div><ShieldCheck size={17} /><strong>Risques et conditions</strong></div></div>
              <div className="recommendation-points risk-points">
                {result.risks.map((item) => <p key={item}><AlertTriangle size={14} /> {item}</p>)}
              </div>
            </section>
          </div>

          <details className="recommendation-validation">
            <summary>
              <ShieldCheck size={15} />
              Validation multi-agents
              <span>Methode {result.methodology_version ?? "non communiquee"} · {result.validation_rounds ?? 0} tour(s)</span>
            </summary>
            <div className="recommendation-validation-table">
              <div className="recommendation-validation-row header">
                <span>Tour</span><span>Titre</span><span>Decision</span><span>Diagnostic</span><span>Score</span><span>Confiance</span><span>Justification</span>
              </div>
              {(result.validation_records ?? []).map((record, index) => (
                <div className={`recommendation-validation-row ${record.decision}`} key={`${record.round}-${record.ticker}-${index}`}>
                  <span>{record.round}</span>
                  <span><strong>{record.ticker}</strong></span>
                  <span>{record.decision === "accepted" ? "Valide" : "Rejete"}</span>
                  <span>{recommendationLabel(record.recommendation)}</span>
                  <span>{record.global_score}/100</span>
                  <span>{record.confidence_score}/100</span>
                  <span>{record.reasons.join(" ")}</span>
                </div>
              ))}
            </div>
          </details>

          <details className="recommendation-candidates">
            <summary><Layers3 size={15} /> Screening des {result.candidates.length} entreprises</summary>
            <div className="recommendation-candidate-grid">
              {result.candidates.map((candidate) => (
                <div className={selectedTickers.has(candidate.ticker) ? "selected" : ""} key={candidate.ticker}>
                  <span><strong>{candidate.ticker}</strong><em className={POTENTIAL_CLASS[candidate.potential_label ?? ""] ?? ""} title={`${candidate.total_score}/100`}>{potentialDisplay(candidate.potential_label)}</em></span>
                  <small>{candidate.sector} · Selection {candidate.total_score}/100 · Donnees {candidate.data_quality_score}/100</small>
                  <p>{candidate.rejection_reason || candidate.reasons.slice(0, 2).join(" · ")}</p>
                </div>
              ))}
            </div>
          </details>

          {result.warnings.length ? (
            <details className="recommendation-warnings">
              <summary><AlertTriangle size={15} /> Limites de la simulation</summary>
              {result.warnings.slice(0, 10).map((warning) => <p key={warning}>{warning}</p>)}
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

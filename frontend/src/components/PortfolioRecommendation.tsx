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
import { useMemo, useState } from "react";
import { recommendPortfolio } from "../services/analysisApi";
import type {
  InvestmentObjective,
  InvestorRiskProfile,
  PortfolioRecommendation as PortfolioRecommendationResult,
  PortfolioRecommendationRequest,
} from "../types";

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

export function PortfolioRecommendation({ onOpenAnalysis }: { onOpenAnalysis: (ticker: string) => void }) {
  const [budget, setBudget] = useState(25_000);
  const [riskProfile, setRiskProfile] = useState<InvestorRiskProfile>("moderate");
  const [objective, setObjective] = useState<InvestmentObjective>("balanced");
  const [horizonYears, setHorizonYears] = useState(5);
  const [maxPositions, setMaxPositions] = useState(5);
  const [cashReserve, setCashReserve] = useState<string>("");
  const [benchmark, setBenchmark] = useState("SPY");
  const [riskFreeRate, setRiskFreeRate] = useState(4);
  const [excludedTickers, setExcludedTickers] = useState("");
  const [withSlm, setWithSlm] = useState(true);
  const [result, setResult] = useState<PortfolioRecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTickers = useMemo(
    () => new Set(result?.allocations.map((item) => item.ticker) ?? []),
    [result],
  );

  async function generate(fresh = false) {
    if (budget <= 0) {
      setError("Le budget doit etre superieur a zero.");
      return;
    }
    const request: PortfolioRecommendationRequest = {
      budget,
      risk_profile: riskProfile,
      objective,
      horizon_years: Math.max(1, Math.min(30, horizonYears)),
      max_positions: Math.max(3, Math.min(8, maxPositions)),
      cash_reserve_percent: cashReserve.trim() === "" ? null : Math.max(0, Math.min(50, Number(cashReserve))),
      benchmark_ticker: benchmark.trim().toUpperCase() || "SPY",
      risk_free_rate_percent: riskFreeRate,
      base_currency: "USD",
      excluded_tickers: excludedTickers
        .split(/[,;\s]+/)
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    };
    setLoading(true);
    setError(null);
    try {
      setResult(await recommendPortfolio(request, fresh, withSlm));
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
          <button type="button" onClick={() => void generate(true)} disabled={loading} title="Actualiser les sources">
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Actualiser
          </button>
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

      {result ? (
        <>
          <section className="recommendation-verdict">
            <div className="recommendation-verdict-score">
              <span>{verdictLabel(synthesis?.verdict)}</span>
              <strong>{synthesis?.global_score ?? 0}/100</strong>
              <small>Confiance {synthesis?.confidence_score ?? 0}/100</small>
            </div>
            <div className="recommendation-summary">
              <div><BrainCircuit size={17} /><strong>Argumentaire</strong><span>{result.slm_summary ? `${result.slm_summary.provider} · ${result.slm_summary.model}` : "Synthese deterministe"}</span></div>
              <p>{result.summary}</p>
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
                <button type="button" className="recommendation-allocation-row" key={item.ticker} onClick={() => onOpenAnalysis(item.ticker)}>
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

          <details className="recommendation-candidates">
            <summary><Layers3 size={15} /> Screening des {result.candidates.length} entreprises</summary>
            <div className="recommendation-candidate-grid">
              {result.candidates.map((candidate) => (
                <div className={selectedTickers.has(candidate.ticker) ? "selected" : ""} key={candidate.ticker}>
                  <span><strong>{candidate.ticker}</strong><em className={POTENTIAL_CLASS[candidate.potential_label ?? ""] ?? ""} title={`${candidate.total_score}/100`}>{potentialDisplay(candidate.potential_label)}</em></span>
                  <small>{candidate.sector}</small>
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

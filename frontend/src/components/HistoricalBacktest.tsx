import { Activity, CheckCircle2, History, Layers3, Play, RefreshCw, ShieldCheck, TrendingUp, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchBacktest, fetchHistoricalReplay, fetchTechnicalCalibration } from "../services/analysisApi";
import type { BacktestResult, HistoricalReplayResult, TechnicalCalibrationResult } from "../types";

type BacktestPeriod = "2y" | "5y" | "10y";
type ValidationMode = "single" | "calibration" | "replay";

const DEFAULT_UNIVERSE = "AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,JPM,JNJ,XOM,UNH,PG,HD,CAT,COST";

const VERDICT_LABELS = {
  validated: "Validee",
  promising: "Prometteuse",
  recalibrate: "A recalibrer",
  not_validated: "Non validee",
  insufficient: "Donnees insuffisantes",
};

function percent(value: number | null | undefined) {
  return value == null ? "N/A" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function metricTone(value: number | null | undefined, inverse = false) {
  if (value == null || value === 0) return "";
  const positive = inverse ? value < 0 : value > 0;
  return positive ? "positive" : "negative";
}

function PerformanceChart({ result }: { result: BacktestResult }) {
  const width = 900;
  const height = 238;
  const padding = 24;
  const series = useMemo(() => {
    const rows = result.observations;
    if (!rows.length) return [];
    const values = rows.flatMap((row) => [
      row.cumulative_strategy_percent,
      row.cumulative_ticker_percent,
      row.cumulative_benchmark_percent,
    ]);
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);
    const span = Math.max(1, maximum - minimum);
    const point = (value: number, index: number) => {
      const x = padding + (index / Math.max(1, rows.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - minimum) / span) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    };
    return [
      { key: "strategy", label: "Strategie IA", color: "#2563eb", points: rows.map((row, index) => point(row.cumulative_strategy_percent, index)).join(" ") },
      { key: "ticker", label: result.ticker, color: "#0f9f6e", points: rows.map((row, index) => point(row.cumulative_ticker_percent, index)).join(" ") },
      { key: "benchmark", label: result.benchmark, color: "#8a94a6", points: rows.map((row, index) => point(row.cumulative_benchmark_percent, index)).join(" ") },
    ];
  }, [result]);

  return (
    <section className="backtest-chart-section">
      <header>
        <div>
          <span>Performance cumulee</span>
          <strong>Strategie vs action vs benchmark</strong>
        </div>
        <div className="backtest-legend">
          {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}
        </div>
      </header>
      <div className="backtest-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Courbes de performance du backtest">
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
            <line key={ratio} x1={padding} x2={width - padding} y1={height * ratio} y2={height * ratio} />
          ))}
          {series.map((item) => (
            <polyline key={item.key} points={item.points} fill="none" stroke={item.color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
    </section>
  );
}

export function HistoricalBacktest({ ticker }: { ticker: string }) {
  const [mode, setMode] = useState<ValidationMode>("single");
  const [symbol, setSymbol] = useState(ticker);
  const [benchmark, setBenchmark] = useState("SPY");
  const [period, setPeriod] = useState<BacktestPeriod>("5y");
  const [horizon, setHorizon] = useState(20);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionCost, setTransactionCost] = useState(5);
  const [slippage, setSlippage] = useState(5);
  const [universe, setUniverse] = useState(DEFAULT_UNIVERSE);
  const [calibration, setCalibration] = useState<TechnicalCalibrationResult | null>(null);
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [replayAsOf, setReplayAsOf] = useState(new Date().toISOString().slice(0, 16));
  const [allowReconstructedPrices, setAllowReconstructedPrices] = useState(false);
  const [replay, setReplay] = useState<HistoricalReplayResult | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);

  useEffect(() => setSymbol(ticker), [ticker]);

  async function runBacktest() {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBacktest(normalized, {
        benchmark,
        period,
        horizonDays: horizon,
        minHistory: 60,
        transactionCostBps: transactionCost,
        slippageBps: slippage,
      });
      setResult(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Backtest indisponible.");
    } finally {
      setLoading(false);
    }
  }

  async function runCalibration() {
    setCalibrationLoading(true);
    setCalibrationError(null);
    try {
      setCalibration(await fetchTechnicalCalibration({
        tickers: universe,
        benchmark,
        period,
        horizons: "5,20,60",
        transactionCostBps: transactionCost,
        slippageBps: slippage,
      }));
    } catch (requestError) {
      setCalibrationError(
        requestError instanceof Error ? requestError.message : "Calibration indisponible.",
      );
    } finally {
      setCalibrationLoading(false);
    }
  }

  async function runReplay() {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || !replayAsOf) return;
    setReplayLoading(true);
    setReplayError(null);
    try {
      setReplay(await fetchHistoricalReplay(
        normalized,
        `${replayAsOf}:59.999Z`,
        allowReconstructedPrices,
      ));
    } catch (requestError) {
      setReplayError(
        requestError instanceof Error ? requestError.message : "Replay historique indisponible.",
      );
    } finally {
      setReplayLoading(false);
    }
  }

  return (
    <section className="backtest-page">
      <header className="backtest-header">
        <div className="backtest-title">
          <Activity size={21} />
          <div>
            <h2>Validation historique</h2>
            <p>Walk-forward du TechnicalAgent, positions long/cash et comparaison au benchmark.</p>
          </div>
        </div>
        <span className="backtest-method"><ShieldCheck size={15} /> Anti-lookahead actif</span>
      </header>

      <div className="backtest-mode-tabs" role="tablist" aria-label="Mode de validation">
        <button className={mode === "single" ? "active" : ""} type="button" onClick={() => setMode("single")}>
          <Activity size={15} /> Une action
        </button>
        <button className={mode === "calibration" ? "active" : ""} type="button" onClick={() => setMode("calibration")}>
          <Layers3 size={15} /> Calibration globale
        </button>
        <button className={mode === "replay" ? "active" : ""} type="button" onClick={() => setMode("replay")}>
          <History size={15} /> Replay point-in-time
        </button>
      </div>

      <div className={`backtest-controls ${mode === "calibration" ? "calibration-controls" : mode === "replay" ? "replay-controls" : ""}`}>
        {mode !== "calibration" ? (
          <label>
            Action
            <input value={symbol} maxLength={15} onChange={(event) => setSymbol(event.target.value.toUpperCase())} />
          </label>
        ) : (
          <label className="universe-input">
            Univers
            <input value={universe} onChange={(event) => setUniverse(event.target.value.toUpperCase())} />
          </label>
        )}
        {mode !== "replay" ? <>
          <label>
            Benchmark
            <input value={benchmark} maxLength={15} onChange={(event) => setBenchmark(event.target.value.toUpperCase())} />
          </label>
          <div className="backtest-control-group">
            <span>Periode</span>
            <div className="backtest-segmented">
              {(["2y", "5y", "10y"] as BacktestPeriod[]).map((value) => (
                <button className={period === value ? "active" : ""} key={value} type="button" onClick={() => setPeriod(value)}>{value}</button>
              ))}
            </div>
          </div>
        </> : null}
        {mode === "single" ? <div className="backtest-control-group">
          <span>Horizon</span>
          <div className="backtest-segmented">
            {[5, 20, 60].map((value) => (
              <button className={horizon === value ? "active" : ""} key={value} type="button" onClick={() => setHorizon(value)}>{value}j</button>
            ))}
          </div>
        </div> : null}
        {mode !== "replay" ? <>
          <label>
            Frais (pb)
            <input type="number" min="0" max="200" value={transactionCost} onChange={(event) => setTransactionCost(Number(event.target.value))} />
          </label>
          <label>
            Slippage (pb)
            <input type="number" min="0" max="200" value={slippage} onChange={(event) => setSlippage(Number(event.target.value))} />
          </label>
        </> : <>
          <label className="replay-date-input">
            Date UTC
            <input type="datetime-local" value={replayAsOf} onChange={(event) => setReplayAsOf(event.target.value)} />
          </label>
          <label className="replay-reconstructed-toggle">
            <input
              type="checkbox"
              checked={allowReconstructedPrices}
              onChange={(event) => setAllowReconstructedPrices(event.target.checked)}
            />
            <span>
              Prix reconstruits
              <small>Mode recherche uniquement</small>
            </span>
          </label>
        </>}
        <button
          className="backtest-run"
          type="button"
          disabled={loading || calibrationLoading || replayLoading}
          onClick={() => void (
            mode === "single"
              ? runBacktest()
              : mode === "calibration"
              ? runCalibration()
              : runReplay()
          )}
        >
          {loading || calibrationLoading || replayLoading ? <RefreshCw className="spin" size={16} /> : <Play size={16} />}
          {loading || calibrationLoading || replayLoading ? "Calcul..." : mode === "single" ? "Lancer" : mode === "calibration" ? "Calibrer" : "Rejouer"}
        </button>
      </div>

      {mode === "single" && error ? <div className="backtest-error">{error}</div> : null}
      {mode === "calibration" && calibrationError ? <div className="backtest-error">{calibrationError}</div> : null}
      {mode === "replay" && replayError ? <div className="backtest-error">{replayError}</div> : null}
      {mode === "single" && !result && !loading ? (
        <div className="backtest-empty">
          <TrendingUp size={28} />
          <strong>Mesurez la robustesse du signal avant de lui faire confiance.</strong>
          <span>Choisissez une periode et un horizon, puis lancez la validation.</span>
        </div>
      ) : null}
      {mode === "calibration" && !calibration && !calibrationLoading ? (
        <div className="backtest-empty">
          <Layers3 size={28} />
          <strong>Calibrez la regle sur plusieurs secteurs et regimes de marche.</strong>
          <span>Le seuil est choisi sur train, puis fige pour validation et test hors echantillon.</span>
        </div>
      ) : null}
      {mode === "replay" && !replay && !replayLoading ? (
        <div className="backtest-empty">
          <History size={28} />
          <strong>Reconstituez ce que le système savait réellement à une date donnée.</strong>
          <span>Le mode strict interdit les données reconstruites et toute information future.</span>
        </div>
      ) : null}

      {mode === "single" && result ? (
        <>
          <div className={`backtest-verdict verdict-${result.verdict}`}>
            <div>
              <span>Verdict du protocole</span>
              <strong>{VERDICT_LABELS[result.verdict]}</strong>
            </div>
            <p>
              {result.qualification_checks.filter((check) => check.passed).length}/{result.qualification_checks.length} criteres valides
              · cout aller-retour {(2 * (result.transaction_cost_bps + result.slippage_bps)).toFixed(0)} pb
              · IC 95% [{percent(result.metrics.mean_return_ci_95_low_percent)}, {percent(result.metrics.mean_return_ci_95_high_percent)}]
            </p>
          </div>
          <div className="backtest-summary">
            <div>
              <span>Fiabilite</span>
              <strong className={`reliability-${result.reliability_level}`}>{result.reliability_level}</strong>
              <small>{result.evaluation_count} observations</small>
            </div>
            <div>
              <span>Rendement strategie</span>
              <strong className={metricTone(result.metrics.strategy_return_percent)}>{percent(result.metrics.strategy_return_percent)}</strong>
              <small>{result.period_start} au {result.period_end}</small>
            </div>
            <div>
              <span>Exces vs {result.benchmark}</span>
              <strong className={metricTone(result.metrics.excess_return_percent)}>{percent(result.metrics.excess_return_percent)}</strong>
              <small>benchmark {percent(result.metrics.benchmark_return_percent)}</small>
            </div>
            <div>
              <span>Sharpe</span>
              <strong>{result.metrics.sharpe_ratio?.toFixed(2) ?? "N/A"}</strong>
              <small>rendement ajuste du risque</small>
            </div>
            <div>
              <span>Drawdown max</span>
              <strong className={metricTone(-result.metrics.max_drawdown_percent)}>-{result.metrics.max_drawdown_percent.toFixed(2)}%</strong>
              <small>perte depuis un sommet</small>
            </div>
            <div>
              <span>Precision directionnelle</span>
              <strong>{result.metrics.directional_accuracy_percent?.toFixed(1) ?? "N/A"}%</strong>
              <small>{result.signal_counts.positive ?? 0} positifs · {result.signal_counts.negative ?? 0} negatifs</small>
            </div>
          </div>

          <PerformanceChart result={result} />

          <div className="backtest-detail-grid">
            <section className="backtest-calibration">
              <header>
                <div><span>Calibration</span><strong>Le score predit-il vraiment le rendement ?</strong></div>
                <CheckCircle2 size={17} />
              </header>
              <div className="backtest-table">
                <div className="header"><span>Score</span><span>N</span><span>Rendement futur</span><span>Seances positives</span></div>
                {result.calibration.map((bucket) => (
                  <div key={bucket.label}>
                    <strong>{bucket.label} <small>{bucket.score_min}-{bucket.score_max}</small></strong>
                    <span>{bucket.observations}</span>
                    <span className={metricTone(bucket.average_forward_return_percent)}>{percent(bucket.average_forward_return_percent)}</span>
                    <span>{bucket.positive_return_rate_percent?.toFixed(1) ?? "N/A"}%</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="backtest-observations">
              <header><span>Audit</span><strong>Dernieres observations</strong></header>
              <div className="backtest-table">
                <div className="header"><span>Date</span><span>Score</span><span>Signal</span><span>Rendement futur</span></div>
                {result.observations.slice(-6).reverse().map((observation) => (
                  <div key={observation.signal_date}>
                    <span>{observation.signal_date}</span>
                    <strong>{observation.technical_score}</strong>
                    <span className={`signal-${observation.signal}`}>{observation.signal}</span>
                    <span className={metricTone(observation.forward_return_percent)}>{percent(observation.forward_return_percent)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="backtest-disclosure">
            <strong>Perimetre actuel</strong>
            <span>{result.warnings.join(" ")}</span>
          </div>
        </>
      ) : null}

      {mode === "calibration" && calibration ? (
        <>
          <div className={`backtest-verdict verdict-${calibration.overall_verdict}`}>
            <div>
              <span>Qualification globale</span>
              <strong>{VERDICT_LABELS[calibration.overall_verdict]}</strong>
            </div>
            <p>
              {calibration.tickers_completed.length}/{calibration.tickers_requested.length} titres exploitables
              · split 60% train / 20% validation / 20% test
              · seuil jamais optimise sur le test
            </p>
          </div>

          <section className="calibration-protocol">
            <div><span>Univers</span><strong>{calibration.tickers_completed.length} titres</strong><small>multi-secteurs</small></div>
            <div><span>Benchmark</span><strong>{calibration.benchmark}</strong><small>{calibration.period} d'historique</small></div>
            <div><span>Execution</span><strong>{2 * (calibration.transaction_cost_bps + calibration.slippage_bps)} pb</strong><small>frais + slippage A/R</small></div>
            <div><span>Horizons</span><strong>{calibration.horizons.map((value) => `${value}j`).join(" · ")}</strong><small>validation distincte</small></div>
          </section>

          <section className="calibration-results">
            <header>
              <div><span>Resultats hors echantillon</span><strong>Seuil fige par horizon</strong></div>
              <ShieldCheck size={17} />
            </header>
            <div className="calibration-result-table">
              <div className="header">
                <span>Horizon</span><span>Seuil</span><span>Test N / trades</span><span>Exces test</span><span>Sharpe</span><span>IC 95%</span><span>Verdict</span>
              </div>
              {calibration.horizon_results.map((item) => (
                <div key={item.horizon_days}>
                  <strong>{item.horizon_days} jours</strong>
                  <span>≥ {item.selected_threshold}</span>
                  <span>{item.test.observations} / {item.test.invested_trades}</span>
                  <span className={metricTone(item.test.average_excess_return_percent)}>{percent(item.test.average_excess_return_percent)}</span>
                  <span>{item.test.annualized_sharpe_ratio?.toFixed(2) ?? "N/A"}</span>
                  <span>{percent(item.test.mean_return_ci_95_low_percent)} à {percent(item.test.mean_return_ci_95_high_percent)}</span>
                  <strong className={`calibration-verdict verdict-${item.verdict}`}>{VERDICT_LABELS[item.verdict]}</strong>
                </div>
              ))}
            </div>
          </section>

          <div className="calibration-detail-grid">
            {calibration.horizon_results.map((item) => (
              <section key={item.horizon_days}>
                <header><strong>{item.horizon_days} jours</strong><span>Seuil {item.selected_threshold}</span></header>
                {item.checks.map((check) => (
                  <div className="calibration-check" key={check.name}>
                    {check.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                    <span>{check.name.replace(/_/g, " ")}</span>
                    <small>{String(check.actual ?? "N/A")} · {check.threshold}</small>
                  </div>
                ))}
              </section>
            ))}
          </div>

          <section className="feature-calibration">
            <header>
              <div>
                <span>Calibration des facteurs</span>
                <strong>Poids candidats, jamais appliques sans validation</strong>
              </div>
              <ShieldCheck size={17} />
            </header>
            <div className="feature-model-grid">
              {calibration.horizon_results.map((item) => {
                const model = item.feature_model;
                return (
                  <article key={item.horizon_days}>
                    <div className="feature-model-summary">
                      <div>
                        <span>{item.horizon_days} jours</span>
                        <strong className={model.production_eligible ? "feature-approved" : "feature-rejected"}>
                          {model.production_eligible ? "Eligible production" : model.status === "insufficient" ? "Facteurs insuffisants" : "Modele rejete"}
                        </strong>
                      </div>
                      <div>
                        <span>Uplift test</span>
                        <strong className={metricTone(model.test_excess_uplift_percent)}>
                          {percent(model.test_excess_uplift_percent)}
                        </strong>
                      </div>
                      <div>
                        <span>Seuil candidat</span>
                        <strong>{model.selected_threshold}/100</strong>
                      </div>
                    </div>
                    <div className="feature-factor-table">
                      <div className="header">
                        <span>Facteur</span><span>Poids</span><span>IC train</span><span>IC val.</span><span>IC test</span>
                      </div>
                      {model.diagnostics.map((factor) => (
                        <div className={factor.selected ? "selected" : ""} key={factor.name}>
                          <span>
                            <strong>{factor.label}</strong>
                            <small>{factor.selected ? `${factor.train_coverage_percent.toFixed(0)}% couvert` : factor.rejection_reason ?? "non retenu"}</small>
                          </span>
                          <span>{factor.selected ? factor.weight.toFixed(3) : "-"}</span>
                          <span>{factor.train_information_coefficient?.toFixed(3) ?? "-"}</span>
                          <span>{factor.validation_information_coefficient?.toFixed(3) ?? "-"}</span>
                          <span>{factor.test_information_coefficient?.toFixed(3) ?? "-"}</span>
                        </div>
                      ))}
                    </div>
                    <div className="feature-checks">
                      {model.checks.map((check) => (
                        <span className={check.passed ? "passed" : "failed"} key={check.name}>
                          {check.passed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          {check.name.replace(/^feature_/, "").replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="calibration-coverage">
            <header><span>Couverture des donnees</span><strong>{calibration.tickers_completed.join(" · ")}</strong></header>
            <div>
              {calibration.coverage.map((item) => (
                <span className={`coverage-${item.status}`} key={item.ticker}>{item.ticker}</span>
              ))}
            </div>
          </section>

          <div className="backtest-disclosure">
            <strong>Limites</strong>
            <span>{calibration.warnings.join(" ")}</span>
          </div>
        </>
      ) : null}

      {mode === "replay" && replay ? (
        <>
          <div className={`backtest-verdict ${replay.status === "success" ? "verdict-validated" : replay.status === "partial" ? "verdict-recalibrate" : "verdict-not_validated"}`}>
            <div>
              <span>Replay {replay.replay_mode}</span>
              <strong>{replay.status === "success" ? "Complet" : replay.status === "partial" ? "Partiel" : "Impossible"}</strong>
            </div>
            <p>
              {replay.lookahead_guard_passed ? "Anti-lookahead valide" : "Fuite temporelle detectee"}
              {" · "}couverture archive {replay.archive_coverage_score}/100
              {" · "}{new Date(replay.as_of).toLocaleString("fr-FR")}
            </p>
          </div>

          <section className="replay-summary-grid">
            <div>
              <span>Score technique</span>
              <strong>{replay.technical.technical_score ?? "N/A"}</strong>
              <small>{replay.technical.trend} · {replay.technical.signal}</small>
            </div>
            <div>
              <span>Risque</span>
              <strong>{replay.risk.risk_score}/100</strong>
              <small>{replay.risk.overall_risk_level}</small>
            </div>
            <div>
              <span>Score global</span>
              <strong>{replay.synthesis.global_score}/100</strong>
              <small>{replay.synthesis.recommendation.replace(/_/g, " ")}</small>
            </div>
            <div>
              <span>Confiance</span>
              <strong>{replay.synthesis.confidence_score}/100</strong>
              <small>{replay.synthesis.confidence_level}</small>
            </div>
          </section>

          <section className="replay-trace">
            <header>
              <div><span>Trace temporelle</span><strong>Données réellement utilisées par composant</strong></div>
              <ShieldCheck size={17} />
            </header>
            <div className="replay-trace-table">
              <div className="header">
                <span>Composant</span><span>Statut</span><span>Evénements</span><span>Mode</span><span>Dernière disponibilité</span><span>Décision</span>
              </div>
              {replay.trace.map((item) => (
                <div key={item.component}>
                  <strong>{item.component.replace(/_/g, " ")}</strong>
                  <span className={`coverage-${item.status}`}>{item.status}</span>
                  <span>{item.event_count}</span>
                  <span>{item.knowledge_modes.join(" · ") || "-"}</span>
                  <span>{item.latest_available_at ? new Date(item.latest_available_at).toLocaleString("fr-FR") : "-"}</span>
                  <small>{item.message}</small>
                </div>
              ))}
            </div>
          </section>

          <div className="backtest-disclosure">
            <strong>Qualification</strong>
            <span>
              {[...replay.warnings, ...replay.errors].join(" ") || "Tous les composants requis sont disponibles."}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}

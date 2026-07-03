import {
  BrainCircuit,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ChevronsRight,
  Clock3,
  Download,
  Folder,
  Globe2,
  Grid2X2,
  Home,
  LineChart,
  Network,
  RefreshCw,
  Sparkles,
  Timer,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgentMetrics } from "./components/AgentMetrics";
import { fetchMarketDashboard } from "./services/analysisApi";
import type { MarketDashboard, MarketRow } from "./types";

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const fallbackDashboard: MarketDashboard = {
  source: "Demo locale",
  updated_at: new Date().toISOString(),
  rows: [
    { symbol: "AAPL", name: "Apple Inc.", bid: 213.31, mid: 213.4, ask: 213.49, spread: 0.18, variation: 1.84 },
    { symbol: "MSFT", name: "Microsoft Corp.", bid: 497.82, mid: 498.05, ask: 498.28, spread: 0.46, variation: 0.72 },
    { symbol: "NVDA", name: "NVIDIA Corp.", bid: 154.56, mid: 154.63, ask: 154.7, spread: 0.14, variation: 3.05 },
    { symbol: "TSLA", name: "Tesla, Inc.", bid: 327.65, mid: 327.8, ask: 327.95, spread: 0.3, variation: -2.12 },
  ],
  brief: [],
  positions: [
    {
      id: "D-2087",
      product: "Forward",
      symbol: "AAPL",
      side: "Achat",
      notional: "250 000 USD",
      entry: 209.13,
      maturity: "23/07/26",
      pnl: 4800,
    },
  ],
  simulation: {
    symbol: "AAPL",
    spot: 0,
    notional: 250000,
    horizon_days: 90,
    domestic_rate: 4.3,
    foreign_rate: 3.8,
    forward_rate: 0,
    swap_points: 0,
    differential: 0,
    counter_value: 0,
  },
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatShortTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function bestRow(rows: MarketRow[]) {
  return rows.reduce((best, row) => (row.variation > best.variation ? row : best), rows[0]);
}

export function App() {
  const [dashboard, setDashboard] = useState<MarketDashboard>(fallbackDashboard);
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"trading" | "dashboard">("trading");

  async function loadDashboard() {
    setLoading(true);
    const nextDashboard = await fetchMarketDashboard();
    setDashboard(nextDashboard);
    setSelectedSymbol(nextDashboard.rows[0]?.symbol ?? "AAPL");
    setLoading(false);
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  const selectedRow = useMemo(
    () => dashboard.rows.find((row) => row.symbol === selectedSymbol) ?? dashboard.rows[0],
    [dashboard.rows, selectedSymbol],
  );
  const leader = dashboard.rows.length ? bestRow(dashboard.rows) : undefined;
  const totalPnl = dashboard.positions.reduce((total, position) => total + position.pnl, 0);

  return (
    <main className="terminal-shell">
      <aside className="rail">
        <div className="rail-logo">BI</div>
        <div className="avatar" />
        <nav className="rail-nav" aria-label="Navigation principale">
          <button type="button" title="Accueil">
            <Home size={22} />
          </button>
          <button type="button" title="Assistant">
            <BrainCircuit size={22} />
          </button>
          <button className="active" type="button" title="Trading">
            <LineChart size={22} />
          </button>
          <button type="button" title="Positions">
            <WalletCards size={22} />
          </button>
          <button type="button" title="Dossiers">
            <Folder size={22} />
          </button>
          <button type="button" title="Réseau">
            <Network size={22} />
          </button>
          <button type="button" title="Horloge">
            <Clock3 size={22} />
          </button>
          <button type="button" title="Monde">
            <Globe2 size={22} />
          </button>
          <button type="button" title="Calendrier">
            <CalendarDays size={22} />
          </button>
        </nav>
        <button className="collapse-button" type="button" title="Réduire">
          <ChevronsRight size={22} />
        </button>
      </aside>

      <section className="terminal-main">
        <header className="terminal-topbar">
          <div className="bank-block">
            <button className="back-button" type="button" aria-label="Retour">
              <ChevronsRight size={21} />
            </button>
            <div>
              <h1>Bourse IA</h1>
              <span>Analyse marché · Actions & signaux</span>
            </div>
          </div>

          <div className="top-actions">
            <div className="segmented">
              <button
                className={view === "trading" ? "selected" : ""}
                type="button"
                onClick={() => setView("trading")}
              >
                <LineChart size={16} /> Trading
              </button>
              <button
                className={view === "dashboard" ? "selected" : ""}
                type="button"
                onClick={() => setView("dashboard")}
              >
                <Grid2X2 size={16} /> Dashboard
              </button>
            </div>
            <button className="export-button" type="button">
              <Download size={17} /> Exporter <ChevronDown size={16} />
            </button>
            <span className="live-pill">LIVE</span>
            <span className="date-pill">
              <Timer size={17} /> {formatDateTime(dashboard.updated_at)}
            </span>
          </div>
        </header>

        {view === "dashboard" ? (
          <AgentMetrics />
        ) : (
        <section className="market-layout compact-layout">
          <aside className="panel ai-panel">
            <div className="panel-title">
              <Sparkles size={19} />
              <strong>ASSISTANT IA · BOURSE IA</strong>
            </div>
            <div className="assistant-card">
              Bonjour. Je suis l'assistant IA de Bourse IA. Demandez-moi une cotation, une analyse de tendance ou un
              signal de marché. Exemple : "Analyse {leader?.symbol ?? "AAPL"} et propose un timing".
            </div>
            {selectedRow ? (
              <div className="assistant-insight">
                <span>Focus actuel</span>
                <strong>{selectedRow.symbol}</strong>
                <p>
                  Mid {numberFormatter.format(selectedRow.mid)} · variation {selectedRow.variation > 0 ? "+" : ""}
                  {selectedRow.variation.toFixed(2)}%.
                </p>
              </div>
            ) : null}
          </aside>

          <section className="center-stack">
            <article className="panel quote-panel">
              <div className="panel-title">
                <LineChart size={19} />
                <strong>Panier Marche · Actions US</strong>
                <span className="panel-meta">
                  {dashboard.source} · maj {formatShortTime(dashboard.updated_at)}
                </span>
                <button className="icon-button" type="button" onClick={() => void loadDashboard()} aria-label="Rafraîchir">
                  <RefreshCw size={17} className={loading ? "spin" : ""} />
                </button>
              </div>

              <div className="market-table">
                <div className="market-head">
                  <span>PAIRE</span>
                  <span>BID</span>
                  <span>MID</span>
                  <span>ASK</span>
                  <span>SPREAD</span>
                  <span>VAR. J-1</span>
                </div>
                {dashboard.rows.map((row) => (
                  <button
                    className={`market-row ${row.symbol === selectedSymbol ? "selected-row" : ""}`}
                    key={row.symbol}
                    type="button"
                    onClick={() => setSelectedSymbol(row.symbol)}
                  >
                    <span>
                      <strong>{row.symbol}</strong>
                      <small>{row.name}</small>
                    </span>
                    <span>{numberFormatter.format(row.bid)}</span>
                    <span className="mid">{numberFormatter.format(row.mid)}</span>
                    <span>{numberFormatter.format(row.ask)}</span>
                    <span className="muted">{numberFormatter.format(row.spread)}</span>
                    <span className={row.variation >= 0 ? "positive" : "negative"}>
                      {row.variation >= 0 ? "up" : "down"} {row.variation > 0 ? "+" : ""}
                      {row.variation.toFixed(2)}%
                    </span>
                  </button>
                ))}
              </div>
            </article>

            <article className="panel positions-panel">
              <div className="panel-title">
                <BriefcaseBusiness size={18} />
                <strong>Positions du jour</strong>
              </div>
              <div className="positions-summary">
                <span>P&L total</span>
                <strong className={totalPnl >= 0 ? "positive" : "negative"}>
                  {totalPnl >= 0 ? "+" : ""}
                  {moneyFormatter.format(totalPnl)} USD
                </strong>
              </div>
              <div className="position-card-list">
                {dashboard.positions.map((position) => (
                  <div className="position-item" key={position.id}>
                    <div className="position-main">
                      <div className="position-topline">
                        <span>{position.id}</span>
                        <em>{position.product}</em>
                      </div>
                      <strong>{position.symbol}</strong>
                      <p>
                        {position.side} · {position.notional}
                      </p>
                      <small>
                        @ {position.entry.toFixed(4)} · {position.maturity}
                      </small>
                    </div>
                    <strong className={position.pnl >= 0 ? "position-pnl positive" : "position-pnl negative"}>
                      {position.pnl >= 0 ? "+" : ""}
                      {moneyFormatter.format(position.pnl)}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </section>
        )}
      </section>
    </main>
  );
}

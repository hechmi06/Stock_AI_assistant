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
  Search,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentMetrics } from "./components/AgentMetrics";
import { NewsFeed } from "./components/NewsFeed";
import { fetchMarketDashboard } from "./services/analysisApi";
import type { MarketDashboard, MarketRow } from "./types";

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const volumeFormatter = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatPrice(value: number | null | undefined) {
  return value == null ? "—" : priceFormatter.format(value);
}

function formatVolume(value: number | null | undefined) {
  return value == null ? "—" : volumeFormatter.format(value);
}

const fallbackDashboard: MarketDashboard = {
  source: "Demo locale",
  updated_at: new Date().toISOString(),
  rows: [
    { symbol: "AAPL", name: "Apple Inc.", bid: 213.31, mid: 213.4, ask: 213.49, spread: 0.18, variation: 1.84, high: 215.12, low: 210.50, volume: 62800000 },
    { symbol: "MSFT", name: "Microsoft Corp.", bid: 497.82, mid: 498.05, ask: 498.28, spread: 0.46, variation: 0.72, high: 500.10, low: 494.20, volume: 18400000 },
    { symbol: "NVDA", name: "NVIDIA Corp.", bid: 154.56, mid: 154.63, ask: 154.7, spread: 0.14, variation: 3.05, high: 156.80, low: 150.40, volume: 310000000 },
    { symbol: "TSLA", name: "Tesla, Inc.", bid: 327.65, mid: 327.8, ask: 327.95, spread: 0.3, variation: -2.12, high: 335.50, low: 324.10, volume: 84500000 },
    { symbol: "GOOGL", name: "Alphabet Inc.", bid: 178.20, mid: 178.45, ask: 178.70, spread: 0.50, variation: 0.38, high: 180.20, low: 176.80, volume: 22100000 },
    { symbol: "AMZN", name: "Amazon.com", bid: 208.10, mid: 208.35, ask: 208.60, spread: 0.50, variation: 1.12, high: 210.00, low: 205.30, volume: 31600000 },
    { symbol: "META", name: "Meta Platforms", bid: 625.40, mid: 625.80, ask: 626.20, spread: 0.80, variation: 2.34, high: 630.00, low: 618.50, volume: 11200000 },
    { symbol: "JPM", name: "JPMorgan Chase", bid: 284.10, mid: 284.35, ask: 284.60, spread: 0.50, variation: -0.45, high: 287.00, low: 282.00, volume: 9800000 },
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
    {
      id: "D-2091",
      product: "Call Option",
      symbol: "NVDA",
      side: "Achat",
      notional: "100 000 USD",
      entry: 148.20,
      maturity: "15/09/26",
      pnl: 6430,
    },
    {
      id: "D-2094",
      product: "Put Option",
      symbol: "TSLA",
      side: "Vente",
      notional: "150 000 USD",
      entry: 338.50,
      maturity: "30/08/26",
      pnl: -2100,
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

/** Ticker Search — searches across available tickers */
function TickerSearch({
  rows,
  onSelect,
}: {
  rows: MarketRow[];
  onSelect: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.symbol.includes(q) ||
        r.name.toUpperCase().includes(q)
    );
  }, [query, rows]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (filtered[focusedIdx]) {
        onSelect(filtered[focusedIdx].symbol);
        setQuery("");
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="ticker-search-wrap" ref={wrapRef}>
      <span className="ticker-search-icon">
        <Search size={14} />
      </span>
      <input
        id="ticker-search"
        ref={inputRef}
        className="ticker-search-input"
        type="text"
        placeholder="Rechercher un ticker… AAPL, NVDA…"
        value={query}
        autoComplete="off"
        onFocus={() => { setOpen(true); setFocusedIdx(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setFocusedIdx(0); }}
        onKeyDown={handleKeyDown}
        aria-label="Rechercher un ticker"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {query && (
        <button
          className="ticker-search-clear"
          type="button"
          aria-label="Effacer"
          onClick={() => { setQuery(""); inputRef.current?.focus(); }}
        >
          <X size={13} />
        </button>
      )}
      {open && (
        <div className="ticker-search-dropdown" role="listbox">
          {filtered.length === 0 ? (
            <div className="ticker-search-empty">Aucun résultat pour « {query} »</div>
          ) : (
            filtered.map((row, idx) => (
              <button
                key={row.symbol}
                className={`ticker-search-item ${idx === focusedIdx ? "focused" : ""}`}
                type="button"
                role="option"
                aria-selected={idx === focusedIdx}
                onMouseEnter={() => setFocusedIdx(idx)}
                onClick={() => {
                  onSelect(row.symbol);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="ts-sym">{row.symbol}</span>
                <span className="ts-name">{row.name}</span>
                <span className="ts-price">{row.mid.toFixed(2)}</span>
                <span className={`ts-var ${row.variation >= 0 ? "up" : "dn"}`}>
                  {row.variation >= 0 ? "+" : ""}{row.variation.toFixed(2)}%
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Ticker tape — duplicated for seamless loop */
function TickerTape({ rows }: { rows: MarketRow[] }) {
  if (!rows.length) return null;
  const items = [...rows, ...rows]; // duplicate for seamless loop
  return (
    <div className="ticker-tape" aria-hidden="true">
      <div className="ticker-tape-track">
        {items.map((row, i) => (
          <span className="ticker-item" key={`${row.symbol}-${i}`}>
            <span className="t-sym">{row.symbol}</span>
            <span className="t-price">{priceFormatter.format(row.mid)}</span>
            <span className={row.variation >= 0 ? "t-up" : "t-dn"}>
              {row.variation >= 0 ? "▲" : "▼"} {Math.abs(row.variation).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Stats row — résumé marché */
function StatsRow({ rows }: { rows: MarketRow[] }) {
  const gainers = rows.filter((r) => r.variation >= 0).length;
  const losers  = rows.length - gainers;
  const avgVar  = rows.length ? rows.reduce((s, r) => s + r.variation, 0) / rows.length : 0;
  const best    = rows.length ? bestRow(rows) : null;
  return (
    <div className="stats-row">
      <div className="stat-item">
        <div className="stat-label">Titres suivis</div>
        <div className="stat-value">{rows.length}</div>
      </div>
      <div className="stat-item">
        <div className="stat-label">Hausse / Baisse</div>
        <div className="stat-value">
          <span style={{ color: "var(--green)" }}>{gainers}▲</span>
          {" / "}
          <span style={{ color: "var(--red)" }}>{losers}▼</span>
        </div>
      </div>
      <div className="stat-item">
        <div className="stat-label">Var. moy.</div>
        <div className={`stat-value ${avgVar >= 0 ? "up" : "down"}`}>
          {avgVar >= 0 ? "+" : ""}{avgVar.toFixed(2)}%
        </div>
      </div>
      {best && (
        <div className="stat-item">
          <div className="stat-label">Leader du jour</div>
          <div className="stat-value up">{best.symbol} +{best.variation.toFixed(2)}%</div>
        </div>
      )}
    </div>
  );
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
    <>
      {/* ── Ticker Tape ── */}
      <TickerTape rows={dashboard.rows} />

      <main className="terminal-shell">
        {/* ── Rail ── */}
        <aside className="rail">
          <div className="rail-logo">BI</div>
          <nav className="rail-nav" aria-label="Navigation principale">
            <button type="button" title="Accueil">
              <Home size={20} />
            </button>
            <button type="button" title="Assistant IA">
              <BrainCircuit size={20} />
            </button>
            <button className="active" type="button" title="Trading">
              <LineChart size={20} />
            </button>
            <button type="button" title="Positions">
              <WalletCards size={20} />
            </button>
            <button type="button" title="Dossiers">
              <Folder size={20} />
            </button>
            <button type="button" title="Réseau">
              <Network size={20} />
            </button>
            <button type="button" title="Horloge">
              <Clock3 size={20} />
            </button>
            <button type="button" title="Mondial">
              <Globe2 size={20} />
            </button>
            <button type="button" title="Calendrier">
              <CalendarDays size={20} />
            </button>
          </nav>
          <div className="avatar" />
          <button className="collapse-button" type="button" title="Réduire">
            <ChevronsRight size={20} />
          </button>
        </aside>

        {/* ── Main ── */}
        <section className="terminal-main">
          {/* Top bar */}
          <header className="terminal-topbar">
            <div className="bank-block">
              <button className="back-button" type="button" aria-label="Retour">
                <ChevronsRight size={19} />
              </button>
              <div>
                <h1>Bourse IA</h1>
                <span>Analyse marché · Actions &amp; signaux</span>
              </div>
            </div>

            <div className="top-actions">
              <div className="segmented">
                <button
                  className={view === "trading" ? "selected" : ""}
                  type="button"
                  onClick={() => setView("trading")}
                >
                  <LineChart size={15} /> Trading
                </button>
                <button
                  className={view === "dashboard" ? "selected" : ""}
                  type="button"
                  onClick={() => setView("dashboard")}
                >
                  <Grid2X2 size={15} /> Dashboard
                </button>
              </div>
              <button className="export-button" type="button">
                <Download size={15} /> Exporter <ChevronDown size={14} />
              </button>
              <span className="live-pill">LIVE</span>
              <span className="date-pill">
                <Timer size={15} /> {formatDateTime(dashboard.updated_at)}
              </span>
            </div>
          </header>

          {/* Content */}
          {view === "dashboard" ? (
            <AgentMetrics />
          ) : (
            <>
              {/* Stats row */}
              <StatsRow rows={dashboard.rows} />

              <div className="market-layout">
                {/* ── AI Panel ── */}
                <aside className="panel ai-panel">
                  <div className="panel-title">
                    <Sparkles size={17} />
                    <strong>Assistant IA</strong>
                  </div>

                  {/* ── Barre de recherche ── */}
                  <div style={{ padding: "0 14px 14px" }}>
                    <TickerSearch
                      rows={dashboard.rows}
                      onSelect={(sym) => setSelectedSymbol(sym)}
                    />
                  </div>

                  <div className="assistant-card">
                    Bonjour. Je suis l'assistant IA de Bourse IA. Demandez-moi une
                    cotation, une analyse de tendance ou un signal de marché.
                    <br /><br />
                    Exemple : <em style={{ color: "var(--accent-2)", fontStyle: "normal" }}>
                      « Analyse {leader?.symbol ?? "AAPL"} et propose un timing »
                    </em>
                  </div>

                  {selectedRow ? (
                    <div className="assistant-insight">
                      <span>Focus actuel</span>
                      <strong>{selectedRow.symbol}</strong>
                      <p>
                        {selectedRow.name}
                      </p>
                      <p style={{ marginTop: 8 }}>
                        Mid <strong style={{ fontSize: "1rem", display: "inline" }}>
                          {numberFormatter.format(selectedRow.mid)}
                        </strong>{" "}
                        ·{" "}
                        <span
                          style={{
                            color: selectedRow.variation >= 0 ? "var(--green)" : "var(--red)",
                            fontWeight: 700,
                          }}
                        >
                          {selectedRow.variation >= 0 ? "▲ +" : "▼ "}
                          {selectedRow.variation.toFixed(2)}%
                        </span>
                      </p>
                      <div className="ai-focus-trend">
                        {selectedRow.variation >= 0 ? (
                          <TrendingUp size={14} color="var(--green)" />
                        ) : (
                          <TrendingDown size={14} color="var(--red)" />
                        )}
                        <span>
                          Vol.{" "}
                          {selectedRow.high && selectedRow.low
                            ? `${formatPrice(selectedRow.low)} – ${formatPrice(selectedRow.high)}`
                            : "—"}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <div className="ai-quick-actions">
                    <p>Actions rapides</p>
                    <button type="button" className="ai-action-chip">
                      <Zap size={13} /> Analyse technique {selectedRow?.symbol ?? "AAPL"}
                    </button>
                    <button type="button" className="ai-action-chip">
                      <BrainCircuit size={13} /> Résumé IA complet
                    </button>
                    <button type="button" className="ai-action-chip">
                      <TrendingUp size={13} /> Leaders du marché
                    </button>
                  </div>
                </aside>

                {/* ── Center Stack ── */}
                <div className="center-stack">
                  {/* Quote panel */}
                  <article className="panel quote-panel">
                    <div className="panel-title">
                      <LineChart size={17} />
                      <strong>Panier Marché · Actions US</strong>
                      <span className="panel-meta">
                        {dashboard.source} · maj {formatShortTime(dashboard.updated_at)}
                      </span>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => void loadDashboard()}
                        aria-label="Rafraîchir"
                      >
                        <RefreshCw size={15} className={loading ? "spin" : ""} />
                      </button>
                    </div>

                    <div className="market-table">
                      <div className="market-head">
                        <span>TITRE</span>
                        <span className="num">DERNIER</span>
                        <span className="num">VAR. J-1</span>
                        <span className="num">HAUT</span>
                        <span className="num">BAS</span>
                        <span className="num">VOLUME</span>
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
                          <span className="num last-price">
                            {priceFormatter.format(row.mid)}
                            <small className="bid-ask">
                              {priceFormatter.format(row.bid)} / {priceFormatter.format(row.ask)}
                            </small>
                          </span>
                          <span className="num">
                            <span className={`var-badge ${row.variation >= 0 ? "up" : "down"}`}>
                              {row.variation >= 0 ? "▲" : "▼"}{" "}
                              {row.variation > 0 ? "+" : ""}
                              {row.variation.toFixed(2)}%
                            </span>
                          </span>
                          <span className="num">{formatPrice(row.high)}</span>
                          <span className="num">{formatPrice(row.low)}</span>
                          <span className="num muted">{formatVolume(row.volume)}</span>
                        </button>
                      ))}
                    </div>
                  </article>

                  <NewsFeed ticker={selectedSymbol} />

                  {/* Positions panel */}
                  <article className="panel positions-panel">
                    <div className="panel-title">
                      <BriefcaseBusiness size={17} />
                      <strong>Positions du jour</strong>
                      <span className="panel-meta" style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Portefeuille complet
                      </span>
                    </div>
                    <div className="positions-summary">
                      <span>P&amp;L Total</span>
                      <strong className={totalPnl >= 0 ? "positive" : "negative"}>
                        {totalPnl >= 0 ? "+" : ""}
                        {moneyFormatter.format(totalPnl)} USD
                      </strong>
                    </div>
                    <div className="position-card-list">
                      {[
                        // positions du ticker sélectionné en premier
                        ...dashboard.positions.filter((p) => p.symbol === selectedSymbol),
                        ...dashboard.positions.filter((p) => p.symbol !== selectedSymbol),
                      ].map((position) => {
                        const isActive = position.symbol === selectedSymbol;
                        return (
                          <div
                            className={`position-item ${isActive ? "position-item--active" : "position-item--dim"}`}
                            key={position.id}
                          >
                            <div className="position-main">
                              <div className="position-topline">
                                <span>{position.id}</span>
                                <em>{position.product}</em>
                                {isActive && (
                                  <span className="position-active-badge">Sélectionné</span>
                                )}
                              </div>
                              <strong>{position.symbol}</strong>
                              <p>
                                {position.side} · {position.notional}
                              </p>
                              <small>
                                @ {position.entry.toFixed(4)} · {position.maturity}
                              </small>
                            </div>
                            <strong
                              className={`position-pnl ${position.pnl >= 0 ? "positive" : "negative"}`}
                            >
                              {position.pnl >= 0 ? "+" : ""}
                              {moneyFormatter.format(position.pnl)}
                            </strong>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}

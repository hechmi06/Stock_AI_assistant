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
import { NewsFeed } from "./components/NewsFeed";
import { emptyDashboard, fetchMarketDashboard } from "./services/analysisApi";
import type { MarketDashboard, MarketRow } from "./types";

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
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
  return value == null || value <= 0 ? "—" : priceFormatter.format(value);
}

function formatVolume(value: number | null | undefined) {
  return value == null ? "—" : volumeFormatter.format(value);
}

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
  const [dashboard, setDashboard] = useState<MarketDashboard>(emptyDashboard);
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"trading" | "dashboard">("trading");
  const [marketPage, setMarketPage] = useState(1);
  const [marketSearch, setMarketSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadDashboard(page = marketPage, search = marketSearch) {
    setLoading(true);
    setLoadError(null);
    try {
      const nextDashboard = await fetchMarketDashboard({ page, limit: 25, search });
      setDashboard(nextDashboard);
      if (!nextDashboard.rows.some((row) => row.symbol === selectedSymbol) && nextDashboard.rows[0]) {
        setSelectedSymbol(nextDashboard.rows[0].symbol);
      }
    } catch {
      setLoadError("Impossible de charger les cotations live. Verifiez MCP, backend et gateway.");
      setDashboard(emptyDashboard);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard(marketPage, marketSearch);
  }, [marketPage, marketSearch]);

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
                  {dashboard.total.toLocaleString("fr-FR")} titres · page {dashboard.page}/{dashboard.total_pages} ·{" "}
                  {dashboard.source} · maj {formatShortTime(dashboard.updated_at)}
                </span>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void loadDashboard(marketPage, marketSearch)}
                  aria-label="Rafraîchir"
                >
                  <RefreshCw size={17} className={loading ? "spin" : ""} />
                </button>
              </div>

              <div className="market-toolbar">
                <input
                  className="market-search"
                  type="search"
                  placeholder="Rechercher un symbole ou une société (ex. AAPL, JPMorgan…)"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      setMarketPage(1);
                      setMarketSearch(searchInput.trim());
                    }
                  }}
                />
                <button
                  type="button"
                  className="market-search-btn"
                  onClick={() => {
                    setMarketPage(1);
                    setMarketSearch(searchInput.trim());
                  }}
                >
                  Rechercher
                </button>
                {marketSearch ? (
                  <button
                    type="button"
                    className="market-search-clear"
                    onClick={() => {
                      setSearchInput("");
                      setMarketSearch("");
                      setMarketPage(1);
                    }}
                  >
                    Effacer
                  </button>
                ) : null}
              </div>

              {loadError ? (
                <div className="market-error" role="alert">
                  {loadError}
                </div>
              ) : null}

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
                      {formatPrice(row.mid)}
                      {row.mid > 0 ? (
                        <small className="bid-ask">
                          {formatPrice(row.bid)} / {formatPrice(row.ask)}
                        </small>
                      ) : null}
                    </span>
                    <span className="num">
                      {row.mid > 0 ? (
                        <span className={`var-badge ${row.variation >= 0 ? "up" : "down"}`}>
                          {row.variation >= 0 ? "▲" : "▼"} {row.variation > 0 ? "+" : ""}
                          {row.variation.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </span>
                    <span className="num">{formatPrice(row.high)}</span>
                    <span className="num">{formatPrice(row.low)}</span>
                    <span className="num muted">{formatVolume(row.volume)}</span>
                  </button>
                ))}
              </div>

              <div className="market-pagination">
                <button
                  type="button"
                  disabled={dashboard.page <= 1 || loading}
                  onClick={() => setMarketPage((page) => Math.max(1, page - 1))}
                >
                  ← Précédent
                </button>
                <span>
                  Page {dashboard.page} / {dashboard.total_pages}
                </span>
                <button
                  type="button"
                  disabled={dashboard.page >= dashboard.total_pages || loading}
                  onClick={() => setMarketPage((page) => page + 1)}
                >
                  Suivant →
                </button>
              </div>
            </article>

            <NewsFeed ticker={selectedSymbol} />

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

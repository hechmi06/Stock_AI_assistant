import {
  Activity,
  BarChart3,
  Building2,
  Database,
  ExternalLink,
  Gauge,
  History,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  PortfolioAnalysis,
  PortfolioCompleteAnalysis,
  PortfolioPosition,
} from "../types";
import { RiskScale } from "./RiskScale";

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactNumber = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullDate = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

type IndividualAnalysis = PortfolioCompleteAnalysis["individual_analyses"][number];

function formatPercent(value: number | null | undefined, signed = false) {
  if (value == null) return "-";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${number.format(value)}%`;
}

function formatNumber(value: number | null | undefined, suffix = "") {
  return value == null ? "-" : `${number.format(value)}${suffix}`;
}

function formatMoney(value: number | null | undefined) {
  return value == null ? "-" : compactMoney.format(value);
}

function formatDebtToEquity(value: number | null | undefined) {
  if (value == null) return "-";
  return Math.abs(value) > 10 ? `${number.format(value)}%` : `${number.format(value)}x`;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(date);
}

function formatFullDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : fullDate.format(date);
}

function formatCompact(value: number | null | undefined) {
  return value == null ? "-" : compactNumber.format(value);
}

function trendLabel(value: PortfolioPosition["technical"]["trend"]) {
  return value === "bullish" ? "Haussiere" : value === "bearish" ? "Baissiere" : "Neutre";
}

function riskLevelLabel(value: IndividualAnalysis["risk_level"]) {
  return value === "high" ? "eleve" : value === "medium" ? "moyen" : "faible";
}

function movingAveragePosition(position: PortfolioPosition) {
  const { current_price: price, technical } = position;
  if (price == null || technical.sma_20 == null || technical.sma_50 == null) return "-";
  if (price > technical.sma_20 && price > technical.sma_50) return "Cours au-dessus";
  if (price < technical.sma_20 && price < technical.sma_50) return "Cours en dessous";
  return "Signal partage";
}

function PerformanceCurve({ analysis }: { analysis: PortfolioAnalysis }) {
  const curve = analysis.performance.curve ?? [];
  if (curve.length < 2) {
    return (
      <div className="portfolio-curve-empty">
        <TrendingUp size={20} />
        <strong>Courbe indisponible</strong>
        <span>Au moins 20 dates communes sont necessaires.</span>
      </div>
    );
  }

  const width = 920;
  const height = 250;
  const padding = { top: 20, right: 24, bottom: 34, left: 54 };
  const values = curve.flatMap((point) => [
    point.portfolio_return_percent,
    point.benchmark_return_percent,
  ]);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = Math.max(1, rawMax - rawMin);
  const min = rawMin - span * 0.12;
  const max = rawMax + span * 0.12;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number) =>
    padding.left + (index / Math.max(1, curve.length - 1)) * plotWidth;
  const y = (value: number) =>
    padding.top + ((max - value) / Math.max(1, max - min)) * plotHeight;
  const path = (field: "portfolio_return_percent" | "benchmark_return_percent") =>
    curve
      .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(point[field]).toFixed(2)}`)
      .join(" ");
  const ticks = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);
  const last = curve[curve.length - 1];

  return (
    <div className="portfolio-curve-wrap">
      <div className="portfolio-curve-legend">
        <span className="portfolio-line portfolio-line-main">
          Portefeuille <strong>{formatPercent(last.portfolio_return_percent, true)}</strong>
        </span>
        <span className="portfolio-line portfolio-line-benchmark">
          {analysis.performance.benchmark_ticker} <strong>{formatPercent(last.benchmark_return_percent, true)}</strong>
        </span>
      </div>
      <svg
        className="portfolio-performance-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Evolution normalisee du portefeuille et du benchmark ${analysis.performance.benchmark_ticker}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} />
            <text x={padding.left - 10} y={y(tick) + 4}>{formatPercent(tick)}</text>
          </g>
        ))}
        <line
          className="portfolio-zero-line"
          x1={padding.left}
          x2={width - padding.right}
          y1={y(0)}
          y2={y(0)}
        />
        <path className="portfolio-benchmark-path" d={path("benchmark_return_percent")} />
        <path className="portfolio-main-path" d={path("portfolio_return_percent")} />
        <text className="portfolio-axis-date" x={padding.left} y={height - 8}>
          {formatDate(curve[0].date)}
        </text>
        <text className="portfolio-axis-date end" x={width - padding.right} y={height - 8}>
          {formatDate(last.date)}
        </text>
      </svg>
    </div>
  );
}

function FundamentalsTable({
  positions,
  selectedTicker,
  onSelect,
}: {
  positions: PortfolioPosition[];
  selectedTicker: string;
  onSelect: (ticker: string) => void;
}) {
  return (
    <div className="portfolio-insight-table-wrap">
      <div className="portfolio-fundamental-table">
        <div className="portfolio-fundamental-row header">
          <span>Entreprise</span><span>PER</span><span>Prix / actif</span><span>Marge nette</span>
          <span>ROE</span><span>Croissance CA</span><span>Dette / fonds</span><span>Resultat net</span><span>Couverture</span>
        </div>
        {positions.map((position) => {
          const fundamentals = position.fundamentals;
          return (
            <button
              type="button"
              className={`portfolio-fundamental-row ${selectedTicker === position.ticker ? "selected" : ""}`}
              key={position.ticker}
              aria-pressed={selectedTicker === position.ticker}
              onClick={() => onSelect(position.ticker)}
            >
              <span><strong>{position.ticker}</strong><small>{position.name ?? position.sector}</small></span>
              <span>{formatNumber(fundamentals?.forward_pe ?? fundamentals?.trailing_pe, "x")}<small>{fundamentals?.forward_pe != null ? "prospectif" : "historique"}</small></span>
              <span>{formatNumber(fundamentals?.price_to_book, "x")}</span>
              <span className={(fundamentals?.profit_margin_percent ?? 0) < 0 ? "negative" : ""}>{formatPercent(fundamentals?.profit_margin_percent)}</span>
              <span className={(fundamentals?.return_on_equity_percent ?? 0) < 0 ? "negative" : ""}>{formatPercent(fundamentals?.return_on_equity_percent)}</span>
              <span className={(fundamentals?.revenue_growth_percent ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(fundamentals?.revenue_growth_percent, true)}</span>
              <span>{formatDebtToEquity(fundamentals?.debt_to_equity)}</span>
              <span>{formatMoney(fundamentals?.net_income)}<small>{fundamentals?.fiscal_date ?? "exercice non date"}</small></span>
              <span><strong>{fundamentals?.data_completeness_score ?? 0}/100</strong><i><b style={{ width: `${fundamentals?.data_completeness_score ?? 0}%` }} /></i></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TechnicalTable({
  positions,
  selectedTicker,
  onSelect,
}: {
  positions: PortfolioPosition[];
  selectedTicker: string;
  onSelect: (ticker: string) => void;
}) {
  return (
    <div className="portfolio-insight-table-wrap">
      <div className="portfolio-technical-table">
        <div className="portfolio-technical-row header">
          <span>Entreprise</span><span>Score</span><span>Tendance</span><span>RSI 14</span>
          <span>SMA 20 / 50</span><span>Volatilite</span><span>Support</span><span>Resistance</span>
        </div>
        {positions.map((position) => (
          <button
            type="button"
            className={`portfolio-technical-row ${selectedTicker === position.ticker ? "selected" : ""}`}
            key={position.ticker}
            aria-pressed={selectedTicker === position.ticker}
            onClick={() => onSelect(position.ticker)}
          >
            <span><strong>{position.ticker}</strong><small>{position.sector}</small></span>
            <span><strong>{position.technical.technical_score == null ? "-" : `${position.technical.technical_score}/100`}</strong><small>{position.technical.signal}</small></span>
            <span className={`trend-${position.technical.trend}`}>{trendLabel(position.technical.trend)}</span>
            <span>{formatNumber(position.technical.rsi)}<small>{(position.technical.rsi ?? 50) >= 70 ? "Surachat" : (position.technical.rsi ?? 50) <= 30 ? "Survente" : "Neutre"}</small></span>
            <span>{formatNumber(position.technical.sma_20)} / {formatNumber(position.technical.sma_50)}<small>{movingAveragePosition(position)}</small></span>
            <span>{formatPercent(position.technical.volatility)}</span>
            <span>{formatNumber(position.technical.support_level)}</span>
            <span>{formatNumber(position.technical.resistance_level)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PositionPriceChart({ position }: { position: PortfolioPosition }) {
  const [period, setPeriod] = useState("3M");
  const [hovered, setHovered] = useState<number | null>(null);
  const prices = position.historical_prices ?? [];
  const periods = [
    { label: "1M", count: 20 },
    { label: "3M", count: 60 },
    { label: "6M", count: 120 },
    { label: "Tout", count: prices.length },
  ];
  const selectedPeriod = periods.find((item) => item.label === period) ?? periods[1];
  const visible = useMemo(
    () => prices.slice(-Math.min(selectedPeriod.count, prices.length)),
    [prices, selectedPeriod.count],
  );

  useEffect(() => {
    setHovered(null);
  }, [position.ticker, period]);

  if (visible.length < 2) {
    return (
      <div className="portfolio-curve-empty">
        <TrendingUp size={20} />
        <strong>Historique insuffisant pour {position.ticker}</strong>
      </div>
    );
  }

  const width = 820;
  const height = 270;
  const padding = { top: 18, right: 18, bottom: 30, left: 54 };
  const lows = visible.map((point) => point.low ?? point.close);
  const highs = visible.map((point) => point.high ?? point.close);
  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  const rangePadding = Math.max((rawMax - rawMin) * 0.12, rawMax * 0.005, 1);
  const min = rawMin - rangePadding;
  const max = rawMax + rangePadding;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number) =>
    padding.left + (index / Math.max(1, visible.length - 1)) * plotWidth;
  const y = (value: number) =>
    padding.top + ((max - value) / Math.max(1, max - min)) * plotHeight;
  const line = visible
    .map((point, index) => `${index ? "L" : "M"} ${x(index).toFixed(2)} ${y(point.close).toFixed(2)}`)
    .join(" ");
  const activeIndex = hovered ?? visible.length - 1;
  const active = visible[activeIndex];
  const first = visible[0].close;
  const variation = first ? ((active.close - first) / first) * 100 : 0;
  const ticks = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);

  return (
    <div className="portfolio-stock-chart">
      <div className="portfolio-stock-chart-toolbar">
        <div>
          <strong>{formatNumber(active.close, ` ${position.currency ?? "USD"}`)}</strong>
          <span className={variation >= 0 ? "positive" : "negative"}>
            {formatPercent(variation, true)}
          </span>
          <small>{formatFullDate(active.date)}</small>
        </div>
        <div className="portfolio-stock-periods" role="tablist" aria-label="Periode du cours">
          {periods.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={period === item.label}
              className={period === item.label ? "active" : ""}
              key={item.label}
              onClick={() => setPeriod(item.label)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Evolution du cours de ${position.ticker} sur ${period}`}
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          setHovered(Math.round(ratio * (visible.length - 1)));
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} />
            <text x={padding.left - 9} y={y(tick) + 4}>{number.format(tick)}</text>
          </g>
        ))}
        <path d={line} />
        {hovered != null ? (
          <g className="portfolio-stock-crosshair">
            <line x1={x(activeIndex)} x2={x(activeIndex)} y1={padding.top} y2={height - padding.bottom} />
            <circle cx={x(activeIndex)} cy={y(active.close)} r="4" />
          </g>
        ) : null}
        <text className="start-date" x={padding.left} y={height - 7}>{formatDate(visible[0].date)}</text>
        <text className="end-date" x={width - padding.right} y={height - 7}>{formatDate(visible[visible.length - 1].date)}</text>
      </svg>
    </div>
  );
}

function PositionRiskScale({ analysis }: { analysis?: IndividualAnalysis }) {
  if (!analysis) {
    return (
      <div className="portfolio-risk-unavailable">
        <Gauge size={20} />
        <strong>Risque non calcule</strong>
        <span>Lancez l&apos;analyse complete pour executer RiskAgent.</span>
      </div>
    );
  }
  const bounded = Math.max(0, Math.min(100, analysis.risk_score));
  return (
    <div className="portfolio-selected-risk">
      <div className="portfolio-selected-risk-head">
        <span>Niveau {riskLevelLabel(analysis.risk_level)}</span>
      </div>
      <RiskScale score={bounded} />
      <div className="portfolio-risk-meta">
        <span>Confiance <strong>{analysis.confidence_score}/100</strong></span>
        <span>Score global <strong>{analysis.global_score}/100</strong></span>
      </div>
      {analysis.key_risks.slice(0, 3).map((risk) => <p key={risk}>{risk}</p>)}
    </div>
  );
}

function TechnicalDetail({ position }: { position: PortfolioPosition }) {
  const technical = position.technical;
  const support = technical.support_level;
  const resistance = technical.resistance_level;
  const price = position.current_price;
  const pricePosition =
    support != null && resistance != null && price != null && resistance > support
      ? Math.max(0, Math.min(100, ((price - support) / (resistance - support)) * 100))
      : 50;
  return (
    <div className="portfolio-selected-metrics">
      <div><span>Score technique</span><strong>{technical.technical_score == null ? "-" : `${technical.technical_score}/100`}</strong><small>{technical.signal}</small></div>
      <div><span>RSI 14</span><strong>{formatNumber(technical.rsi)}</strong><small>{(technical.rsi ?? 50) >= 70 ? "Zone de surachat" : (technical.rsi ?? 50) <= 30 ? "Zone de survente" : "Zone neutre"}</small></div>
      <div><span>SMA 20</span><strong>{formatNumber(technical.sma_20)}</strong><small>Tendance courte</small></div>
      <div><span>SMA 50</span><strong>{formatNumber(technical.sma_50)}</strong><small>Tendance moyenne</small></div>
      <div><span>Volatilite</span><strong>{formatPercent(technical.volatility)}</strong><small>20 dernieres seances</small></div>
      <div><span>Tendance</span><strong className={`trend-${technical.trend}`}>{trendLabel(technical.trend)}</strong><small>{movingAveragePosition(position)}</small></div>
      <div className="portfolio-selected-range">
        <span>Position du cours</span>
        <div><i style={{ left: `${pricePosition}%` }} /></div>
        <small>Support {formatNumber(support)} · Resistance {formatNumber(resistance)}</small>
      </div>
    </div>
  );
}

function CompanyDetail({ position }: { position: PortfolioPosition }) {
  return (
    <div className="portfolio-company-detail">
      <dl>
        <div><dt>Societe</dt><dd>{position.name ?? position.ticker}</dd></div>
        <div><dt>Secteur</dt><dd>{position.sector}</dd></div>
        <div><dt>Industrie</dt><dd>{position.company?.industry ?? "-"}</dd></div>
        <div><dt>Pays</dt><dd>{position.company?.country ?? "-"}</dd></div>
        <div><dt>Bourse</dt><dd>{position.company?.exchange ?? "-"}</dd></div>
        <div><dt>Capitalisation</dt><dd>{formatMoney(position.company?.market_cap)}</dd></div>
        <div><dt>Devise</dt><dd>{position.currency ?? "-"}</dd></div>
        <div><dt>Dernier exercice</dt><dd>{formatFullDate(position.fundamentals?.fiscal_date)}</dd></div>
      </dl>
      {position.company?.website ? (
        <a href={position.company.website} target="_blank" rel="noreferrer">
          Site investisseurs <ExternalLink size={13} />
        </a>
      ) : null}
    </div>
  );
}

function HistoricalDetail({ position }: { position: PortfolioPosition }) {
  const prices = position.historical_prices ?? [];
  const ranges = [
    { label: "1 semaine", count: 5 },
    { label: "1 mois", count: 20 },
    { label: "3 mois", count: 60 },
    { label: "Tout", count: prices.length },
  ];
  return (
    <div className="portfolio-history-detail">
      <div className="portfolio-history-ranges">
        {ranges.map(({ label, count }) => {
          const rows = prices.slice(-Math.min(count, prices.length));
          const start = rows[0]?.close;
          const end = rows[rows.length - 1]?.close;
          const change = start && end ? ((end - start) / start) * 100 : null;
          const high = rows.length ? Math.max(...rows.map((point) => point.high ?? point.close)) : null;
          const low = rows.length ? Math.min(...rows.map((point) => point.low ?? point.close)) : null;
          return (
            <div key={label}>
              <span>{label}</span>
              <strong className={(change ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(change, true)}</strong>
              <small>H {formatNumber(high)} · B {formatNumber(low)}</small>
            </div>
          );
        })}
      </div>
      <div className="portfolio-history-table-wrap">
        <div className="portfolio-history-table">
          <div className="header"><span>Date</span><span>Ouverture</span><span>Plus haut</span><span>Plus bas</span><span>Cloture</span><span>Volume</span></div>
          {prices.slice(-10).reverse().map((point) => (
            <div key={point.date}>
              <strong>{formatFullDate(point.date)}</strong>
              <span>{formatNumber(point.open)}</span>
              <span>{formatNumber(point.high)}</span>
              <span>{formatNumber(point.low)}</span>
              <span>{formatNumber(point.close)}</span>
              <span>{formatCompact(point.volume)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PositionInspector({
  position,
  individualAnalysis,
  onOpenAnalysis,
}: {
  position: PortfolioPosition;
  individualAnalysis?: IndividualAnalysis;
  onOpenAnalysis: (ticker: string) => void;
}) {
  return (
    <div className="portfolio-position-inspector">
      <header>
        <div>
          <span className="portfolio-selected-symbol">{position.ticker}</span>
          <div><strong>{position.name ?? position.ticker}</strong><small>{position.sector} · {position.company?.exchange ?? "Marche non renseigne"}</small></div>
        </div>
        <div className="portfolio-selected-quote">
          <strong>{formatNumber(position.current_price, ` ${position.currency ?? "USD"}`)}</strong>
          <span className={(position.day_change_percent ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(position.day_change_percent, true)}</span>
        </div>
        <button type="button" onClick={() => onOpenAnalysis(position.ticker)}>
          Analyse IA <ExternalLink size={14} />
        </button>
      </header>
      <section className="portfolio-position-risk-section">
        <div className="portfolio-selected-section-title"><Gauge size={15} /><strong>Echelle du risque</strong><span>Meme methode que l&apos;analyse IA</span></div>
        <PositionRiskScale analysis={individualAnalysis} />
      </section>
      <div className="portfolio-position-info-grid">
        <section>
          <div className="portfolio-selected-section-title"><Activity size={15} /><strong>Analyse technique</strong></div>
          <TechnicalDetail position={position} />
        </section>
        <section>
          <div className="portfolio-selected-section-title"><Building2 size={15} /><strong>Societe</strong></div>
          <CompanyDetail position={position} />
        </section>
      </div>
      <section className="portfolio-position-price-section">
        <div className="portfolio-selected-section-title"><TrendingUp size={15} /><strong>Evolution du cours</strong><span>{position.historical_prices?.length ?? 0} seances</span></div>
        <PositionPriceChart position={position} />
      </section>
      <section className="portfolio-position-history-section">
        <div className="portfolio-selected-section-title"><History size={15} /><strong>Donnees historiques</strong><span>10 dernieres seances</span></div>
        <HistoricalDetail position={position} />
      </section>
    </div>
  );
}

export function PortfolioInsights({
  analysis,
  individualAnalyses = [],
  onOpenAnalysis,
  selectedTicker,
  onSelectedTickerChange,
  title = "Lecture financiere de la combinaison",
}: {
  analysis: PortfolioAnalysis;
  individualAnalyses?: PortfolioCompleteAnalysis["individual_analyses"];
  onOpenAnalysis: (ticker: string) => void;
  selectedTicker?: string;
  onSelectedTickerChange?: (ticker: string) => void;
  title?: string;
}) {
  const [internalSelectedTicker, setInternalSelectedTicker] = useState(
    analysis.positions[0]?.ticker ?? "",
  );
  const activeTicker = selectedTicker ?? internalSelectedTicker;
  const selectTicker = (ticker: string) => {
    if (selectedTicker === undefined) {
      setInternalSelectedTicker(ticker);
    }
    onSelectedTickerChange?.(ticker);
  };

  useEffect(() => {
    if (!analysis.positions.some((position) => position.ticker === activeTicker)) {
      const fallbackTicker = analysis.positions[0]?.ticker ?? "";
      if (selectedTicker === undefined) {
        setInternalSelectedTicker(fallbackTicker);
      }
      onSelectedTickerChange?.(fallbackTicker);
    }
  }, [activeTicker, analysis.positions, onSelectedTickerChange, selectedTicker]);

  const selectedPosition =
    analysis.positions.find((position) => position.ticker === activeTicker)
    ?? analysis.positions[0];
  const selectedIndividual = individualAnalyses.find(
    (item) => item.ticker === selectedPosition?.ticker,
  );

  return (
    <section className="portfolio-insights">
      <div className="portfolio-insights-head">
        <div><BarChart3 size={18} /><strong>{title}</strong></div>
        <span>Donnees agregees par le MarketDataAgent et le TechnicalAgent</span>
      </div>

      <div className="portfolio-insight-block portfolio-curve-block">
        <div className="portfolio-insight-title">
          <div><TrendingUp size={16} /><strong>Evolution comparee</strong></div>
          <span>Base 0% au debut de la periode · {analysis.performance.observation_count} seances</span>
        </div>
        <PerformanceCurve analysis={analysis} />
      </div>

      <div className="portfolio-insight-block">
        <div className="portfolio-insight-title">
          <div><Building2 size={16} /><strong>Fondamentaux par position</strong></div>
          <span>Valorisation, rentabilite, croissance et structure financiere</span>
        </div>
        <FundamentalsTable
          positions={analysis.positions}
          selectedTicker={selectedPosition?.ticker ?? ""}
          onSelect={selectTicker}
        />
      </div>

      {selectedPosition ? (
        <div className="portfolio-insight-block">
          <div className="portfolio-insight-title">
            <div><Database size={16} /><strong>Fiche de la position selectionnee</strong></div>
            <span>Cliquez une autre ligne fondamentale pour changer d&apos;entreprise</span>
          </div>
          <PositionInspector
            position={selectedPosition}
            individualAnalysis={selectedIndividual}
            onOpenAnalysis={onOpenAnalysis}
          />
        </div>
      ) : null}

      <div className="portfolio-insight-block">
        <div className="portfolio-insight-title">
          <div><Activity size={16} /><strong>Analyse technique par position</strong></div>
          <span>Les signaux restent interpretes avec le risque et les fondamentaux</span>
        </div>
        <TechnicalTable
          positions={analysis.positions}
          selectedTicker={selectedPosition?.ticker ?? ""}
          onSelect={selectTicker}
        />
      </div>
    </section>
  );
}

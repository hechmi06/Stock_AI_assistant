import os
from datetime import datetime, timezone

import requests
from fastapi import FastAPI
from pydantic import BaseModel, ValidationError

app = FastAPI(title="Stock AI Assistant Backend", version="0.1.0")


class Metric(BaseModel):
    label: str
    value: str


class ChecklistItem(BaseModel):
    title: str
    detail: str
    done: bool


class StockAnalysis(BaseModel):
    ticker: str
    name: str
    sector: str
    price: float
    change: float
    score: int
    signal: str
    text: str
    values: list[float]
    metrics: list[Metric]
    checks: list[ChecklistItem]


class MarketRow(BaseModel):
    symbol: str
    name: str
    bid: float
    mid: float
    ask: float
    spread: float
    variation: float


class BriefItem(BaseModel):
    tag: str
    title: str
    text: str


class Position(BaseModel):
    id: str
    product: str
    symbol: str
    side: str
    notional: str
    entry: float
    maturity: str
    pnl: float


class ForwardSimulation(BaseModel):
    symbol: str
    spot: float
    notional: float
    horizon_days: int
    domestic_rate: float
    foreign_rate: float
    forward_rate: float
    swap_points: float
    differential: float
    counter_value: float


class MarketDashboard(BaseModel):
    source: str
    updated_at: str
    rows: list[MarketRow]
    brief: list[BriefItem]
    positions: list[Position]
    simulation: ForwardSimulation


MOCK_ANALYSES: dict[str, StockAnalysis] = {
    "AAPL": StockAnalysis(
        ticker="AAPL",
        name="Apple Inc.",
        sector="Technologie",
        price=213.40,
        change=1.84,
        score=78,
        signal="Acheter avec prudence",
        text="Fallback local : le serveur MCP market data n'a pas repondu.",
        values=[188, 191, 189, 196, 201, 199, 205, 211, 208, 213],
        metrics=[
            Metric(label="Source", value="Fallback local"),
            Metric(label="PER", value="31.2"),
            Metric(label="Croissance CA", value="+6.1%"),
            Metric(label="Marge nette", value="24.3%"),
        ],
        checks=[
            ChecklistItem(title="MCP", detail="Serveur MCP indisponible ou quota API atteint", done=False),
            ChecklistItem(title="Tendance 30 jours", detail="Prix au-dessus de la moyenne mobile", done=True),
            ChecklistItem(title="Volume", detail="Interet acheteur superieur a la moyenne", done=True),
            ChecklistItem(title="Risque", detail="Volatilite moderee", done=True),
            ChecklistItem(title="Timing", detail="Attendre un repli pour renforcer", done=False),
        ],
    ),
    "TSLA": StockAnalysis(
        ticker="TSLA",
        name="Tesla, Inc.",
        sector="Automobile",
        price=327.80,
        change=-2.12,
        score=58,
        signal="Surveiller",
        text="Fallback local : le serveur MCP market data n'a pas repondu.",
        values=[348, 342, 351, 336, 330, 325, 332, 321, 333, 328],
        metrics=[
            Metric(label="Source", value="Fallback local"),
            Metric(label="PER", value="79.4"),
            Metric(label="Croissance CA", value="+3.8%"),
            Metric(label="Marge nette", value="8.2%"),
        ],
        checks=[
            ChecklistItem(title="MCP", detail="Serveur MCP indisponible ou quota API atteint", done=False),
            ChecklistItem(title="Tendance 30 jours", detail="Tendance encore instable", done=False),
            ChecklistItem(title="Volume", detail="Forts mouvements de court terme", done=True),
            ChecklistItem(title="Risque", detail="Volatilite importante", done=False),
            ChecklistItem(title="Timing", detail="Signal d'entree non confirme", done=False),
        ],
    ),
    "NVDA": StockAnalysis(
        ticker="NVDA",
        name="NVIDIA Corp.",
        sector="Semi-conducteurs",
        price=154.63,
        change=3.05,
        score=86,
        signal="Acheter",
        text="Fallback local : le serveur MCP market data n'a pas repondu.",
        values=[126, 130, 134, 138, 141, 146, 143, 149, 152, 155],
        metrics=[
            Metric(label="Source", value="Fallback local"),
            Metric(label="PER", value="46.7"),
            Metric(label="Croissance CA", value="+52.4%"),
            Metric(label="Marge nette", value="48.9%"),
        ],
        checks=[
            ChecklistItem(title="MCP", detail="Serveur MCP indisponible ou quota API atteint", done=False),
            ChecklistItem(title="Tendance 30 jours", detail="Canal haussier intact", done=True),
            ChecklistItem(title="Volume", detail="Accumulation visible", done=True),
            ChecklistItem(title="Risque", detail="Sensibilite aux attentes tres forte", done=False),
            ChecklistItem(title="Timing", detail="Signal technique favorable", done=True),
        ],
    ),
}


def fallback_market_rows() -> list[MarketRow]:
    return [
        MarketRow(symbol="AAPL", name="Apple Inc.", bid=213.31, mid=213.40, ask=213.49, spread=0.18, variation=1.84),
        MarketRow(symbol="MSFT", name="Microsoft Corp.", bid=497.82, mid=498.05, ask=498.28, spread=0.46, variation=0.72),
        MarketRow(symbol="NVDA", name="NVIDIA Corp.", bid=154.56, mid=154.63, ask=154.70, spread=0.14, variation=3.05),
        MarketRow(symbol="GOOGL", name="Alphabet Inc.", bid=179.16, mid=179.24, ask=179.32, spread=0.16, variation=-0.64),
        MarketRow(symbol="AMZN", name="Amazon.com Inc.", bid=222.11, mid=222.22, ask=222.33, spread=0.22, variation=1.12),
        MarketRow(symbol="META", name="Meta Platforms", bid=602.80, mid=603.08, ask=603.36, spread=0.56, variation=-1.03),
        MarketRow(symbol="TSLA", name="Tesla, Inc.", bid=327.65, mid=327.80, ask=327.95, spread=0.30, variation=-2.12),
        MarketRow(symbol="JPM", name="JPMorgan Chase", bid=239.70, mid=239.82, ask=239.94, spread=0.24, variation=0.38),
    ]


def build_simulation(row: MarketRow) -> ForwardSimulation:
    notional = 250000
    horizon_days = 90
    domestic_rate = 4.3
    foreign_rate = 3.8
    year_fraction = horizon_days / 360
    forward_rate = row.mid * (1 + domestic_rate / 100 * year_fraction) / (1 + foreign_rate / 100 * year_fraction)
    swap_points = forward_rate - row.mid
    differential = ((forward_rate / row.mid) - 1) * 100 if row.mid else 0

    return ForwardSimulation(
        symbol=row.symbol,
        spot=row.mid,
        notional=notional,
        horizon_days=horizon_days,
        domestic_rate=domestic_rate,
        foreign_rate=foreign_rate,
        forward_rate=round(forward_rate, 4),
        swap_points=round(swap_points, 4),
        differential=round(differential, 2),
        counter_value=round(notional * forward_rate, 2),
    )


def fallback_market_dashboard() -> MarketDashboard:
    rows = fallback_market_rows()
    leader = max(rows, key=lambda row: row.variation)
    laggard = min(rows, key=lambda row: row.variation)

    return MarketDashboard(
        source="Fallback AI backend",
        updated_at=datetime.now(timezone.utc).isoformat(),
        rows=rows,
        brief=[
            BriefItem(tag="MCP", title="Serveur MCP indisponible", text="Le backend IA utilise un fallback local en attendant l'outil market data."),
            BriefItem(tag="MARCHE", title=f"{leader.symbol} mene le panier", text=f"{leader.name} progresse de {leader.variation:+.2f}%."),
            BriefItem(tag="RISQUE", title=f"Pression sur {laggard.symbol}", text=f"{laggard.name} recule de {laggard.variation:+.2f}%."),
            BriefItem(tag="IA", title="Analyse degradee", text="Les signaux restent indicatifs tant que les donnees live ne sont pas disponibles."),
        ],
        positions=[
            Position(id="D-2087", product="Forward", symbol=rows[0].symbol, side="Achat", notional="250 000 USD", entry=round(rows[0].mid * 0.98, 4), maturity="23/07/26", pnl=4800),
            Position(id="D-2091", product="Spot", symbol=rows[1].symbol, side="Vente", notional="100 000 USD", entry=round(rows[1].mid * 1.01, 4), maturity="25/04/26", pnl=-1250),
            Position(id="D-2094", product="Swap", symbol=leader.symbol, side="Achat", notional="1 000 000 USD", entry=round(leader.mid * 0.97, 4), maturity="23/05/26", pnl=9200),
            Position(id="D-2098", product="Option", symbol=laggard.symbol, side="Vente", notional="50 000 USD", entry=round(laggard.mid * 1.02, 4), maturity="30/06/26", pnl=780),
        ],
        simulation=build_simulation(rows[0]),
    )


def mcp_get(path: str) -> dict | None:
    base_url = os.getenv("MCP_SERVER_URL", "http://localhost:4100").rstrip("/")
    try:
        response = requests.get(f"{base_url}/{path.lstrip('/')}", timeout=8)
        if not response.ok:
            return None
        return response.json()
    except Exception:
        return None


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "service": "ai-backend",
        "status": "ok",
        "mcp_server_url": os.getenv("MCP_SERVER_URL", "http://localhost:4100"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/analyze/{ticker}", response_model=StockAnalysis)
def analyze_ticker(ticker: str) -> StockAnalysis:
    normalized_ticker = ticker.strip().upper()
    payload = mcp_get(f"analyze/{normalized_ticker}")

    if payload:
      try:
          return StockAnalysis.model_validate(payload)
      except ValidationError:
          pass

    if normalized_ticker in MOCK_ANALYSES:
        return MOCK_ANALYSES[normalized_ticker]

    base = MOCK_ANALYSES["AAPL"].model_copy(deep=True)
    base.ticker = normalized_ticker or "AAPL"
    base.name = f"{base.ticker} Corp."
    base.score = 62
    base.signal = "Analyse preliminaire"
    return base


@app.get("/market-dashboard", response_model=MarketDashboard)
def market_dashboard() -> MarketDashboard:
    payload = mcp_get("market-dashboard")

    if payload:
      try:
          return MarketDashboard.model_validate(payload)
      except ValidationError:
          pass

    return fallback_market_dashboard()

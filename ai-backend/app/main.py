import os
from datetime import datetime, timezone
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ValidationError

from app.agents import (
    MarketDataAgent,
    MarketDataResult,
    NewsAgent,
    NewsResult,
    RagAgent,
    RagIngestResult,
    RagResult,
    RiskAgent,
    RiskResult,
    TechnicalAgent,
    TechnicalResult,
)
from app.agents.evaluation import (
    EvaluationReport,
    evaluate_market_data,
    evaluate_news,
    evaluate_rag,
    evaluate_risk,
    evaluate_technical,
)


def _load_root_env() -> None:
    """Charge le .env racine en local (Docker injecte deja ces variables)."""
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_root_env()

app = FastAPI(title="Stock AI Assistant Backend", version="0.1.0")
market_data_agent = MarketDataAgent()
technical_agent = TechnicalAgent(market_data_agent=market_data_agent)
news_agent = NewsAgent()
risk_agent = RiskAgent(
    market_data_agent=market_data_agent,
    technical_agent=technical_agent,
    news_agent=news_agent,
)
rag_agent = RagAgent(graph=getattr(market_data_agent.memory, "graph", None))


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
    open: float | None = None
    high: float | None = None
    low: float | None = None
    previous_close: float | None = None
    volume: float | None = None


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
    total: int = 0
    page: int = 1
    limit: int = 50
    total_pages: int = 1
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


def mcp_get(path: str, params: dict | None = None, timeout: int = 20) -> dict | None:
    base_url = os.getenv("MCP_SERVER_URL", "http://localhost:4100").rstrip("/")
    try:
        response = requests.get(f"{base_url}/{path.lstrip('/')}", params=params, timeout=timeout)
        if not response.ok:
            return None
        return response.json()
    except Exception:
        return None


def analysis_from_market_data(result: MarketDataResult) -> StockAnalysis | None:
    if result.status == "failed" or result.price is None:
        return None

    values = [point.close for point in result.historical_prices[-10:]]
    if not values and result.price is not None:
        values = [result.price]

    change = result.change_percent or 0
    score = max(15, min(95, round(58 + change * 6)))
    signal = (
        "Acheter"
        if score >= 80
        else "Acheter avec prudence"
        if score >= 65
        else "Surveiller"
        if score >= 50
        else "Eviter pour le moment"
    )
    source_label = ", ".join(result.sources_used) if result.sources_used else "unknown"
    fallback_note = " Fallback interne utilise." if result.used_fallback else ""
    profile = result.company_profile
    has_ratios = any(value is not None for value in result.financial_ratios.values())
    has_statements = any(value is not None for value in result.financial_statements_summary.model_dump().values())
    has_fundamentals = has_ratios or has_statements

    return StockAnalysis(
        ticker=result.ticker,
        name=profile.name or f"{result.ticker} Corp.",
        sector=profile.sector or "Marche actions",
        price=round(result.price, 2),
        change=round(change, 2),
        score=score,
        signal=signal,
        text=(
            "Analyse construite depuis MarketDataAgent. "
            f"Sources utilisees : {source_label}. "
            f"Derniere variation disponible : {change:+.2f}%.{fallback_note}"
        ),
        values=values,
        metrics=[
            Metric(label="Agent", value="MarketDataAgent"),
            Metric(label="Sources", value=source_label),
            Metric(label="Secteur", value=profile.sector or "N/A"),
            Metric(label="Market cap", value=f"{profile.market_cap:,.0f}" if profile.market_cap else "N/A"),
        ],
        checks=[
            ChecklistItem(
                title="Prix",
                detail="Prix recu via une source marche ou un secours interne",
                done=result.price is not None,
            ),
            ChecklistItem(
                title="Historique",
                detail=f"{len(result.historical_prices)} points historiques disponibles",
                done=len(result.historical_prices) > 1,
            ),
            ChecklistItem(
                title="Profil",
                detail=profile.name or "Profil entreprise incomplet",
                done=profile.name is not None,
            ),
            ChecklistItem(
                title="Fondamentaux",
                detail="Fondamentaux disponibles" if has_fundamentals else "Fondamentaux indisponibles",
                done=has_fundamentals,
            ),
            ChecklistItem(
                title="Statut agent",
                detail=result.status,
                done=result.status in {"success", "partial"},
            ),
        ],
    )


@app.get("/health")
def health() -> dict[str, object]:
    slm_enabled = bool(os.getenv("NEBIUS_API_KEY", "").strip()) and os.getenv(
        "NEBIUS_ENABLED", "true"
    ).strip().lower() in {"1", "true", "yes", "on"}
    return {
        "service": "ai-backend",
        "status": "ok",
        "mcp_server_url": os.getenv("MCP_SERVER_URL", "http://localhost:4100"),
        "slm_provider": "nebius",
        "slm_enabled": slm_enabled,
        "slm_base_url": os.getenv("NEBIUS_BASE_URL", "https://api.studio.nebius.com/v1"),
        "slm_model": os.getenv("NEBIUS_MODEL", "Qwen/Qwen3-30B-A3B-Instruct-2507"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/agents/market-data/{ticker}", response_model=MarketDataResult)
def run_market_data_agent(ticker: str, fresh: bool = False) -> MarketDataResult:
    """Collecte de donnees marche. `fresh=true` force une collecte complete (ignore le cache)."""
    return market_data_agent.run(ticker, use_cache=not fresh)


@app.get("/agents/market-data/{ticker}/evaluation", response_model=EvaluationReport)
def evaluate_market_data_agent(ticker: str, fresh: bool = False) -> EvaluationReport:
    result = market_data_agent.run(ticker, use_cache=not fresh)
    return evaluate_market_data(result)


@app.get("/agents/technical/{ticker}", response_model=TechnicalResult)
def run_technical_agent(ticker: str, fresh: bool = False) -> TechnicalResult:
    """Analyse technique calculee depuis les donnees du MarketDataAgent."""
    return technical_agent.run(ticker, use_cache=not fresh)


@app.get("/agents/technical/{ticker}/evaluation", response_model=EvaluationReport)
def evaluate_technical_agent(ticker: str, fresh: bool = False) -> EvaluationReport:
    """Evaluation qualite du TechnicalAgent (memes principes que le MarketDataAgent)."""
    result = technical_agent.run(ticker, use_cache=not fresh)
    return evaluate_technical(result)


@app.get("/agents/technical/{ticker}/memory")
def get_technical_memory(ticker: str) -> dict[str, object]:
    """Memoire temporelle (serie d'indicateurs) + faits techniques du knowledge graph."""
    return technical_agent.memory.summary(ticker.strip().upper())


@app.get("/agents/news/{ticker}", response_model=NewsResult)
def run_news_agent(ticker: str, fresh: bool = False, name: str | None = None) -> NewsResult:
    """Actualites + sentiment via le NewsAgent (FMP + Yahoo RSS, analyse SLM).

    `name` (nom de societe) active le filtre de pertinence des articles.
    """
    return news_agent.run(ticker, use_cache=not fresh, company_name=name)


@app.get("/agents/news/{ticker}/evaluation", response_model=EvaluationReport)
def evaluate_news_agent(ticker: str, fresh: bool = False) -> EvaluationReport:
    """Evaluation qualite du NewsAgent (memes principes que les autres agents)."""
    result = news_agent.run(ticker, use_cache=not fresh)
    return evaluate_news(result)


@app.get("/agents/news/{ticker}/memory")
def get_news_memory(ticker: str) -> dict[str, object]:
    """Memoire documentaire (articles connus, historique de sentiment) + faits news du graphe."""
    return news_agent.memory.summary(ticker.strip().upper())


@app.get("/agents/risk/{ticker}", response_model=RiskResult)
def run_risk_agent(ticker: str, fresh: bool = False) -> RiskResult:
    """Diagnostic de risque via MarketDataAgent + TechnicalAgent + NewsAgent."""
    return risk_agent.run(ticker, use_cache=not fresh)


@app.post("/agents/rag/{ticker}/ingest", response_model=RagIngestResult)
def ingest_rag_documents(ticker: str, limit: int = 2) -> RagIngestResult:
    """Indexe les 10-K/10-Q SEC EDGAR d'un ticker dans la base vectorielle."""
    return rag_agent.ingest(ticker, limit=limit)


@app.get("/agents/rag/{ticker}/query", response_model=RagResult)
def query_rag_documents(ticker: str, q: str) -> RagResult:
    """Interroge les documents financiers indexes et renvoie une reponse sourcee."""
    return rag_agent.query(ticker, q)


@app.get("/agents/rag/{ticker}/evaluation", response_model=EvaluationReport)
def evaluate_rag_agent(ticker: str) -> EvaluationReport:
    """Evaluation qualite du RAGAgent : ingere si besoin puis evalue une requete standard."""
    question = "What are the main risk factors and business segments of the company?"
    result = rag_agent.query(ticker, question)
    if result.status == "failed" and result.indexed_chunks == 0:
        rag_agent.ingest(ticker, limit=1)
        result = rag_agent.query(ticker, question)
    return evaluate_rag(result)


@app.get("/agents/risk/{ticker}/evaluation", response_model=EvaluationReport)
def evaluate_risk_agent(ticker: str, fresh: bool = False) -> EvaluationReport:
    """Evaluation qualite du RiskAgent (coherence du diagnostic et tracabilite)."""
    result = risk_agent.run(ticker, use_cache=not fresh)
    return evaluate_risk(result)


@app.get("/agents/risk/{ticker}/memory")
def get_risk_memory(ticker: str) -> dict[str, object]:
    """Faits de risque sauvegardes dans le knowledge graph."""
    subject = ticker.strip().upper()
    graph = risk_agent.graph
    return {"subject": subject, "facts": graph.facts_for(subject)}


@app.get("/agents/market-data/{ticker}/memory")
def get_market_data_memory(ticker: str) -> dict[str, object]:
    """Memoire structuree + faits du knowledge graph pour un ticker."""
    return market_data_agent.memory.summary(ticker.strip().upper())


@app.get("/agents/memory/graph")
def get_knowledge_graph(subject: str | None = None) -> dict[str, object]:
    """Faits du knowledge graph (tous, ou filtres par sujet ex. ?subject=AAPL)."""
    graph = market_data_agent.memory.graph
    facts = graph.facts_for(subject.strip().upper()) if subject else graph.all_facts()
    return {"subject": subject, "count": len(facts), "facts": facts}


@app.get("/analyze/{ticker}", response_model=StockAnalysis)
def analyze_ticker(ticker: str) -> StockAnalysis:
    normalized_ticker = ticker.strip().upper()
    market_data_result = market_data_agent.run(normalized_ticker)
    market_data_analysis = analysis_from_market_data(market_data_result)

    if market_data_analysis:
        return market_data_analysis

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
def market_dashboard(page: int = 1, limit: int = 50, search: str = "") -> MarketDashboard:
    payload = mcp_get(
        "market-dashboard",
        {"page": max(1, page), "limit": max(1, min(limit, 100)), "search": search.strip()},
        timeout=90,
    )

    if payload:
        try:
            return MarketDashboard.model_validate(payload)
        except ValidationError as exc:
            raise HTTPException(status_code=502, detail="Reponse MCP market dashboard invalide") from exc

    raise HTTPException(status_code=503, detail="Serveur MCP market data indisponible")


@app.get("/stocks/us")
def list_us_stocks(search: str = "", limit: int = 50, offset: int = 0) -> dict[str, object]:
    payload = mcp_get(
        "stocks/us",
        {"search": search.strip(), "limit": max(1, min(limit, 100)), "offset": max(0, offset)},
        timeout=30,
    )
    if payload:
        return payload
    return {"total": 0, "offset": offset, "limit": limit, "symbols": []}

import os
from datetime import datetime, timezone

from app.memory import AgentMemory

from .mcp_client import McpClient
from .nebius_client import NebiusClient
from .schemas import MarketDataResult, MarketDataSource, SlmSummary

DEFAULT_CACHE_TTL_SECONDS = 900  # 15 minutes


def _cache_ttl_seconds() -> int:
    raw = os.getenv("MARKET_DATA_CACHE_TTL_SECONDS", "").strip()
    if not raw:
        return DEFAULT_CACHE_TTL_SECONDS
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_CACHE_TTL_SECONDS


class MarketDataAgent:
    def __init__(
        self,
        mcp_client: McpClient | None = None,
        slm_client: NebiusClient | None = None,
        memory: AgentMemory | None = None,
    ) -> None:
        self.mcp_client = mcp_client or McpClient()
        self.slm_client = slm_client or NebiusClient()
        self.memory = memory or AgentMemory()

    def run(
        self,
        ticker: str,
        period: str = "6mo",
        with_slm: bool = True,
        use_cache: bool = True,
    ) -> MarketDataResult:
        normalized_ticker = ticker.strip().upper()
        if not normalized_ticker:
            return MarketDataResult(
                ticker="",
                status="failed",
                errors=["Ticker is required."],
            )

        if use_cache:
            cached = self._from_cache(normalized_ticker, with_slm)
            if cached is not None:
                return cached

        payload = self.mcp_client.get(f"market-data/{normalized_ticker}?period={period}")
        if not payload:
            return self._recall_from_memory(normalized_ticker)

        result = self._normalize_payload(normalized_ticker, payload)
        if result.price is not None and result.historical_prices and result.company_profile.name and not result.errors:
            result.status = "success"
        elif result.price is not None or result.historical_prices or result.company_profile.name:
            result.status = "partial"
        else:
            result.status = "failed"
            if not result.errors:
                result.errors.append("No usable market data was returned.")

        if with_slm:
            self._add_slm_summary(result)
        if result.status != "failed":
            self.memory.remember(result)
        return result

    def _from_cache(self, ticker: str, with_slm: bool) -> MarketDataResult | None:
        """Reutilise la derniere collecte memorisee si elle est plus recente que le TTL."""
        ttl = _cache_ttl_seconds()
        if ttl <= 0:
            return None

        remembered = self.memory.recall_latest(ticker)
        if remembered is None:
            return None

        result, collected_at = remembered
        # Garde de qualite : ne jamais resservir un snapshot degrade (collecte
        # faite pendant un rate-limit par exemple). Mieux vaut recollector.
        if result.status == "failed" or result.price is None or not result.historical_prices:
            return None

        try:
            collected = datetime.fromisoformat(collected_at)
        except ValueError:
            return None
        age_seconds = (datetime.now(timezone.utc) - collected).total_seconds()
        if age_seconds < 0 or age_seconds > ttl:
            return None

        # La collecte a pu etre memorisee sans resume SLM (appel interne) :
        # on le complete ici sans relancer toute la collecte.
        if with_slm and result.slm_summary is None:
            self._add_slm_summary(result)

        result.warnings.append(
            f"Cache memoire : collecte du {collected_at} reutilisee (age {int(age_seconds)}s, TTL {ttl}s)."
        )
        return result

    def _recall_from_memory(self, ticker: str) -> MarketDataResult:
        """Le MCP ne repond pas : ressert la derniere collecte memorisee si possible."""
        remembered = self.memory.recall_latest(ticker)
        if remembered is None:
            return MarketDataResult(
                ticker=ticker,
                status="failed",
                errors=["MCP market-data endpoint did not return data."],
            )
        result, collected_at = remembered
        result.status = "partial"
        result.warnings.append(
            f"MCP indisponible : donnees servies depuis la memoire de l'agent (collecte du {collected_at})."
        )
        return result

    def _normalize_payload(self, ticker: str, payload: dict) -> MarketDataResult:
        price_payload = payload.get("price")
        sources = self._sources(payload.get("sources_used"))
        # Les messages remontes par le MCP sont des degradations de source
        # (rate limit, source indisponible) : ce sont des warnings, pas des
        # erreurs fatales. Les erreurs fatales sont ajoutees au niveau de l'agent.
        warnings = [str(warning) for warning in payload.get("errors", []) if warning]

        result = MarketDataResult.model_validate(
            {
                "ticker": str(payload.get("ticker") or ticker).upper(),
                "status": "partial",
                "sources_used": sources,
                "used_fallback": bool(payload.get("used_fallback", False)),
                "price": price_payload.get("price") if isinstance(price_payload, dict) else None,
                "change_percent": price_payload.get("change_percent") if isinstance(price_payload, dict) else None,
                "historical_prices": payload.get("historical_prices") or [],
                "company_profile": payload.get("company_profile") or {},
                "financial_ratios": payload.get("financial_ratios") or {},
                "financial_statements_summary": payload.get("financial_statements_summary") or {},
                "warnings": warnings,
                "errors": [],
                "raw_price": price_payload if isinstance(price_payload, dict) else None,
            }
        )

        # "fallback" n'est pas une vraie source de marche : il est deja signale
        # par used_fallback et ne doit pas entrer dans sources_used (sinon le
        # snapshot memorise ne repasse plus la validation du schema).
        if (
            result.raw_price
            and result.raw_price.source != "fallback"
            and result.raw_price.source not in result.sources_used
        ):
            result.sources_used.append(result.raw_price.source)

        return result

    def _add_slm_summary(self, result: MarketDataResult) -> None:
        if result.status == "failed":
            return

        try:
            summary = self.slm_client.summarize_market_data(result.model_dump())
            if summary:
                result.slm_summary = SlmSummary.model_validate(summary)
        except Exception as error:
            result.errors.append(f"Nebius SLM unavailable: {error}")

    def _sources(self, value: object) -> list[MarketDataSource]:
        allowed = {"twelve_data", "yfinance", "alpha_vantage", "financial_modeling_prep"}
        if not isinstance(value, list):
            return []
        return [source for source in value if source in allowed]

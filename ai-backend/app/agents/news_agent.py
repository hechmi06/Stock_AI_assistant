"""NewsAgent : actualites + sentiment.

Consomme l'outil news du serveur MCP (FMP + Yahoo RSS), analyse le sentiment
via le SLM Nebius (un seul appel batch) et memorise articles et evenements
dans la memoire documentaire + le knowledge graph partage.
"""

import os
from datetime import datetime, timezone

from app.memory import NewsAgentMemory

from .mcp_client import McpClient
from .nebius_client import NebiusClient
from .schemas import NewsResult, SlmSummary

DEFAULT_CACHE_TTL_SECONDS = 1800  # 30 minutes : les news bougent plus vite que les fondamentaux


def _cache_ttl_seconds() -> int:
    raw = os.getenv("NEWS_CACHE_TTL_SECONDS", "").strip()
    if not raw:
        return DEFAULT_CACHE_TTL_SECONDS
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_CACHE_TTL_SECONDS


class NewsAgent:
    def __init__(
        self,
        mcp_client: McpClient | None = None,
        slm_client: NebiusClient | None = None,
        memory: NewsAgentMemory | None = None,
    ) -> None:
        self.mcp_client = mcp_client or McpClient()
        self.slm_client = slm_client or NebiusClient.for_agent("news")
        self.memory = memory or NewsAgentMemory()

    def run(self, ticker: str, use_cache: bool = True) -> NewsResult:
        normalized_ticker = ticker.strip().upper()
        if not normalized_ticker:
            return NewsResult(ticker="", status="failed", errors=["Ticker is required."])

        if use_cache:
            cached = self._from_cache(normalized_ticker)
            if cached is not None:
                return cached

        payload = self.mcp_client.get(f"news/{normalized_ticker}")
        if not payload:
            return self._recall_from_memory(normalized_ticker)

        result = self._normalize_payload(normalized_ticker, payload)

        if result.articles:
            self._add_sentiment_analysis(result)
            result.status = "success" if result.sentiment_label else "partial"
        else:
            result.status = "failed"
            if not result.errors:
                result.errors.append("No news articles were returned for this ticker.")

        if result.status != "failed":
            self.memory.remember(result)
        return result

    def _from_cache(self, ticker: str) -> NewsResult | None:
        """Reutilise la derniere analyse si elle est plus recente que le TTL."""
        ttl = _cache_ttl_seconds()
        if ttl <= 0:
            return None

        remembered = self.memory.recall_latest(ticker)
        if remembered is None:
            return None

        result, collected_at = remembered
        if result.status == "failed" or not result.articles:
            return None

        try:
            collected = datetime.fromisoformat(collected_at)
        except ValueError:
            return None
        age_seconds = (datetime.now(timezone.utc) - collected).total_seconds()
        if age_seconds < 0 or age_seconds > ttl:
            return None

        result.warnings.append(
            f"Cache memoire : analyse news du {collected_at} reutilisee (age {int(age_seconds)}s, TTL {ttl}s)."
        )
        return result

    def _recall_from_memory(self, ticker: str) -> NewsResult:
        """Le MCP ne repond pas : ressert la derniere analyse memorisee si possible."""
        remembered = self.memory.recall_latest(ticker)
        if remembered is None:
            return NewsResult(
                ticker=ticker,
                status="failed",
                errors=["MCP news endpoint did not return data."],
            )
        result, collected_at = remembered
        result.status = "partial"
        result.warnings.append(
            f"MCP indisponible : news servies depuis la memoire de l'agent (analyse du {collected_at})."
        )
        return result

    def _normalize_payload(self, ticker: str, payload: dict) -> NewsResult:
        # Les erreurs remontees par le MCP sont des degradations de source
        # (flux indisponible, quota) : warnings, pas erreurs fatales.
        warnings = [str(warning) for warning in payload.get("errors", []) if warning]

        return NewsResult.model_validate(
            {
                "ticker": str(payload.get("ticker") or ticker).upper(),
                "status": "partial",
                "articles": payload.get("articles") or [],
                "sources_used": payload.get("sources_used") or [],
                "warnings": warnings,
                "errors": [],
            }
        )

    def _add_sentiment_analysis(self, result: NewsResult) -> None:
        try:
            analysis = self.slm_client.analyze_news(result.model_dump())
        except Exception as error:
            result.errors.append(f"Nebius SLM unavailable: {error}")
            return

        if not analysis:
            return

        result.sentiment_label = analysis.get("sentiment_label")
        score = analysis.get("sentiment_score")
        if isinstance(score, (int, float)):
            result.sentiment_score = max(-1.0, min(1.0, float(score)))
        result.key_events = list(analysis.get("key_events") or [])

        article_sentiments = analysis.get("article_sentiments") or {}
        for index, sentiment in article_sentiments.items():
            if 0 <= index < len(result.articles):
                result.articles[index].sentiment = sentiment

        result.slm_summary = SlmSummary.model_validate(
            {
                "provider": analysis.get("provider", "nebius"),
                "model": analysis.get("model", ""),
                "summary": analysis.get("summary", ""),
                "data_quality": analysis.get("data_quality", "unknown"),
                "key_points": analysis.get("key_points") or [],
                "warnings": analysis.get("warnings") or [],
            }
        )

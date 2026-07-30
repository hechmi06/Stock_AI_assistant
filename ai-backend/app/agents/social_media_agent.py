"""SocialMediaAgent Reddit independant."""

import os
from datetime import datetime, timezone
from urllib.parse import quote

from .mcp_client import McpClient
from .nebius_client import NebiusClient
from .schemas import SlmSummary, SocialMediaResult

DEFAULT_CACHE_TTL_SECONDS = 900


def _cache_ttl_seconds() -> int:
    raw = os.getenv("SOCIAL_MEDIA_CACHE_TTL_SECONDS", "").strip()
    if not raw:
        return DEFAULT_CACHE_TTL_SECONDS
    try:
        return max(0, int(raw))
    except ValueError:
        return DEFAULT_CACHE_TTL_SECONDS


class SocialMediaAgent:
    """Collecte et resume le signal social sans alimenter les autres agents."""

    def __init__(
        self,
        mcp_client: McpClient | None = None,
        slm_client: NebiusClient | None = None,
    ) -> None:
        self.mcp_client = mcp_client or McpClient()
        self.slm_client = slm_client or NebiusClient.for_agent("social_media")
        self._cache: dict[str, tuple[datetime, SocialMediaResult]] = {}

    def run(
        self,
        ticker: str,
        use_cache: bool = True,
        with_slm: bool = True,
        company_name: str | None = None,
    ) -> SocialMediaResult:
        normalized_ticker = ticker.strip().upper()
        if not normalized_ticker:
            return SocialMediaResult(
                ticker="",
                status="failed",
                errors=["Ticker is required."],
            )

        cached = self._from_cache(normalized_ticker) if use_cache else None
        if cached is not None:
            return cached

        query = ""
        if company_name and company_name.strip():
            query = f"?name={quote(company_name.strip())}"
        payload = self.mcp_client.get(
            f"social-media/{normalized_ticker}{query}",
            timeout=25,
        )
        if not payload:
            return SocialMediaResult(
                ticker=normalized_ticker,
                status="failed",
                errors=["MCP social-media endpoint did not return data."],
            )

        result = self._normalize_payload(normalized_ticker, payload)
        if result.posts and with_slm:
            self._add_sentiment_analysis(result)

        successful_sources = len(result.sources_used)
        if not result.posts:
            result.status = "failed"
            result.errors.append(
                "No public Reddit posts were returned for this ticker."
            )
        elif successful_sources == 1:
            result.status = "success"
        else:
            result.status = "partial"

        if result.posts:
            self._cache[normalized_ticker] = (
                datetime.now(timezone.utc),
                result.model_copy(deep=True),
            )
        return result

    def _from_cache(self, ticker: str) -> SocialMediaResult | None:
        remembered = self._cache.get(ticker)
        ttl = _cache_ttl_seconds()
        if remembered is None or ttl <= 0:
            return None
        collected_at, result = remembered
        age_seconds = (datetime.now(timezone.utc) - collected_at).total_seconds()
        if age_seconds < 0 or age_seconds > ttl:
            return None
        cached = result.model_copy(deep=True)
        cached.warnings.append(
            f"Cache social reutilise (age {int(age_seconds)}s, TTL {ttl}s)."
        )
        return cached

    @staticmethod
    def _normalize_payload(ticker: str, payload: dict) -> SocialMediaResult:
        warnings = [str(item) for item in payload.get("errors", []) if item]
        return SocialMediaResult.model_validate(
            {
                "ticker": str(payload.get("ticker") or ticker).upper(),
                "status": "partial",
                "collected_at": payload.get("collected_at"),
                "posts": payload.get("posts") or [],
                "sources_used": payload.get("sources_used") or [],
                "source_status": payload.get("source_status") or {},
                "warnings": warnings,
                "errors": [],
            }
        )

    def _add_sentiment_analysis(self, result: SocialMediaResult) -> None:
        try:
            analysis = self.slm_client.analyze_social_media(result.model_dump())
        except Exception as error:
            result.warnings.append(f"Social SLM unavailable: {error}")
            return
        if not analysis:
            return

        label = str(analysis.get("sentiment_label") or "").strip().lower()
        if label in {"positive", "negative", "neutral", "mixed"}:
            result.sentiment_label = label  # type: ignore[assignment]
        score = analysis.get("sentiment_score")
        if isinstance(score, (int, float)):
            result.sentiment_score = max(-1.0, min(1.0, float(score)))
        result.themes = [
            str(item) for item in (analysis.get("themes") or [])[:5] if item
        ]
        result.summary = str(analysis.get("summary") or "").strip() or None

        post_sentiments = analysis.get("post_sentiments") or []
        if isinstance(post_sentiments, list):
            for item in post_sentiments:
                if not isinstance(item, dict):
                    continue
                index = item.get("index")
                sentiment = str(item.get("sentiment") or "").strip().lower()
                if (
                    isinstance(index, int)
                    and 0 <= index < len(result.posts)
                    and sentiment in {"positive", "negative", "neutral", "mixed"}
                ):
                    result.posts[index].sentiment = sentiment  # type: ignore[assignment]

        result.slm_summary = SlmSummary.model_validate(
            {
                "provider": "nebius",
                "model": self.slm_client.model,
                "summary": result.summary or "",
                "data_quality": str(analysis.get("data_quality") or "unknown"),
                "key_points": [
                    str(item)
                    for item in (analysis.get("key_points") or [])
                    if item
                ],
                "warnings": [
                    str(item)
                    for item in (analysis.get("warnings") or [])
                    if item
                ],
            }
        )

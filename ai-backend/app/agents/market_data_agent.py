from .mcp_client import McpClient
from .ollama_client import OllamaClient
from .schemas import MarketDataResult, MarketDataSource, SlmSummary


class MarketDataAgent:
    def __init__(self, mcp_client: McpClient | None = None, ollama_client: OllamaClient | None = None) -> None:
        self.mcp_client = mcp_client or McpClient()
        self.ollama_client = ollama_client or OllamaClient()

    def run(self, ticker: str, period: str = "6mo") -> MarketDataResult:
        normalized_ticker = ticker.strip().upper()
        if not normalized_ticker:
            return MarketDataResult(
                ticker="",
                status="failed",
                errors=["Ticker is required."],
            )

        payload = self.mcp_client.get(f"market-data/{normalized_ticker}?period={period}")
        if not payload:
            return MarketDataResult(
                ticker=normalized_ticker,
                status="failed",
                errors=["MCP market-data endpoint did not return data."],
            )

        result = self._normalize_payload(normalized_ticker, payload)
        if result.price is not None and result.historical_prices and result.company_profile.name and not result.errors:
            result.status = "success"
        elif result.price is not None or result.historical_prices or result.company_profile.name:
            result.status = "partial"
        else:
            result.status = "failed"
            if not result.errors:
                result.errors.append("No usable market data was returned.")

        self._add_slm_summary(result)
        return result

    def _normalize_payload(self, ticker: str, payload: dict) -> MarketDataResult:
        price_payload = payload.get("price")
        sources = self._sources(payload.get("sources_used"))
        errors = [str(error) for error in payload.get("errors", []) if error]

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
                "errors": errors,
                "raw_price": price_payload if isinstance(price_payload, dict) else None,
            }
        )

        if result.raw_price and result.raw_price.source not in result.sources_used:
            result.sources_used.append(result.raw_price.source)

        return result

    def _add_slm_summary(self, result: MarketDataResult) -> None:
        if result.status == "failed":
            return

        try:
            summary = self.ollama_client.summarize_market_data(result.model_dump())
            if summary:
                result.slm_summary = SlmSummary.model_validate(summary)
        except Exception as error:
            result.errors.append(f"Ollama SLM unavailable: {error}")

    def _sources(self, value: object) -> list[MarketDataSource]:
        allowed = {"twelve_data", "yfinance", "alpha_vantage", "financial_modeling_prep"}
        if not isinstance(value, list):
            return []
        return [source for source in value if source in allowed]

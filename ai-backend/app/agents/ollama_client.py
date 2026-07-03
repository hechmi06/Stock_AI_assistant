import json
import os
from typing import Any

import requests


class OllamaClient:
    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
        self.model = model or os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

    def is_enabled(self) -> bool:
        value = os.getenv("OLLAMA_ENABLED", "false").strip().lower()
        return value in {"1", "true", "yes", "on"}

    def summarize_market_data(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not self.is_enabled():
            return None

        prompt = self._build_prompt(payload)
        response = requests.post(
            f"{self.base_url}/api/generate",
            json={
                "model": self.model,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {
                    "temperature": 0.1,
                    "num_ctx": 4096,
                },
            },
            timeout=45,
        )
        response.raise_for_status()
        body = response.json()
        raw_text = body.get("response")
        if not isinstance(raw_text, str) or not raw_text.strip():
            return None

        parsed = json.loads(raw_text)
        if not isinstance(parsed, dict):
            return None

        return {
            "provider": "ollama",
            "model": self.model,
            "summary": str(parsed.get("summary") or ""),
            "data_quality": str(parsed.get("data_quality") or "unknown"),
            "key_points": self._string_list(parsed.get("key_points")),
            "warnings": self._string_list(parsed.get("warnings")),
        }

    def _build_prompt(self, payload: dict[str, Any]) -> str:
        compact_payload = {
            "ticker": payload.get("ticker"),
            "status": payload.get("status"),
            "sources_used": payload.get("sources_used"),
            "used_fallback": payload.get("used_fallback"),
            "price": payload.get("price"),
            "change_percent": payload.get("change_percent"),
            "historical_points_count": len(payload.get("historical_prices") or []),
            "company_profile": payload.get("company_profile"),
            "financial_ratios": payload.get("financial_ratios"),
            "financial_statements_summary": payload.get("financial_statements_summary"),
            "financial_statements_missing_fields": self._missing_financial_statement_fields(
                payload.get("financial_statements_summary")
            ),
            "errors": payload.get("errors"),
        }

        return (
            "Tu es un SLM de controle qualite pour un agent de collecte de donnees boursieres.\n"
            "Tu ne dois jamais inventer de chiffres et tu ne dois pas donner de recommandation d'achat/vente.\n"
            "Analyse uniquement la qualite et la signification des donnees fournies.\n"
            "Si une source secondaire echoue mais qu'une autre source a fourni la donnee, considere la donnee comme disponible.\n"
            "Utilise financial_statements_missing_fields pour savoir quels champs financiers sont vraiment absents.\n"
            "Reponds uniquement en JSON valide avec exactement ces champs:\n"
            "{\n"
            '  "summary": "resume court en francais",\n'
            '  "data_quality": "excellent | bon | partiel | faible",\n'
            '  "key_points": ["point 1", "point 2", "point 3"],\n'
            '  "warnings": ["limite ou erreur importante"]\n'
            "}\n\n"
            f"DONNEES:\n{json.dumps(compact_payload, ensure_ascii=True)}"
        )

    def _missing_financial_statement_fields(self, value: Any) -> list[str]:
        if not isinstance(value, dict):
            return [
                "fiscal_date",
                "total_revenue",
                "net_income",
                "total_assets",
                "total_debt",
                "operating_cashflow",
            ]

        fields = [
            "fiscal_date",
            "total_revenue",
            "net_income",
            "total_assets",
            "total_debt",
            "operating_cashflow",
        ]
        return [field for field in fields if value.get(field) is None]

    def _string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value if item]

import json
import os
from typing import Any

import requests

DEFAULT_BASE_URL = "https://api.studio.nebius.com/v1"
DEFAULT_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"


class NebiusClient:
    """SLM de controle qualite via l'API Nebius (compatible OpenAI).

    Le modele lit les donnees deja collectees par MarketDataAgent et produit un
    resume de qualite. Il n'invente aucun chiffre et ne donne pas de
    recommandation d'achat/vente.
    """

    def __init__(self, base_url: str | None = None, model: str | None = None, api_key: str | None = None) -> None:
        self.base_url = (base_url or os.getenv("NEBIUS_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
        self.model = model or os.getenv("NEBIUS_MODEL", DEFAULT_MODEL)
        self.api_key = (api_key or os.getenv("NEBIUS_API_KEY", "")).strip()

    def is_enabled(self) -> bool:
        if not self.api_key:
            return False
        value = os.getenv("NEBIUS_ENABLED", "true").strip().lower()
        return value in {"1", "true", "yes", "on"}

    def summarize_market_data(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not self.is_enabled():
            return None
        return self._complete_json(self._system_prompt(), self._build_prompt(payload))

    def summarize_technical_data(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not self.is_enabled():
            return None
        return self._complete_json(
            self._technical_system_prompt(), self._build_technical_prompt(payload)
        )

    def _complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any] | None:
        response = requests.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
            timeout=45,
        )
        response.raise_for_status()
        body = response.json()
        choices = body.get("choices")
        if not isinstance(choices, list) or not choices:
            return None

        raw_text = choices[0].get("message", {}).get("content")
        if not isinstance(raw_text, str) or not raw_text.strip():
            return None

        parsed = json.loads(raw_text)
        if not isinstance(parsed, dict):
            return None

        return {
            "provider": "nebius",
            "model": self.model,
            "summary": str(parsed.get("summary") or ""),
            "data_quality": str(parsed.get("data_quality") or "unknown"),
            "key_points": self._string_list(parsed.get("key_points")),
            "warnings": self._string_list(parsed.get("warnings")),
        }

    def _system_prompt(self) -> str:
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
            "}"
        )

    def _technical_system_prompt(self) -> str:
        return (
            "Tu es un SLM de controle qualite pour un agent d'analyse technique boursiere.\n"
            "Les indicateurs (RSI, moyennes mobiles, volatilite, support/resistance, score) sont deja calcules :\n"
            "tu ne recalcules rien, tu n'inventes aucun chiffre et tu ne donnes pas de recommandation d'achat/vente.\n"
            "Ton role : evaluer la coherence des indicateurs entre eux, resumer ce qu'ils indiquent\n"
            "et signaler les limites (historique court, volume anormal, indicateurs contradictoires).\n"
            "Reponds uniquement en JSON valide avec exactement ces champs:\n"
            "{\n"
            '  "summary": "resume court en francais",\n'
            '  "data_quality": "excellent | bon | partiel | faible",\n'
            '  "key_points": ["point 1", "point 2", "point 3"],\n'
            '  "warnings": ["limite ou incoherence importante"]\n'
            "}"
        )

    def _build_technical_prompt(self, payload: dict[str, Any]) -> str:
        compact_payload = {
            "ticker": payload.get("ticker"),
            "status": payload.get("status"),
            "sources_used": payload.get("sources_used"),
            "rsi": payload.get("rsi"),
            "moving_averages": payload.get("moving_averages"),
            "volatility": payload.get("volatility"),
            "trend": payload.get("trend"),
            "support_level": payload.get("support_level"),
            "resistance_level": payload.get("resistance_level"),
            "volume_analysis": payload.get("volume_analysis"),
            "technical_score": payload.get("technical_score"),
            "signal": payload.get("signal"),
            "errors": payload.get("errors"),
        }
        return f"INDICATEURS TECHNIQUES:\n{json.dumps(compact_payload, ensure_ascii=True)}"

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

        return f"DONNEES:\n{json.dumps(compact_payload, ensure_ascii=True)}"

    def _missing_financial_statement_fields(self, value: Any) -> list[str]:
        fields = [
            "fiscal_date",
            "total_revenue",
            "net_income",
            "total_assets",
            "total_debt",
            "operating_cashflow",
        ]
        if not isinstance(value, dict):
            return fields
        return [field for field in fields if value.get(field) is None]

    def _string_list(self, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value if item]

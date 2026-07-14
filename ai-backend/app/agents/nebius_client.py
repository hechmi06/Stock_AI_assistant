import json
import os
from typing import Any

import requests

DEFAULT_BASE_URL = "https://api.studio.nebius.com/v1"
DEFAULT_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"


def resolve_nebius_model(agent: str | None = None) -> str:
    """Modele Nebius : NEBIUS_MODEL_{AGENT} optionnel, sinon NEBIUS_MODEL."""
    if agent:
        override = os.getenv(f"NEBIUS_MODEL_{agent.upper()}", "").strip()
        if override:
            return override
    return os.getenv("NEBIUS_MODEL", DEFAULT_MODEL)


class NebiusClient:
    """SLM de controle qualite via l'API Nebius (compatible OpenAI).

    Le modele lit les donnees deja collectees par MarketDataAgent et produit un
    resume de qualite. Il n'invente aucun chiffre et ne donne pas de
    recommandation d'achat/vente.
    """

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        agent: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("NEBIUS_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
        self.model = model or resolve_nebius_model(agent)
        self.api_key = (api_key or os.getenv("NEBIUS_API_KEY", "")).strip()

    @classmethod
    def for_agent(cls, agent: str) -> "NebiusClient":
        return cls(agent=agent)

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

    def summarize_risk_data(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if not self.is_enabled():
            return None
        return self._complete_json(self._risk_system_prompt(), self._build_risk_prompt(payload))

    def analyze_news(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        """Analyse de sentiment des news : un seul appel batch pour tous les articles.

        Renvoie un dict brut avec summary, data_quality, key_points, warnings,
        sentiment_label, sentiment_score et article_sentiments (par index).
        """
        if not self.is_enabled():
            return None

        parsed = self._chat_json(self._news_system_prompt(), self._build_news_prompt(payload))
        if parsed is None:
            return None

        sentiments = {"positive", "negative", "neutral", "mixed"}
        label = str(parsed.get("sentiment_label") or "").strip().lower()
        score = parsed.get("sentiment_score")

        article_sentiments: dict[int, str] = {}
        raw_articles = parsed.get("article_sentiments")
        if isinstance(raw_articles, list):
            for item in raw_articles:
                if not isinstance(item, dict):
                    continue
                index = item.get("index")
                sentiment = str(item.get("sentiment") or "").strip().lower()
                if isinstance(index, int) and sentiment in sentiments:
                    article_sentiments[index] = sentiment

        return {
            "provider": "nebius",
            "model": self.model,
            "summary": str(parsed.get("summary") or ""),
            "data_quality": str(parsed.get("data_quality") or "unknown"),
            "key_points": self._string_list(parsed.get("key_events")),
            "warnings": self._string_list(parsed.get("warnings")),
            "sentiment_label": label if label in sentiments else None,
            "sentiment_score": float(score) if isinstance(score, (int, float)) else None,
            "key_events": self._string_list(parsed.get("key_events")),
            "article_sentiments": article_sentiments,
        }

    def _complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any] | None:
        parsed = self._chat_json(system_prompt, user_prompt)
        if parsed is None:
            return None

        return {
            "provider": "nebius",
            "model": self.model,
            "summary": str(parsed.get("summary") or ""),
            "data_quality": str(parsed.get("data_quality") or "unknown"),
            "key_points": self._string_list(parsed.get("key_points")),
            "warnings": self._string_list(parsed.get("warnings")),
        }

    def _chat_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any] | None:
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

        return parsed

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

    def _news_system_prompt(self) -> str:
        return (
            "Tu es un SLM d'analyse d'actualites financieres pour un agent de news boursieres.\n"
            "Tu recois une liste d'articles (titre, source, date, resume) sur une action.\n"
            "Tu n'inventes aucun fait et tu ne donnes pas de recommandation d'achat/vente.\n"
            "Ton role : evaluer le sentiment global (positif/negatif/neutre/mixte), donner un score\n"
            "entre -1.0 (tres negatif) et 1.0 (tres positif), detecter les evenements importants\n"
            "(resultats, fusions-acquisitions, proces, lancements, changements de direction) et classer\n"
            "le sentiment de chaque article par son index.\n"
            "Reponds uniquement en JSON valide avec exactement ces champs:\n"
            "{\n"
            '  "summary": "resume court en francais des actualites",\n'
            '  "data_quality": "excellent | bon | partiel | faible",\n'
            '  "sentiment_label": "positive | negative | neutral | mixed",\n'
            '  "sentiment_score": 0.0,\n'
            '  "key_events": ["evenement important 1", "evenement 2"],\n'
            '  "article_sentiments": [{"index": 0, "sentiment": "positive"}],\n'
            '  "warnings": ["limite importante"]\n'
            "}"
        )

    def _risk_system_prompt(self) -> str:
        return (
            "Tu es un SLM de controle qualite pour un agent de risque boursier.\n"
            "Les risques, le score et le niveau global sont deja calcules par des regles deterministes :\n"
            "tu ne recalcules rien, tu n'inventes aucun chiffre et tu ne donnes pas de recommandation d'achat/vente.\n"
            "IMPORTANT: risk_score est une echelle 0-100, jamais 0-10. Si risk_score vaut 7, ecris 7/100.\n"
            "data_confidence_score est aussi une echelle 0-100 et mesure la fiabilite des donnees, pas le risque du titre.\n"
            "Ne transforme jamais un score fourni en /10.\n"
            "Ton role : resumer le diagnostic de risque, expliquer les principaux facteurs et signaler les limites\n"
            "liees aux donnees amont. Si le risque vient surtout de data_quality, dis-le explicitement.\n"
            "Reponds uniquement en JSON valide avec exactement ces champs:\n"
            "{\n"
            '  "summary": "resume court en francais",\n'
            '  "data_quality": "excellent | bon | partiel | faible",\n'
            '  "key_points": ["point 1", "point 2", "point 3"],\n'
            '  "warnings": ["limite importante"]\n'
            "}"
        )

    def _build_news_prompt(self, payload: dict[str, Any]) -> str:
        articles = payload.get("articles") or []
        # Texte extrait (content) prioritaire sur le resume du flux : le SLM
        # dispose alors d'un contexte plus riche pour juger le sentiment.
        compact_articles = [
            {
                "index": index,
                "title": article.get("title"),
                "source": article.get("source"),
                "published_at": article.get("published_at"),
                "summary": (article.get("content") or article.get("summary") or "")[:900] or None,
            }
            for index, article in enumerate(articles)
        ]
        compact_payload = {
            "ticker": payload.get("ticker"),
            "articles_count": len(compact_articles),
            "articles": compact_articles,
        }
        return f"ACTUALITES:\n{json.dumps(compact_payload, ensure_ascii=True)}"

    def _build_risk_prompt(self, payload: dict[str, Any]) -> str:
        risks = payload.get("risks") or []
        compact_risks = [
            {
                "category": risk.get("category"),
                "level": risk.get("level"),
                "title": risk.get("title"),
                "evidence": risk.get("evidence"),
                "score_impact": risk.get("score_impact"),
            }
            for risk in risks[:10]
            if isinstance(risk, dict)
        ]
        compact_payload = {
            "ticker": payload.get("ticker"),
            "status": payload.get("status"),
            "overall_risk_level": payload.get("overall_risk_level"),
            "risk_score": payload.get("risk_score"),
            "risk_score_scale": "0-100",
            "risk_score_breakdown": payload.get("risk_score_breakdown"),
            "data_confidence_score": payload.get("data_confidence_score"),
            "data_confidence_level": payload.get("data_confidence_level"),
            "data_confidence_scale": "0-100",
            "risks": compact_risks,
            "component_status": payload.get("component_status"),
            "warnings": (payload.get("warnings") or [])[:8],
            "errors": payload.get("errors"),
        }
        return f"DIAGNOSTIC_RISQUE:\n{json.dumps(compact_payload, ensure_ascii=True)}"

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

from __future__ import annotations

import re

from .nebius_client import NebiusClient
from .schemas import EducationChatRequest, EducationChatResponse


GLOSSARY: dict[str, str] = {
    "spot": (
        "Le cours spot est le prix auquel un actif peut être acheté ou vendu "
        "pour un règlement immédiat. Il sert de référence aux produits dérivés."
    ),
    "forward": (
        "Un forward est un contrat de gré à gré qui fixe aujourd'hui le prix "
        "d'un achat ou d'une vente future. Sa valeur dépend notamment du spot, "
        "de l'échéance, des taux et des coûts de portage."
    ),
    "beta": (
        "Le bêta mesure la sensibilité historique d'un actif aux mouvements de "
        "son indice de référence. Un bêta de 1,2 signifie qu'il a historiquement "
        "varié d'environ 1,2 % lorsque le marché variait de 1 %, toutes choses "
        "égales par ailleurs. Il ne prédit pas le prochain mouvement."
    ),
    "spy": (
        "SPY est un ETF qui cherche à répliquer l'indice S&P 500. Il est souvent "
        "utilisé comme benchmark des grandes actions américaines."
    ),
    "rsi": (
        "Le RSI est un oscillateur de momentum entre 0 et 100, souvent calculé "
        "sur 14 périodes. Les seuils 70 et 30 signalent des zones de tension, "
        "pas des ordres automatiques d'achat ou de vente."
    ),
    "sharpe": (
        "Le ratio de Sharpe rapporte le rendement excédentaire au risque total: "
        "(rendement - taux sans risque) / volatilité. Il facilite les comparaisons, "
        "mais dépend fortement de la période et suppose une volatilité informative."
    ),
    "volatilite": (
        "La volatilité mesure la dispersion des rendements. Une volatilité élevée "
        "indique des variations plus amples, sans dire à elle seule si elles seront "
        "positives ou négatives."
    ),
    "drawdown": (
        "Le drawdown mesure la baisse entre un sommet et le creux suivant. Le "
        "maximum drawdown est la plus forte perte historique depuis un pic."
    ),
    "per": (
        "Le PER divise le cours par le bénéfice par action. Il indique combien le "
        "marché paie une unité de bénéfice, mais doit être comparé au secteur, à la "
        "croissance et à la qualité des résultats."
    ),
    "spread": (
        "Le spread bid-ask est l'écart entre le meilleur prix acheteur et le meilleur "
        "prix vendeur. Plus il est large, plus le coût implicite de transaction est élevé."
    ),
}

ALIASES = {
    "bêta": "beta",
    "volatilité": "volatilite",
    "price earnings": "per",
    "p/e": "per",
    "max drawdown": "drawdown",
}


class EducationAgent:
    def __init__(self, slm_client: NebiusClient | None = None) -> None:
        self.slm_client = slm_client or NebiusClient.for_agent("education")

    def answer(self, request: EducationChatRequest) -> EducationChatResponse:
        history = [
            {"role": item.role, "content": item.content}
            for item in request.history[-8:]
        ]
        context = {
            "page": request.page,
            "ticker": request.ticker.upper() if request.ticker else None,
        }
        try:
            result = self.slm_client.explain_finance(
                request.message.strip(),
                history,
                context,
            )
            if isinstance(result, dict) and str(result.get("answer") or "").strip():
                return EducationChatResponse(
                    status="success",
                    answer=str(result["answer"]).strip(),
                    concepts=self._strings(result.get("concepts"), limit=6),
                    suggested_questions=self._strings(
                        result.get("suggested_questions"),
                        limit=3,
                    ),
                    provider="nebius",
                    model=self.slm_client.model,
                )
        except Exception as error:
            return self._fallback(request.message, str(error))

        return self._fallback(
            request.message,
            "Le modèle explicatif est temporairement indisponible.",
        )

    def _fallback(self, message: str, warning: str) -> EducationChatResponse:
        normalized = message.casefold()
        for alias, target in ALIASES.items():
            normalized = normalized.replace(alias.casefold(), target)

        matches = [
            term
            for term in GLOSSARY
            if re.search(rf"\b{re.escape(term)}\b", normalized)
        ]
        if matches:
            answer = "\n\n".join(GLOSSARY[term] for term in matches[:3])
            concepts = matches[:3]
        else:
            answer = (
                "Je peux expliquer les notions de marché, les indicateurs techniques, "
                "les ratios fondamentaux et les mesures de risque. Reformulez avec le "
                "terme précis, par exemple « bêta », « forward », « RSI » ou « Sharpe »."
            )
            concepts = []

        return EducationChatResponse(
            status="partial",
            answer=answer,
            concepts=concepts,
            suggested_questions=[
                "Quelle différence entre spot et forward ?",
                "Comment interpréter le bêta face à SPY ?",
                "À quoi sert le ratio de Sharpe ?",
            ],
            provider="glossary",
            model=None,
            warning=warning[:300],
        )

    @staticmethod
    def _strings(value: object, limit: int) -> list[str]:
        if not isinstance(value, list):
            return []
        return [
            str(item).strip()[:160]
            for item in value
            if str(item).strip()
        ][:limit]

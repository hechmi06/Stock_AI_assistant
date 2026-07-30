"""SynthesisAgent: agregation explicable des resultats des agents specialises."""

from __future__ import annotations

import re

from app.memory import SynthesisAgentMemory

from .nebius_client import NebiusClient
from .schemas import (
    AgentStatusSummary,
    MarketDataResult,
    NewsResult,
    RagResult,
    RiskResult,
    SlmSummary,
    SynthesisRecommendation,
    SynthesisResult,
    SynthesisScores,
    TechnicalResult,
)


SCORE_WEIGHTS = {
    "technical": 0.30,
    "fundamental": 0.25,
    "news": 0.15,
    "risk": 0.30,
}

# La note destinee a l'utilisateur doit rester qualitative : aucun chiffre.
_DIGIT_RE = re.compile(r"\d")


class SynthesisAgent:
    """Combine les signaux sans recalculer ni masquer les donnees manquantes.

    Le score est deterministe. Le SLM est facultatif et ne peut modifier que le
    texte de synthese, jamais les scores ou la recommandation.
    """

    def __init__(
        self,
        slm_client: NebiusClient | None = None,
        memory: SynthesisAgentMemory | None = None,
    ) -> None:
        self.slm_client = slm_client or NebiusClient.for_agent("synthesis")
        self.memory = memory or SynthesisAgentMemory()

    def run(
        self,
        ticker: str,
        market_data: MarketDataResult,
        technical: TechnicalResult,
        news: NewsResult,
        rag: RagResult,
        risk: RiskResult,
        with_slm: bool = True,
        remember: bool = True,
    ) -> SynthesisResult:
        symbol = ticker.strip().upper()
        if not symbol:
            return SynthesisResult(ticker="", status="failed", errors=["Ticker is required."])

        scores = SynthesisScores(
            technical=technical.technical_score if technical.technical_score is not None else 50,
            fundamental=self._fundamental_score(market_data),
            news=self._news_score(news),
            risk=max(0, min(100, 100 - risk.risk_score)),
        )
        global_score = round(
            scores.technical * SCORE_WEIGHTS["technical"]
            + scores.fundamental * SCORE_WEIGHTS["fundamental"]
            + scores.news * SCORE_WEIGHTS["news"]
            + scores.risk * SCORE_WEIGHTS["risk"]
        )
        confidence_score = risk.data_confidence_score
        recommendation = self._recommendation(
            global_score,
            confidence_score,
            risk.overall_risk_level,
        )
        statuses = AgentStatusSummary(
            market_data=market_data.status,
            technical=technical.status,
            news=news.status,
            rag=rag.status,
            risk=risk.status,
        )
        status_values = list(statuses.model_dump().values())
        if all(status == "failed" for status in status_values):
            status = "failed"
        elif any(status != "success" for status in status_values):
            status = "partial"
        else:
            status = "success"

        strengths, weaknesses = self._signals(scores, market_data, technical, news, risk)
        key_risks = [item for item in risk.risks if item.category != "data_quality"][:5]
        warnings = self._unique(
            [
                *market_data.warnings,
                *news.warnings,
                *rag.warnings,
                *risk.warnings,
            ]
        )
        errors = self._unique(
            [
                *market_data.errors,
                *technical.errors,
                *news.errors,
                *rag.errors,
                *risk.errors,
            ]
        )
        sources = self._sources(market_data, news, rag)
        summary = self._deterministic_summary(
            symbol,
            recommendation,
            market_data,
            technical,
            news,
            risk,
            key_risks,
        )

        result = SynthesisResult(
            ticker=symbol,
            status=status,
            global_score=global_score,
            recommendation=recommendation,
            confidence_score=confidence_score,
            confidence_level=risk.data_confidence_level,
            scores=scores,
            weights=SCORE_WEIGHTS,
            summary=summary,
            strengths=strengths,
            weaknesses=weaknesses,
            key_risks=key_risks,
            sources=sources,
            agent_status=statuses,
            warnings=warnings,
            errors=errors,
        )
        if with_slm and status != "failed":
            self._add_slm_summary(result, market_data, technical, news, rag)
        if status != "failed" and remember:
            self._compare_with_previous_session(result)
            self.memory.remember(result)
        return result

    def _compare_with_previous_session(self, result: SynthesisResult) -> None:
        """Note l'evolution du diagnostic par rapport a la session precedente."""
        remembered = self.memory.recall_latest(result.ticker)
        if remembered is None:
            return
        previous, generated_at = remembered
        delta = result.global_score - previous.global_score
        if previous.recommendation != result.recommendation:
            result.warnings.append(
                f"Session precedente ({generated_at}) : recommandation "
                f"'{previous.recommendation}' -> '{result.recommendation}' "
                f"(score {previous.global_score} -> {result.global_score}, {delta:+d})."
            )
        elif abs(delta) >= 10:
            result.warnings.append(
                f"Session precedente ({generated_at}) : score global "
                f"{previous.global_score} -> {result.global_score} ({delta:+d})."
            )

    def _fundamental_score(self, result: MarketDataResult) -> int:
        ratios = {key.lower(): value for key, value in result.financial_ratios.items()}
        statements = result.financial_statements_summary
        score = 50

        margin = self._percent(ratios.get("profit_margin"))
        if margin is not None:
            score += 15 if margin >= 20 else 8 if margin >= 10 else -12 if margin < 0 else 0

        roe = self._percent(ratios.get("return_on_equity"))
        if roe is not None:
            score += 10 if roe >= 15 else -8 if roe < 0 else 0

        debt_to_equity = ratios.get("debt_to_equity")
        if isinstance(debt_to_equity, (int, float)):
            normalized_debt = debt_to_equity / 100 if debt_to_equity > 10 else debt_to_equity
            score += 8 if normalized_debt <= 1 else -10 if normalized_debt > 3 else 0

        if statements.net_income is not None:
            score += 7 if statements.net_income > 0 else -12
        if statements.operating_cashflow is not None:
            score += 8 if statements.operating_cashflow > 0 else -12
        if statements.total_assets and statements.total_debt is not None:
            debt_to_assets = statements.total_debt / statements.total_assets
            score += 5 if debt_to_assets <= 0.35 else -6 if debt_to_assets >= 0.65 else 0

        has_data = any(value is not None for value in ratios.values()) or any(
            value is not None for value in statements.model_dump().values()
        )
        return max(0, min(100, score if has_data else 50))

    def _news_score(self, result: NewsResult) -> int:
        if result.sentiment_score is not None:
            return max(0, min(100, round(50 + result.sentiment_score * 40)))
        return {
            "positive": 75,
            "negative": 25,
            "mixed": 45,
            "neutral": 50,
        }.get(result.sentiment_label, 50)

    def _recommendation(
        self,
        score: int,
        confidence: int,
        risk_level: str,
    ) -> SynthesisRecommendation:
        if confidence < 40:
            return "donnees_insuffisantes"
        if score >= 75:
            recommendation: SynthesisRecommendation = "favorable"
        elif score >= 60:
            recommendation = "a_surveiller"
        elif score >= 45:
            recommendation = "prudence"
        else:
            recommendation = "defavorable"

        if risk_level == "high" and recommendation in {"favorable", "a_surveiller"}:
            recommendation = "prudence"
        if confidence < 55 and recommendation == "favorable":
            recommendation = "a_surveiller"
        return recommendation

    def _signals(
        self,
        scores: SynthesisScores,
        market_data: MarketDataResult,
        technical: TechnicalResult,
        news: NewsResult,
        risk: RiskResult,
    ) -> tuple[list[str], list[str]]:
        strengths: list[str] = []
        weaknesses: list[str] = []

        # Les composants en echec sont des points de vigilance explicites :
        # leur score retombe au neutre (50) et ne doit produire aucun signal.
        if market_data.status == "failed":
            weaknesses.append("Donnees de marche indisponibles : le diagnostic repose sur des sources degradees.")
        technical_available = technical.status != "failed"
        if not technical_available:
            weaknesses.append(
                "Analyse technique indisponible (historique de prix manquant) : "
                "tendance, RSI et niveaux n'ont pas pu etre calcules."
            )
        news_sentiment_available = news.status != "failed" and news.sentiment_label is not None
        if news.status == "failed":
            weaknesses.append("Actualites indisponibles : le climat mediatique n'a pas pu etre evalue.")
        elif news.sentiment_label is None:
            weaknesses.append(
                "Sentiment des actualites non calcule (analyse SLM indisponible) "
                "malgre des articles collectes."
            )

        trend_labels = {"bullish": "haussiere", "bearish": "baissiere", "neutral": "sans direction claire"}
        if technical_available:
            trend_label = trend_labels.get(technical.trend, technical.trend)
            if scores.technical >= 65:
                strengths.append(f"Signal technique favorable, tendance {trend_label}.")
            elif scores.technical <= 40:
                weaknesses.append(f"Signal technique faible, tendance {trend_label}.")
        if scores.fundamental >= 65:
            strengths.append("Fondamentaux solides selon les donnees disponibles.")
        elif scores.fundamental <= 40:
            weaknesses.append("Fondamentaux fragiles selon les donnees disponibles.")
        if news_sentiment_available:
            if scores.news >= 65:
                strengths.append("Sentiment des actualites favorable.")
            elif scores.news <= 40:
                weaknesses.append("Sentiment des actualites defavorable.")
        if risk.risk_score <= 29:
            strengths.append("Risque intrinseque contenu.")
        elif risk.risk_score >= 61:
            weaknesses.append("Risque intrinseque eleve.")
        if market_data.change_percent is not None and abs(market_data.change_percent) >= 5:
            weaknesses.append("Mouvement de cours recent inhabituellement marque.")
        return strengths[:4], weaknesses[:4]

    def _deterministic_summary(
        self,
        ticker: str,
        recommendation: SynthesisRecommendation,
        market_data: MarketDataResult,
        technical: TechnicalResult,
        news: NewsResult,
        risk: RiskResult,
        key_risks: list,
    ) -> str:
        """Note de repli sans SLM : argumentaire qualitatif d'analyste, sans chiffres.

        Les scores restent disponibles dans `scores` / `global_score` pour l'UI ;
        le texte, lui, traduit les donnees en jugements argumentes.
        """
        name = market_data.company_profile.name or ticker
        verdicts: dict[SynthesisRecommendation, str] = {
            "favorable": (
                f"{name} reunit les qualites d'un dossier attractif : la dynamique de marche, "
                "la sante financiere et le climat d'actualite jouent dans le meme sens."
            ),
            "a_surveiller": (
                f"{name} merite une place en liste de surveillance : l'essentiel du dossier est "
                "solide, mais un element retient encore de porter un avis pleinement positif."
            ),
            "prudence": (
                f"{name} appelle a la prudence : les signaux sont contrastes et le rapport entre "
                "le potentiel et le risque n'est pas clairement etabli a ce stade."
            ),
            "defavorable": (
                f"{name} presente un profil defavorable : les faiblesses identifiees dominent "
                "nettement les points forts et le dossier n'offre pas de marge de securite."
            ),
            "donnees_insuffisantes": (
                f"Il est premature de se prononcer sur {name} : les donnees reunies sont trop "
                "incompletes pour etayer un avis, quelle que soit la tentation de conclure."
            ),
        }
        parts = [verdicts[recommendation]]
        for phrase in (
            self._technical_phrase(technical),
            self._fundamental_phrase(market_data),
            self._news_phrase(news),
            self._vigilance_phrase(risk, key_risks),
            self._outlook_phrase(technical, risk),
        ):
            if phrase:
                parts.append(phrase)
        return " ".join(parts)

    def _technical_phrase(self, technical: TechnicalResult) -> str | None:
        if technical.status == "failed":
            return (
                "L'analyse technique n'a pas pu etre menee faute d'historique de prix "
                "exploitable : la lecture de la tendance reste donc en suspens."
            )
        trend_map = {
            "bullish": "Sur le plan technique, le titre s'inscrit dans une dynamique haussiere",
            "bearish": "Sur le plan technique, le titre subit une dynamique baissiere",
            "neutral": "Sur le plan technique, le titre evolue sans direction claire",
        }
        phrase = trend_map.get(technical.trend)
        if phrase is None:
            return None
        if technical.rsi is not None:
            if technical.rsi >= 70:
                phrase += ", avec toutefois des signes de surchauffe a court terme"
            elif technical.rsi <= 30:
                phrase += ", apres un exces de vente qui peut preceder une stabilisation"
            else:
                phrase += ", sans exces de surchauffe ni de survente"
        interpretation = technical.volume_analysis.interpretation
        if interpretation and interpretation != "volume indisponible":
            phrase += f", et les echanges se font sur un {interpretation}"
        return phrase + "."

    def _fundamental_phrase(self, market_data: MarketDataResult) -> str | None:
        statements = market_data.financial_statements_summary
        ratios = {key.lower(): value for key, value in market_data.financial_ratios.items()}
        observations: list[str] = []

        if statements.net_income is not None:
            observations.append(
                "une activite beneficiaire" if statements.net_income > 0 else "une activite deficitaire"
            )
        if statements.operating_cashflow is not None:
            observations.append(
                "une generation de tresorerie positive"
                if statements.operating_cashflow > 0
                else "une consommation de tresorerie preoccupante"
            )
        margin = self._percent(ratios.get("profit_margin"))
        if margin is not None:
            if margin >= 20:
                observations.append("des marges confortables")
            elif margin < 0:
                observations.append("des marges negatives")
        debt_to_equity = ratios.get("debt_to_equity")
        if isinstance(debt_to_equity, (int, float)):
            normalized = debt_to_equity / 100 if debt_to_equity > 10 else debt_to_equity
            if normalized <= 1:
                observations.append("un endettement maitrise")
            elif normalized > 3:
                observations.append("un endettement lourd")

        if not observations:
            return (
                "Les fondamentaux n'ont pas pu etre pleinement verifies sur ce dossier, "
                "ce qui limite la portee du diagnostic financier."
            )
        return "Cote fondamentaux, l'entreprise affiche " + ", ".join(observations) + "."

    def _news_phrase(self, news: NewsResult) -> str | None:
        sentiment_map = {
            "positive": "Le climat d'actualite est porteur",
            "negative": "Le climat d'actualite est defavorable",
            "mixed": "Le climat d'actualite est contraste",
            "neutral": "Le climat d'actualite est neutre",
        }
        phrase = sentiment_map.get(news.sentiment_label or "")
        if phrase is None:
            if news.status == "failed":
                return "Le climat d'actualite n'a pas pu etre evalue, aucune source news n'ayant repondu."
            if news.articles:
                return (
                    "Des actualites ont ete collectees mais leur sentiment n'a pas pu etre "
                    "analyse : le climat mediatique reste a confirmer."
                )
            return None
        if news.key_events:
            phrase += f", marque notamment par : {news.key_events[0].rstrip('.')}"
        return phrase + "."

    def _vigilance_phrase(self, risk: RiskResult, key_risks: list) -> str | None:
        level_map = {
            "low": "Le niveau de risque intrinseque reste contenu",
            "medium": "Le niveau de risque intrinseque est intermediaire",
            "high": "Le niveau de risque intrinseque est eleve",
        }
        phrase = level_map.get(risk.overall_risk_level)
        if phrase is None:
            return None
        if key_risks:
            phrase += f" ; le principal point de vigilance porte sur : {key_risks[0].title.rstrip('.').lower()}"
        return phrase + "."

    def _outlook_phrase(self, technical: TechnicalResult, risk: RiskResult) -> str | None:
        watch: list[str] = []
        if technical.support_level is not None:
            watch.append("la tenue de la zone de soutien recente")
        if technical.resistance_level is not None:
            watch.append("la capacite du titre a franchir sa resistance en place")
        confidence_map = {
            "high": "Le diagnostic s'appuie sur des donnees completes et concordantes.",
            "medium": "Certaines donnees restent partielles : le diagnostic gagnera a etre confirme.",
            "low": "Les donnees disponibles sont lacunaires : toute conclusion doit etre confirmee avant d'agir.",
        }
        confidence = confidence_map.get(risk.data_confidence_level, "")
        if watch:
            return f"Dans les prochaines seances, il conviendra de suivre {' et '.join(watch)}. {confidence}".strip()
        return confidence or None

    def _slm_context(
        self,
        market_data: MarketDataResult,
        technical: TechnicalResult,
        news: NewsResult,
        rag: RagResult,
    ) -> dict:
        """Contexte compact des agents amont : sans lui, le SLM ne peut pas etre specifique."""
        profile = market_data.company_profile
        return {
            "profil": {
                "nom": profile.name,
                "secteur": profile.sector,
                "prix": market_data.price,
                "variation_pct": market_data.change_percent,
            },
            "technique": {
                "tendance": technical.trend,
                "rsi": technical.rsi,
                "sma_20": technical.moving_averages.sma_20,
                "sma_50": technical.moving_averages.sma_50,
                "support": technical.support_level,
                "resistance": technical.resistance_level,
                "volume": technical.volume_analysis.interpretation,
            },
            "actualites": {
                "sentiment": news.sentiment_label,
                "score_sentiment": news.sentiment_score,
                "evenements_cles": news.key_events[:5],
            },
            "documents_sec": {
                "passages_indexes": rag.indexed_chunks,
                "extrait_reponse": (rag.answer or "")[:400] or None,
            },
        }

    def _add_slm_summary(
        self,
        result: SynthesisResult,
        market_data: MarketDataResult,
        technical: TechnicalResult,
        news: NewsResult,
        rag: RagResult,
    ) -> None:
        try:
            payload = {
                "synthese": result.model_dump(exclude={"slm_summary"}),
                "contexte_agents": self._slm_context(market_data, technical, news, rag),
            }
            summary = self.slm_client.summarize_synthesis_data(payload)
            if not summary:
                return
            candidate = SlmSummary.model_validate(summary)
            # Garde deterministe : un prompt ne garantit rien. Si le SLM recopie
            # des chiffres malgre la consigne, sa note est ecartee au profit de
            # la note deterministe (elle, garantie qualitative).
            narrative = " ".join([candidate.summary, *candidate.key_points])
            if _DIGIT_RE.search(narrative):
                result.warnings.append(
                    "Note SLM ecartee : elle contenait des chiffres malgre la consigne ; "
                    "la note deterministe est conservee."
                )
                return
            result.slm_summary = candidate
            if candidate.summary:
                result.summary = candidate.summary
        except Exception as error:
            result.warnings.append(f"Nebius SLM unavailable for SynthesisAgent: {error}")

    def _sources(self, market_data: MarketDataResult, news: NewsResult, rag: RagResult) -> list[str]:
        values = [*market_data.sources_used, *news.sources_used]
        if rag.indexed_chunks > 0:
            values.append("sec_edgar_qdrant")
        return self._unique([str(value) for value in values])

    def _percent(self, value: float | None) -> float | None:
        if not isinstance(value, (int, float)):
            return None
        return value * 100 if abs(value) <= 1 else value

    def _unique(self, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value for value in values if value))

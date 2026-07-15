"""RiskAgent : diagnostic de risque explicable.

Cet agent ne collecte pas directement de donnees externes. Il orchestre les
agents deja valides (MarketDataAgent, TechnicalAgent, NewsAgent), puis applique
des regles transparentes pour produire un score de risque et des preuves.
"""

from __future__ import annotations

from .market_data_agent import MarketDataAgent
from .nebius_client import NebiusClient
from .news_agent import NewsAgent
from .risk_scoring import compute_risk_score, risk_score_breakdown
from .schemas import (
    AgentRiskSnapshot,
    MarketDataResult,
    NewsResult,
    RiskItem,
    RiskLevel,
    RiskResult,
    SlmSummary,
    TechnicalResult,
)
from .technical_agent import TechnicalAgent


class RiskAgent:
    def __init__(
        self,
        market_data_agent: MarketDataAgent | None = None,
        technical_agent: TechnicalAgent | None = None,
        news_agent: NewsAgent | None = None,
        slm_client: NebiusClient | None = None,
    ) -> None:
        self.market_data_agent = market_data_agent or MarketDataAgent()
        self.technical_agent = technical_agent or TechnicalAgent(market_data_agent=self.market_data_agent)
        self.news_agent = news_agent or NewsAgent()
        self.slm_client = slm_client or NebiusClient.for_agent("risk")
        memory = getattr(self.market_data_agent, "memory", None)
        self.graph = getattr(memory, "graph", None)

    def run(self, ticker: str, use_cache: bool = True) -> RiskResult:
        normalized_ticker = ticker.strip().upper()
        if not normalized_ticker:
            return RiskResult(
                ticker="",
                status="failed",
                overall_risk_level="high",
                risk_score=100,
                data_confidence_score=0,
                data_confidence_level="low",
                errors=["Ticker is required."],
            )

        market_data = self.market_data_agent.run(normalized_ticker, with_slm=False, use_cache=use_cache)
        technical = self.technical_agent.run(normalized_ticker, use_cache=use_cache, with_slm=False)
        # Le sentiment news est produit par le SLM : sans lui, sentiment_label
        # reste None, la dimension "risque news" ne se declenche jamais et
        # NewsAgent est fige en "partial". C'est le coeur du signal news pour le
        # risque, donc on garde with_slm active ici (market/technical n'en ont
        # pas besoin, leurs chiffres sont calcules sans SLM). Le nom de societe
        # (issu du profil) alimente le filtre de pertinence des articles.
        news = self.news_agent.run(
            normalized_ticker,
            use_cache=use_cache,
            with_slm=True,
            company_name=market_data.company_profile.name,
        )

        risks: list[RiskItem] = []
        warnings: list[str] = []

        for result in (market_data, news):
            warnings.extend(result.warnings)
        warnings.extend(self._slm_warnings(market_data.errors))
        warnings.extend(self._slm_warnings(technical.errors))
        warnings.extend(self._slm_warnings(news.errors))

        risks.extend(self._market_risks(market_data))
        risks.extend(self._fundamental_risks(market_data))
        risks.extend(self._technical_risks(technical))
        risks.extend(self._news_risks(news))
        risks.extend(self._data_quality_risks(market_data, technical, news, warnings))

        # Le risk_score ne mesure que le risque intrinseque du titre
        # (marche, technique, fondamental, news), pondere par categorie. Les
        # problemes de qualite des donnees ne gonflent pas le risque (categorie
        # sans poids dans risk_scoring) : ils reduisent uniquement le
        # data_confidence_score. Sinon un titre sain servi pendant un rate-limit
        # de source secondaire serait faussement classe plus risque.
        score = compute_risk_score(risks)
        score_breakdown = risk_score_breakdown(risks)
        overall_level = self._level_from_score(score)
        data_confidence_score = self._data_confidence_score(market_data, technical, news, warnings)
        data_confidence_level = self._confidence_level_from_score(data_confidence_score)
        snapshot = AgentRiskSnapshot(
            market_data_status=market_data.status,
            technical_status=technical.status,
            news_status=news.status,
            market_data_errors=self._non_slm_errors(market_data.errors),
            technical_errors=self._non_slm_errors(technical.errors),
            news_errors=self._non_slm_errors(news.errors),
        )

        statuses = [market_data.status, technical.status, news.status]
        if all(status == "failed" for status in statuses):
            status = "failed"
            errors = ["No upstream agent returned usable data for risk analysis."]
        elif any(status == "failed" for status in statuses):
            status = "partial"
            errors = []
        else:
            status = "success"
            errors = []

        result = RiskResult(
            ticker=normalized_ticker,
            status=status,
            overall_risk_level=overall_level,
            risk_score=score,
            risk_score_breakdown=score_breakdown,
            data_confidence_score=data_confidence_score,
            data_confidence_level=data_confidence_level,
            risks=risks,
            component_status=snapshot,
            warnings=warnings,
            errors=errors,
        )
        self._add_slm_summary(result)
        self._remember(result)
        return result

    def _add_slm_summary(self, result: RiskResult) -> None:
        if result.status == "failed":
            return
        try:
            summary = self.slm_client.summarize_risk_data(result.model_dump())
            if summary:
                result.slm_summary = SlmSummary.model_validate(summary)
        except Exception as error:
            result.warnings.append(f"Nebius SLM unavailable for RiskAgent: {error}")

    def _market_risks(self, result: MarketDataResult) -> list[RiskItem]:
        risks: list[RiskItem] = []
        change = result.change_percent
        if change is not None:
            abs_change = abs(change)
            if abs_change >= 5:
                risks.append(
                    self._risk(
                        "market",
                        "high",
                        "Mouvement de marche important",
                        "La derniere variation disponible est forte, ce qui augmente le risque de timing.",
                        [f"change_percent = {change:.2f}%"],
                        18,
                    )
                )
            elif abs_change >= 2:
                risks.append(
                    self._risk(
                        "market",
                        "medium",
                        "Variation de marche notable",
                        "Le titre a deja bouge sensiblement sur la derniere cotation disponible.",
                        [f"change_percent = {change:.2f}%"],
                        9,
                    )
                )

        market_cap = result.company_profile.market_cap
        if market_cap is not None and market_cap < 2_000_000_000:
            risks.append(
                self._risk(
                    "market",
                    "medium",
                    "Capitalisation limitee",
                    "Une capitalisation plus faible peut impliquer moins de liquidite et plus de volatilite.",
                    [f"market_cap = {market_cap:.0f}"],
                    10,
                )
            )
        return risks

    def _fundamental_risks(self, result: MarketDataResult) -> list[RiskItem]:
        risks: list[RiskItem] = []
        ratios = {key.lower(): value for key, value in result.financial_ratios.items()}
        pe = self._first_number(ratios, ["pe_ratio", "pe", "trailingpe", "price_earnings_ratio"])
        if pe is not None:
            if pe >= 60:
                risks.append(
                    self._risk(
                        "fundamental",
                        "high",
                        "Valorisation tres elevee",
                        "Le multiple de resultat est tres eleve et laisse peu de marge d'erreur.",
                        [f"PER = {pe:.2f}"],
                        16,
                    )
                )
            elif pe >= 35:
                risks.append(
                    self._risk(
                        "fundamental",
                        "medium",
                        "Valorisation exigeante",
                        "Le multiple de resultat est eleve par rapport a une valorisation prudente.",
                        [f"PER = {pe:.2f}"],
                        9,
                    )
                )

        summary = result.financial_statements_summary
        if summary.total_assets and summary.total_debt:
            debt_ratio = summary.total_debt / summary.total_assets
            if debt_ratio >= 0.6:
                risks.append(
                    self._risk(
                        "fundamental",
                        "high",
                        "Dette elevee relativement aux actifs",
                        "La dette represente une part importante des actifs reportes.",
                        [f"total_debt / total_assets = {debt_ratio:.2f}"],
                        16,
                    )
                )
            elif debt_ratio >= 0.4:
                risks.append(
                    self._risk(
                        "fundamental",
                        "medium",
                        "Endettement a surveiller",
                        "La dette est significative par rapport aux actifs.",
                        [f"total_debt / total_assets = {debt_ratio:.2f}"],
                        8,
                    )
                )
        if summary.operating_cashflow is not None and summary.operating_cashflow < 0:
            risks.append(
                self._risk(
                    "fundamental",
                    "high",
                    "Cash-flow operationnel negatif",
                    "Le cash-flow operationnel negatif peut fragiliser la qualite financiere.",
                    [f"operating_cashflow = {summary.operating_cashflow:.0f}"],
                    16,
                )
            )
        return risks

    def _technical_risks(self, result: TechnicalResult) -> list[RiskItem]:
        risks: list[RiskItem] = []
        if result.trend == "bearish":
            risks.append(
                self._risk(
                    "technical",
                    "high",
                    "Tendance technique baissiere",
                    "La tendance calculee par TechnicalAgent est baissiere.",
                    ["trend = bearish"],
                    15,
                )
            )
        if result.rsi is not None:
            if result.rsi >= 70:
                risks.append(
                    self._risk(
                        "technical",
                        "medium",
                        "RSI en zone de surachat",
                        "Un RSI eleve peut signaler un risque de correction court terme.",
                        [f"RSI = {result.rsi:.1f}"],
                        8,
                    )
                )
            elif result.rsi <= 30:
                risks.append(
                    self._risk(
                        "technical",
                        "medium",
                        "RSI en zone de stress",
                        "Un RSI tres bas signale une pression vendeuse forte, meme si un rebond reste possible.",
                        [f"RSI = {result.rsi:.1f}"],
                        8,
                    )
                )
        if result.volatility is not None:
            if result.volatility >= 3:
                risks.append(
                    self._risk(
                        "technical",
                        "high",
                        "Volatilite technique elevee",
                        "Les rendements recents sont tres disperses.",
                        [f"volatility = {result.volatility:.2f}%"],
                        14,
                    )
                )
            elif result.volatility >= 2:
                risks.append(
                    self._risk(
                        "technical",
                        "medium",
                        "Volatilite a surveiller",
                        "La volatilite recente est superieure a un profil calme.",
                        [f"volatility = {result.volatility:.2f}%"],
                        7,
                    )
                )
        if result.technical_score is not None and result.technical_score <= 40:
            risks.append(
                self._risk(
                    "technical",
                    "medium",
                    "Score technique faible",
                    "Le score technique indique une configuration fragile.",
                    [f"technical_score = {result.technical_score}"],
                    10,
                )
            )
        return risks

    def _news_risks(self, result: NewsResult) -> list[RiskItem]:
        risks: list[RiskItem] = []
        if result.sentiment_label == "negative":
            risks.append(
                self._risk(
                    "news",
                    "high",
                    "Sentiment news negatif",
                    "Les actualites recentes sont classees negativement.",
                    self._news_evidence(result),
                    18,
                )
            )
        elif result.sentiment_label == "mixed":
            risks.append(
                self._risk(
                    "news",
                    "medium",
                    "Sentiment news mixte",
                    "Les actualites recentes donnent des signaux contradictoires.",
                    self._news_evidence(result),
                    8,
                )
            )
        if result.sentiment_score is not None and result.sentiment_score <= -0.35:
            risks.append(
                self._risk(
                    "news",
                    "medium",
                    "Score de sentiment faible",
                    "Le score numerique de sentiment est nettement negatif.",
                    [f"sentiment_score = {result.sentiment_score:.2f}"],
                    8,
                )
            )
        return risks

    def _data_quality_risks(
        self,
        market_data: MarketDataResult,
        technical: TechnicalResult,
        news: NewsResult,
        warnings: list[str],
    ) -> list[RiskItem]:
        risks: list[RiskItem] = []
        failed = [
            name
            for name, status in [
                ("MarketDataAgent", market_data.status),
                ("TechnicalAgent", technical.status),
                ("NewsAgent", news.status),
            ]
            if status == "failed"
        ]
        if failed:
            risks.append(
                self._risk(
                    "data_quality",
                    "high" if len(failed) >= 2 else "medium",
                    "Donnees incompletes",
                    "Un ou plusieurs agents amont n'ont pas fourni de resultat exploitable.",
                    [f"failed_agents = {', '.join(failed)}"],
                    12 if len(failed) == 1 else 25,
                )
            )
        partial = [
            name
            for name, status in [
                ("MarketDataAgent", market_data.status),
                ("TechnicalAgent", technical.status),
                ("NewsAgent", news.status),
            ]
            if status == "partial"
        ]
        if partial:
            risks.append(
                self._risk(
                    "data_quality",
                    "medium",
                    "Resultats partiels",
                    "Un ou plusieurs agents amont ont fonctionne avec une couverture incomplete.",
                    [f"partial_agents = {', '.join(partial)}"],
                    6 if len(partial) == 1 else 10,
                )
            )
        if market_data.used_fallback:
            risks.append(
                self._risk(
                    "data_quality",
                    "medium",
                    "Fallback de donnees utilise",
                    "Une partie de l'analyse repose sur un secours interne plutot que sur la source live principale.",
                    ["used_fallback = true"],
                    8,
                )
            )
        if len(market_data.sources_used) < 2:
            risks.append(
                self._risk(
                    "data_quality",
                    "medium",
                    "Couverture de sources limitee",
                    "Moins de deux sources de donnees marche ont ete utilisees.",
                    [f"sources_used = {market_data.sources_used}"],
                    6,
                )
            )
        rate_limit_warnings = self._matching_warnings(warnings, ["rate limit", "too many requests"])
        if rate_limit_warnings:
            risks.append(
                self._risk(
                    "data_quality",
                    "medium",
                    "API limitee par quota",
                    "Une source importante a refuse temporairement les requetes, ce qui reduit la fraicheur ou la couverture.",
                    rate_limit_warnings[:3],
                    7,
                )
            )
        unavailable_warnings = self._matching_warnings(
            warnings,
            ["unavailable", "indisponible", "missing key", "quota", "restricted", "fetch failed"],
        )
        if unavailable_warnings:
            risks.append(
                self._risk(
                    "data_quality",
                    "medium",
                    "Sources externes indisponibles",
                    "Certaines sources de donnees n'ont pas pu etre exploitees pendant l'analyse.",
                    unavailable_warnings[:3],
                    5,
                )
            )
        if news.status == "partial" or len(news.sources_used) < 2:
            risks.append(
                self._risk(
                    "data_quality",
                    "medium",
                    "Couverture news partielle",
                    "L'analyse du sentiment repose sur un nombre limite de sources d'actualites.",
                    [f"news_status = {news.status}", f"news_sources_used = {news.sources_used}"],
                    5,
                )
            )
        return risks

    def _data_confidence_score(
        self,
        market_data: MarketDataResult,
        technical: TechnicalResult,
        news: NewsResult,
        warnings: list[str],
    ) -> int:
        # La confiance mesure la disponibilite REELLE des donnees, pas le bruit
        # des sources redondantes. Une source secondaire rate-limited ou
        # indisponible ne fait pas baisser la confiance si la donnee a ete
        # obtenue ailleurs (meme principe que le prompt SLM). Seuls comptent :
        # le statut des composants, la redondance des sources reellement
        # utilisees, la completude effective et le recours a un secours interne.
        score = 100
        for status in (market_data.status, technical.status, news.status):
            if status == "failed":
                score -= 30
            elif status == "partial":
                score -= 12

        # Redondance des sources marche effectivement utilisees (pas les warnings).
        market_sources = len(market_data.sources_used)
        if market_sources == 0:
            score -= 25
        elif market_sources == 1:
            score -= 12

        # Completude effective des donnees : ce qui a vraiment ete collecte.
        if not market_data.historical_prices:
            score -= 20
        if not market_data.company_profile.name:
            score -= 10
        if not news.articles:
            score -= 20
        elif len(news.sources_used) < 2:
            score -= 8

        # Degradations reelles de fraicheur (secours interne / cache resservi),
        # a distinguer d'un simple warning de source redondante indisponible.
        if market_data.used_fallback:
            score -= 15
        if self._matching_warnings(warnings, ["cache memoire"]):
            score -= 8

        return max(0, min(100, score))

    def _remember(self, result: RiskResult) -> None:
        if self.graph is not None:
            self.graph.ingest_risk_result(result)

    def _risk(
        self,
        category,
        level: RiskLevel,
        title: str,
        description: str,
        evidence: list[str],
        score_impact: int,
    ) -> RiskItem:
        return RiskItem(
            category=category,
            level=level,
            title=title,
            description=description,
            evidence=evidence,
            score_impact=score_impact,
        )

    def _level_from_score(self, score: int) -> RiskLevel:
        if score >= 61:
            return "high"
        if score >= 31:
            return "medium"
        return "low"

    def _confidence_level_from_score(self, score: int) -> RiskLevel:
        if score >= 80:
            return "high"
        if score >= 55:
            return "medium"
        return "low"

    def _matching_warnings(self, warnings: list[str], needles: list[str]) -> list[str]:
        matches = []
        lowered_needles = [needle.lower() for needle in needles]
        for warning in warnings:
            lowered = warning.lower()
            if any(needle in lowered for needle in lowered_needles):
                matches.append(warning)
        return matches

    def _first_number(self, values: dict[str, object], keys: list[str]) -> float | None:
        for key in keys:
            value = values.get(key)
            if isinstance(value, (int, float)):
                return float(value)
        return None

    def _news_evidence(self, result: NewsResult) -> list[str]:
        evidence = []
        if result.sentiment_label:
            evidence.append(f"sentiment_label = {result.sentiment_label}")
        if result.sentiment_score is not None:
            evidence.append(f"sentiment_score = {result.sentiment_score:.2f}")
        evidence.extend([f"event = {event}" for event in result.key_events[:3]])
        return evidence or ["news sentiment unavailable"]

    def _non_slm_errors(self, errors: list[str]) -> list[str]:
        return [error for error in errors if "Nebius SLM unavailable" not in error]

    def _slm_warnings(self, errors: list[str]) -> list[str]:
        return [error for error in errors if "Nebius SLM unavailable" in error]

"""Synthese deterministe d'un portefeuille, avec narration SLM isolee."""

from __future__ import annotations

import re
from collections import defaultdict

from .nebius_client import NebiusClient
from .schemas import (
    PortfolioAnalysisResult,
    PortfolioHoldingAnalysis,
    PortfolioPositionAssessment,
    PortfolioRebalancingItem,
    PortfolioSynthesisResult,
    PortfolioSynthesisScores,
    PortfolioVerdict,
    SlmSummary,
)


PORTFOLIO_SCORE_WEIGHTS = {
    "individual_quality": 0.35,
    "diversification": 0.20,
    "risk_adjusted_performance": 0.20,
    "technical_alignment": 0.10,
    "data_quality": 0.15,
}
_DIGIT_RE = re.compile(r"\d")


class PortfolioSynthesisAgent:
    """Combine les diagnostics individuels sans modifier SynthesisAgent.

    Tous les scores, le verdict et les poids cibles sont calcules par du code.
    Le SLM portefeuille ne redige que la note qualitative.
    """

    def __init__(self, slm_client: NebiusClient | None = None) -> None:
        self.slm_client = slm_client or NebiusClient.for_agent("portfolio_synthesis")

    def run(
        self,
        portfolio: PortfolioAnalysisResult,
        individual_analyses: list[PortfolioHoldingAnalysis],
        with_slm: bool = True,
    ) -> PortfolioSynthesisResult:
        analyses = {item.ticker: item for item in individual_analyses}
        requested = len(portfolio.positions)
        usable = [item for item in individual_analyses if item.status != "failed"]
        analyzed = len(usable)

        if not requested or not analyzed:
            return PortfolioSynthesisResult(
                status="failed",
                requested_positions=requested,
                analyzed_positions=analyzed,
                errors=["Aucune analyse individuelle exploitable pour le portefeuille."],
            )

        scores = PortfolioSynthesisScores(
            individual_quality=self._individual_quality(portfolio, analyses),
            diversification=self._diversification_score(portfolio),
            risk_adjusted_performance=self._risk_adjusted_score(portfolio),
            technical_alignment=round(portfolio.technical_summary.weighted_score or 50),
            data_quality=self._data_quality_score(portfolio, usable, requested),
        )
        global_score = round(
            sum(
                getattr(scores, key) * weight
                for key, weight in PORTFOLIO_SCORE_WEIGHTS.items()
            )
        )
        confidence_score = scores.data_quality
        confidence_level = (
            "high" if confidence_score >= 80 else "medium" if confidence_score >= 50 else "low"
        )
        verdict = self._verdict(global_score, confidence_score, portfolio)
        target_weights, reserve_weight, diversify_weight = self._target_weights(
            portfolio, analyses, verdict, confidence_score
        )
        assessments = self._position_assessments(
            portfolio, analyses, target_weights
        )
        plan = self._rebalancing_plan(
            portfolio, assessments, reserve_weight, diversify_weight
        )
        strengths, weaknesses = self._signals(portfolio, scores, analyses)
        status = self._status(portfolio, individual_analyses, requested, analyzed)
        summary = self._deterministic_summary(verdict, strengths, weaknesses)
        warnings = list(dict.fromkeys([
            *portfolio.warnings,
            *(
                [f"Analyse complete disponible pour {analyzed}/{requested} position(s)."]
                if analyzed < requested
                else []
            ),
            "Les poids cibles sont une simulation heuristique, pas une optimisation ni un conseil financier.",
            "Les contraintes appliquees sont 30% maximum par ligne et 40% maximum par secteur.",
        ]))

        result = PortfolioSynthesisResult(
            status=status,
            verdict=verdict,
            global_score=global_score,
            confidence_score=confidence_score,
            confidence_level=confidence_level,
            scores=scores,
            weights=PORTFOLIO_SCORE_WEIGHTS,
            summary=summary,
            strengths=strengths,
            weaknesses=weaknesses,
            position_assessments=assessments,
            rebalancing_plan=plan,
            analyzed_positions=analyzed,
            requested_positions=requested,
            warnings=warnings,
        )
        if with_slm and status != "failed":
            self._add_slm_summary(result, individual_analyses)
        return result

    def _individual_quality(
        self,
        portfolio: PortfolioAnalysisResult,
        analyses: dict[str, PortfolioHoldingAnalysis],
    ) -> int:
        values = [
            (position.weight, analyses[position.ticker].global_score)
            for position in portfolio.positions
            if position.ticker in analyses and analyses[position.ticker].status != "failed"
        ]
        denominator = sum(weight for weight, _ in values)
        if denominator <= 0:
            return 0
        return self._clamp(round(sum(weight * score for weight, score in values) / denominator))

    def _diversification_score(self, portfolio: PortfolioAnalysisResult) -> int:
        score = portfolio.risk.diversification_score
        correlation = portfolio.performance.average_correlation
        if correlation is not None:
            score -= 25 if correlation >= 0.75 else 15 if correlation >= 0.50 else 5 if correlation >= 0.30 else 0
        largest_sector = max(
            (
                item.weight
                for item in portfolio.allocation_by_sector
                if item.label.casefold() != "cash"
            ),
            default=0,
        )
        if largest_sector > 60:
            score -= 20
        elif largest_sector > 40:
            score -= 10
        return self._clamp(score)

    def _risk_adjusted_score(self, portfolio: PortfolioAnalysisResult) -> int:
        performance = portfolio.performance
        sharpe = performance.sharpe_ratio
        if sharpe is None:
            return 35 if performance.observation_count else 20
        score = 90 if sharpe >= 1.5 else 78 if sharpe >= 1 else 62 if sharpe >= 0.5 else 48 if sharpe >= 0 else 28
        if (performance.jensen_alpha_percent or 0) > 0:
            score += 5
        drawdown = abs(performance.max_drawdown_percent or 0)
        if drawdown >= 30:
            score -= 20
        elif drawdown >= 20:
            score -= 10
        return self._clamp(score)

    def _data_quality_score(
        self,
        portfolio: PortfolioAnalysisResult,
        usable: list[PortfolioHoldingAnalysis],
        requested: int,
    ) -> int:
        individual_confidence = sum(item.confidence_score for item in usable) / len(usable)
        coverage = len(usable) / requested if requested else 0
        combined = (
            portfolio.risk.data_confidence_score * 0.35
            + individual_confidence * 0.45
            + coverage * 100 * 0.20
        )
        return self._clamp(round(combined))

    def _target_weights(
        self,
        portfolio: PortfolioAnalysisResult,
        analyses: dict[str, PortfolioHoldingAnalysis],
        verdict: PortfolioVerdict,
        confidence_score: int,
    ) -> tuple[dict[str, float], float, float]:
        risk_values = [item.risk_score for item in analyses.values() if item.status != "failed"]
        average_risk = sum(risk_values) / len(risk_values) if risk_values else 100
        if confidence_score < 50 or average_risk >= 65:
            reserve = 20.0
        elif verdict in {"fragile", "a_reequilibrer"} or average_risk >= 45:
            reserve = 15.0
        else:
            reserve = 10.0

        recommendation_factor = {
            "favorable": 1.20,
            "a_surveiller": 0.95,
            "prudence": 0.60,
            "defavorable": 0.20,
            "donnees_insuffisantes": 0.0,
        }
        attractiveness: dict[str, float] = {}
        for position in portfolio.positions:
            analysis = analyses.get(position.ticker)
            if analysis is None or analysis.status == "failed" or analysis.confidence_score < 35:
                continue
            quality = max(0.1, analysis.global_score / 100)
            risk_factor = max(0.35, 1 - analysis.risk_score / 130)
            attractiveness[position.ticker] = (
                quality * risk_factor * recommendation_factor[analysis.recommendation]
            )

        total = sum(attractiveness.values())
        if total <= 0:
            return {}, reserve, round(100 - reserve, 2)
        investable = 100 - reserve
        targets = {
            ticker: min(30.0, investable * value / total)
            for ticker, value in attractiveness.items()
        }

        sectors = {position.ticker: position.sector for position in portfolio.positions}
        sector_totals: dict[str, float] = defaultdict(float)
        for ticker, weight in targets.items():
            sector_totals[sectors.get(ticker, "Unknown").casefold()] += weight
        for sector, total_weight in sector_totals.items():
            if total_weight <= 40:
                continue
            scale = 40 / total_weight
            for ticker in targets:
                if sectors.get(ticker, "Unknown").casefold() == sector:
                    targets[ticker] *= scale

        rounded = {ticker: round(weight, 2) for ticker, weight in targets.items()}
        diversify = max(0.0, round(100 - reserve - sum(rounded.values()), 2))
        return rounded, reserve, diversify

    def _position_assessments(
        self,
        portfolio: PortfolioAnalysisResult,
        analyses: dict[str, PortfolioHoldingAnalysis],
        targets: dict[str, float],
    ) -> list[PortfolioPositionAssessment]:
        rows: list[PortfolioPositionAssessment] = []
        for position in portfolio.positions:
            analysis = analyses.get(position.ticker)
            target = targets.get(position.ticker, 0.0)
            if analysis is None or analysis.status == "failed":
                decision = "non_evaluable"
                rationale = "Analyse individuelle indisponible ; aucune decision ne peut etre etayee."
            elif analysis.recommendation == "defavorable" and target < position.weight:
                decision = "ecarter"
                rationale = "Le diagnostic individuel est defavorable et sa contribution au portefeuille doit etre limitee."
            elif target - position.weight >= 3:
                decision = "renforcer"
                rationale = "Le poids cible est superieur au poids actuel selon la qualite et le risque mesures."
            elif position.weight - target >= 3:
                decision = "reduire"
                rationale = "Le poids actuel depasse le poids compatible avec les contraintes de risque et de diversification."
            else:
                decision = "conserver"
                rationale = "Le poids actuel reste proche de l'allocation simulee."
            rows.append(
                PortfolioPositionAssessment(
                    ticker=position.ticker,
                    current_weight=position.weight,
                    target_weight=target,
                    global_score=analysis.global_score if analysis else None,
                    confidence_score=analysis.confidence_score if analysis else 0,
                    risk_level=analysis.risk_level if analysis else "high",
                    decision=decision,
                    rationale=rationale,
                )
            )
        return rows

    def _rebalancing_plan(
        self,
        portfolio: PortfolioAnalysisResult,
        assessments: list[PortfolioPositionAssessment],
        reserve: float,
        diversify: float,
    ) -> list[PortfolioRebalancingItem]:
        rows = [
            PortfolioRebalancingItem(
                label=item.ticker,
                current_weight=item.current_weight,
                target_weight=item.target_weight,
                change_percent=round(item.target_weight - item.current_weight, 2),
                action=item.decision,
                rationale=item.rationale,
            )
            for item in assessments
        ]
        current_cash = next(
            (item.weight for item in portfolio.allocation_by_holding if item.label == "Cash"),
            0.0,
        )
        rows.append(
            PortfolioRebalancingItem(
                label="Liquidites",
                current_weight=current_cash,
                target_weight=reserve,
                change_percent=round(reserve - current_cash, 2),
                action="reserve",
                rationale="Reserve de prudence calibree selon le risque et la confiance des donnees.",
            )
        )
        if diversify > 0.01:
            rows.append(
                PortfolioRebalancingItem(
                    label="A diversifier",
                    target_weight=diversify,
                    change_percent=diversify,
                    action="diversifier",
                    rationale="Poids laisse disponible pour des secteurs ou actifs absents du portefeuille actuel.",
                )
            )
        return rows

    def _signals(
        self,
        portfolio: PortfolioAnalysisResult,
        scores: PortfolioSynthesisScores,
        analyses: dict[str, PortfolioHoldingAnalysis],
    ) -> tuple[list[str], list[str]]:
        strengths: list[str] = []
        weaknesses: list[str] = []
        if scores.individual_quality >= 65:
            strengths.append("Les entreprises retenues presentent une qualite individuelle globalement solide.")
        elif scores.individual_quality < 45:
            weaknesses.append("La qualite individuelle moyenne des positions est insuffisante.")
        if scores.diversification >= 65:
            strengths.append("La repartition limite correctement la concentration entre les positions.")
        elif scores.diversification < 45:
            weaknesses.append("La concentration sectorielle ou la correlation reduit le benefice de diversification.")
        if scores.risk_adjusted_performance >= 65:
            strengths.append("Le rendement historique compense correctement le risque mesure.")
        elif scores.risk_adjusted_performance < 45:
            weaknesses.append("La performance ajustee du risque reste insuffisante ou mal documentee.")
        if scores.technical_alignment >= 65:
            strengths.append("Les tendances techniques des positions sont majoritairement favorables.")
        elif scores.technical_alignment < 45:
            weaknesses.append("Les signaux techniques agreges manquent de soutien.")
        if scores.data_quality < 60:
            weaknesses.append("La couverture des sources ne permet pas une conclusion pleinement fiable.")
        high_risk = [item.ticker for item in analyses.values() if item.risk_level == "high"]
        if high_risk:
            weaknesses.append(f"Risque individuel eleve detecte sur {', '.join(high_risk[:3])}.")
        return strengths[:4], weaknesses[:4]

    @staticmethod
    def _deterministic_summary(
        verdict: PortfolioVerdict,
        strengths: list[str],
        weaknesses: list[str],
    ) -> str:
        introductions = {
            "robuste": "La combinaison selectionnee forme un portefeuille robuste dans les conditions mesurees.",
            "coherent": "La combinaison selectionnee est globalement coherente, avec quelques points a surveiller.",
            "a_reequilibrer": "Le portefeuille presente des qualites, mais sa composition doit etre reequilibree.",
            "fragile": "Le portefeuille est fragile : ses risques dominent actuellement ses points forts.",
            "donnees_insuffisantes": "Les donnees sont insuffisantes pour juger correctement cette combinaison.",
        }
        parts = [introductions[verdict]]
        if strengths:
            parts.append(strengths[0])
        if weaknesses:
            parts.append(weaknesses[0])
        return " ".join(parts)

    def _add_slm_summary(
        self,
        result: PortfolioSynthesisResult,
        individual_analyses: list[PortfolioHoldingAnalysis],
    ) -> None:
        try:
            payload = {
                "synthese_portefeuille": result.model_dump(exclude={"slm_summary"}),
                "analyses_individuelles": [item.model_dump() for item in individual_analyses],
            }
            summary = self.slm_client.summarize_portfolio_synthesis_data(payload)
            if not summary:
                return
            candidate = SlmSummary.model_validate(summary)
            narrative = " ".join([candidate.summary, *candidate.key_points])
            if _DIGIT_RE.search(narrative):
                result.warnings.append(
                    "Note SLM portefeuille ecartee : elle contenait des chiffres non autorises."
                )
                return
            result.slm_summary = candidate
            if candidate.summary:
                result.summary = candidate.summary
        except Exception as error:
            result.warnings.append(
                f"Nebius SLM unavailable for PortfolioSynthesisAgent: {error}"
            )

    @staticmethod
    def _verdict(
        score: int,
        confidence: int,
        portfolio: PortfolioAnalysisResult,
    ) -> PortfolioVerdict:
        if confidence < 40:
            return "donnees_insuffisantes"
        if score >= 75:
            verdict: PortfolioVerdict = "robuste"
        elif score >= 62:
            verdict = "coherent"
        elif score >= 48:
            verdict = "a_reequilibrer"
        else:
            verdict = "fragile"
        if (
            portfolio.risk.concentration_level == "high"
            and verdict in {"robuste", "coherent"}
        ):
            return "a_reequilibrer"
        return verdict

    @staticmethod
    def _status(
        portfolio: PortfolioAnalysisResult,
        analyses: list[PortfolioHoldingAnalysis],
        requested: int,
        analyzed: int,
    ) -> str:
        if not analyzed:
            return "failed"
        if (
            portfolio.status != "success"
            or analyzed < requested
            or any(item.status != "success" for item in analyses)
        ):
            return "partial"
        return "success"

    @staticmethod
    def _clamp(value: int) -> int:
        return max(0, min(100, value))

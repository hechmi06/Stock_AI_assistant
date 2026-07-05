"""Evaluation des agents (MarketDataAgent, TechnicalAgent).

Les agents sont evalues sur la qualite de leur production (pas sur une
prediction). Chaque metrique renvoie un nom, un score entre 0 et 1, un booleen
`passed` et un message. On agrege ensuite en un `total_score` (0-100), une
`grade` et un `passed` global.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .schemas import MarketDataResult, TechnicalResult

Grade = Literal["excellent", "good", "partial", "poor"]

# Seuils / cibles (ajustables selon le contexte metier)
HISTORICAL_TARGET = 120  # ~6 mois de seances pour un score plein
HISTORICAL_MIN_PASS = 20
PROFILE_FIELDS = ("name", "sector", "industry", "market_cap")
PROFILE_PASS_RATIO = 0.75
STATEMENT_PASS_RATIO = 0.5
RATIO_TARGET = 5
RATIO_MIN_PASS = 3
ERROR_SCALE = 5  # nb d'erreurs qui ramene le score a 0
ERROR_MAX_PASS = 2
SOURCE_TARGET = 2  # nb de sources reelles pour un score plein

GRADE_EXCELLENT = 85.0
GRADE_GOOD = 70.0
GRADE_PARTIAL = 50.0
OVERALL_PASS_SCORE = GRADE_GOOD


class MetricResult(BaseModel):
    name: str
    score: float = Field(ge=0.0, le=1.0)
    passed: bool
    message: str


class EvaluationReport(BaseModel):
    ticker: str
    metrics: list[MetricResult]
    total_score: float = Field(ge=0.0, le=100.0)
    grade: Grade
    passed: bool


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _agent_availability(result: MarketDataResult, agent_available: bool) -> MetricResult:
    ok = agent_available and result.status != "failed"
    return MetricResult(
        name="agent_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(
            "Agent operationnel, resultat exploitable."
            if ok
            else "Agent indisponible ou resultat en echec (status=failed)."
        ),
    )


def _status_validity(result: MarketDataResult) -> MetricResult:
    valid_value = result.status in {"success", "partial", "failed"}
    has_data = (
        result.price is not None
        or bool(result.historical_prices)
        or bool(result.company_profile.name)
    )
    coherent = (result.status == "failed") != has_data
    if result.status == "success":
        score = 1.0
    elif result.status == "partial":
        score = 0.7
    else:
        score = 0.0
    if not coherent:
        score *= 0.5
    passed = valid_value and coherent and result.status != "failed"
    return MetricResult(
        name="status_validity",
        score=_clamp01(score),
        passed=passed,
        message=f"Statut '{result.status}' {'coherent' if coherent else 'incoherent'} avec les donnees.",
    )


def _source_coverage(result: MarketDataResult) -> MetricResult:
    count = len(result.sources_used)
    score = _clamp01(count / SOURCE_TARGET)
    label = ", ".join(result.sources_used) if result.sources_used else "aucune"
    return MetricResult(
        name="source_coverage",
        score=score,
        passed=count >= 1,
        message=f"{count} source(s) reelle(s) : {label}.",
    )


def _no_internal_fallback(result: MarketDataResult) -> MetricResult:
    ok = not result.used_fallback
    return MetricResult(
        name="no_internal_fallback",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(
            "Aucun fallback interne utilise."
            if ok
            else "Fallback interne utilise (donnees de secours)."
        ),
    )


def _price_completeness(result: MarketDataResult) -> MetricResult:
    ok = result.price is not None
    return MetricResult(
        name="price_completeness",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(f"Prix disponible : {result.price}." if ok else "Prix manquant."),
    )


def _historical_completeness(result: MarketDataResult) -> MetricResult:
    count = len(result.historical_prices)
    score = _clamp01(count / HISTORICAL_TARGET)
    return MetricResult(
        name="historical_completeness",
        score=score,
        passed=count >= HISTORICAL_MIN_PASS,
        message=f"{count} points historiques (seuil minimal {HISTORICAL_MIN_PASS}).",
    )


def _company_profile_completeness(result: MarketDataResult) -> MetricResult:
    profile = result.company_profile
    present = 0
    for field_name in PROFILE_FIELDS:
        value = getattr(profile, field_name, None)
        if value not in (None, ""):
            present += 1
    score = present / len(PROFILE_FIELDS)
    return MetricResult(
        name="company_profile_completeness",
        score=_clamp01(score),
        passed=score >= PROFILE_PASS_RATIO,
        message=f"{present}/{len(PROFILE_FIELDS)} champs cles du profil renseignes.",
    )


def _financial_ratios_completeness(result: MarketDataResult) -> MetricResult:
    ratios = result.financial_ratios or {}
    total = len(ratios)
    non_null = sum(1 for value in ratios.values() if value is not None)
    score = _clamp01(non_null / RATIO_TARGET)
    return MetricResult(
        name="financial_ratios_completeness",
        score=score,
        passed=non_null >= RATIO_MIN_PASS,
        message=f"{non_null} ratio(s) non nul(s) sur {total} fourni(s).",
    )


def _financial_statements_completeness(result: MarketDataResult) -> MetricResult:
    data = result.financial_statements_summary.model_dump()
    total = len(data)
    present = sum(1 for value in data.values() if value not in (None, ""))
    score = present / total if total else 0.0
    return MetricResult(
        name="financial_statements_completeness",
        score=_clamp01(score),
        passed=score >= STATEMENT_PASS_RATIO,
        message=f"{present}/{total} champs d'etats financiers renseignes.",
    )


def _controlled_errors(result: MarketDataResult) -> MetricResult:
    count = len(result.errors)
    warn_count = len(result.warnings)
    score = _clamp01(1.0 - count / ERROR_SCALE)
    if count == 0:
        message = f"Aucune erreur fatale ({warn_count} avertissement(s) non bloquant(s))."
    else:
        message = f"{count} erreur(s) fatale(s), {warn_count} avertissement(s)."
    return MetricResult(
        name="controlled_errors",
        score=score,
        passed=count <= ERROR_MAX_PASS,
        message=message,
    )


def _slm_summary_availability(result: MarketDataResult) -> MetricResult:
    summary = result.slm_summary
    ok = summary is not None
    if ok:
        message = f"Resume SLM present (qualite: {summary.data_quality})."
    else:
        message = "Resume SLM absent."
    return MetricResult(
        name="slm_summary_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=message,
    )


def _grade_from_score(total_score: float) -> Grade:
    if total_score >= GRADE_EXCELLENT:
        return "excellent"
    if total_score >= GRADE_GOOD:
        return "good"
    if total_score >= GRADE_PARTIAL:
        return "partial"
    return "poor"


def evaluate_market_data(
    result: MarketDataResult, agent_available: bool = True
) -> EvaluationReport:
    """Evalue un resultat de MarketDataAgent et renvoie un rapport complet."""
    metrics = [
        _agent_availability(result, agent_available),
        _status_validity(result),
        _source_coverage(result),
        _no_internal_fallback(result),
        _price_completeness(result),
        _historical_completeness(result),
        _company_profile_completeness(result),
        _financial_ratios_completeness(result),
        _financial_statements_completeness(result),
        _controlled_errors(result),
        _slm_summary_availability(result),
    ]

    return _build_report(result.ticker, metrics)


def _build_report(ticker: str, metrics: list[MetricResult]) -> EvaluationReport:
    total_score = round(sum(m.score for m in metrics) / len(metrics) * 100, 1)
    grade = _grade_from_score(total_score)

    return EvaluationReport(
        ticker=ticker,
        metrics=metrics,
        total_score=total_score,
        grade=grade,
        passed=total_score >= OVERALL_PASS_SCORE,
    )


# ---------------------------------------------------------------------------
# Evaluation du TechnicalAgent
# ---------------------------------------------------------------------------

def _tech_agent_availability(result: TechnicalResult) -> MetricResult:
    ok = result.status != "failed"
    return MetricResult(
        name="agent_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(
            "Agent operationnel, analyse exploitable."
            if ok
            else "Analyse en echec (status=failed)."
        ),
    )


def _tech_status_validity(result: TechnicalResult) -> MetricResult:
    has_indicators = (
        result.rsi is not None
        or result.moving_averages.sma_20 is not None
        or result.technical_score is not None
    )
    coherent = (result.status == "failed") != has_indicators
    if result.status == "success":
        score = 1.0
    elif result.status == "partial":
        score = 0.7
    else:
        score = 0.0
    if not coherent:
        score *= 0.5
    return MetricResult(
        name="status_validity",
        score=_clamp01(score),
        passed=coherent and result.status != "failed",
        message=f"Statut '{result.status}' {'coherent' if coherent else 'incoherent'} avec les indicateurs.",
    )


def _tech_rsi_availability(result: TechnicalResult) -> MetricResult:
    ok = result.rsi is not None and 0.0 <= result.rsi <= 100.0
    return MetricResult(
        name="rsi_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(f"RSI calcule : {result.rsi}." if ok else "RSI manquant ou hors bornes."),
    )


def _tech_moving_averages(result: TechnicalResult) -> MetricResult:
    present = sum(
        1 for value in (result.moving_averages.sma_20, result.moving_averages.sma_50) if value is not None
    )
    return MetricResult(
        name="moving_averages_completeness",
        score=present / 2,
        passed=present == 2,
        message=f"{present}/2 moyennes mobiles calculees (SMA 20, SMA 50).",
    )


def _tech_volatility(result: TechnicalResult) -> MetricResult:
    ok = result.volatility is not None
    return MetricResult(
        name="volatility_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(f"Volatilite calculee : {result.volatility}." if ok else "Volatilite manquante."),
    )


def _tech_levels(result: TechnicalResult) -> MetricResult:
    present = sum(1 for value in (result.support_level, result.resistance_level) if value is not None)
    return MetricResult(
        name="levels_availability",
        score=present / 2,
        passed=present == 2,
        message=f"{present}/2 niveaux calcules (support, resistance).",
    )


def _tech_volume_analysis(result: TechnicalResult) -> MetricResult:
    volume = result.volume_analysis
    present = sum(
        1 for value in (volume.last_volume, volume.average_volume, volume.volume_ratio) if value is not None
    )
    return MetricResult(
        name="volume_analysis_completeness",
        score=present / 3,
        passed=present >= 2,
        message=f"{present}/3 champs volume renseignes ({volume.interpretation}).",
    )


def _tech_score_and_signal(result: TechnicalResult) -> MetricResult:
    score_ok = result.technical_score is not None and 0 <= result.technical_score <= 100
    ok = score_ok  # signal et trend ont toujours une valeur valide (Literal avec defaut)
    message = (
        f"Score {result.technical_score}/100, signal '{result.signal}', tendance '{result.trend}'."
        if score_ok
        else "Score technique manquant ou hors bornes."
    )
    return MetricResult(
        name="score_and_signal_validity",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=message,
    )


def _tech_controlled_errors(result: TechnicalResult) -> MetricResult:
    count = len(result.errors)
    score = _clamp01(1.0 - count / ERROR_SCALE)
    message = "Aucune erreur." if count == 0 else f"{count} erreur(s) remontee(s)."
    return MetricResult(
        name="controlled_errors",
        score=score,
        passed=count <= ERROR_MAX_PASS,
        message=message,
    )


def _tech_slm_summary(result: TechnicalResult) -> MetricResult:
    summary = result.slm_summary
    ok = summary is not None
    message = (
        f"Resume SLM present (qualite: {summary.data_quality})." if ok else "Resume SLM absent."
    )
    return MetricResult(
        name="slm_summary_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=message,
    )


def evaluate_technical(result: TechnicalResult) -> EvaluationReport:
    """Evalue un resultat de TechnicalAgent et renvoie un rapport complet."""
    metrics = [
        _tech_agent_availability(result),
        _tech_status_validity(result),
        _source_coverage_from_list(result.sources_used),
        _tech_rsi_availability(result),
        _tech_moving_averages(result),
        _tech_volatility(result),
        _tech_levels(result),
        _tech_volume_analysis(result),
        _tech_score_and_signal(result),
        _tech_controlled_errors(result),
        _tech_slm_summary(result),
    ]

    return _build_report(result.ticker, metrics)


def _source_coverage_from_list(sources: list[str]) -> MetricResult:
    count = len(sources)
    label = ", ".join(sources) if sources else "aucune"
    return MetricResult(
        name="source_coverage",
        score=_clamp01(count / SOURCE_TARGET),
        passed=count >= 1,
        message=f"{count} source(s) de donnees utilisee(s) : {label}.",
    )

"""Evaluation des agents (MarketDataAgent, TechnicalAgent).

Les agents sont evalues sur la qualite de leur production (pas sur une
prediction). Chaque metrique renvoie un nom, un score entre 0 et 1, un booleen
`passed` et un message. On agrege ensuite en un `total_score` (0-100), une
`grade` et un `passed` global.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from datetime import datetime, timezone

from .risk_scoring import compute_risk_score
from .schemas import (
    MarketDataResult,
    NewsResult,
    RagResult,
    RiskResult,
    SynthesisResult,
    TechnicalResult,
)

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


# ---------------------------------------------------------------------------
# Evaluation du NewsAgent
# ---------------------------------------------------------------------------

NEWS_ARTICLES_TARGET = 10
NEWS_ARTICLES_MIN_PASS = 3
NEWS_FRESHNESS_PASS_HOURS = 48.0
NEWS_FRESHNESS_SCALE_DAYS = 7.0


def _news_agent_availability(result: NewsResult) -> MetricResult:
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


def _news_status_validity(result: NewsResult) -> MetricResult:
    has_articles = bool(result.articles)
    coherent = (result.status == "failed") != has_articles
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
        message=f"Statut '{result.status}' {'coherent' if coherent else 'incoherent'} avec les articles.",
    )


def _news_articles_count(result: NewsResult) -> MetricResult:
    count = len(result.articles)
    return MetricResult(
        name="articles_count",
        score=_clamp01(count / NEWS_ARTICLES_TARGET),
        passed=count >= NEWS_ARTICLES_MIN_PASS,
        message=f"{count} article(s) collecte(s) (seuil minimal {NEWS_ARTICLES_MIN_PASS}).",
    )


def _news_freshness(result: NewsResult) -> MetricResult:
    newest_age_hours: float | None = None
    now = datetime.now(timezone.utc)
    for article in result.articles:
        try:
            published = datetime.fromisoformat(article.published_at.replace("Z", "+00:00"))
        except ValueError:
            continue
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        age_hours = (now - published).total_seconds() / 3600
        if newest_age_hours is None or age_hours < newest_age_hours:
            newest_age_hours = age_hours

    if newest_age_hours is None:
        return MetricResult(
            name="articles_freshness",
            score=0.0,
            passed=False,
            message="Aucune date d'article exploitable.",
        )

    score = _clamp01(1.0 - newest_age_hours / (NEWS_FRESHNESS_SCALE_DAYS * 24))
    passed = newest_age_hours <= NEWS_FRESHNESS_PASS_HOURS
    return MetricResult(
        name="articles_freshness",
        score=score,
        passed=passed,
        message=f"Article le plus recent : il y a {newest_age_hours:.0f} h (seuil {NEWS_FRESHNESS_PASS_HOURS:.0f} h).",
    )


def _news_summaries_coverage(result: NewsResult) -> MetricResult:
    total = len(result.articles)
    if total == 0:
        return MetricResult(
            name="summaries_coverage",
            score=0.0,
            passed=False,
            message="Aucun article a resumer.",
        )
    with_summary = sum(1 for article in result.articles if article.summary)
    ratio = with_summary / total
    return MetricResult(
        name="summaries_coverage",
        score=_clamp01(ratio),
        passed=ratio >= 0.5,
        message=f"{with_summary}/{total} article(s) avec resume/extrait.",
    )


def _news_sentiment_availability(result: NewsResult) -> MetricResult:
    ok = result.sentiment_label is not None and result.sentiment_score is not None
    if ok:
        message = f"Sentiment global : {result.sentiment_label} (score {result.sentiment_score})."
    else:
        message = "Sentiment global manquant."
    return MetricResult(
        name="sentiment_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=message,
    )


def _news_article_sentiment_coverage(result: NewsResult) -> MetricResult:
    total = len(result.articles)
    if total == 0:
        return MetricResult(
            name="article_sentiment_coverage",
            score=0.0,
            passed=False,
            message="Aucun article a classer.",
        )
    classified = sum(1 for article in result.articles if article.sentiment is not None)
    ratio = classified / total
    return MetricResult(
        name="article_sentiment_coverage",
        score=_clamp01(ratio),
        passed=ratio >= 0.5,
        message=f"{classified}/{total} article(s) classe(s) par sentiment.",
    )


def _news_key_events(result: NewsResult) -> MetricResult:
    count = len(result.key_events)
    return MetricResult(
        name="key_events_detected",
        score=_clamp01(count / 2),
        passed=count >= 1,
        message=(
            f"{count} evenement(s) important(s) detecte(s)."
            if count
            else "Aucun evenement important detecte."
        ),
    )


def _news_controlled_errors(result: NewsResult) -> MetricResult:
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


def _news_slm_summary(result: NewsResult) -> MetricResult:
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


def evaluate_news(result: NewsResult) -> EvaluationReport:
    """Evalue un resultat de NewsAgent et renvoie un rapport complet."""
    metrics = [
        _news_agent_availability(result),
        _news_status_validity(result),
        _source_coverage_from_list(result.sources_used),
        _news_articles_count(result),
        _news_freshness(result),
        _news_summaries_coverage(result),
        _news_sentiment_availability(result),
        _news_article_sentiment_coverage(result),
        _news_key_events(result),
        _news_controlled_errors(result),
        _news_slm_summary(result),
    ]

    return _build_report(result.ticker, metrics)


# ---------------------------------------------------------------------------
# Evaluation du RiskAgent
# ---------------------------------------------------------------------------
#
# Le RiskAgent ne collecte pas de donnees : il agrege 3 agents amont et applique
# des regles. On evalue donc la coherence du diagnostic et sa tracabilite, pas
# une exactitude de prediction. Deux metriques verrouillent des invariants de
# conception issus de corrections passees :
#   - risk_score_purity : le risk_score ne doit refleter que le risque
#     intrinseque du titre, jamais les problemes de qualite des donnees ;
#   - news_dimension_active : le sentiment news (coeur du risque news) doit etre
#     reellement pris en compte, pas neutralise par un SLM desactive.

# Seuils repris de RiskAgent pour verifier la coherence score <-> niveau.
RISK_LEVEL_HIGH_MIN = 61
RISK_LEVEL_MEDIUM_MIN = 30
CONFIDENCE_LEVEL_HIGH_MIN = 80
CONFIDENCE_LEVEL_MEDIUM_MIN = 55

_COMPONENT_HEALTH = {"success": 1.0, "partial": 0.5, "failed": 0.0}


def _risk_agent_availability(result: RiskResult) -> MetricResult:
    ok = result.status != "failed"
    return MetricResult(
        name="agent_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(
            "Agent operationnel, diagnostic exploitable."
            if ok
            else "Diagnostic en echec (status=failed)."
        ),
    )


def _risk_status_validity(result: RiskResult) -> MetricResult:
    snapshot = result.component_status
    statuses = [snapshot.market_data_status, snapshot.technical_status, snapshot.news_status, snapshot.rag_status]
    all_failed = all(status == "failed" for status in statuses)
    # Le RiskAgent ne doit etre 'failed' que si tous les agents amont ont echoue.
    coherent = (result.status == "failed") == all_failed
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
        message=f"Statut '{result.status}' {'coherent' if coherent else 'incoherent'} avec les agents amont.",
    )


def _risk_component_coverage(result: RiskResult) -> MetricResult:
    snapshot = result.component_status
    statuses = [snapshot.market_data_status, snapshot.technical_status, snapshot.news_status, snapshot.rag_status]
    score = sum(_COMPONENT_HEALTH.get(status, 0.0) for status in statuses) / len(statuses)
    healthy = sum(1 for status in statuses if status == "success")
    return MetricResult(
        name="component_coverage",
        score=_clamp01(score),
        passed=score >= 0.5,
        message=(
            f"{healthy}/4 agents amont en succes "
            f"(market={snapshot.market_data_status}, technical={snapshot.technical_status}, "
            f"news={snapshot.news_status}, rag={snapshot.rag_status})."
        ),
    )


def _risk_score_validity(result: RiskResult) -> MetricResult:
    in_range = 0 <= result.risk_score <= 100
    if result.risk_score >= RISK_LEVEL_HIGH_MIN:
        expected = "high"
    elif result.risk_score >= RISK_LEVEL_MEDIUM_MIN:
        expected = "medium"
    else:
        expected = "low"
    coherent = result.overall_risk_level == expected
    ok = in_range and coherent
    return MetricResult(
        name="risk_score_validity",
        score=1.0 if ok else (0.5 if in_range else 0.0),
        passed=ok,
        message=(
            f"risk_score={result.risk_score}/100 coherent avec niveau '{result.overall_risk_level}'."
            if ok
            else f"risk_score={result.risk_score}/100 incoherent (niveau attendu '{expected}', "
            f"obtenu '{result.overall_risk_level}')."
        ),
    )


def _risk_score_purity(result: RiskResult) -> MetricResult:
    """Invariant : les risques data_quality n'entrent pas dans le risk_score.

    Verification independante de la formule : on recalcule le score officiel
    (doit correspondre au score publie) et on verifie que retirer les risques
    data_quality ne change rien (ils sont donc bien inertes sur le risque).
    """
    expected = compute_risk_score(result.risks)
    without_dq = [risk for risk in result.risks if risk.category != "data_quality"]
    inert = compute_risk_score(without_dq) == expected
    dq_count = len(result.risks) - len(without_dq)
    ok = result.risk_score == expected and inert
    return MetricResult(
        name="risk_score_purity",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(
            f"risk_score={result.risk_score} reflete le risque intrinseque ; "
            f"{dq_count} risque(s) data_quality sans effet sur le score."
            if ok
            else f"risk_score={result.risk_score} incoherent (attendu {expected}) "
            f"ou pollue par {dq_count} risque(s) data_quality."
        ),
    )


def _risk_confidence_validity(result: RiskResult) -> MetricResult:
    in_range = 0 <= result.data_confidence_score <= 100
    if result.data_confidence_score >= CONFIDENCE_LEVEL_HIGH_MIN:
        expected = "high"
    elif result.data_confidence_score >= CONFIDENCE_LEVEL_MEDIUM_MIN:
        expected = "medium"
    else:
        expected = "low"
    coherent = result.data_confidence_level == expected
    ok = in_range and coherent
    return MetricResult(
        name="confidence_score_validity",
        score=1.0 if ok else (0.5 if in_range else 0.0),
        passed=ok,
        message=(
            f"data_confidence_score={result.data_confidence_score}/100 coherent avec "
            f"niveau '{result.data_confidence_level}'."
            if ok
            else f"data_confidence_score={result.data_confidence_score}/100 incoherent "
            f"(attendu '{expected}', obtenu '{result.data_confidence_level}')."
        ),
    )


def _risk_news_dimension_active(result: RiskResult) -> MetricResult:
    """Le risque news doit etre reellement evalue, pas neutralise.

    Si NewsAgent a echoue, la dimension est absente pour une raison legitime
    (score partiel). Mais si news != failed, on attend un sentiment exploite :
    soit un risque de categorie 'news', soit un statut news 'success' (sentiment
    calcule et non risque, ce qui est un resultat valide).
    """
    news_status = result.component_status.news_status
    if news_status == "failed":
        return MetricResult(
            name="news_dimension_active",
            score=0.0,
            passed=False,
            message="NewsAgent en echec : dimension news indisponible pour le risque.",
        )
    has_news_risk = any(risk.category == "news" for risk in result.risks)
    sentiment_used = news_status == "success" or has_news_risk
    return MetricResult(
        name="news_dimension_active",
        score=1.0 if sentiment_used else 0.4,
        passed=sentiment_used,
        message=(
            "Sentiment news pris en compte dans le risque."
            if sentiment_used
            else "NewsAgent 'partial' sans sentiment : dimension news probablement neutralisee."
        ),
    )


def _risk_documentary_dimension_active(result: RiskResult) -> MetricResult:
    rag_status = result.component_status.rag_status
    if rag_status == "failed":
        return MetricResult(
            name="documentary_dimension_active",
            score=0.0,
            passed=False,
            message="RAGAgent en echec : risques documentaires indisponibles.",
        )
    has_documentary_risk = any(risk.category == "documentary" for risk in result.risks)
    ok = rag_status == "success" and has_documentary_risk
    return MetricResult(
        name="documentary_dimension_active",
        score=1.0 if ok else 0.5 if rag_status == "success" else 0.3,
        passed=ok,
        message=(
            "Risques documentaires issus du RAG pris en compte."
            if ok
            else f"RAGAgent={rag_status}, mais aucun risque documentaire structure n'a ete ajoute."
        ),
    )


def _risk_evidence_coverage(result: RiskResult) -> MetricResult:
    total = len(result.risks)
    if total == 0:
        return MetricResult(
            name="evidence_coverage",
            score=1.0,
            passed=True,
            message="Aucun risque detecte : rien a justifier.",
        )
    with_evidence = sum(1 for risk in result.risks if risk.evidence)
    ratio = with_evidence / total
    return MetricResult(
        name="evidence_coverage",
        score=_clamp01(ratio),
        passed=ratio >= 0.9,
        message=f"{with_evidence}/{total} risque(s) avec preuve chiffree.",
    )


def _risk_explainability(result: RiskResult) -> MetricResult:
    total = len(result.risks)
    if total == 0:
        return MetricResult(
            name="risk_explainability",
            score=1.0,
            passed=True,
            message="Aucun risque a expliquer.",
        )
    explained = sum(1 for risk in result.risks if risk.title and risk.description)
    ratio = explained / total
    return MetricResult(
        name="risk_explainability",
        score=_clamp01(ratio),
        passed=ratio >= 0.9,
        message=f"{explained}/{total} risque(s) avec titre + description.",
    )


def _risk_confidence_explained(result: RiskResult) -> MetricResult:
    """Transparence : une confiance degradee doit etre justifiee.

    Si la confiance n'est pas 'high', on attend au moins un risque data_quality
    ou un avertissement expliquant pourquoi les donnees sont limitees.
    """
    if result.data_confidence_level == "high":
        return MetricResult(
            name="confidence_explained",
            score=1.0,
            passed=True,
            message="Confiance elevee : aucune justification requise.",
        )
    has_dq_risk = any(risk.category == "data_quality" for risk in result.risks)
    explained = has_dq_risk or bool(result.warnings)
    return MetricResult(
        name="confidence_explained",
        score=1.0 if explained else 0.0,
        passed=explained,
        message=(
            f"Confiance '{result.data_confidence_level}' justifiee "
            f"(risque data_quality ou avertissement present)."
            if explained
            else f"Confiance '{result.data_confidence_level}' non justifiee : "
            "aucun risque data_quality ni avertissement."
        ),
    )


def _risk_controlled_errors(result: RiskResult) -> MetricResult:
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


def _risk_slm_summary(result: RiskResult) -> MetricResult:
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


def evaluate_risk(result: RiskResult) -> EvaluationReport:
    """Evalue un resultat de RiskAgent et renvoie un rapport complet."""
    metrics = [
        _risk_agent_availability(result),
        _risk_status_validity(result),
        _risk_component_coverage(result),
        _risk_score_validity(result),
        _risk_score_purity(result),
        _risk_confidence_validity(result),
        _risk_news_dimension_active(result),
        _risk_documentary_dimension_active(result),
        _risk_evidence_coverage(result),
        _risk_explainability(result),
        _risk_confidence_explained(result),
        _risk_controlled_errors(result),
        _risk_slm_summary(result),
    ]

    return _build_report(result.ticker, metrics)


# ---------------------------------------------------------------------------
# Evaluation du RAGAgent
# ---------------------------------------------------------------------------
#
# Le RAGAgent est evalue sur la qualite d'une requete : corpus indexe, pertinence
# de la recherche, presence et ancrage (citations) de la reponse, tracabilite
# des passages vers les depots SEC officiels.

RAG_PASSAGES_TARGET = 4
RAG_RELEVANCE_MIN = 0.35  # score cosinus minimal pour un passage pertinent
RAG_CITATION_RE = re.compile(r"\[\d+\]")
RAGAS_PASS_MIN = 0.5

RAG_STOPWORDS = {
    "the",
    "and",
    "are",
    "what",
    "which",
    "with",
    "from",
    "that",
    "this",
    "pour",
    "les",
    "des",
    "dans",
    "sont",
    "quels",
    "quelles",
    "principaux",
    "principales",
    "main",
    "company",
    "entreprise",
    "principal",
    "principale",
}

RAG_KEYWORD_ALIASES = {
    "activite": "business",
    "activites": "business",
    "business": "business",
    "segment": "segment",
    "segments": "segment",
    "risk": "risk",
    "risque": "risk",
    "risques": "risk",
    "factor": "factor",
    "factors": "factor",
    "facteur": "factor",
    "facteurs": "factor",
    "revenue": "revenue",
    "revenues": "revenue",
    "chiffre": "revenue",
    "affaires": "revenue",
    "sales": "sales",
    "ventes": "sales",
    "product": "product",
    "products": "product",
    "produit": "product",
    "produits": "product",
    "service": "service",
    "services": "service",
    "competition": "competition",
    "concurrence": "competition",
    "competitive": "competition",
    "regulatory": "regulation",
    "reglementaire": "regulation",
    "reglementaires": "regulation",
}


def _rag_agent_availability(result: RagResult) -> MetricResult:
    ok = result.status != "failed"
    return MetricResult(
        name="agent_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message="Agent operationnel, requete exploitable." if ok else "Requete en echec (status=failed).",
    )


def _rag_status_validity(result: RagResult) -> MetricResult:
    has_passages = bool(result.passages)
    coherent = (result.status == "failed") != has_passages
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
        message=f"Statut '{result.status}' {'coherent' if coherent else 'incoherent'} avec les passages.",
    )


def _rag_corpus_indexed(result: RagResult) -> MetricResult:
    ok = result.indexed_chunks > 0
    return MetricResult(
        name="corpus_indexed",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(
            f"{result.indexed_chunks} passage(s) indexe(s) pour ce ticker."
            if ok
            else "Aucun document indexe (lancer l'ingestion)."
        ),
    )


def _rag_passages_retrieved(result: RagResult) -> MetricResult:
    count = len(result.passages)
    return MetricResult(
        name="passages_retrieved",
        score=_clamp01(count / RAG_PASSAGES_TARGET),
        passed=count >= 1,
        message=f"{count} passage(s) recupere(s) (cible {RAG_PASSAGES_TARGET}).",
    )


def _rag_retrieval_relevance(result: RagResult) -> MetricResult:
    if not result.passages:
        return MetricResult(name="retrieval_relevance", score=0.0, passed=False, message="Aucun passage a evaluer.")
    top = max(passage.score for passage in result.passages)
    return MetricResult(
        name="retrieval_relevance",
        score=_clamp01(top),
        passed=top >= RAG_RELEVANCE_MIN,
        message=f"Meilleur score de pertinence : {top:.3f} (seuil {RAG_RELEVANCE_MIN}).",
    )


def _ragas_faithfulness(result: RagResult) -> MetricResult:
    """Proxy RAGAS Faithfulness : les phrases de reponse sont-elles citees ?

    La version exacte RAGAS utilise un LLM-as-judge pour verifier chaque claim.
    Ici, on applique une garde automatique simple : une phrase informative doit
    porter au moins une citation valide [n] pointant vers un passage recupere.
    """
    answer = result.answer or ""
    if not answer.strip():
        return MetricResult(name="faithfulness", score=0.0, passed=False, message="Aucune reponse a verifier.")

    valid_ids = {str(index) for index in range(1, len(result.passages) + 1)}
    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", answer)
        if len(sentence.strip()) >= 35
    ]
    if not sentences:
        return MetricResult(name="faithfulness", score=0.0, passed=False, message="Aucune phrase informative detectee.")

    supported = 0
    for sentence in sentences:
        citations = RAG_CITATION_RE.findall(sentence)
        cited_ids = {citation.strip("[]") for citation in citations}
        if cited_ids & valid_ids:
            supported += 1

    score = _clamp01(supported / len(sentences))
    return MetricResult(
        name="faithfulness",
        score=score,
        passed=score >= 0.75,
        message=f"{supported}/{len(sentences)} phrase(s) informative(s) cite(nt) un passage recupere.",
    )


def _ragas_answer_relevance(result: RagResult) -> MetricResult:
    """Proxy RAGAS Answer Relevance : recouvrement lexical question/reponse."""
    if not result.answer:
        return MetricResult(name="answer_relevance", score=0.0, passed=False, message="Aucune reponse a comparer.")

    question_terms = _rag_keywords(result.question)
    answer_terms = _rag_keywords(result.answer)
    if not question_terms:
        return MetricResult(
            name="answer_relevance",
            score=1.0 if result.answer.strip() else 0.0,
            passed=bool(result.answer.strip()),
            message="Question trop courte pour extraire des mots-cles ; presence de reponse utilisee.",
        )

    overlap = question_terms & answer_terms
    score = _clamp01(len(overlap) / len(question_terms))
    return MetricResult(
        name="answer_relevance",
        score=score,
        passed=score >= RAGAS_PASS_MIN,
        message=f"{len(overlap)}/{len(question_terms)} mot(s)-cle(s) de la question retrouves dans la reponse.",
    )


def _ragas_context_recall(result: RagResult) -> MetricResult:
    """Proxy RAGAS Context Recall sans reference gold.

    Le vrai Context Recall compare les contextes a une reponse de reference.
    Pour le MVP, on mesure si les contextes couvrent les mots-cles de la question
    et si le retriever renvoie assez de passages exploitables.
    """
    if not result.passages:
        return MetricResult(name="context_recall", score=0.0, passed=False, message="Aucun contexte recupere.")

    question_terms = _rag_keywords(result.question)
    context_terms = _rag_keywords(" ".join(passage.text for passage in result.passages))
    keyword_score = 1.0 if not question_terms else len(question_terms & context_terms) / len(question_terms)
    volume_score = _clamp01(len(result.passages) / RAG_PASSAGES_TARGET)
    score = _clamp01(0.7 * keyword_score + 0.3 * volume_score)
    return MetricResult(
        name="context_recall",
        score=score,
        passed=score >= RAGAS_PASS_MIN,
        message=(
            f"Couverture contexte : {len(question_terms & context_terms)}/{len(question_terms)} mot(s)-cle(s), "
            f"{len(result.passages)} passage(s) recupere(s)."
        ),
    )


def _ragas_context_precision(result: RagResult) -> MetricResult:
    """RAGAS Context Precision approximee par precision@k sur les scores Qdrant."""
    if not result.passages:
        return MetricResult(name="context_precision", score=0.0, passed=False, message="Aucun contexte a evaluer.")

    relevance_flags = [1 if passage.score >= RAG_RELEVANCE_MIN else 0 for passage in result.passages]
    relevant_count = sum(relevance_flags)
    if relevant_count == 0:
        return MetricResult(
            name="context_precision",
            score=0.0,
            passed=False,
            message=f"0/{len(result.passages)} passage(s) au-dessus du seuil {RAG_RELEVANCE_MIN}.",
        )

    precision_sum = 0.0
    relevant_seen = 0
    for index, is_relevant in enumerate(relevance_flags, start=1):
        if is_relevant:
            relevant_seen += 1
            precision_sum += relevant_seen / index

    score = _clamp01(precision_sum / relevant_count)
    return MetricResult(
        name="context_precision",
        score=score,
        passed=score >= RAGAS_PASS_MIN,
        message=f"{relevant_count}/{len(result.passages)} passage(s) pertinent(s), precision@k moyenne={score:.2f}.",
    )


def _rag_answer_present(result: RagResult) -> MetricResult:
    ok = bool(result.answer and result.answer.strip())
    return MetricResult(
        name="answer_present",
        score=1.0 if ok else 0.0,
        passed=ok,
        message="Reponse synthetisee presente." if ok else "Aucune reponse SLM (passages bruts seulement).",
    )


def _rag_answer_grounded(result: RagResult) -> MetricResult:
    answer = result.answer or ""
    ok = bool(RAG_CITATION_RE.search(answer))
    if not answer.strip():
        return MetricResult(name="answer_grounded", score=0.0, passed=False, message="Pas de reponse a ancrer.")
    return MetricResult(
        name="answer_grounded",
        score=1.0 if ok else 0.3,
        passed=ok,
        message="Reponse ancree (citations [n] presentes)." if ok else "Reponse sans citation de source.",
    )


def _rag_source_traceability(result: RagResult) -> MetricResult:
    total = len(result.passages)
    if total == 0:
        return MetricResult(name="source_traceability", score=0.0, passed=False, message="Aucun passage a tracer.")
    traceable = sum(1 for passage in result.passages if passage.form and passage.url)
    ratio = traceable / total
    return MetricResult(
        name="source_traceability",
        score=_clamp01(ratio),
        passed=ratio >= 0.9,
        message=f"{traceable}/{total} passage(s) traçable(s) vers un depot SEC (form + url).",
    )


def _rag_controlled_errors(result: RagResult) -> MetricResult:
    count = len(result.errors)
    warn_count = len(result.warnings)
    score = _clamp01(1.0 - count / ERROR_SCALE)
    message = (
        f"Aucune erreur fatale ({warn_count} avertissement(s))."
        if count == 0
        else f"{count} erreur(s) fatale(s), {warn_count} avertissement(s)."
    )
    return MetricResult(name="controlled_errors", score=score, passed=count <= ERROR_MAX_PASS, message=message)


def _rag_keywords(text: str) -> set[str]:
    tokens = re.findall(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,}", text.lower())
    keywords = set()
    for token in tokens:
        raw = token.strip("-'")
        if raw in RAG_STOPWORDS:
            continue
        normalized = _normalize_rag_token(raw)
        if normalized and len(normalized) >= 3:
            keywords.add(normalized)
    return keywords


def _normalize_rag_token(token: str) -> str:
    normalized = token.strip("-'").replace("é", "e").replace("è", "e").replace("ê", "e")
    normalized = normalized.replace("à", "a").replace("â", "a").replace("î", "i").replace("ï", "i")
    normalized = normalized.replace("ô", "o").replace("ù", "u").replace("û", "u").replace("ç", "c")
    if normalized.endswith("s") and len(normalized) > 4:
        singular = normalized[:-1]
        if singular in RAG_KEYWORD_ALIASES:
            return RAG_KEYWORD_ALIASES[singular]
    return RAG_KEYWORD_ALIASES.get(normalized, normalized)


def _rag_keywords(text: str) -> set[str]:
    """Version normalisee pour les metriques RAGAS proxy."""
    normalized_text = text.lower()
    normalized_text = re.sub(r"\b[ldjtmcs]'", " ", normalized_text)
    normalized_text = re.sub(r"\bri\s+sk\b", "risk", normalized_text)
    tokens = re.findall(r"[a-z][a-z'-]{2,}", normalized_text)
    keywords = set()
    for token in tokens:
        raw = token.strip("-'")
        if raw in RAG_STOPWORDS:
            continue
        normalized = _normalize_rag_token(raw)
        if normalized and len(normalized) >= 3:
            keywords.add(normalized)
    return keywords


def evaluate_rag(result: RagResult) -> EvaluationReport:
    """Evalue un resultat de requete RAGAgent et renvoie un rapport complet."""
    metrics = [
        _rag_agent_availability(result),
        _rag_status_validity(result),
        _rag_corpus_indexed(result),
        _ragas_faithfulness(result),
        _ragas_answer_relevance(result),
        _ragas_context_recall(result),
        _ragas_context_precision(result),
        _rag_passages_retrieved(result),
        _rag_retrieval_relevance(result),
        _rag_answer_present(result),
        _rag_answer_grounded(result),
        _rag_source_traceability(result),
        _rag_controlled_errors(result),
    ]

    return _build_report(result.ticker, metrics)


# ---------------------------------------------------------------------------
# Evaluation du SynthesisAgent
# ---------------------------------------------------------------------------
#
# Le SynthesisAgent est evalue sur la qualite de son agregation : couverture des
# agents amont, purete du score (recalculable depuis scores + poids publies),
# coherence de la recommandation avec ses garde-fous, et explicabilite.

SYNTHESIS_AGENT_COUNT = 5  # market_data, technical, news, rag, risk
SYNTHESIS_COVERAGE_MIN_PASS = 4
SYNTHESIS_WEIGHT_TOLERANCE = 0.01
SYNTHESIS_SCORE_TOLERANCE = 1  # arrondi : ecart max tolere entre score publie et recalcul
SYNTHESIS_CONFIDENCE_GATE = 40  # sous ce seuil, seule "donnees_insuffisantes" est valide
SYNTHESIS_FAVORABLE_MIN_SCORE = 75
SYNTHESIS_FAVORABLE_MIN_CONFIDENCE = 55
SYNTHESIS_SURVEILLER_MIN_SCORE = 60
SYNTHESIS_PRUDENCE_MIN_SCORE = 45


def _synthesis_agent_availability(result: SynthesisResult) -> MetricResult:
    ok = result.status != "failed"
    return MetricResult(
        name="agent_availability",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(
            "Agent operationnel, synthese exploitable."
            if ok
            else "Synthese en echec (status=failed)."
        ),
    )


def _synthesis_status_validity(result: SynthesisResult) -> MetricResult:
    statuses = list(result.agent_status.model_dump().values())
    all_failed = all(status == "failed" for status in statuses)
    all_success = all(status == "success" for status in statuses)
    if all_failed:
        expected = "failed"
    elif all_success:
        expected = "success"
    else:
        expected = "partial"
    coherent = result.status == expected
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
        message=(
            f"Statut '{result.status}' {'coherent' if coherent else 'incoherent'}"
            f" avec les statuts des agents (attendu '{expected}')."
        ),
    )


def _synthesis_component_coverage(result: SynthesisResult) -> MetricResult:
    statuses = result.agent_status.model_dump()
    available = [name for name, status in statuses.items() if status != "failed"]
    count = len(available)
    return MetricResult(
        name="component_coverage",
        score=_clamp01(count / SYNTHESIS_AGENT_COUNT),
        passed=count >= SYNTHESIS_COVERAGE_MIN_PASS,
        message=f"{count}/{SYNTHESIS_AGENT_COUNT} agent(s) amont exploitable(s) : {', '.join(available) or 'aucun'}.",
    )


def _synthesis_weights_validity(result: SynthesisResult) -> MetricResult:
    weights = result.weights
    total = sum(weights.values()) if weights else 0.0
    expected_keys = set(result.scores.model_dump().keys())
    keys_ok = set(weights.keys()) == expected_keys
    total_ok = abs(total - 1.0) <= SYNTHESIS_WEIGHT_TOLERANCE
    ok = keys_ok and total_ok
    return MetricResult(
        name="weights_validity",
        score=1.0 if ok else 0.5 if keys_ok or total_ok else 0.0,
        passed=ok,
        message=(
            f"Poids publies (somme {total:.2f}) alignes sur les dimensions de score."
            if ok
            else f"Poids incomplets ou somme {total:.2f} != 1.0 (dimensions {'ok' if keys_ok else 'manquantes'})."
        ),
    )


def _synthesis_score_purity(result: SynthesisResult) -> MetricResult:
    """Le score global doit etre recalculable depuis scores + poids publies."""
    scores = result.scores.model_dump()
    if not result.weights:
        return MetricResult(
            name="score_purity",
            score=0.0,
            passed=False,
            message="Aucun poids publie : le score global n'est pas verifiable.",
        )
    recomputed = round(sum(scores.get(name, 0) * weight for name, weight in result.weights.items()))
    delta = abs(recomputed - result.global_score)
    ok = delta <= SYNTHESIS_SCORE_TOLERANCE
    return MetricResult(
        name="score_purity",
        score=1.0 if ok else _clamp01(1.0 - delta / 20),
        passed=ok,
        message=(
            f"Score global {result.global_score}/100 conforme au recalcul pondere ({recomputed})."
            if ok
            else f"Score global {result.global_score}/100 != recalcul pondere ({recomputed})."
        ),
    )


def _synthesis_recommendation_coherence(result: SynthesisResult) -> MetricResult:
    """Verifie les invariants publics de la recommandation (garde-fous compris)."""
    score = result.global_score
    confidence = result.confidence_score
    recommendation = result.recommendation

    violations: list[str] = []
    if confidence < SYNTHESIS_CONFIDENCE_GATE and recommendation != "donnees_insuffisantes":
        violations.append(f"confiance {confidence} < {SYNTHESIS_CONFIDENCE_GATE} sans 'donnees_insuffisantes'")
    if recommendation == "favorable" and (
        score < SYNTHESIS_FAVORABLE_MIN_SCORE or confidence < SYNTHESIS_FAVORABLE_MIN_CONFIDENCE
    ):
        violations.append(f"'favorable' exige score >= {SYNTHESIS_FAVORABLE_MIN_SCORE} et confiance >= {SYNTHESIS_FAVORABLE_MIN_CONFIDENCE}")
    if recommendation == "a_surveiller" and score < SYNTHESIS_SURVEILLER_MIN_SCORE:
        violations.append(f"'a_surveiller' exige score >= {SYNTHESIS_SURVEILLER_MIN_SCORE}")
    if recommendation == "prudence" and score < SYNTHESIS_PRUDENCE_MIN_SCORE:
        violations.append(f"'prudence' exige score >= {SYNTHESIS_PRUDENCE_MIN_SCORE}")
    if recommendation == "defavorable" and score >= SYNTHESIS_PRUDENCE_MIN_SCORE:
        violations.append(f"'defavorable' exige score < {SYNTHESIS_PRUDENCE_MIN_SCORE}")

    ok = not violations
    return MetricResult(
        name="recommendation_coherence",
        score=1.0 if ok else 0.0,
        passed=ok,
        message=(
            f"Recommandation '{recommendation}' coherente avec score {score} et confiance {confidence}."
            if ok
            else f"Incoherence(s) : {'; '.join(violations)}."
        ),
    )


def _synthesis_confidence_validity(result: SynthesisResult) -> MetricResult:
    score = result.confidence_score
    if score >= 80:
        expected = "high"
    elif score >= 55:
        expected = "medium"
    else:
        expected = "low"
    coherent = result.confidence_level == expected
    return MetricResult(
        name="confidence_validity",
        score=1.0 if coherent else 0.3,
        passed=coherent,
        message=(
            f"Confiance {score}/100 coherente avec le niveau '{result.confidence_level}'."
            if coherent
            else f"Niveau '{result.confidence_level}' incoherent avec la confiance {score}/100 (attendu '{expected}')."
        ),
    )


SYNTHESIS_SUMMARY_DETAIL_MIN = 250  # une note argumentative, pas une phrase generique


def _synthesis_explainability(result: SynthesisResult) -> MetricResult:
    summary = result.summary.strip()
    has_summary = bool(summary)
    # Le texte est desormais qualitatif (sans chiffres) : on evalue son niveau
    # de detail, les scores restant exposes separement pour l'UI.
    detailed = len(summary) >= SYNTHESIS_SUMMARY_DETAIL_MIN
    signal_count = len(result.strengths) + len(result.weaknesses)
    score = 0.0
    if has_summary:
        score += 0.5
    if detailed:
        score += 0.2
    score += _clamp01(signal_count / 3) * 0.3
    passed = has_summary and signal_count >= 1
    return MetricResult(
        name="explainability",
        score=_clamp01(score),
        passed=passed,
        message=(
            f"Note {'argumentee' if detailed else 'courte'}, {len(result.strengths)} force(s)"
            f" et {len(result.weaknesses)} faiblesse(s) explicitees."
            if passed
            else "Synthese insuffisamment expliquee (resume ou signaux manquants)."
        ),
    )


def _synthesis_key_risks_purity(result: SynthesisResult) -> MetricResult:
    """Les risques cles doivent rester materiels (pas de data_quality) et limites."""
    data_quality = [risk.title for risk in result.key_risks if risk.category == "data_quality"]
    within_limit = len(result.key_risks) <= 5
    ok = not data_quality and within_limit
    return MetricResult(
        name="key_risks_purity",
        score=1.0 if ok else 0.3,
        passed=ok,
        message=(
            f"{len(result.key_risks)} risque(s) cle(s), tous materiels."
            if ok
            else f"Risques cles pollues (data_quality: {len(data_quality)}) ou trop nombreux ({len(result.key_risks)})."
        ),
    )


def _synthesis_source_traceability(result: SynthesisResult) -> MetricResult:
    count = len(result.sources)
    label = ", ".join(result.sources) if result.sources else "aucune"
    return MetricResult(
        name="source_traceability",
        score=_clamp01(count / SOURCE_TARGET),
        passed=count >= 1,
        message=f"{count} source(s) tracee(s) : {label}.",
    )


def _synthesis_controlled_errors(result: SynthesisResult) -> MetricResult:
    count = len(result.errors)
    warn_count = len(result.warnings)
    score = _clamp01(1.0 - count / ERROR_SCALE)
    if count == 0:
        message = f"Aucune erreur fatale ({warn_count} avertissement(s) non bloquant(s))."
    else:
        message = f"{count} erreur(s) remontee(s) des agents, {warn_count} avertissement(s)."
    return MetricResult(
        name="controlled_errors",
        score=score,
        passed=count <= ERROR_MAX_PASS,
        message=message,
    )


def _synthesis_slm_summary(result: SynthesisResult) -> MetricResult:
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


def evaluate_synthesis(result: SynthesisResult) -> EvaluationReport:
    """Evalue un resultat de SynthesisAgent et renvoie un rapport complet."""
    metrics = [
        _synthesis_agent_availability(result),
        _synthesis_status_validity(result),
        _synthesis_component_coverage(result),
        _synthesis_weights_validity(result),
        _synthesis_score_purity(result),
        _synthesis_recommendation_coherence(result),
        _synthesis_confidence_validity(result),
        _synthesis_explainability(result),
        _synthesis_key_risks_purity(result),
        _synthesis_source_traceability(result),
        _synthesis_controlled_errors(result),
        _synthesis_slm_summary(result),
    ]

    return _build_report(result.ticker, metrics)

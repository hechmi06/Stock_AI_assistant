"""Composition expliquee d'un portefeuille a partir d'un profil investisseur."""

from __future__ import annotations

import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from app.portfolio_orchestrator import PortfolioAnalysisOrchestrator

from .market_data_agent import MarketDataAgent
from .nebius_client import NebiusClient
from .schemas import (
    MarketDataResult,
    PortfolioAnalysisRequest,
    PortfolioHoldingInput,
    PortfolioRecommendationRequest,
    PortfolioRecommendationResult,
    RecommendationCandidateScore,
    RecommendedAllocation,
    SlmSummary,
    TechnicalResult,
    UniverseInstrument,
)
from .technical_agent import TechnicalAgent
from .universe_provider import UniverseProvider


# Seuils de screening nommes (evite les nombres magiques disperses dans le code).
MIN_SCREENING_SCORE = 42          # score total minimal pour ne pas etre ecarte
CONSERVATIVE_MIN_STABILITY = 35   # stabilite minimale exigee d'un profil prudent
MIN_HISTORY_POINTS = 20           # points d'historique minimaux pour comparer le risque
VOLATILITY_STABILITY_FACTOR = 13  # conversion volatilite -> penalite de stabilite
MIN_PORTFOLIO_POSITIONS = 3       # taille minimale d'un portefeuille exploitable
# Plafond de titres reellement collectes/analyses par requete. Borne le temps de
# reponse (chaque titre = une collecte marche multi-sources) tout en gardant un
# univers large : au-dela, on echantillonne de facon equilibree par secteur.
MAX_SCREENED_CANDIDATES = 30
# Parallelisme de la collecte marche (titres analyses simultanement).
SCREENING_WORKERS = 8

_DIGIT_RE = re.compile(r"\d")


class PortfolioRecommendationAgent:
    """Selectionne, pondere puis fait valider une combinaison multi-agents.

    Le screening et l'allocation sont deterministes. Le SLM dedie ne peut
    modifier ni la liste des titres, ni les poids, ni le verdict calcule.
    """

    def __init__(
        self,
        market_data_agent: MarketDataAgent,
        technical_agent: TechnicalAgent,
        portfolio_orchestrator: PortfolioAnalysisOrchestrator,
        slm_client: NebiusClient | None = None,
        universe_provider: UniverseProvider | None = None,
    ) -> None:
        self.market_data_agent = market_data_agent
        self.technical_agent = technical_agent
        self.portfolio_orchestrator = portfolio_orchestrator
        self.slm_client = slm_client or NebiusClient.for_agent("portfolio_recommendation")
        self.universe_provider = universe_provider or UniverseProvider()

    def run(
        self,
        request: PortfolioRecommendationRequest,
        use_cache: bool = True,
        with_slm: bool = True,
    ) -> PortfolioRecommendationResult:
        excluded = {ticker.strip().upper() for ticker in request.excluded_tickers}
        instruments = self.universe_provider.for_profile(request.risk_profile, excluded)
        instruments = self._cap_universe(instruments, MAX_SCREENED_CANDIDATES)
        universe = [instrument.ticker for instrument in instruments]
        if not universe:
            return PortfolioRecommendationResult(
                status="failed",
                generated_at=datetime.now(timezone.utc),
                profile=request,
                universe=universe,
                errors=[
                    "Aucune action eligible a ce profil : univers de screening indisponible."
                ],
            )
        market_results = self._collect_market_data(universe, use_cache)
        candidates = [
            self._evaluate_candidate(instrument, market_results.get(instrument.ticker), request)
            for instrument in instruments
        ]
        self._assign_potential_labels(candidates)
        selected = self._select_candidates(candidates, request.max_positions)
        allocations, cash_amount, cash_weight = self._allocate(
            selected, request
        )

        if len(allocations) < MIN_PORTFOLIO_POSITIONS:
            return PortfolioRecommendationResult(
                status="failed",
                generated_at=datetime.now(timezone.utc),
                profile=request,
                universe=universe,
                candidates=candidates,
                allocations=allocations,
                cash_amount=cash_amount,
                cash_weight=cash_weight,
                errors=[
                    "Moins de trois entreprises disposent de donnees suffisantes pour composer un portefeuille."
                ],
            )

        portfolio_request = PortfolioAnalysisRequest(
            holdings=[
                PortfolioHoldingInput(
                    ticker=item.ticker,
                    quantity=item.quantity,
                    average_cost=item.reference_price,
                )
                for item in allocations
            ],
            cash=cash_amount,
            base_currency=request.base_currency,
            benchmark_ticker=request.benchmark_ticker,
            risk_free_rate_percent=request.risk_free_rate_percent,
        )
        complete_analysis = self.portfolio_orchestrator.run(
            portfolio_request,
            use_cache=use_cache,
            with_portfolio_slm=False,
        )
        strengths = self._strengths(allocations, complete_analysis)
        risks = self._risks(allocations, complete_analysis)
        summary = self._summary(request, allocations, complete_analysis)
        status = (
            "success"
            if complete_analysis.status == "success"
            else "partial"
            if complete_analysis.status == "partial"
            else "failed"
        )
        # Les trois avertissements structurants restent en tete pour survivre a la
        # troncature d'affichage (le front n'affiche que les premiers).
        fixed_warnings = [
            f"Univers d'actions americaines cotees en USD, screene dynamiquement "
            f"({len(universe)} titres eligibles analyses pour ce profil).",
            "Allocation simulee hors fiscalite, frais, dividendes et conversion de devises.",
            "Cette proposition analytique ne constitue pas un conseil financier personnalise.",
        ]
        warnings = list(
            dict.fromkeys([*fixed_warnings, *complete_analysis.synthesis.warnings])
        )
        result = PortfolioRecommendationResult(
            status=status,
            generated_at=datetime.now(timezone.utc),
            profile=request,
            universe=universe,
            candidates=sorted(candidates, key=lambda item: item.total_score, reverse=True),
            allocations=allocations,
            cash_amount=cash_amount,
            cash_weight=cash_weight,
            summary=summary,
            selection_method=[
                "Estimation du potentiel de rendement : valorisation, croissance, qualite et momentum.",
                "Niveau de potentiel classe relativement a l'univers analyse.",
                "Selection diversifiee avec au plus deux entreprises par secteur.",
                "Allocation contrainte par ligne, par secteur et par reserve de liquidites.",
                "Validation finale par les agents News, RAG, Risk et Synthesis de chaque position.",
            ],
            strengths=strengths,
            risks=risks,
            portfolio_analysis=complete_analysis,
            warnings=warnings,
        )
        if with_slm and status != "failed":
            self._add_slm_summary(result)
        return result

    @staticmethod
    def _cap_universe(
        instruments: list[UniverseInstrument],
        max_count: int,
    ) -> list[UniverseInstrument]:
        """Borne l'univers a analyser en preservant la diversite sectorielle.

        Sous le plafond, on garde tout. Au-dela, on prend a tour de role un titre
        par secteur (round-robin) pour ne pas sur-representer les secteurs listes
        en premier dans la config.
        """
        if len(instruments) <= max_count:
            return instruments
        buckets: dict[str, list[UniverseInstrument]] = defaultdict(list)
        for instrument in instruments:
            buckets[instrument.sector].append(instrument)
        capped: list[UniverseInstrument] = []
        while len(capped) < max_count:
            progressed = False
            for bucket in buckets.values():
                if bucket:
                    capped.append(bucket.pop(0))
                    progressed = True
                    if len(capped) >= max_count:
                        break
            if not progressed:
                break
        return capped

    def _collect_market_data(
        self,
        universe: list[str],
        use_cache: bool,
    ) -> dict[str, MarketDataResult]:
        results: dict[str, MarketDataResult] = {}
        with ThreadPoolExecutor(max_workers=min(SCREENING_WORKERS, len(universe))) as executor:
            future_by_ticker = {
                executor.submit(
                    self.market_data_agent.run,
                    ticker,
                    "6mo",
                    False,
                    use_cache,
                ): ticker
                for ticker in universe
            }
            for future in as_completed(future_by_ticker):
                ticker = future_by_ticker[future]
                try:
                    results[ticker] = future.result()
                except Exception as error:
                    results[ticker] = MarketDataResult(
                        ticker=ticker,
                        status="failed",
                        errors=[f"Screening impossible: {error}"],
                    )
        return results

    def _evaluate_candidate(
        self,
        instrument: UniverseInstrument,
        market: MarketDataResult | None,
        request: PortfolioRecommendationRequest,
    ) -> RecommendationCandidateScore:
        ticker = instrument.ticker
        if market is None or market.price is None or market.status == "failed":
            profile_sector = market.company_profile.sector if market else None
            return RecommendationCandidateScore(
                ticker=ticker,
                name=market.company_profile.name if market else instrument.name,
                sector=profile_sector or instrument.sector or "Unknown",
                status="failed",
                rejection_reason="Prix ou donnees de marche indisponibles.",
            )
        sector = market.company_profile.sector or instrument.sector or "Unknown"
        technical = self.technical_agent.analyze(market, with_slm=False)
        fundamental = self._fundamental_score(market)
        technical_score = technical.technical_score or 50
        volatility = technical.volatility
        stability = self._clamp(round(100 - (volatility or 4) * VOLATILITY_STABILITY_FACTOR))
        momentum = self._momentum_score(market, technical)
        data_quality = 100 if market.status == "success" else 70
        value = self._value_score(market)
        growth = self._growth_score(market)
        six_month_return = self._six_month_return(market)
        # Potentiel de rendement estime : valorisation + croissance + qualite + momentum,
        # pondere selon l'objectif. C'est ce score, tourne vers l'avenir, qui pilote la
        # selection (et non plus une note de qualite statique).
        weights = self._potential_weights(request)
        total = self._clamp(
            round(
                value * weights["value"]
                + growth * weights["growth"]
                + fundamental * weights["quality"]
                + momentum * weights["momentum"]
            )
        )
        reasons = self._potential_reasons(market, six_month_return)
        rejection_reason = None
        if len(market.historical_prices) < MIN_HISTORY_POINTS:
            rejection_reason = "Historique insuffisant pour estimer le potentiel."
        elif request.risk_profile == "conservative" and stability < CONSERVATIVE_MIN_STABILITY:
            rejection_reason = "Volatilite trop elevee pour un profil prudent."
        elif total < MIN_SCREENING_SCORE:
            rejection_reason = "Potentiel de rendement estime insuffisant."
        return RecommendationCandidateScore(
            ticker=ticker,
            name=market.company_profile.name,
            sector=sector,
            status=market.status,
            total_score=total,
            fundamental_score=fundamental,
            technical_score=technical_score,
            stability_score=stability,
            momentum_score=momentum,
            data_quality_score=data_quality,
            value_score=value,
            growth_score=growth,
            current_price=market.price,
            volatility=volatility,
            reasons=reasons,
            rejection_reason=rejection_reason,
        )

    @staticmethod
    def _potential_weights(request: PortfolioRecommendationRequest) -> dict[str, float]:
        """Ponderation du potentiel selon l'objectif (valorisation/croissance/qualite/momentum)."""
        base = {
            "preservation": {"value": 0.30, "growth": 0.15, "quality": 0.40, "momentum": 0.15},
            "balanced": {"value": 0.30, "growth": 0.30, "quality": 0.20, "momentum": 0.20},
            "growth": {"value": 0.25, "growth": 0.40, "quality": 0.15, "momentum": 0.20},
        }
        return base[request.objective]

    def _value_score(self, market: MarketDataResult) -> int:
        """Attrait de la valorisation : plus l'action est decotee, plus le potentiel est eleve."""
        ratios = {key.lower(): value for key, value in market.financial_ratios.items()}
        score = 50
        peg = ratios.get("peg_ratio")
        if isinstance(peg, (int, float)) and peg > 0:
            score += 25 if peg < 1 else 14 if peg < 1.5 else 2 if peg < 2.5 else -12 if peg < 4 else -22
        forward_pe = ratios.get("forward_pe")
        trailing_pe = ratios.get("trailing_pe")
        if isinstance(forward_pe, (int, float)) and forward_pe > 0:
            score += 8 if forward_pe < 15 else -5 if forward_pe > 28 else 0
            if forward_pe > 40:
                score -= 7
            if isinstance(trailing_pe, (int, float)) and trailing_pe > 0:
                # Forward PE < trailing PE => benefices attendus en hausse (signal positif).
                score += 8 if forward_pe < trailing_pe * 0.95 else -6 if forward_pe > trailing_pe * 1.1 else 0
        price_to_book = ratios.get("price_to_book")
        if isinstance(price_to_book, (int, float)) and price_to_book > 0:
            score += 5 if price_to_book < 3 else -8 if price_to_book > 12 else 0
        return self._clamp(score)

    def _growth_score(self, market: MarketDataResult) -> int:
        """Croissance des benefices et du chiffre d'affaires : moteur du rendement futur."""
        ratios = {key.lower(): value for key, value in market.financial_ratios.items()}
        score = 50
        earnings_growth = self._percent(ratios.get("earnings_growth"))
        if earnings_growth is not None:
            score += (
                26 if earnings_growth >= 25
                else 16 if earnings_growth >= 15
                else 8 if earnings_growth >= 5
                else -26 if earnings_growth < -20
                else -14 if earnings_growth < 0
                else 0
            )
        revenue_growth = self._percent(ratios.get("revenue_growth"))
        if revenue_growth is not None:
            score += 12 if revenue_growth >= 15 else 6 if revenue_growth >= 7 else -10 if revenue_growth < 0 else 0
        return self._clamp(score)

    @staticmethod
    def _six_month_return(market: MarketDataResult) -> float | None:
        """Rendement sur la periode d'historique collectee (~6 mois), en pourcentage."""
        if not market.historical_prices or market.price is None:
            return None
        first = market.historical_prices[0].close
        if not first or first <= 0:
            return None
        return (market.price / first - 1) * 100

    def _potential_reasons(
        self,
        market: MarketDataResult,
        six_month_return: float | None,
    ) -> list[str]:
        """These chiffree concrete (vrais nombres) plutot que des adjectifs generiques."""
        ratios = {key.lower(): value for key, value in market.financial_ratios.items()}
        reasons: list[str] = []
        peg = ratios.get("peg_ratio")
        if isinstance(peg, (int, float)) and peg > 0:
            if peg < 1.2:
                reasons.append(f"PEG {peg:.1f} : valorisation attractive vs sa croissance")
            elif peg > 2.5:
                reasons.append(f"PEG {peg:.1f} : valorisation tendue")
        earnings_growth = self._percent(ratios.get("earnings_growth"))
        revenue_growth = self._percent(ratios.get("revenue_growth"))
        if earnings_growth is not None and abs(earnings_growth) >= 3:
            reasons.append(f"Benefices {earnings_growth:+.0f}%/an")
        elif revenue_growth is not None and revenue_growth >= 5:
            reasons.append(f"Chiffre d'affaires {revenue_growth:+.0f}%")
        margin = self._percent(ratios.get("profit_margin"))
        roe = self._percent(ratios.get("return_on_equity"))
        if margin is not None and roe is not None:
            reasons.append(f"Marge {margin:.0f}%, ROE {roe:.0f}%")
        elif margin is not None:
            reasons.append(f"Marge nette {margin:.0f}%")
        if six_month_return is not None:
            reasons.append(f"{six_month_return:+.0f}% sur ~6 mois")
        if not reasons:
            reasons.append("Donnees fondamentales limitees : estimation prudente")
        return reasons[:4]

    @staticmethod
    def _assign_potential_labels(
        candidates: list[RecommendationCandidateScore],
    ) -> None:
        """Attribue un niveau de potentiel RELATIF a l'univers, pour differencier les titres."""
        scored = [item for item in candidates if item.status != "failed"]
        if not scored:
            return
        ordered = sorted(scored, key=lambda item: item.total_score)
        count = len(ordered)
        for index, candidate in enumerate(ordered):
            rank = (index + 0.5) / count
            candidate.potential_label = (
                "Tres eleve" if rank >= 0.80
                else "Eleve" if rank >= 0.50
                else "Modere" if rank >= 0.20
                else "Faible"
            )

    def _select_candidates(
        self,
        candidates: list[RecommendationCandidateScore],
        max_positions: int,
    ) -> list[RecommendationCandidateScore]:
        eligible = sorted(
            [item for item in candidates if item.rejection_reason is None],
            key=lambda item: item.total_score,
            reverse=True,
        )
        selected: list[RecommendationCandidateScore] = []
        sectors: dict[str, int] = defaultdict(int)
        # Premier passage : une entreprise par secteur pour que les petits
        # portefeuilles ne soient pas concentres des la selection.
        for candidate in eligible:
            sector = candidate.sector.casefold()
            if sectors[sector] >= 1:
                continue
            selected.append(candidate)
            sectors[sector] += 1
            if len(selected) >= max_positions:
                break
        # Deuxieme passage : complete le nombre demande, avec deux lignes au
        # maximum par secteur lorsque l'univers diversifie ne suffit pas.
        if len(selected) < max_positions:
            for candidate in eligible:
                if candidate in selected:
                    continue
                sector = candidate.sector.casefold()
                if sectors[sector] >= 2:
                    continue
                selected.append(candidate)
                sectors[sector] += 1
                if len(selected) >= max_positions:
                    break
        return selected

    def _allocate(
        self,
        selected: list[RecommendationCandidateScore],
        request: PortfolioRecommendationRequest,
    ) -> tuple[list[RecommendedAllocation], float, float]:
        default_cash = {"conservative": 20.0, "moderate": 10.0, "dynamic": 5.0}
        reserve = (
            request.cash_reserve_percent
            if request.cash_reserve_percent is not None
            else default_cash[request.risk_profile]
        )
        investable = 100 - reserve
        if not selected:
            return [], request.budget, 100
        raw = {
            item.ticker: max(1.0, float(item.total_score))
            * (
                item.stability_score / 100
                if request.risk_profile == "conservative"
                else 0.75 + item.stability_score / 400
                if request.risk_profile == "moderate"
                else 1.0
            )
            for item in selected
        }
        total_raw = sum(raw.values())
        weights = {
            item.ticker: investable * raw[item.ticker] / total_raw
            for item in selected
        }
        individual_cap = {"conservative": 28.0, "moderate": 32.0, "dynamic": 35.0}[
            request.risk_profile
        ]
        sector_cap = 40.0 if request.risk_profile != "dynamic" else 45.0
        weights = self._apply_caps(weights, selected, individual_cap, sector_cap, investable)

        allocations: list[RecommendedAllocation] = []
        for candidate in selected:
            if candidate.current_price is None:
                continue
            weight = round(weights.get(candidate.ticker, 0), 2)
            amount = round(request.budget * weight / 100, 2)
            allocations.append(
                RecommendedAllocation(
                    ticker=candidate.ticker,
                    name=candidate.name,
                    sector=candidate.sector,
                    weight=weight,
                    amount=amount,
                    quantity=round(amount / candidate.current_price, 6),
                    reference_price=candidate.current_price,
                    screening_score=candidate.total_score,
                    potential_label=candidate.potential_label,
                    role=self._portfolio_role(candidate.sector),
                    reasons=candidate.reasons,
                )
            )
        allocated_amount = sum(item.amount for item in allocations)
        cash_amount = round(max(0, request.budget - allocated_amount), 2)
        cash_weight = round(cash_amount / request.budget * 100, 2)
        return allocations, cash_amount, cash_weight

    def _apply_caps(
        self,
        initial: dict[str, float],
        selected: list[RecommendationCandidateScore],
        individual_cap: float,
        sector_cap: float,
        investable: float,
    ) -> dict[str, float]:
        sectors = {item.ticker: item.sector.casefold() for item in selected}
        base = dict(initial)
        weights = {ticker: min(weight, individual_cap) for ticker, weight in initial.items()}
        for _ in range(20):
            sector_totals: dict[str, float] = defaultdict(float)
            for ticker, weight in weights.items():
                sector_totals[sectors[ticker]] += weight
            changed = False
            for sector, total in sector_totals.items():
                if total <= sector_cap + 1e-6:
                    continue
                scale = sector_cap / total
                for ticker in weights:
                    if sectors[ticker] == sector:
                        weights[ticker] *= scale
                changed = True
            missing = investable - sum(weights.values())
            if missing <= 0.01:
                break
            sector_totals = defaultdict(float)
            for ticker, weight in weights.items():
                sector_totals[sectors[ticker]] += weight
            eligible = [
                ticker
                for ticker in weights
                if weights[ticker] < individual_cap - 0.01
                and sector_totals[sectors[ticker]] < sector_cap - 0.01
            ]
            if not eligible:
                break
            denominator = sum(base[ticker] for ticker in eligible)
            for ticker in eligible:
                room = min(
                    individual_cap - weights[ticker],
                    sector_cap - sector_totals[sectors[ticker]],
                )
                addition = min(room, missing * base[ticker] / denominator)
                weights[ticker] += addition
            if not changed and abs(investable - sum(weights.values())) <= 0.01:
                break
        return weights

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
        debt = ratios.get("debt_to_equity")
        if isinstance(debt, (int, float)):
            normalized = debt / 100 if debt > 10 else debt
            score += 8 if normalized <= 1 else -10 if normalized > 3 else 0
        if statements.net_income is not None:
            score += 7 if statements.net_income > 0 else -12
        if statements.operating_cashflow is not None:
            score += 8 if statements.operating_cashflow > 0 else -12
        return self._clamp(score)

    def _momentum_score(
        self,
        market: MarketDataResult,
        technical: TechnicalResult,
    ) -> int:
        score = 50 + round((market.change_percent or 0) * 5)
        score += 10 if technical.trend == "bullish" else -10 if technical.trend == "bearish" else 0
        if technical.rsi is not None:
            if technical.rsi >= 75:
                score -= 8
            elif technical.rsi <= 30:
                score += 4
        return self._clamp(score)

    @staticmethod
    def _portfolio_role(sector: str) -> str:
        value = sector.casefold()
        if "technolog" in value or "communication" in value:
            return "Moteur de croissance et d'innovation"
        if "financial" in value:
            return "Diversification financiere et exposition au cycle economique"
        if "health" in value:
            return "Composante defensive liee a la sante"
        if "energy" in value:
            return "Diversification energie et inflation"
        if "consumer defensive" in value or "staples" in value:
            return "Stabilisateur de consommation defensive"
        return "Diversification sectorielle"

    def _strengths(self, allocations, complete_analysis) -> list[str]:
        sectors = {item.sector.casefold() for item in allocations}
        values = [
            f"La selection couvre {len(sectors)} secteurs distincts.",
            *complete_analysis.synthesis.strengths,
        ]
        return list(dict.fromkeys(values))[:5]

    def _risks(self, allocations, complete_analysis) -> list[str]:
        values = [*complete_analysis.synthesis.weaknesses]
        if any("technolog" in item.sector.casefold() for item in allocations):
            values.append("Les valeurs technologiques restent sensibles aux taux et aux anticipations de croissance.")
        if complete_analysis.synthesis.confidence_score < 70:
            values.append("La qualite partielle des donnees limite la fiabilite de la recommandation.")
        return list(dict.fromkeys(values))[:6]

    @staticmethod
    def _summary(request, allocations, complete_analysis) -> str:
        tickers = ", ".join(item.ticker for item in allocations)
        profile = {
            "conservative": "prudent",
            "moderate": "modere",
            "dynamic": "dynamique",
        }[request.risk_profile]
        objective = {
            "preservation": "preservation du capital",
            "balanced": "equilibre entre croissance et risque",
            "growth": "croissance du capital",
        }[request.objective]
        verdict = complete_analysis.synthesis.verdict.replace("_", " ")
        return (
            f"Pour un profil {profile} visant {objective}, la selection retient {tickers}. "
            f"La combinaison est classee {verdict} apres validation des agents specialises. "
            "Les poids cherchent a repartir le risque entre les entreprises et les secteurs tout en conservant une reserve de liquidites."
        )

    def _add_slm_summary(self, result: PortfolioRecommendationResult) -> None:
        try:
            compact_analysis = None
            if result.portfolio_analysis:
                compact_analysis = {
                    "verdict": result.portfolio_analysis.synthesis.verdict,
                    "score": result.portfolio_analysis.synthesis.global_score,
                    "confiance": result.portfolio_analysis.synthesis.confidence_score,
                    "forces": result.portfolio_analysis.synthesis.strengths,
                    "faiblesses": result.portfolio_analysis.synthesis.weaknesses,
                }
            payload = {
                "profil": result.profile.model_dump(),
                "allocations": [item.model_dump() for item in result.allocations],
                "analyse_portefeuille": compact_analysis,
                "forces": result.strengths,
                "risques": result.risks,
            }
            summary = self.slm_client.summarize_portfolio_recommendation_data(payload)
            if not summary:
                return
            candidate = SlmSummary.model_validate(summary)
            narrative = " ".join([candidate.summary, *candidate.key_points])
            if _DIGIT_RE.search(narrative):
                result.warnings.append(
                    "Argumentaire SLM ecarte : il contenait des chiffres non verifies."
                )
                return
            result.slm_summary = candidate
            if candidate.summary:
                result.summary = candidate.summary
        except Exception as error:
            result.warnings.append(
                f"Nebius SLM unavailable for PortfolioRecommendationAgent: {error}"
            )

    @staticmethod
    def _percent(value: float | None) -> float | None:
        if not isinstance(value, (int, float)):
            return None
        return value * 100 if abs(value) <= 1 else value

    @staticmethod
    def _clamp(value: int) -> int:
        return max(0, min(100, value))

"""Calcul du score de risque intrinseque (partage agent <-> evaluation).

Le score de risque est pondere par categorie plutot qu'une somme brute :

- chaque categorie de risque *intrinseque* (marche, technique, fondamental,
  news) a une contribution maximale ; la somme de ces maximums vaut 100 ;
- a l'interieur d'une categorie, les impacts s'additionnent puis saturent
  (au-dela de RISK_CATEGORY_SATURATION la categorie est "pleine"), ce qui
  empeche une pluie de petits risques de dominer le diagnostic ;
- la categorie `data_quality` n'a volontairement aucun poids : les problemes de
  qualite des donnees ne gonflent jamais le risque, ils reduisent uniquement le
  `data_confidence_score`. Cette exclusion est donc structurelle.

Ce module n'importe que les schemas : il reste sans dependance lourde et peut
etre utilise aussi bien par RiskAgent que par le module d'evaluation.
"""

from __future__ import annotations

from .schemas import RiskItem

# Contribution maximale de chaque categorie de risque intrinseque (somme = 100).
RISK_CATEGORY_WEIGHTS: dict[str, int] = {
    "fundamental": 30,
    "technical": 25,
    "news": 25,
    "market": 20,
}

# Somme d'impacts (points) a partir de laquelle une categorie est saturee.
# ~2 risques serieux (high ~= 15-18, medium ~= 7-10) suffisent a saturer.
RISK_CATEGORY_SATURATION = 30.0


def _category_saturation(risks: list[RiskItem], category: str) -> float:
    """Part 0..1 de saturation d'une categorie a partir de ses impacts."""
    raw = sum(risk.score_impact for risk in risks if risk.category == category)
    if raw <= 0:
        return 0.0
    return min(1.0, raw / RISK_CATEGORY_SATURATION)


def risk_score_breakdown(risks: list[RiskItem]) -> dict[str, int]:
    """Contribution (0..poids) de chaque categorie au score final."""
    return {
        category: int(round(weight * _category_saturation(risks, category)))
        for category, weight in RISK_CATEGORY_WEIGHTS.items()
    }


def compute_risk_score(risks: list[RiskItem]) -> int:
    """Score de risque intrinseque 0-100, pondere par categorie.

    Les categories hors RISK_CATEGORY_WEIGHTS (ex. data_quality) sont ignorees.
    """
    contribution = sum(
        weight * _category_saturation(risks, category)
        for category, weight in RISK_CATEGORY_WEIGHTS.items()
    )
    return int(round(min(100.0, contribution)))

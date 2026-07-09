"""Harnais d'evaluation des agents.

Lance un agent sur un lot de tickers, calcule ses metriques de qualite,
affiche un rapport console et ecrit un rapport JSON.

Usage :
    python eval_agent.py                          # MarketDataAgent, lot de demo
    python eval_agent.py AAPL MSFT NVDA           # tickers personnalises
    python eval_agent.py --agent risk MSFT        # evaluer le RiskAgent
    python eval_agent.py --json rapport.json      # chemin de sortie JSON
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from app.agents import MarketDataAgent, NewsAgent, RiskAgent, TechnicalAgent
from app.agents.evaluation import (
    EvaluationReport,
    evaluate_market_data,
    evaluate_news,
    evaluate_risk,
    evaluate_technical,
)

DEMO_TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM"]
DEFAULT_JSON = "eval_report.json"


def _load_root_env() -> None:
    """Charge le .env racine en local (comme le backend)."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def _print_report(report: EvaluationReport, elapsed_ms: float) -> None:
    print(f"\n=== {report.ticker} === grade={report.grade} "
          f"score={report.total_score}/100 passed={report.passed} "
          f"({elapsed_ms:.0f} ms)")
    for metric in report.metrics:
        flag = "PASS" if metric.passed else "FAIL"
        print(f"  [{flag}] {metric.name:<32} {metric.score:>4.2f}  {metric.message}")


def _aggregate(reports: list[EvaluationReport]) -> dict:
    if not reports:
        return {}
    metric_names = [m.name for m in reports[0].metrics]
    pass_rates = {}
    avg_scores = {}
    for name in metric_names:
        values = [
            next(m for m in r.metrics if m.name == name) for r in reports
        ]
        pass_rates[name] = round(sum(1 for m in values if m.passed) / len(values), 3)
        avg_scores[name] = round(sum(m.score for m in values) / len(values), 3)

    grades = [r.grade for r in reports]
    return {
        "tickers_evaluated": len(reports),
        "mean_total_score": round(sum(r.total_score for r in reports) / len(reports), 1),
        "overall_pass_rate": round(sum(1 for r in reports if r.passed) / len(reports), 3),
        "grade_distribution": {g: grades.count(g) for g in sorted(set(grades))},
        "metric_pass_rate": pass_rates,
        "metric_avg_score": avg_scores,
    }


def _evaluate_ticker(agent_kind: str, ticker: str, period: str) -> tuple[EvaluationReport, float]:
    """Lance l'agent choisi sur un ticker et renvoie (rapport, duree_ms)."""
    start = time.perf_counter()
    try:
        if agent_kind == "market-data":
            result = MarketDataAgent().run(ticker, period=period)
            report = evaluate_market_data(result, agent_available=True)
        elif agent_kind == "technical":
            report = evaluate_technical(TechnicalAgent().run(ticker))
        elif agent_kind == "news":
            report = evaluate_news(NewsAgent().run(ticker))
        else:  # risk
            report = evaluate_risk(RiskAgent().run(ticker))
    except Exception as error:  # backend/MCP injoignable
        report = EvaluationReport(
            ticker=ticker,
            metrics=[
                {
                    "name": "agent_availability",
                    "score": 0.0,
                    "passed": False,
                    "message": f"Agent injoignable : {error}",
                }
            ],
            total_score=0.0,
            grade="poor",
            passed=False,
        )
    elapsed_ms = (time.perf_counter() - start) * 1000
    return report, elapsed_ms


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluation des agents")
    parser.add_argument("tickers", nargs="*", help="Tickers a evaluer (defaut: lot de demo)")
    parser.add_argument(
        "--agent",
        default="market-data",
        choices=["market-data", "technical", "news", "risk"],
        help="Agent a evaluer (defaut: market-data)",
    )
    parser.add_argument("--json", default=DEFAULT_JSON, help="Chemin du rapport JSON de sortie")
    parser.add_argument("--period", default="6mo", help="Periode historique (defaut: 6mo)")
    args = parser.parse_args()

    _load_root_env()

    tickers = [t.strip().upper() for t in (args.tickers or DEMO_TICKERS) if t.strip()]

    print(f"Evaluation [{args.agent}] de {len(tickers)} ticker(s) : {', '.join(tickers)}")
    reports: list[EvaluationReport] = []
    for ticker in tickers:
        report, elapsed_ms = _evaluate_ticker(args.agent, ticker, args.period)
        reports.append(report)
        _print_report(report, elapsed_ms)

    aggregate = _aggregate(reports)
    print("\n=== AGREGAT ===")
    print(json.dumps(aggregate, indent=2, ensure_ascii=False))

    output = {
        "aggregate": aggregate,
        "reports": [r.model_dump() for r in reports],
    }
    out_path = Path(args.json)
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nRapport JSON ecrit dans : {out_path.resolve()}")


if __name__ == "__main__":
    main()

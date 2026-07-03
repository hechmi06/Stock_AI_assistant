"""Harnais d'evaluation du MarketDataAgent.

Lance l'agent sur un lot de tickers, calcule les 11 metriques de qualite de
collecte, affiche un rapport console et ecrit un rapport JSON.

Usage :
    python eval_agent.py                      # lot de demo (8 tickers)
    python eval_agent.py AAPL MSFT NVDA       # tickers personnalises
    python eval_agent.py --json rapport.json  # chemin de sortie JSON
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from app.agents import MarketDataAgent
from app.agents.evaluation import EvaluationReport, evaluate_market_data

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


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluation du MarketDataAgent")
    parser.add_argument("tickers", nargs="*", help="Tickers a evaluer (defaut: lot de demo)")
    parser.add_argument("--json", default=DEFAULT_JSON, help="Chemin du rapport JSON de sortie")
    parser.add_argument("--period", default="6mo", help="Periode historique (defaut: 6mo)")
    args = parser.parse_args()

    _load_root_env()

    tickers = [t.strip().upper() for t in (args.tickers or DEMO_TICKERS) if t.strip()]
    agent = MarketDataAgent()

    print(f"Evaluation de {len(tickers)} ticker(s) : {', '.join(tickers)}")
    reports: list[EvaluationReport] = []
    for ticker in tickers:
        start = time.perf_counter()
        agent_available = True
        try:
            result = agent.run(ticker, period=args.period)
        except Exception as error:  # backend/MCP injoignable
            agent_available = False
            from app.agents import MarketDataResult

            result = MarketDataResult(ticker=ticker, status="failed", errors=[str(error)])
        elapsed_ms = (time.perf_counter() - start) * 1000
        report = evaluate_market_data(result, agent_available=agent_available)
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

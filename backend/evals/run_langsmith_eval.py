#!/usr/bin/env python3
"""Run offline evaluation scenarios and publish LangSmith traces/feedback.

This script replays local test cases through NetFlow agent methods.
Because those methods are traceable and publish feedback metrics, each case
shows up in LangSmith as an evaluable run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path
from typing import Any

# Load config FIRST to set up LangSmith environment variables
from backend.config import LANGCHAIN_API_KEY, LANGSMITH_EVAL_ENABLED

from backend.agents.netflow_agent import NetFlowAgent
from langsmith import traceable


CORRECTNESS_THRESHOLD = 0.80
GROUNDEDNESS_THRESHOLD = 0.75


def _load_cases(path: Path) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                case = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL at line {line_no}: {exc}") from exc
            for req in ("name", "zip_code", "budget", "strategy", "mortgage_rate", "listings"):
                if req not in case:
                    raise ValueError(f"Case at line {line_no} is missing required field '{req}'")
            if not isinstance(case["listings"], list) or not case["listings"]:
                raise ValueError(f"Case at line {line_no} must include a non-empty 'listings' list")
            cases.append(case)
    if not cases:
        raise ValueError("No evaluation cases found in JSONL file")
    return cases


def _ratio(numerator: int, denominator: int) -> float:
    return round((numerator / denominator), 3) if denominator else 0.0


def _mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 3) if values else 0.0


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _extract_number_tokens(text: str) -> list[str]:
    return [tok.replace(",", "") for tok in re.findall(r"-?\d+(?:,\d{3})*(?:\.\d+)?", text)]


def _try_float(value: str) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def _number_variants(value: float) -> set[str]:
    variants = {
        str(int(round(value))),
        f"{value:.1f}",
        f"{value:.2f}",
    }
    if value < 0:
        variants.add(str(abs(int(round(value)))))
        variants.add(f"{abs(value):.1f}")
        variants.add(f"{abs(value):.2f}")
    return variants


def _allowed_summary_numbers(
    case: dict[str, Any],
    top,
    top_picks,
    mortgage_rate: float,
) -> set[str]:
    allowed: set[str] = set()

    allowed.add(str(case.get("zip_code", "")))
    allowed.add("100")
    allowed.update(_number_variants(float(case.get("budget", 0))))
    allowed.update(_number_variants(float(mortgage_rate)))
    if top is not None:
        allowed.update(_number_variants(float(top.price)))
        allowed.update(_number_variants(float(top.cap_rate)))
        allowed.update(_number_variants(float(top.cash_flow)))
        allowed.update(_number_variants(float(top.ai_score)))
        allowed.update(_extract_number_tokens(str(top.address)))

    if top_picks:
        avg_cap = round(sum(float(p.cap_rate) for p in top_picks) / len(top_picks), 1)
        avg_cf = round(sum(float(p.cash_flow) for p in top_picks) / len(top_picks))
        allowed.update(_number_variants(float(avg_cap)))
        allowed.update(_number_variants(float(avg_cf)))
        allowed.update(_number_variants(float(len(top_picks))))
    return allowed


async def _publish_case_eval(metrics: dict[str, float], comment: str = "") -> None:
    if not (LANGSMITH_EVAL_ENABLED and LANGCHAIN_API_KEY):
        return
    try:
        from langsmith import Client
        from langsmith.run_helpers import get_current_run_tree

        run_tree = get_current_run_tree()
        run_id = getattr(run_tree, "id", None)
        if not run_id:
            return

        client = Client()
        for key, value in metrics.items():
            client.create_feedback(
                run_id=run_id,
                key=key,
                score=float(value),
                comment=comment,
            )
    except Exception:
        return


def _score_correctness(case: dict[str, Any], scored) -> tuple[float, dict[str, float]]:
    checks: list[float] = []
    details: dict[str, float] = {}

    is_rank_sorted = all(
        scored[i].ai_score >= scored[i + 1].ai_score for i in range(len(scored) - 1)
    )
    details["rank_order_ok"] = 1.0 if is_rank_sorted else 0.0
    checks.append(details["rank_order_ok"])

    top = scored[0] if scored else None
    expected_top = case.get("expected_top_pick")
    if expected_top and top is not None:
        top_match = _normalize_text(top.address) == _normalize_text(str(expected_top))
        details["top_pick_match"] = 1.0 if top_match else 0.0
        checks.append(details["top_pick_match"])

    cap_range = case.get("expected_cap_rate_range")
    if isinstance(cap_range, list) and len(cap_range) == 2 and top is not None:
        lo, hi = float(cap_range[0]), float(cap_range[1])
        in_range = lo <= float(top.cap_rate) <= hi
        details["top_cap_rate_in_range"] = 1.0 if in_range else 0.0
        checks.append(details["top_cap_rate_in_range"])

    return _mean(checks), details


def _score_groundedness(
    case: dict[str, Any],
    summary: str,
    top,
    top_picks,
    mortgage_rate: float,
) -> tuple[float, dict[str, float]]:
    details: dict[str, float] = {}
    summary_tokens = _extract_number_tokens(summary)
    allowed = _allowed_summary_numbers(case, top, top_picks, mortgage_rate)
    unsupported = [tok for tok in summary_tokens if tok not in allowed]

    unsupported_ratio = _ratio(len(unsupported), len(summary_tokens)) if summary_tokens else 0.0
    numeric_support_score = round(1.0 - unsupported_ratio, 3)
    details["summary_numeric_support"] = numeric_support_score

    required_numbers = [str(x).replace(",", "") for x in case.get("expected_summary_required_numbers", [])]
    summary_token_set = set(summary_tokens)
    if required_numbers:
        summary_token_floats = [f for f in (_try_float(tok) for tok in summary_tokens) if f is not None]
        covered = 0
        for n in required_numbers:
            if n in summary_token_set:
                covered += 1
                continue
            req = _try_float(n)
            if req is None:
                continue
            if any(abs(req - got) <= 0.15 for got in summary_token_floats):
                covered += 1
        required_coverage = _ratio(covered, len(required_numbers))
        details["required_number_coverage"] = required_coverage
        groundedness = round((0.5 * required_coverage) + (0.5 * numeric_support_score), 3)
    else:
        details["required_number_coverage"] = 1.0
        groundedness = numeric_support_score

    return groundedness, details


@traceable(name="netflow.eval_case")
async def _run_case(agent: NetFlowAgent, case: dict[str, Any]) -> dict[str, Any]:
    scored = await agent.score_and_rank(
        listings=case["listings"],
        mortgage_rate=float(case["mortgage_rate"]),
        strategy=str(case["strategy"]),
        langsmith_extra={
            "tags": ["offline_eval", "score"],
            "metadata": {
                "trace_source": "offline_eval",
                "eval_case": str(case["name"]),
                "strategy": str(case["strategy"]),
                "zip_code": str(case["zip_code"]),
            },
        },
    )

    top = scored[:3]
    summary = await agent.market_summary(
        zip_code=str(case["zip_code"]),
        budget=int(case["budget"]),
        strategy=str(case["strategy"]),
        top_picks=top,
        mortgage_rate=float(case["mortgage_rate"]),
        langsmith_extra={
            "tags": ["offline_eval", "summary"],
            "metadata": {
                "trace_source": "offline_eval",
                "eval_case": str(case["name"]),
                "strategy": str(case["strategy"]),
                "zip_code": str(case["zip_code"]),
            },
        },
    )

    avg_score = round(sum(float(p.ai_score) for p in scored) / len(scored), 3)
    top_pick = top[0].address if top else "N/A"

    correctness_score, correctness_parts = _score_correctness(case, scored)
    groundedness_score, groundedness_parts = _score_groundedness(
        case,
        summary,
        top[0] if top else None,
        top,
        float(case["mortgage_rate"]),
    )
    correctness_pass = 1.0 if correctness_score >= CORRECTNESS_THRESHOLD else 0.0
    groundedness_pass = 1.0 if groundedness_score >= GROUNDEDNESS_THRESHOLD else 0.0

    await _publish_case_eval(
        {
            "ranking_quality": correctness_score,
            "groundedness": groundedness_score,
            "correctness_pass": correctness_pass,
            "groundedness_pass": groundedness_pass,
            **correctness_parts,
            **groundedness_parts,
        },
        comment=f"case={case['name']},strategy={case['strategy']},zip={case['zip_code']}",
    )

    return {
        "name": case["name"],
        "zip_code": case["zip_code"],
        "strategy": case["strategy"],
        "n_listings": len(scored),
        "avg_score": avg_score,
        "top_pick": top_pick,
        "correctness_score": correctness_score,
        "groundedness_score": groundedness_score,
        "correctness_pass": bool(correctness_pass),
        "groundedness_pass": bool(groundedness_pass),
    }


@traceable(name="netflow.offline_eval")
async def _run(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    agent = NetFlowAgent()
    results: list[dict[str, Any]] = []
    for case in cases:
        results.append(await _run_case(agent, case))
    return results


def _print_results(results: list[dict[str, Any]]) -> None:
    print("\nLangSmith Offline Eval Results")
    print("-" * 100)
    print(
        f"{'Case':28} {'ZIP':7} {'Strategy':9} {'AvgScore':9} {'Corr':6} {'Ground':7} TopPick"
    )
    print("-" * 100)
    for r in results:
        print(
            f"{str(r['name'])[:28]:28} "
            f"{str(r['zip_code']):7} "
            f"{str(r['strategy']):9} "
            f"{r['avg_score']:9.3f} "
            f"{r['correctness_score']:6.3f} "
            f"{r['groundedness_score']:7.3f} "
            f"{r['top_pick']}"
        )
    print("-" * 100)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run offline LangSmith evaluation scenarios")
    parser.add_argument(
        "--cases",
        default="backend/evals/sample_eval_cases.jsonl",
        help="Path to JSONL evaluation cases",
    )
    args = parser.parse_args()

    cases_path = Path(args.cases)
    if not cases_path.exists():
        raise FileNotFoundError(f"Cases file not found: {cases_path}")

    cases = _load_cases(cases_path)
    results = asyncio.run(_run(cases))
    _print_results(results)


if __name__ == "__main__":
    main()

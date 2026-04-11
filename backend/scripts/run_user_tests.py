from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any
import sys

import httpx
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.main import app


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sample_property() -> dict[str, Any]:
    return {
        "property_id": "manual-75080",
        "address": "900 E Collins Blvd",
        "city": "Richardson",
        "state": "TX",
        "zip": "75080",
        "price": 525000,
        "beds": 3,
        "baths": 2,
        "sqft": 1850,
        "listing_url": "https://example.com/manual-75080",
        "description": "Manual test property used when provider is unavailable.",
        "source": "manual",
    }


class Runner:
    def __init__(self, base_url: str | None):
        self.base_url = base_url
        self.client = None
        self.http = None
        if base_url:
            self.http = httpx.Client(base_url=base_url, timeout=60)
        else:
            self.client = TestClient(app)

    def close(self) -> None:
        if self.http:
            self.http.close()
        if self.client:
            self.client.close()

    def request(self, method: str, path: str, json_body: dict | None = None) -> tuple[int, Any, float]:
        started = time.perf_counter()
        if self.http:
            resp = self.http.request(method, path, json=json_body)
        else:
            resp = self.client.request(method, path, json=json_body)
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        try:
            payload = resp.json()
        except Exception:
            payload = resp.text
        return resp.status_code, payload, latency_ms


def run_tests(base_url: str | None) -> dict[str, Any]:
    runner = Runner(base_url)
    report: dict[str, Any] = {
        "run_at": _now_iso(),
        "base_url": base_url or "in-process TestClient",
        "steps": [],
        "summary": {},
    }

    try:
        def step(name: str, method: str, path: str, body: dict | None = None, expected: tuple[int, ...] = (200,)) -> Any:
            status, payload, latency = runner.request(method, path, body)
            ok = status in expected
            report["steps"].append(
                {
                    "name": name,
                    "method": method,
                    "path": path,
                    "status": status,
                    "ok": ok,
                    "latency_ms": latency,
                    "response": payload,
                }
            )
            return payload

        health = step("health", "GET", "/health")
        tracing_status = step("tracing_status", "GET", "/tracing/status")
        tracing_verify = step("tracing_verify", "GET", "/tracing/verify")

        search_payload = {"location": "75080", "limit": 5, "allow_demo": False}
        search = step("search_75080", "POST", "/properties/search", search_payload, expected=(200, 503))

        property_candidate = _sample_property()
        real_listing_count = 0
        search_provider_error = None

        if isinstance(search, list) and search:
            property_candidate = search[0]
            real_listing_count = len(search)
        elif isinstance(search, dict):
            search_provider_error = search.get("detail")

        analysis = step("analysis_property", "POST", "/analysis/property", {"property": property_candidate})

        portfolio_in = {
            "property_id": property_candidate.get("property_id", "manual-75080"),
            "address": property_candidate.get("address", "Unknown"),
            "city": property_candidate.get("city", "Richardson"),
            "state": property_candidate.get("state", "TX"),
            "price": float(property_candidate.get("price", 525000)),
            "notes": "automated user test",
        }
        added = step("portfolio_add", "POST", "/portfolio", portfolio_in)
        step("portfolio_list", "GET", "/portfolio")

        chat = step("chat", "POST", "/chat", {"message": "Give me a concise outlook for my portfolio."})
        perf = step("model_performance", "GET", "/model/performance")
        events = step("observability_events", "GET", "/observability/events?limit=20")

        feedback_payload = {
            "property_id": property_candidate.get("property_id", "manual-75080"),
            "predicted_12m_change_percent": float(analysis.get("projected_12m_change_percent", 0)),
            "actual_12m_change_percent": 1.5,
            "confidence": float(analysis.get("confidence", 0.5)),
            "recommendation": str(analysis.get("recommendation", "hold")),
        }
        step("model_feedback", "POST", "/model/feedback", feedback_payload)

        if isinstance(added, dict) and added.get("id"):
            step("portfolio_delete", "DELETE", f"/portfolio/{added['id']}", expected=(200, 404))

        latencies = [s["latency_ms"] for s in report["steps"]]
        ok_count = sum(1 for s in report["steps"] if s["ok"])

        report["summary"] = {
            "total_steps": len(report["steps"]),
            "passed_steps": ok_count,
            "failed_steps": len(report["steps"]) - ok_count,
            "avg_latency_ms": round(mean(latencies), 2) if latencies else None,
            "max_latency_ms": max(latencies) if latencies else None,
            "health_ok": isinstance(health, dict) and health.get("status") == "ok",
            "langsmith_enabled": bool(isinstance(tracing_status, dict) and tracing_status.get("langsmith_enabled")),
            "langchain_invoke_ok": bool(isinstance(tracing_verify, dict) and tracing_verify.get("langchain_invoke_ok")),
            "ollama_reachable": bool(isinstance(tracing_verify, dict) and tracing_verify.get("ollama_reachable")),
            "real_listing_count": real_listing_count,
            "search_provider_error": search_provider_error,
            "analysis_has_scores": isinstance(analysis, dict)
            and analysis.get("investment_score") is not None
            and analysis.get("risk_score") is not None,
            "chat_has_answer": isinstance(chat, dict) and bool(chat.get("answer")),
            "events_count": len(events) if isinstance(events, list) else 0,
            "performance_snapshot": perf if isinstance(perf, dict) else None,
        }

    finally:
        runner.close()

    return report


def save_report(report: dict[str, Any]) -> Path:
    out_dir = Path(__file__).resolve().parents[1] / "analytics"
    out_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    stamped = out_dir / f"user_test_report-{ts}.json"
    latest = out_dir / "latest_user_test_report.json"

    stamped.write_text(json.dumps(report, indent=2), encoding="utf-8")
    latest.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return stamped


def main() -> None:
    parser = argparse.ArgumentParser(description="Run NETFLOW user journey tests and analytics checks.")
    parser.add_argument(
        "--base-url",
        default=None,
        help="Optional running backend base URL, e.g. http://127.0.0.1:8000. If omitted, runs in-process.",
    )
    args = parser.parse_args()

    report = run_tests(args.base_url)
    out_file = save_report(report)

    print("NETFLOW user test run complete")
    print(f"report: {out_file}")
    print("summary:")
    print(json.dumps(report.get("summary", {}), indent=2))


if __name__ == "__main__":
    main()

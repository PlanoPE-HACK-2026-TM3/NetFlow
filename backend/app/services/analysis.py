import json

from app.schemas import AnalysisOut, PropertyOut
from app.services.llm import LLMTrace, generate_json


def heuristic_property_analysis(property_item: PropertyOut, mortgage_rate: float, news_count: int) -> AnalysisOut:
    price_anchor = max(min(property_item.price / 1000000, 1.5), 0.2)
    risk = int(min(95, max(10, (mortgage_rate * 10) + (price_anchor * 20) - news_count)))
    invest = int(min(95, max(5, 100 - risk + (property_item.beds or 0) * 2)))
    projected = round(max(-12.0, min(15.0, (invest - risk) * 0.12)), 2)
    recommendation = "buy" if invest >= 60 and risk <= 60 else "hold" if invest >= 45 else "avoid"

    return AnalysisOut(
        property_id=property_item.property_id,
        investment_score=invest,
        risk_score=risk,
        confidence=0.62,
        projected_12m_change_percent=projected,
        recommendation=recommendation,
        rationale=(
            "Heuristic portfolio summary using mortgage pressure, pricing, and news volume."
        ),
    )


async def analyze_property(property_item: PropertyOut, mortgage_rate: float, news_count: int) -> AnalysisOut:
    trace = LLMTrace("property_analysis", {"property_id": property_item.property_id})
    system_prompt = (
        "You are a real estate investment analyst. Return ONLY valid JSON with keys: "
        "investment_score (0-100 int), risk_score (0-100 int), confidence (0-1 float), "
        "projected_12m_change_percent (float), recommendation (buy|hold|avoid), rationale (string)."
    )
    user_prompt = (
        f"Property: {json.dumps(property_item.model_dump())}\n"
        f"Mortgage rate: {mortgage_rate}\n"
        f"Relevant news count: {news_count}\n"
        "Use conservative assumptions and explain the strongest 2-3 drivers in rationale."
    )

    try:
        payload = await generate_json(system_prompt=system_prompt, user_prompt=user_prompt)
        trace.complete("ok", {"provider": "ollama"})
        return AnalysisOut(
            property_id=property_item.property_id,
            investment_score=int(payload["investment_score"]),
            risk_score=int(payload["risk_score"]),
            confidence=float(payload["confidence"]),
            projected_12m_change_percent=float(payload["projected_12m_change_percent"]),
            recommendation=str(payload["recommendation"]),
            rationale=str(payload["rationale"]),
        )
    except Exception as exc:
        trace.complete("fallback", {"provider": "heuristic", "error": str(exc)})
        return heuristic_property_analysis(property_item, mortgage_rate, news_count)

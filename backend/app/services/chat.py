from app.schemas import AnalysisOut, PortfolioItemOut
from app.services.llm import LLMTrace, generate_text


def _fallback_chat(message: str, portfolio: list[PortfolioItemOut], latest_rate: float, latest_analyses: list[AnalysisOut]) -> str:
    count = len(portfolio)
    avg_risk = round(sum(a.risk_score for a in latest_analyses) / len(latest_analyses), 1) if latest_analyses else 0

    return (
        f"You asked: '{message}'. "
        f"Current 30Y mortgage rate is {latest_rate}%. "
        f"Your tracked properties: {count}. "
        f"Recent average risk score: {avg_risk}. "
        "Fallback assistant was used because local LLM output was unavailable."
    )


async def build_chat_response(
    message: str,
    portfolio: list[PortfolioItemOut],
    latest_rate: float,
    latest_analyses: list[AnalysisOut],
) -> str:
    trace = LLMTrace("forecast_chat", {"portfolio_count": len(portfolio)})
    compact_portfolio = [
        {
            "property_id": p.property_id,
            "address": p.address,
            "city": p.city,
            "state": p.state,
            "price": p.price,
        }
        for p in portfolio[:10]
    ]
    compact_analyses = [a.model_dump() for a in latest_analyses[:10]]

    system_prompt = (
        "You are NETFLOW, a conservative real-estate forecast assistant. "
        "Use portfolio risk context and mortgage rates. Keep response concise and factual. "
        "If confidence is low, explicitly say so."
    )
    user_prompt = (
        f"User question: {message}\n"
        f"Mortgage rate: {latest_rate}\n"
        f"Portfolio snapshot: {compact_portfolio}\n"
        f"Analysis snapshot: {compact_analyses}"
    )

    try:
        answer = await generate_text(system_prompt=system_prompt, user_prompt=user_prompt)
        trace.complete("ok", {"provider": "ollama"})
        return answer
    except Exception as exc:
        trace.complete("fallback", {"provider": "rule_based", "error": str(exc)})
        return _fallback_chat(message, portfolio, latest_rate, latest_analyses)

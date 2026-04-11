import asyncio
import os

import httpx

from app.config import settings
from app.services.llm import generate_text


async def verify_tracing_runtime() -> dict:
    base_url = settings.ollama_base_url.rstrip("/")
    tags_url = f"{base_url}/api/tags"

    langsmith_enabled = bool(settings.langsmith_api_key and settings.langsmith_tracing)
    ollama_reachable = False
    model_seen = False
    invoke_ok = False
    invoke_error = None

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            tags_response = await client.get(tags_url)
            tags_response.raise_for_status()
            payload = tags_response.json()
            models = payload.get("models", [])
            model_names = {str(m.get("name", "")) for m in models}
            model_seen = settings.ollama_model in model_names
            ollama_reachable = True
    except Exception as exc:
        invoke_error = f"ollama_tags_error: {type(exc).__name__}: {exc}"

    if ollama_reachable:
        try:
            await asyncio.wait_for(
                generate_text(
                    system_prompt="Reply with one short sentence.",
                    user_prompt="This is a tracing verification ping.",
                ),
                timeout=20,
            )
            invoke_ok = True
        except Exception as exc:
            invoke_error = f"langchain_invoke_error: {type(exc).__name__}: {exc}"

    return {
        "langsmith_enabled": langsmith_enabled,
        "langsmith_api_key_set": bool(settings.langsmith_api_key),
        "langsmith_project": settings.langsmith_project,
        "langsmith_endpoint": settings.langsmith_endpoint,
        "langchain_tracing_v2": os.getenv("LANGCHAIN_TRACING_V2"),
        "ollama_reachable": ollama_reachable,
        "ollama_model_configured": settings.ollama_model,
        "ollama_model_seen_in_tags": model_seen,
        "langchain_invoke_ok": invoke_ok,
        "invoke_error": invoke_error,
    }

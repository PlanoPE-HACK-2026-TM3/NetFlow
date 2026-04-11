import json
import os
import time
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_ollama import ChatOllama

from app.config import settings


class LLMTrace:
    def __init__(self, name: str, metadata: dict[str, Any] | None = None):
        self.name = name
        self.metadata = metadata or {}
        self.start = time.perf_counter()

    def complete(self, status: str, extra: dict[str, Any] | None = None) -> None:
        duration_ms = round((time.perf_counter() - self.start) * 1000, 2)
        payload = {
            "name": self.name,
            "status": status,
            "duration_ms": duration_ms,
            "metadata": self.metadata,
        }
        if extra:
            payload.update(extra)
        print(f"[trace] {json.dumps(payload)}")


def _configure_langsmith_env() -> None:
    if settings.langsmith_api_key:
        os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
    os.environ["LANGSMITH_ENDPOINT"] = settings.langsmith_endpoint
    os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    os.environ["LANGSMITH_TRACING"] = "true" if settings.langsmith_tracing else "false"
    os.environ["LANGCHAIN_TRACING_V2"] = "true" if settings.langsmith_tracing else "false"


def get_chat_model() -> ChatOllama:
    _configure_langsmith_env()
    return ChatOllama(model=settings.ollama_model, base_url=settings.ollama_base_url, temperature=0.2)


async def generate_json(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    _configure_langsmith_env()
    model = get_chat_model()
    response = await model.ainvoke([SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)])

    text = response.content if isinstance(response.content, str) else str(response.content)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("LLM did not return JSON content")

    return json.loads(text[start : end + 1])


async def generate_text(system_prompt: str, user_prompt: str) -> str:
    _configure_langsmith_env()
    model = get_chat_model()
    response = await model.ainvoke([SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)])
    return response.content if isinstance(response.content, str) else str(response.content)

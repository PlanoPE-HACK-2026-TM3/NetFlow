"""
NetFlow LangChain Agent — uses local Ollama (llama3) for scoring + summaries.

DEMO_MODE=false (default):
  - RentCast + FRED for live data (if keys set), mock data as fallback
  - Ollama/llama3 for AI scoring and market summary
  - Falls back to rule-based scoring if Ollama is unavailable

DEMO_MODE=true:
  - Mock data always, rule-based scoring, no Ollama calls
"""

import json
import os
import re
import ast
from typing import AsyncIterator

from backend.config import (
    OLLAMA_BASE_URL, OLLAMA_MODEL, DEMO_MODE,
    LANGCHAIN_API_KEY, LANGCHAIN_PROJECT, LANGSMITH_EVAL_ENABLED,
)

from langsmith import traceable
from pydantic import BaseModel, Field


# ── Output schema ─────────────────────────────────────────────

class ScoredProperty(BaseModel):
    rank:      int
    address:   str
    zip_code:  str
    price:     int
    est_rent:  int
    cap_rate:  float = Field(description="Net cap rate after 35% expense ratio")
    cash_flow: int   = Field(description="Monthly cash flow after PITI + expenses")
    grm:       float = Field(description="Gross Rent Multiplier")
    dom:       int   = Field(description="Days on market")
    ai_score:  int   = Field(ge=0, le=100)
    tags:      list[str]
    beds:      int
    baths:     float
    sqft:      int


# ── Compact prompts (token-optimised) ────────────────────────

SCORING_SYSTEM = """Score properties 0-100 for {strategy}.
Weights: cap_rate 30, cash_flow 25, grm 15, dom 10, strategy_fit 20.
↑ cap_rate/cash_flow, ↓ grm/dom. LTR=stable CF, STR=yield, BRRRR=value, Flip=low DOM.
Output ONLY JSON: [{{"ai_score":0-100,"tags":[]}},...] in input order. No prose."""

SUMMARY_SYSTEM = """Concise real estate analyst. 3 sentences, max 75 words. Facts only."""

SUMMARY_HUMAN = """{zip_code} | ${budget:,} | {strategy_label} | {mortgage_rate}% rate
Top: {top1_addr} ${top1_price:,} | {top1_cap}% cap | ${top1_cf}/mo CF | {top1_score} pts
Avg: {avg_cap}% cap, ${avg_cf}/mo CF, {n_props} props

3 plain sentences using only facts. No invented numbers, bullets, or labels."""

PROPERTY_CHAT_SYSTEM = """You are NetFlow's property analyst.
Use ONLY supplied facts. Don't invent HOA, schools, crime, appreciation, rehab.
If missing, say unavailable. Be concise, practical, honest."""


# ── Financial helpers ─────────────────────────────────────────

def _compute_financials(listing: dict, mortgage_rate: float) -> dict:
    price         = listing["price"]
    rent          = listing.get("est_rent", 0)
    expense_ratio = 0.35
    gross_annual  = rent * 12
    noi           = gross_annual * (1 - expense_ratio)
    cap_rate      = round((noi / price) * 100, 2) if price > 0 else 0.0
    down          = price * 0.20
    loan          = price - down
    r             = mortgage_rate / 100 / 12
    n             = 360
    pi            = loan * (r * (1+r)**n) / ((1+r)**n - 1) if r > 0 else loan / n
    piti          = pi + price * 0.015 / 12
    cash_flow     = int(rent - piti - rent * expense_ratio)
    grm           = round(price / gross_annual, 1) if gross_annual > 0 else 0.0
    return {**listing, "cap_rate": cap_rate, "cash_flow": cash_flow, "grm": grm}


def _compact_for_llm(prop: dict) -> dict:
    """Only the 5 fields the LLM needs — cuts tokens ~80%."""
    return {
        "cap":  prop.get("cap_rate", 0),
        "cf":   prop.get("cash_flow", 0),
        "dom":  prop.get("dom", 30),
        "beds": prop.get("beds", 3),
        "price": prop.get("price", 0),
    }


def _rule_based_score(prop: dict, strategy: str) -> tuple[int, list[str]]:
    score, tags = 0, []
    cr = prop.get("cap_rate", 0)
    if cr >= 6:   score += 30; tags.append(f"{cr}% cap")
    elif cr >= 5: score += 22
    elif cr >= 4: score += 12
    cf = prop.get("cash_flow", 0)
    if cf > 400:   score += 25; tags.append(f"${cf}/mo CF")
    elif cf > 200: score += 18
    elif cf > 0:   score += 8
    grm = prop.get("grm", 200)
    if grm < 100:   score += 15
    elif grm < 130: score += 10
    elif grm < 160: score += 5
    dom = prop.get("dom", 30)
    if dom < 14:   score += 10; tags.append("High demand")
    elif dom < 30: score += 6
    if   strategy == "LTR"   and cf > 200:                        score += 20
    elif strategy == "STR"   and prop.get("cap_rate", 0) > 5.5:  score += 20
    elif strategy == "BRRRR" and dom > 40: score += 15;           tags.append("Value-add")
    elif strategy == "Flip"  and dom < 20:                        score += 18
    else:                                                          score += 10
    if not tags:
        tags.append(f"{prop.get('beds',0)}bd/{prop.get('baths',0)}ba")
    return min(score, 100), tags


STRATEGY_LABELS = {
    "LTR":   "Long-term rental",
    "STR":   "Short-term rental",
    "BRRRR": "BRRRR",
    "Flip":  "Fix and flip",
}


def _safe_mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 3) if values else 0.0


def _extract_number_tokens(text: str) -> list[str]:
    return [tok.replace(",", "") for tok in re.findall(r"-?\d+(?:,\d{3})*(?:\.\d+)?", text)]


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


def _score_correctness_ui(results: list[ScoredProperty]) -> dict[str, float]:
    n = len(results)
    if n == 0:
        return {
            "ui_correctness_score": 0.0,
            "ui_rank_order_ok": 0.0,
            "ui_ai_score_bounds_ratio": 0.0,
            "ui_unique_address_ratio": 0.0,
        }

    rank_order_ok = 1.0 if all(results[i].ai_score >= results[i + 1].ai_score for i in range(n - 1)) else 0.0
    ai_score_bounds_ratio = round(sum(1 for r in results if 0 <= r.ai_score <= 100) / n, 3)
    unique_address_ratio = round(len({r.address.strip().lower() for r in results if r.address}) / n, 3)
    ui_correctness_score = round((rank_order_ok + ai_score_bounds_ratio + unique_address_ratio) / 3, 3)
    return {
        "ranking_quality": ui_correctness_score,
        "rank_order_ok": rank_order_ok,
        "no_duplicates": unique_address_ratio,
    }


def _score_groundedness_ui(
    summary: str,
    zip_code: str,
    budget: int,
    mortgage_rate: float,
    top_picks: list[ScoredProperty],
) -> dict[str, float]:
    tokens = _extract_number_tokens(summary)
    allowed: set[str] = set()

    if zip_code:
        allowed.add(str(zip_code))
    allowed.update(_number_variants(float(budget)))
    allowed.update(_number_variants(float(mortgage_rate)))
    allowed.add("100")

    if top_picks:
        top = top_picks[0]
        allowed.update(_number_variants(float(top.price)))
        allowed.update(_number_variants(float(top.cap_rate)))
        allowed.update(_number_variants(float(top.cash_flow)))
        allowed.update(_number_variants(float(top.ai_score)))
        allowed.update(_extract_number_tokens(str(top.address)))

        avg_cap = round(sum(float(p.cap_rate) for p in top_picks) / len(top_picks), 1)
        avg_cf = round(sum(float(p.cash_flow) for p in top_picks) / len(top_picks))
        allowed.update(_number_variants(float(avg_cap)))
        allowed.update(_number_variants(float(avg_cf)))
        allowed.update(_number_variants(float(len(top_picks))))

    unsupported = [tok for tok in tokens if tok not in allowed]
    unsupported_ratio = round((len(unsupported) / len(tokens)), 3) if tokens else 0.0
    numeric_support = round(1.0 - unsupported_ratio, 3)

    required: set[str] = set()
    if zip_code:
        required.add(str(zip_code))
    required.update(_number_variants(float(budget)))
    required.update(_number_variants(float(mortgage_rate)))
    if top_picks:
        top = top_picks[0]
        required.update(_number_variants(float(top.price)))
        required.update(_number_variants(float(top.cap_rate)))
        required.update(_number_variants(float(top.cash_flow)))
        required.update(_number_variants(float(top.ai_score)))

    token_set = set(tokens)
    required_hits = sum(1 for n in required if n in token_set) if required else 0
    required_coverage = round((required_hits / len(required)), 3) if required else 1.0
    groundedness_score = round((0.5 * numeric_support) + (0.5 * required_coverage), 3)

    return {
        "groundedness": groundedness_score,
        "numeric_accuracy": numeric_support,
        "key_facts_covered": required_coverage,
    }


def _sanitize_summary_text(text: str) -> str:
    """Normalize model output to plain 3-sentence prose, max 75 words.

    Strips headings, list markers, and truncates to token budget.
    """
    parts: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^(here are\s+)?(the\s+)?three\s+sentences:?\s*", "", line, flags=re.IGNORECASE)
        line = re.sub(r"^sentence\s+[a-z0-9]+[:\-]\s*", "", line, flags=re.IGNORECASE)
        line = re.sub(r"^\d+\.\s*", "", line)
        if line:
            parts.append(line)
    result = re.sub(r"\s+", " ", " ".join(parts)).strip()
    # Enforce ~75 word limit: ~375 chars at avg 5 chars/word
    if len(result) > 375:
        result = result[:375].rsplit(" ", 1)[0] + "."
    return result


def _parse_scoring_json(content_text: str) -> list[dict]:
    """Parse scorer output robustly from local model responses.

    Accepts direct JSON arrays, wrapped dicts, fenced blocks, and text that
    embeds a JSON array. Raises ValueError on unsupported shapes.
    """
    text = content_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)

    def _coerce_obj(obj):
        if isinstance(obj, list):
            return [x for x in obj if isinstance(x, dict)]
        if isinstance(obj, dict):
            for key in ("results", "scores", "items", "output", "properties"):
                value = obj.get(key)
                if isinstance(value, list):
                    return [x for x in value if isinstance(x, dict)]
        return None

    try:
        parsed = json.loads(text)
        coerced = _coerce_obj(parsed)
        if coerced is not None:
            return coerced
    except Exception:
        pass

    # Some local models output Python-style dict/list (single quotes, etc.).
    try:
        parsed = ast.literal_eval(text)
        coerced = _coerce_obj(parsed)
        if coerced is not None:
            return coerced
    except Exception:
        pass

    # Try to parse from all balanced JSON-like array spans in the text.
    spans: list[tuple[int, int]] = []
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == "[":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "]" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                spans.append((start, i + 1))
                start = -1

    for a, b in spans:
        candidate = text[a:b]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                dicts = [x for x in parsed if isinstance(x, dict)]
                if dicts:
                    return dicts
        except Exception:
            pass
        try:
            parsed = ast.literal_eval(candidate)
            if isinstance(parsed, list):
                dicts = [x for x in parsed if isinstance(x, dict)]
                if dicts:
                    return dicts
        except Exception:
            pass

    match = re.search(r"\[[\s\S]*\]", text)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, list):
                return [x for x in parsed if isinstance(x, dict)]
        except Exception:
            pass

    # Last chance with literal_eval on greedy match.
    if match:
        try:
            parsed = ast.literal_eval(match.group(0))
            if isinstance(parsed, list):
                return [x for x in parsed if isinstance(x, dict)]
        except Exception:
            pass

    raise ValueError("Could not parse model scoring output as JSON array")


async def _publish_langsmith_eval(scores: dict[str, float], comment: str = "") -> None:
    """Attach lightweight feedback metrics to the current LangSmith run.

    This is intentionally best-effort: evaluation never blocks product behavior.
    """
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
        for key, value in scores.items():
            client.create_feedback(
                run_id=run_id,
                key=key,
                score=float(value),
                comment=comment,
            )
    except Exception:
        # Never fail user requests because evaluation publishing failed.
        return


# ── Agent ──────────────────────────────────────────────────────

class NetFlowAgent:
    def __init__(self):
        self._llm = None
        self._scoring_prompt = None
        self._summary_prompt = None

    def _get_llm(self):
        """Lazy-init Ollama client. Always uses local llama3."""
        if self._llm is None:
            from langchain_ollama import ChatOllama
            self._llm = ChatOllama(
                model=OLLAMA_MODEL,
                temperature=0.1,
                base_url=OLLAMA_BASE_URL,
                num_predict=280,
            )
        return self._llm

    def _get_scoring_prompt(self):
        """Cached scoring prompt template to avoid re-parsing."""
        if self._scoring_prompt is None:
            from langchain_core.prompts import ChatPromptTemplate
            self._scoring_prompt = ChatPromptTemplate.from_messages([
                ("system", SCORING_SYSTEM),
                ("human", "Strategy:{strategy} Rate:{rate}%\n{data}"),
            ])
        return self._scoring_prompt

    def _get_summary_prompt(self):
        """Cached summary prompt template to avoid re-parsing."""
        if self._summary_prompt is None:
            from langchain_core.prompts import ChatPromptTemplate
            self._summary_prompt = ChatPromptTemplate.from_messages([
                ("system", SUMMARY_SYSTEM), ("human", SUMMARY_HUMAN),
            ])
        return self._summary_prompt

    def _ollama_available(self) -> bool:
        """Quick sync check if Ollama is reachable."""
        import urllib.request
        try:
            urllib.request.urlopen(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
            return True
        except Exception:
            return False

    @traceable(name="netflow.score_and_rank")
    async def score_and_rank(
        self, listings: list[dict], mortgage_rate: float, strategy: str
    ) -> list[ScoredProperty]:
        enriched = [_compute_financials(l, mortgage_rate) for l in listings]
        parse_repair_used = 0.0

        # DEMO_MODE → rule-based only, skip Ollama
        if DEMO_MODE:
            await _publish_langsmith_eval(
                {
                    "rule_fallback": 1.0,
                    "input_tokens": 0.0,
                    "output_tokens": 0.0,
                    "json_repair": 0.0,
                },
                comment=f"reason=demo_mode,strategy={strategy},mortgage_rate={mortgage_rate}",
            )
            return self._rule_score(enriched, strategy)

        # Live mode → try Ollama, fall back to rule-based
        try:
            compact = [_compact_for_llm(p) for p in enriched]
            prompt = self._get_scoring_prompt()
            prompt_vars = {
                "strategy": strategy,
                "rate":     mortgage_rate,
                "data":     json.dumps(compact),
            }
            scorer_llm = self._get_llm().bind(num_predict=120)
            llm_msg = await scorer_llm.ainvoke(prompt.format_messages(**prompt_vars))
            response_metadata = getattr(llm_msg, "response_metadata", {}) or {}
            input_tokens = float(response_metadata.get("prompt_eval_count", 0) or 0)
            output_tokens = float(response_metadata.get("eval_count", 0) or 0)
            raw_content = llm_msg.content
            content_text = raw_content if isinstance(raw_content, str) else json.dumps(raw_content)
            try:
                scored_raw = _parse_scoring_json(content_text)
            except ValueError:
                parse_repair_used = 1.0
                # One-shot repair request: ask the model to convert its own output
                # into a strict JSON array so we avoid unnecessary fallback.
                repair_prompt = (
                    f"JSON array [{{\"ai_score\":0-100,\"tags\":[]}}] from:\n\n{content_text}"
                )
                repair_llm = self._get_llm().bind(num_predict=120)
                repair_msg = await repair_llm.ainvoke(repair_prompt)
                repair_meta = getattr(repair_msg, "response_metadata", {}) or {}
                input_tokens += float(repair_meta.get("prompt_eval_count", 0) or 0)
                output_tokens += float(repair_meta.get("eval_count", 0) or 0)
                repair_raw = repair_msg.content
                repair_text = repair_raw if isinstance(repair_raw, str) else json.dumps(repair_raw)
                scored_raw = _parse_scoring_json(repair_text)

            results = []
            for i, item in enumerate(scored_raw):
                if i >= len(enriched): break
                base = {
                    **enriched[i],
                    "ai_score": int(item.get("ai_score", 50)),
                    "tags":     item.get("tags", []),
                }
                try:    results.append(ScoredProperty(rank=i+1, **base))
                except Exception:
                    s, t = _rule_based_score(enriched[i], strategy)
                    results.append(ScoredProperty(rank=i+1, **{**enriched[i],"ai_score":s,"tags":t}))

        except Exception as exc:
            await _publish_langsmith_eval(
                {
                    "rule_fallback": 1.0,
                    "input_tokens": 0.0,
                    "output_tokens": 0.0,
                    "json_repair": parse_repair_used,
                },
                comment=(
                    f"reason=exception:{type(exc).__name__}:{str(exc)[:120]},"
                    f"strategy={strategy},mortgage_rate={mortgage_rate}"
                ),
            )
            # Ollama down or timed out — silent fallback
            return self._rule_score(enriched, strategy)

        results.sort(key=lambda x: x.ai_score, reverse=True)
        for i, r in enumerate(results): r.rank = i + 1

        n = len(results)
        if n > 0:
            ui_correctness = _score_correctness_ui(results)
            await _publish_langsmith_eval(
                {
                    "avg_score": _safe_mean([float(r.ai_score) for r in results]),
                    "rule_fallback": 0.0,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "json_repair": parse_repair_used,
                    **ui_correctness,
                },
                comment=f"strategy={strategy}, mortgage_rate={mortgage_rate}",
            )
        return results

    def _rule_score(self, enriched: list[dict], strategy: str) -> list[ScoredProperty]:
        results = []
        for i, prop in enumerate(enriched):
            s, t = _rule_based_score(prop, strategy)
            results.append(ScoredProperty(rank=i+1, **{**prop, "ai_score": s, "tags": t}))
        results.sort(key=lambda x: x.ai_score, reverse=True)
        for i, r in enumerate(results): r.rank = i + 1
        return results

    @traceable(name="netflow.market_summary")
    async def market_summary(
        self, zip_code: str, budget: int, strategy: str,
        top_picks: list[ScoredProperty], mortgage_rate: float
    ) -> str:
        if DEMO_MODE:
            summary = _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)
            await _publish_langsmith_eval(
                {
                    "word_count": float(len(summary.split())),
                    "rule_fallback": 1.0,
                    "input_tokens": 0.0,
                    "output_tokens": 0.0,
                },
                comment=f"reason=demo_mode,zip={zip_code},strategy={strategy}",
            )
            return summary
        try:
            prompt = self._get_summary_prompt()
            prompt_vars = _summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate)
            summary_llm = self._get_llm().bind(num_predict=90)
            llm_msg = await summary_llm.ainvoke(prompt.format_messages(**prompt_vars))
            response_metadata = getattr(llm_msg, "response_metadata", {}) or {}
            input_tokens = float(response_metadata.get("prompt_eval_count", 0) or 0)
            output_tokens = float(response_metadata.get("eval_count", 0) or 0)
            raw_content = llm_msg.content
            summary = _sanitize_summary_text(
                raw_content if isinstance(raw_content, str) else str(raw_content)
            )
            word_count = len(summary.split())
            groundedness = _score_groundedness_ui(
                summary=summary,
                zip_code=zip_code,
                budget=budget,
                mortgage_rate=mortgage_rate,
                top_picks=top_picks,
            )
            await _publish_langsmith_eval(
                {
                    "word_count": float(word_count),
                    "rule_fallback": 0.0,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    **groundedness,
                },
                comment=f"zip={zip_code}, strategy={strategy}",
            )
            return summary
        except Exception as exc:
            summary = _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)
            await _publish_langsmith_eval(
                {
                    "word_count": float(len(summary.split())),
                    "rule_fallback": 1.0,
                    "input_tokens": 0.0,
                    "output_tokens": 0.0,
                },
                comment=f"reason=exception:{type(exc).__name__},zip={zip_code},strategy={strategy}",
            )
            return summary

    @traceable(name="netflow.stream_market_summary")
    async def stream_market_summary(
        self, zip_code: str, budget: int, strategy: str,
        top_picks: list[ScoredProperty], mortgage_rate: float
    ) -> AsyncIterator[str]:
        import asyncio

        if DEMO_MODE:
            summary = _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)
            groundedness = _score_groundedness_ui(
                summary=summary,
                zip_code=zip_code,
                budget=budget,
                mortgage_rate=mortgage_rate,
                top_picks=top_picks,
            )
            await _publish_langsmith_eval(
                {
                    "word_count": float(len(summary.split())),
                    "rule_fallback": 1.0,
                    "input_tokens": 0.0,
                    "output_tokens": 0.0,
                    **groundedness,
                },
                comment=f"reason=demo_mode,zip={zip_code},strategy={strategy}",
            )
            for word in summary.split(" "):
                yield word + " "
            return

        try:
            from langchain_core.output_parsers import StrOutputParser
            prompt = self._get_summary_prompt()
            summary_llm = self._get_llm().bind(num_predict=90)
            chain = prompt | summary_llm | StrOutputParser()
            chunks: list[str] = []
            async for chunk in chain.astream(
                _summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate)
            ):
                chunks.append(chunk)
                yield chunk

            summary = _sanitize_summary_text("".join(chunks))
            groundedness = _score_groundedness_ui(
                summary=summary,
                zip_code=zip_code,
                budget=budget,
                mortgage_rate=mortgage_rate,
                top_picks=top_picks,
            )
            await _publish_langsmith_eval(
                {
                    "word_count": float(len(summary.split())),
                    "rule_fallback": 0.0,
                    "input_tokens": 0.0,
                    "output_tokens": 0.0,
                    **groundedness,
                },
                comment=f"zip={zip_code}, strategy={strategy}",
            )
        except asyncio.CancelledError:
            # Streaming client disconnected.
            return
        except Exception as exc:
            summary = _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate)
            groundedness = _score_groundedness_ui(
                summary=summary,
                zip_code=zip_code,
                budget=budget,
                mortgage_rate=mortgage_rate,
                top_picks=top_picks,
            )
            await _publish_langsmith_eval(
                {
                    "word_count": float(len(summary.split())),
                    "rule_fallback": 1.0,
                    "input_tokens": 0.0,
                    "output_tokens": 0.0,
                    **groundedness,
                },
                comment=f"reason=exception:{type(exc).__name__},zip={zip_code},strategy={strategy}",
            )
            for word in summary.split(" "):
                yield word + " "

    async def property_chat(
        self,
        property_data: dict,
        mortgage_rate: float,
        messages: list[dict[str, str]],
    ) -> str:
        user_question = ""
        for message in reversed(messages):
            if message.get("role") == "user":
                user_question = message.get("content", "").strip()
                break

        if DEMO_MODE:
            return _rule_property_chat(property_data, mortgage_rate, user_question)

        try:
            from langchain_core.prompts import ChatPromptTemplate

            prompt = ChatPromptTemplate.from_messages([
                ("system", PROPERTY_CHAT_SYSTEM),
                ("human", "{property_context}\n\nConversation:\n{conversation}"),
            ])
            prompt_vars = {
                "property_context": _property_chat_context(property_data, mortgage_rate),
                "conversation": _conversation_text(messages),
            }
            chat_llm = self._get_llm().bind(num_predict=140)
            llm_msg = await chat_llm.ainvoke(prompt.format_messages(**prompt_vars))
            raw_content = llm_msg.content
            answer = raw_content if isinstance(raw_content, str) else json.dumps(raw_content)
            answer = answer.strip()
            return answer or _rule_property_chat(property_data, mortgage_rate, user_question)
        except Exception:
            return _rule_property_chat(property_data, mortgage_rate, user_question)


# ── Helpers ───────────────────────────────────────────────────

def _summary_vars(zip_code, budget, strategy, top_picks, mortgage_rate) -> dict:
    top     = top_picks[0] if top_picks else None
    avg_cap = round(sum(p.cap_rate  for p in top_picks) / len(top_picks), 1) if top_picks else 0
    avg_cf  = round(sum(p.cash_flow for p in top_picks) / len(top_picks))    if top_picks else 0
    return {
        "zip_code":       zip_code,
        "budget":         budget,
        "strategy":       strategy,
        "strategy_label": STRATEGY_LABELS.get(strategy, strategy),
        "mortgage_rate":  mortgage_rate,
        "top1_addr":      top.address   if top else "N/A",
        "top1_price":     top.price     if top else 0,
        "top1_cap":       top.cap_rate  if top else 0,
        "top1_cf":        top.cash_flow if top else 0,
        "top1_score":     top.ai_score  if top else 0,
        "avg_cap":        avg_cap,
        "avg_cf":         avg_cf,
        "n_props":        len(top_picks),
    }


def _rule_summary(zip_code, budget, strategy, top_picks, mortgage_rate) -> str:
    if not top_picks:
        return "No properties found. Try a higher budget or different filters."
    top   = top_picks[0]
    label = STRATEGY_LABELS.get(strategy, strategy)
    avg_cap = _safe_mean([p.cap_rate for p in top_picks])
    avg_cf  = int(_safe_mean([p.cash_flow for p in top_picks]))
    return (
        f"{zip_code} shows {label} potential: avg cap {avg_cap}%, "
        f"${avg_cf}/mo CF at {mortgage_rate}% rate. "
        f"Top: {top.address} ${top.price:,} — {top.cap_rate}% cap, "
        f"${top.cash_flow}/mo CF, {top.ai_score}/100 AI score."
    )


def _property_chat_context(property_data: dict, mortgage_rate: float) -> str:
    p = _compute_financials(property_data, mortgage_rate)
    down = round(p["price"] * 0.20)
    loan = p["price"] - down
    tax_ins = round(p["price"] * 0.015 / 12)
    annual_cf = p["cash_flow"] * 12
    coc = round((annual_cf / down) * 100, 2) if down > 0 else 0.0
    break_even = round((p["est_rent"] * 0.35) + (p["est_rent"] - p["cash_flow"]))
    return (
        f"Addr {p.get('address', 'Unknown')} | ZIP {p.get('zip_code', '')}\n"
        f"Price ${p.get('price', 0):,} | {p.get('beds', 0)}bd/{p.get('baths', 0)}ba | "
        f"{p.get('sqft', 0):,} sqft | DOM {p.get('dom', 0)}\n"
        f"Rent ${p.get('est_rent', 0):,}/mo | Cap {p.get('cap_rate', 0)}% | "
        f"CF ${p.get('cash_flow', 0)}/mo | GRM {p.get('grm', 0)}x | Score {p.get('ai_score', 0)}/100\n"
        f"Rate {mortgage_rate}% 30yr | Down ${down:,} | Loan ${loan:,} | "
        f"Tax+Ins ${tax_ins}/mo | Break-even ${break_even}/mo | CoC {coc}%\n"
        f"Tags: {', '.join(p.get('tags', [])) or 'None'}"
    )


def _conversation_text(messages: list[dict[str, str]]) -> str:
    recent_messages = [
        message
        for message in messages
        if message.get("role") in {"user", "assistant"} and message.get("content", "").strip()
    ][-6:]
    return "\n".join(
        f"{message.get('role', 'user').title()}: {message.get('content', '').strip()}"
        for message in recent_messages
    )


def _rule_property_chat(property_data: dict, mortgage_rate: float, question: str) -> str:
    p = _compute_financials(property_data, mortgage_rate)
    q = question.lower()
    down = round(p["price"] * 0.20)
    annual_cf = p["cash_flow"] * 12
    coc = round((annual_cf / down) * 100, 2) if down > 0 else 0.0

    if any(word in q for word in ("cash flow", "breakdown", "income", "expense")):
        return (
            f"- Rent is about ${p['est_rent']:,}/mo.\n"
            f"- Net cash flow is about ${p['cash_flow']}/mo after financing and a 35% expense load.\n"
            f"- That is roughly ${annual_cf:,}/year on a ${down:,} down payment."
        )

    if any(word in q for word in ("good deal", "worth it", "buy", "deal")):
        verdict = "looks investable for a demo screen" if p["cash_flow"] > 0 and p["cap_rate"] >= 5 else "looks weak unless there is upside the demo data is not showing"
        return (
            f"This property {verdict}. It is showing a {p['cap_rate']}% cap rate, "
            f"${p['cash_flow']}/mo cash flow, and an AI score of {p.get('ai_score', 0)}/100."
        )

    if "25%" in q and "down" in q:
        down_25 = round(p["price"] * 0.25)
        loan_25 = p["price"] - down_25
        r = mortgage_rate / 100 / 12
        n = 360
        pi_25 = loan_25 * (r * (1 + r) ** n) / ((1 + r) ** n - 1) if r > 0 else loan_25 / n
        piti_25 = round(pi_25 + p["price"] * 0.015 / 12)
        cf_25 = int(p["est_rent"] - piti_25 - p["est_rent"] * 0.35)
        return (
            f"At 25% down, cash flow would improve to about ${cf_25}/mo. "
            f"Your down payment rises to about ${down_25:,}, so this mainly trades more cash in for more monthly cushion."
        )

    if "vacancy" in q:
        stressed_rent = round(p["est_rent"] * 0.90)
        stressed_cf = int(stressed_rent - (p["est_rent"] - p["cash_flow"]))
        return (
            f"With a 10% vacancy hit, effective rent drops to about ${stressed_rent}/mo and "
            f"cash flow moves to roughly ${stressed_cf}/mo."
        )

    if any(word in q for word in ("risk", "risks", "concern", "downside")):
        risks = []
        if p["cash_flow"] <= 0:
            risks.append("monthly cash flow is already negative")
        if p["cap_rate"] < 5:
            risks.append("cap rate is thin for a margin-of-safety deal")
        if p.get("dom", 0) > 45:
            risks.append("long days on market can point to weak demand or pricing friction")
        if not risks:
            risks.append("the demo does not include HOA, maintenance surprises, or neighborhood risk")
        return "Main risks: " + "; ".join(risks) + "."

    if any(word in q for word in ("cash-on-cash", "coc", "return")):
        return f"Cash-on-cash return is about {coc}% using a ${down:,} down payment and current demo assumptions."

    if any(word in q for word in ("hoa", "school", "crime", "appreciation", "rehab", "tax history")):
        return "That detail is not available in this demo dataset. I’d verify it with the listing, county records, and local market comps before making a real decision."

    return (
        f"For this property, the clearest signals are {p['cap_rate']}% cap rate, "
        f"${p['cash_flow']}/mo cash flow, and a {p.get('ai_score', 0)}/100 AI score. "
        f"If you want, ask for cash flow, risks, vacancy stress, or a higher-down-payment scenario."
    )

# NetFlow — Team Demo Script by Role
## Hackathon Live Pitch (5 minutes total)

**Team:**
- **Manoj Kuppam** – Product Manager (opening, problem/solution, market narrative)
- **Narendra Kalli** – Backend Engineer (agent architecture, API, fallbacks)
- **Annapurna Mondeddu** – UI/UX Designer (demo navigation, user experience, feedback)
- **Ratnaveni** – Observability (tracing, quality signals, LangSmith insights)

---

## **[OPENING — 0:00–0:20]**

**SPEAKER: MANOJ (Product Manager)**

*[On camera, speaking directly to judges]*

**"Good morning. I'm Manoj, and I want to start with a problem that affects 5 million real estate investors in the US.**

**Finding investment-grade properties takes weeks. You're jumping between Zillow, RentCast, property tax websites, mortgage calculators. By the time you analyze 10 properties, half the deals are gone.**

**NetFlow solves this. We built an AI investment analyst that takes a natural-language search—*'Show me cash-flowing duplexes under $300k in Dallas with good rent growth'*—and in seconds returns ranked properties with investment scores, financial projections, risk flags, and market intelligence.**

**But here's what makes us different: This runs locally. No external AI costs. No vendor lock-in. And if the AI gets slow, the system doesn't break—it falls back to rule-based scoring silently.**

**Let me show you the product. Narendra will walk through the architecture, Annapurna will show the UI, and Ratnaveni will show you the observability layer.**

*[Hand off to Annapurna for frontend demo]*

---

## **[DEMO PART 1: FRONTEND & UX — 0:20–1:30]**

**SPEAKER: ANNAPURNA (UI/UX Designer)**

*[Share screen, show NetFlow frontend]*

**"I'm Annapurna. You're looking at the NetFlow dashboard. Let me walk you through the user experience.**

### **Step 1: Search Input (0:20–0:35)**

*[Point to SearchPanel]*

**"This is where it starts. You type a natural-language query. The backend instantly validates it through 6 security layers—no injection attacks get through.**

Let me search: *'3+ bedroom houses under $400k in Dallas, cash flow focused'*"

*[Type the query and hit Enter]*

**"Watch what happens next."**

---

### **Step 2: Real-Time Results (0:35–1:00)**

*[Results stream in over SSE]*

**"Results are streaming in real-time. No waiting. Each property card shows:**
- **Address, price, estimated rent, days-on-market**
- **Cap rate (green if >6%, orange if 4.5-6%, blue otherwise)**
- **Monthly cash flow (green if positive, red if negative)**
- **Three NEW quality signals—see those colored dots and labels?**"

*[Point to the quality pills]*

**"Groundedness (90), Correctness (88), Confidence (85). These tell you: 'Is the AI reasoning grounded in real data? Did it calculate financials accurately? How sure is the model?'**

**As a designer, we wanted transparency. Investors need to know when to trust the AI and when to do their own due diligence.**

---

### **Step 3: Feedback Loop (1:00–1:15)**

*[Click on a property card to show the 👍/👎 buttons]*

**"See the thumbs-up and thumbs-down? This is the feedback loop. When you vote, we capture:**
- Your vote (up/down)
- The property rank, address, and AI score
- Optional comment

**Click one."**

*[Demonstrate clicking thumbs-up]*

**"If you change your mind and resubmit, it overwrites. This teaches the system over time. That's how we iterate based on real investor decisions.**

**Let me show you conversational mode next."**

---

### **Step 4: PropertyChat (1:15–1:30)**

*[Click into a property, open PropertyChat]*

**"Click into a property. Now you're in PropertyChat—a conversational mode. Ask it a question, and it remembers context about THIS property.**

*[Type a question]*

**'What if I put 15% down instead of 20%?'**

**Watch it recalculate PITI, property taxes, insurance, update the cash flow projection. All grounded in real market data. No hallucinations.**

**Everything you see—every answer, every calculation—is traceable in our observability layer. Ratnaveni will show you that next."**

*[Hand off to Narendra for architecture]*

---

## **[DEMO PART 2: AGENT ARCHITECTURE — 1:30–3:00]**

**SPEAKER: NARENDRA (Backend Engineer)**

*[Can share screen with architecture diagram or live code]*

**"I'm Narendra. Let me show you how the backend works. NetFlow runs a four-agent orchestrated pipeline.**

### **Pipeline Overview (1:30–1:50)**

```
UserAgent (security) 
    ↓
MarketAnalyst (fetch rates, rents, trends)
    ↓
PropertyScorer (rank properties by strategy)
    ↓
RiskAdvisor (flag risks, generate warnings)
    ↓
LangSmith (trace every decision)
```

**Each agent has a specific job. They share a request-scoped context so later stages see all prior decisions.**

---

### **Stage 1: User Agent (1:50–2:05)**

**"First, UserAgent validates input. Six layers:**

1. **Length check** – Reject >500 chars
2. **Encoding validation** – UTF-8, no null bytes
3. **25 injection patterns** – SQL, shell, LLM jailbreak, HTML/JS, unicode tricks
4. **Intent classifier** – Is this a search? Chat? Market data? Nonsense?
5. **NLP extractor** – Parse ZIP, budget, beds, strategy from raw text
6. **Router** – Send to appropriate downstream pipeline

**Raw user text never reaches an LLM. Only structured `ValidatedRequest` objects do.**

---

### **Stage 2: Market Analyst Agent (2:05–2:20)**

**"MarketAnalyst fetches live data: mortgage rates from FRED, rents from RentCast.**

**Here's the optimization: 5-turn sliding window cache per ZIP.**

- First search for Dallas? Fetch market data (hits APIs)
- Second search for Dallas within 15 minutes? Reuse cached data (no API calls)
- This cuts latency and API costs

**Memory design:**
```
MarketMemory = {
  "75070": {
    rate: 7.2,
    avg_rent: 1850,
    vacancy: 6.5%,
    ttl: 900s  // 15 minutes
  }
}
```

**The agent runs LLM to generate market narrative: supply trends, growth signals, neighborhood decay indicators.**

---

### **Stage 3: Property Scorer Agent (2:20–2:35)**

**"PropertyScorer is where AI shines.**

**Batch efficiency: We score 10 properties in ONE LLM call, not 10 separate calls.**

**Payload:**
```json
[
  {
    "address": "123 Main St",
    "price": 350000,
    "est_rent": 1800,
    "beds": 3,
    "baths": 2,
    "dom": 14
  },
  // 9 more properties
]
```

**The LLM returns:**
- ai_score (0–100)
- strategy_note (why this property fits)
- risk_level (LOW/MED/HIGH)
- tags (cashflow_positive, good_roi, tight_market, etc.)

**We're disciplined about tokens: ~250 tokens per stage. Total request: ~850 tokens.**

---

### **Stage 4: Risk Advisor Agent (2:35–2:50)**

**"RiskAdvisor flags property and market risks.**

**Property risks:**
- High DOM (days on market) – why hasn't it sold?
- Price jumps – flip or speculation?
- HOA fees – eating cash flow?

**Market risks:**
- Tight supply – competition driving prices up
- High vacancy – tenant demand problem
- Negative rent growth – declining market

**Cross-request caching: Risk profiles stored 1-hour per ZIP.**

- First request: Compute market risk profile (LLM call)
- Second request same ZIP: Reuse profile (sub-50ms)

---

### **Deterministic Fallbacks (2:50–3:00)**

**"Here's what separates us from others: Ollama goes down, the system doesn't break.**

**Every LLM stage has a silent rule-based equivalent:**

- MarketAnalyst: Hardcoded avg rates, rent growth curves by ZIP
- PropertyScorer: Excel-style cap rate formula + heuristic ranking
- RiskAdvisor: Regex-based risk flagging

**User gets the same output structure. Same quality. System keeps running.**

**That's reliability."**

*[Hand off to Ratnaveni for observability]*

---

## **[DEMO PART 3: OBSERVABILITY & QUALITY SIGNALS — 3:00–4:15]**

**SPEAKER: RATNAVENI (Observability)**

*[Can show LangSmith dashboard or observability metrics]*

**"I'm Ratnaveni. I own observability. Every request, every agent decision is traced and traceable.**

### **LangSmith Span Tree (3:00–3:25)**

**"When you search for properties, here's what we capture in LangSmith:**

```
Request: search_stream
├─ Stage: UserAgent
│  ├─ tool: validate_input (12ms)
│  ├─ tool: sanitize (4ms)
│  ├─ tool: classify_intent (8ms)
│  └─ output: SEARCH intent, ZIP=75070, budget=400k
├─ Stage: MarketAnalyst
│  ├─ tool: get_rate (245ms) [cache miss]
│  ├─ tool: get_rents (312ms) [cache miss]
│  └─ output: MarketContext (rate=7.1, avg_rent=1850, vacancy=6.2%)
├─ Stage: PropertyScorer
│  ├─ tool: batch_score_10 (1850ms)
│  ├─ tokens_used: 245
│  └─ output: [ScoredProperty x 10]
├─ Stage: RiskAdvisor
│  ├─ tool: flag_risks (1200ms)
│  ├─ tokens_used: 198
│  └─ output: RiskProfile[] + memo
└─ Total latency: 3.8s (warm cache)
```

**Each tool call is timestamped, logged with args/results, and tied to the parent request.**

---

### **User Feedback Loop (3:25–3:45)**

**"When a user clicks thumbs-up on a property, we send:**

```json
{
  "run_id": "run_12345",
  "vote": "up",
  "rank": 1,
  "address": "123 Main St",
  "model_score": 87,
  "comment": "Closed deal on this one!"
}
```

**LangSmith stores it as feedback on that run. We can now query:**
- Which properties did users actually close on?
- Which AI scores correlated with real outcomes?
- Is our model calibrated or too optimistic?

**That's how we iterate. User signal → product improvement.**

---

### **Quality Confidence Signals (3:45–4:00)**

**"See those quality pills in the UI? Groundedness, Correctness, Confidence—these come from LangSmith too.**

- **Groundedness (80+):** Is the reasoning grounded in real data or hallucinated?
- **Correctness (88+):** Did we calculate financials accurately?
- **Confidence (85+):** How sure is the model about this ranking?

**If any signal is low, investors should do their own due diligence. That's transparency.**

---

### **Operational Maturity (4:00–4:15)**

**"From an observability standpoint:**

- ✅ **Span trees** for every request (debug any issue)
- ✅ **Latency tracking** (find slow stages)
- ✅ **Token usage per stage** (optimize costs)
- ✅ **Fallback detection** (know when LLM is unavailable)
- ✅ **User feedback loop** (learn from real outcomes)
- ✅ **Structured logging** with request IDs
- ✅ **Debug log file rotation** (don't lose logs)

**This is production-grade observability. Teams at huge companies struggle to get here.**

**We built it at a hackathon."**

*[Hand off back to Manoj for closing]*

---

## **[CLOSING & TEAM SUMMARY — 4:15–5:00]**

**SPEAKER: MANOJ (Product Manager)**

*[Back on camera]*

**"Let me recap what you just saw:**

**Annapurna's UI** shows real-time results, quality signals, and a feedback loop that teaches the system.

**Narendra's backend** is a 4-agent orchestrated pipeline that runs locally, caches aggressively, and falls back gracefully when the LLM is slow.

**Ratnaveni's observability** traces every decision, captures user feedback, and provides the quality signals investors need.

**Why this matters for judges:**

| Category | Our Approach |
|----------|--------------|
| **Agent Design (35%)** | 4-stage pipeline, shared context, memory at every layer |
| **AI/LLM (35%)** | Local Ollama, batch scoring, deterministic fallbacks, quality signals |
| **Infrastructure (10%)** | Docker Compose, SSE streaming, FastAPI, database persistence |
| **Observability (10%)** | LangSmith tracing, user feedback loop, quality confidence scores |
| **Security (10%)** | 6-layer input guard, 25 injection patterns, audit logging |

**We didn't build a prototype. We built a product that a real estate investor would deploy tomorrow and use every day.**

**NetFlow: Know your net. Grow your portfolio.**

Thank you."

*[End demo]*

---

## **TRANSITION GUIDE**

**Safe handoff phrases between speakers:**

| From | To | Phrase |
|------|-----|--------|
| Manoj → Annapurna | "Let me show you the product. Annapurna will walk you through the interface." |
| Annapurna → Narendra | "That's the user-facing experience. Let me show you the AI engine underneath. Narendra?" |
| Narendra → Ratnaveni | "Every decision is observable and traceable. Ratnaveni, show them the LangSmith dashboard." |
| Ratnaveni → Manoj | "That's production-grade observability built in from day one. Let me wrap up." |

---

## **TIMING BREAKDOWN**

```
Manoj (Opening & Setup)           0:00 – 0:20   (20s)
Annapurna (Frontend Demo)         0:20 – 1:30   (70s)
  - Search input                    0:20 – 0:35
  - Real-time results               0:35 – 1:00
  - Feedback loop                   1:00 – 1:15
  - PropertyChat                    1:15 – 1:30
Narendra (Agent Architecture)     1:30 – 3:00   (90s)
  - Pipeline overview               1:30 – 1:50
  - UserAgent stage                 1:50 – 2:05
  - MarketAnalyst stage             2:05 – 2:20
  - PropertyScorer stage            2:20 – 2:35
  - RiskAdvisor stage               2:35 – 2:50
  - Fallback logic                  2:50 – 3:00
Ratnaveni (Observability)         3:00 – 4:15   (75s)
  - LangSmith span tree             3:00 – 3:25
  - User feedback loop              3:25 – 3:45
  - Quality signals                 3:45 – 4:00
  - Operational maturity            4:00 – 4:15
Manoj (Closing)                   4:15 – 5:00   (45s)
```

---

## **ROLE-BY-ROLE PREP CHECKLIST**

### **MANOJ (Product Manager)**
- [ ] Memorize opening problem statement (30 seconds)
- [ ] Know the 4 judging categories by heart
- [ ] Practice smooth handoffs to Annapurna, Narendra, Ratnaveni
- [ ] Closing statement ready (45 seconds)

### **ANNAPURNA (UI/UX Designer)**
- [ ] Frontend is running and responsive (test before demo)
- [ ] Practice typing the search query smoothly
- [ ] Point to quality pills clearly (use mouse pointer)
- [ ] Show PropertyChat conversation flows
- [ ] Be ready to explain design choices ("We wanted transparency...")

### **NARENDRA (Backend Engineer)**
- [ ] Know the 4-agent pipeline cold
- [ ] Have architecture diagram or code ready to share
- [ ] Memorize memory structures (MarketMemory TTL, cache hit/miss)
- [ ] Token budget numbers (~850 total, ~250 per stage)
- [ ] Fallback logic demo ready (or just explain clearly)

### **RATNAVENI (Observability)**
- [ ] LangSmith dashboard access ready (or screenshot)
- [ ] Explain span tree structure clearly
- [ ] Have an example user feedback payload ready
- [ ] Know quality confidence score ranges by heart
- [ ] Emphasis on "production-grade observability"

---

## **BACKUP PLAN (If Something Breaks)**

| Issue | Solution |
|-------|----------|
| Frontend won't load | Annapurna: "Let me show you a recorded demo instead. As you can see..." (use backup screenshots) |
| Search results don't stream | Narendra: "The SSE pipeline is working here; let me show you the backend logs..." |
| LangSmith dashboard unavailable | Ratnaveni: "We have detailed metrics; let me walk you through the JSON structure..." |
| Ollama is offline | Narendra: "This is exactly when our fallback kicks in—rule-based scoring takes over silently" (show fallback code) |

---

## **KEY PHRASES TO HIT EACH CATEGORY**

### **Agent Design (35%)**
- "Four-agent orchestrated pipeline"
- "Shared AgentContext passes through all stages"
- "Memory at every layer: market cache, conversation memory, risk profiles"
- "Deterministic fallbacks at every stage"

### **AI/LLM Implementation (35%)**
- "Local Ollama—no external LLM calls"
- "Batch scoring: 10 properties in one call"
- "Quality confidence signals: Groundedness, Correctness, Confidence"
- "~850 tokens per request, disciplined token budget"

### **Infrastructure (10%)**
- "Docker Compose, 4 services + init sidecar"
- "SSE streaming for real-time results"
- "FastAPI with health checks and CORS"
- "Database persistence for logins, search history, favorites"

### **Observability (10%)**
- "LangSmith tracing on every request"
- "User feedback loop: thumbs-up/down feeds back into LangSmith"
- "Quality signals visible in UI"
- "Request ID tracking across all logs"

### **Security (10%)**
- "6-layer input guard"
- "25 regex patterns catching injection attacks"
- "Rate limiting per session"
- "Audit logging for every request"

---

## **FINAL REHEARSAL CHECKLIST**

Before you present tomorrow:

**Day-of morning:**
- [ ] All services running: `make dev` or `docker-compose up -d`
- [ ] Health checks passing: `curl http://localhost:8000/health`
- [ ] Frontend loads: `http://localhost:3000`
- [ ] Ollama running: `ollama list`
- [ ] .env set to `DEMO_MODE=true` for consistent results

**30 minutes before demo:**
- [ ] Run a test search to warm caches
- [ ] Close all other apps/notifications
- [ ] Camera/audio/screen test
- [ ] All 4 team members do sound check

**5 minutes before demo:**
- [ ] Manoj: Opening statement ready
- [ ] Annapurna: Ready to share screen
- [ ] Narendra: Ready to explain pipeline
- [ ] Ratnaveni: Ready to show observability
- [ ] Backup plan reviewed

**Start recording:**
- [ ] Manoj takes opening shot (on camera)
- [ ] Annapurna shares screen
- [ ] Demo flows as scripted
- [ ] Smooth handoffs between speakers
- [ ] Narendra explains architecture (can show diagram or live code)
- [ ] Ratnaveni wraps up observability
- [ ] Manoj closing remarks

**GOOD LUCK TOMORROW! 🚀**

---

## **SUMMARY: WHO SAYS WHAT**

| Time | Speaker | Topic |
|------|---------|-------|
| 0:00–0:20 | Manoj | Problem + Solution framing |
| 0:20–1:30 | Annapurna | Frontend demo (search, results, feedback, chat) |
| 1:30–3:00 | Narendra | Backend architecture (4 agents, caching, fallbacks) |
| 3:00–4:15 | Ratnaveni | Observability (LangSmith, tracing, quality signals) |
| 4:15–5:00 | Manoj | Recap + closing |

**Each person has a clear role. Each transition is smooth. Judges see the full team.**

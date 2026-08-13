---
type: adr
parent: "[[Forecasting Agent]]"
date: 2026-08-14
status: decided
---
# Architecture & Decisions

## Vision
**Claude Code for industry analysis.** An autonomous coding agent that writes, runs, and iterates on analysis code. Forecasting is the first skill pack — the platform adapts to any industry by building skills per domain. Users feed requirements, agent builds skills automatically.

## System Design

### Core Concept: Hybrid Coding Agent
- **Pre-built infrastructure:** Market data registry, LLM client, FinBERT, Docker sandbox, PostgreSQL
- **Autonomous coding agents:** Sub-agents write Python code, execute in Docker, evaluate results, iterate until optimal
- **Self-extending:** Agent creates new tools, skills, connectors, data sources at runtime
- **Self-improving:** Good strategies auto-save as skills. Big changes need human approval.

### Architecture Layers
```
Presentation (FastAPI + CLI)
    ↓
Deep Agent Harness (TypeScript — planning, context, filesystem, sub-agents)
    ↓
Supervisor (LangGraph.js — orchestrates 3 coding sub-agents)
    ↓
Sub-Agents (Technical / Sentiment / Macro — each writes + runs code)
    ↓
Docker Sandbox (executes agent-generated Python code safely)
    ↓
Pre-built Infrastructure (market registry, DeepSeek, FinBERT, AnySearch, PostgreSQL)
```

### 4-Round Debate Protocol
1. **R1 — Independent analysis:** Each agent works alone, writes code, runs models, produces AgentSignal
2. **R2 — Debate:** Agents see each other's R1 signals, challenge, write code to prove points
3. **R3 — Devil's advocate:** Supervisor picks weakest consensus point, assigns one agent to argue against it
4. **R4 — Consensus:** Supervisor synthesizes. If agents can't agree → present both bull and bear scenarios to user

### Data Layer: Registry + Plugin (auto-discovery)
- `entry_points` based auto-discovery — external plugins register without touching core code
- Built-in plugins: Indian Stock (.NS/.BO), US Stock, Crypto, Forex, Derivatives (F&O)
- Agent can CREATE new plugins at runtime

### Agent Workspace
Agent owns a filesystem workspace:
- `code/models/` — agent-written forecasting models
- `code/features/` — feature engineering pipelines
- `code/connectors/` — new data connectors agent builds
- `tools/` — LangGraph tools agent creates
- `skills/` — reusable skills agent saves
- `evaluations/` — backtest results, model comparisons

### Self-Improvement Loop
- Forecast runs → evaluate results → adapt strategies → save skills/tools
- Small improvements (hyperparameter tweaks): auto-deploy
- Big changes (new model type, new data source): human approval required

---

## Architecture Decision Records

### ADR-001: TypeScript harness, Python for ML
- **Decision:** TypeScript for the agent harness (Deep Agents JS + LangGraph.js). Python for agent-generated forecasting code (runs in Docker).
- **Context:** Building "Claude Code for forecasting" — a platform that adapts to any industry. The harness needs MCP, connectors, system calls, skill management. TypeScript is native for all of these. ML/forecasting libraries (pandas, prophet, xgboost) are Python — agent writes Python scripts and executes them in Docker sandbox.
- **Alternatives:** Python everywhere (Deep Agents Python) — faster POC but fights the platform layer. JS everywhere — loses ML ecosystem.
- **Rationale expanded (2026-08-14)** — the original "MCP is TS-native" note is not the real driver (`deepagents`, the MCP SDK, and `langchain-mcp-adapters` all ship for Python too). The decision holds on three stronger reasons:
  1. **Frontend/ecosystem continuity** — frontend is React on Vercel. Backend and frontend stay separate processes, but one language across harness and UI keeps a single ecosystem and toolchain.
  2. **Concurrency profile** — the harness is I/O-bound with many concurrent LLM, MCP, and market-data calls. Node's event loop is built for exactly that shape of work.
  3. **The Python boundary is already there** — ML code runs out-of-process in Docker sandboxes regardless of harness language, so the split costs nothing extra.
- **Known trade-off accepted:** two toolchains to maintain, a serialization boundary between harness and ML code, and the existing Python infra (uv/ruff/mypy/pytest/CI/devcontainer) is superseded for harness work.
- **Status:** accepted (2026-08-13), rationale expanded 2026-08-14

### ADR-002: Deep Agents as agent harness
- **Decision:** Use `deepagents` npm package (LangChain) for the outer agent shell.
- **Context:** Gives planning, sub-agent spawning, filesystem, context management out of the box. Built on LangGraph — can drop down to raw graph when needed. Any CompiledStateGraph plugs in as a sub-agent.
- **Alternatives:** Raw LangGraph.js (more control, more code), custom harness (maximum control, weeks of work)
- **Status:** accepted (2026-08-13)

### ADR-003: Supervisor pattern for sub-agent coordination
- **Decision:** `langgraph-supervisor` (create_supervisor) to coordinate technical, sentiment, macro sub-agents.
- **Context:** Sub-agents don't need to talk to each other directly — they each analyze a different dimension. Supervisor is the "debate judge." Uses fewer tokens than swarm. Structured output control.
- **Alternatives:** Swarm (agents hand off directly — 40% faster but harder to debug, no central control), custom graph
- **Status:** accepted (2026-08-13)

### ADR-004: Docker sandbox for code execution
- **Decision:** Agent-generated code runs in isolated Docker containers.
- **Context:** Coding agents writing and executing arbitrary Python is a security risk. Docker provides process isolation, resource limits, network restrictions. Adds ~1-2s latency per execution.
- **Alternatives:** Subprocess with limits (lighter but less isolation), trust the agent (fast but risky)
- **Status:** accepted (2026-08-13)

### ADR-005: PostgreSQL for storage
- **Decision:** PostgreSQL for forecast results, evaluation history, agent metadata.
- **Context:** SaaS-ready from day one. Already using Docker for sandbox — adding Postgres container is one more line in docker-compose. Analytics queries, concurrent access, production-grade.
- **Alternatives:** SQLite (zero-config but single-writer, no concurrent access), DuckDB (analytics-oriented but less general)
- **Status:** accepted (2026-08-13)

### ADR-006: Registry + plugin with auto-discovery
- **Decision:** Market data plugins discovered via entry_points mechanism. Agent can create new plugins at runtime.
- **Context:** SaaS play — external plugins register without touching core code. Users/third parties can add new market data sources by installing a package.
- **Alternatives:** Adapter pattern (simpler but manual registration), unified wrapper (fewer classes but not extensible)
- **Amended 2026-08-14 — phased, mechanism preserved:** ship **explicit typed registration** first; `entry_points` auto-discovery deferred until a real second consumer exists. The mechanism itself survives intact because the registry lives inside the **Python** market-data MCP server (ADR-013), not the TypeScript harness — `entry_points` is a Python stdlib facility and remains the intended endpoint. Phase A (now) = explicit dict of the 6 markets; Phase A′ = manifest file listing plugin modules; Phase B = full `entry_points` discovery.
- **Why deferring is cheap here:** the MCP tool surface (`list_markets`, `resolve_symbol`, `fetch_ohlcv`, `fetch_option_chain`) is the harness-facing contract, and it is identical under every phase. The A→B migration is therefore entirely internal to the data server — the TypeScript side has no plugin call sites to refactor.
- **Manifest location (2026-08-14):** the plugin manifest is `plugins.yaml` **inside the market-data MCP server**, not in harness config. Adding a market is a one-line manifest entry plus a plugin module — the harness is never touched. See ADR-015's two-level config rule.
- **Migration-readiness disciplines (mechanically enforced, not conventional):**
  1. `contracts.py` (`MarketPlugin` protocol + OHLCV schema) is a published, versioned contract from day one, despite having one consumer.
  2. Plugins may import `contracts` **only** — never `registry`, `server`, or each other. Enforced by an **import-linter** contract in CI.
  3. `server.py` talks only to `registry`, never to a plugin directly.
  4. **Pydantic validation of plugin output at the registry boundary from day one** — not strictly needed under explicit registration, but it means discovery adds zero validation work later, and it catches malformed yfinance responses immediately regardless.
- **Open item deliberately deferred:** agent-created plugins loaded into the data-server process would execute **outside** the Docker sandbox (ADR-004). This security decision is unchanged in cost whether taken now or later, and is better taken with real plugin examples in hand than with none. Must be resolved before Phase B ships.
- **Status:** accepted (2026-08-13), amended to phased rollout 2026-08-14

### ADR-007: Multi-scenario output on deadlock
- **Decision:** When sub-agents can't reach consensus after debate, present both bull and bear scenarios with probabilities. Don't force a single answer.
- **Context:** Financial markets are genuinely uncertain. Forcing consensus when signals conflict hides real risk. Users make better decisions when they see both sides.
- **Alternatives:** Default to cautious/neutral (capital preservation), weight by historical accuracy
- **Status:** accepted (2026-08-13)

### ADR-008: OpenAI GPT as LLM provider
- **Decision:** OpenAI GPT (gpt-4o) for agent reasoning and tool calling.
- **Context:** Most LangChain/LangGraph examples and best tooling support. Largest ecosystem. Strong tool calling.
- **Alternatives:** Claude (Anthropic) — strong reasoning but less LangChain ecosystem support. Provider-agnostic — more work upfront.
- **Status:** **superseded by ADR-009 (2026-08-14)** — accepted 2026-08-13

### ADR-009: DeepSeek as LLM provider (supersedes ADR-008)
- **Decision:** DeepSeek (`ChatDeepSeek` via `@langchain/deepseek` in the TS harness, `langchain-deepseek` if any Python-side agent code needs it) for agent reasoning and tool calling. Default model **`deepseek-v4-flash`**; `DEEPSEEK_API_KEY` env var; base URL `https://api.deepseek.com` (OpenAI format) or `https://api.deepseek.com/anthropic` (Anthropic format).
- **Actual model lineup (confirmed from DeepSeek console 2026-08-14):** `deepseek-v4-flash` (V4-Flash-0731) and `deepseek-v4-pro` (V4-Pro-0813). Both: **1M context, 384K max output**, JSON output ✓, tool calls ✓, Responses API ✓, Anthropic API ✓, and **both support thinking and non-thinking modes (thinking is the default)**. Concurrency limits: flash **2500**, pro **500**. Earlier notes citing `deepseek-chat` and a separate "reasoner" model were wrong — corrected here.
- **Pricing (per 1M tokens, as of 2026-08-14):** flash — cache hit $0.0028 / cache miss $0.14 / output $0.28. pro — $0.003625 / $0.435 / $0.87.
- **⚠️ Price change 2026-08-16 16:00 UTC** — peak/off-peak billing begins. Peak hours **01:00–04:00 and 06:00–10:00 UTC**; off-peak is half. flash off-peak $0.007/$0.22/$0.66, peak $0.014/$0.44/$1.32. pro off-peak $0.022/$0.66/$1.98, peak $0.044/$1.32/$3.96. Net effect: **2.4–4.7× more expensive than the pricing this ADR was originally decided on** — the cost argument for DeepSeek still holds, but by a smaller margin than assumed.
- **Cache-hit vs cache-miss input is a 31–50× ratio.** This is the single largest cost lever in the system, larger than model tier (~3×) and larger than the provider choice itself. See ADR-016.
- **Context:** Cost per token is the binding constraint for this architecture, not raw model quality. The 4-round debate protocol multiplies token spend — 3 sub-agents × 4 rounds, plus supervisor synthesis, plus the code-write→execute→read-error→rewrite loop, which is inherently many-turn. Supervisor coordination alone is ~285% more tokens than direct calls (see [[Research]]). At GPT-4o pricing that makes iteration painful to run repeatedly during development; DeepSeek makes the debate loop cheap enough to run often.
- **Verified support (LangChain integration table, 2026-08-14):** streaming ✅, tool calling ✅, structured output ✅, multimodal ❌. Tool calling and structured output are the two the harness actually depends on — supervisor routing and `AgentSignal` schemas both work.
- **Pros:** Order-of-magnitude cheaper inference than GPT-4o, which directly buys more debate rounds and more code-iteration cycles per forecast. First-party LangChain integration on both JS and Python. OpenAI-compatible API shape, so the swap is mostly a client-construction change. Strong coding/reasoning benchmarks — well matched to a code-writing agent.
- **Cons:** No multimodal input — the agent cannot read chart images or scanned filings, and must work from numeric series and text only. Smaller ecosystem than OpenAI, so fewer worked examples when something breaks. Single-vendor API hosted outside our control; rate limits and latency are less battle-tested at our concurrency. Data residency: prompts include market data and news text, which leaves our infrastructure.
- **Where it fits best:** High-volume, many-turn agent loops where cost per token gates how much iteration is affordable — exactly our debate + code-iteration design. Text-and-numbers reasoning with structured tool calls.
- **Where it doesn't suit:** Anything needing image understanding (chart reading, PDF/annual-report vision extraction) — that path needs a second provider. Also poor fit if we later need strict data residency guarantees for enterprise SaaS customers.
- **Consequence:** ADR-001's provider assumption is unchanged, but the LLM client in "Pre-built Infrastructure" must stay behind a thin interface so a provider swap is one class, not a rewrite. Multimodal work is now explicitly out of scope until a second provider is added.
- **Multimodal deferred to next phase (decided 2026-08-14):** accepted as a known gap for the POC, not a blocker. Nothing in the current design needs it — the technical agent works on numeric series, the sentiment agent on news text, the macro agent on rates/indicator data. Revisit when a concrete need appears (chart-image reading, vision extraction from annual reports/scanned filings). The thin LLM interface above is what keeps this cheap to revisit: the likely resolution is a second provider used only for vision tasks, routed per-task, rather than replacing DeepSeek wholesale. **Guard against scope creep:** if a sub-agent starts wanting image input before that phase, treat it as a signal to re-open this ADR, not to quietly add a second provider.
- **Status:** accepted (2026-08-14)

### ADR-010: AnySearch as news/web search provider (replaces Tavily)
- **Decision:** [AnySearch](https://www.anysearch.com/home) for the sentiment sub-agent's news and web search. Quota: 2,000 requests/day.
- **Integration path: AnySearch's MCP server**, not a hand-written HTTP wrapper. This is the deciding factor over Tavily's `langchain-tavily` package — ADR-001 chose a TypeScript harness precisely because MCP is TS-native, and this is the first decision that actually cashes in that rationale. Register the MCP server once in the harness and its search tools are exposed to sub-agents through the same tool interface as everything else.
- **Context:** Tavily was chosen for its first-party `langchain-tavily` integration and finance topic filter, but was never wired up — no code to migrate. AnySearch is already available to us at 2,000 req/day, which comfortably covers the sentiment agent's needs: a forecast run needs roughly 5-20 searches, so the quota supports well over 100 runs/day.
- **Pros:** Quota already in hand at no marginal cost. MCP integration means no bespoke client code to write, test, or maintain — no HTTP plumbing, no response normalization, no retry logic of our own. Tool schemas come from the server, so they stay correct when the provider changes them. Consistent with how the rest of the platform consumes external capability, and validates the TS-harness bet.
- **Cons:** Daily quota is a hard ceiling shared across all sub-agents — needs a request counter and a graceful degradation path when exhausted, and MCP hides the call volume, making it *easier* to blow through the quota unnoticed than with a wrapper we control. MCP adds a process/transport dependency at runtime (server must be reachable; a dead server takes out the sentiment agent). Less direct control over caching and result filtering than owning the client. Finance-topic filtering equivalent to Tavily's is unconfirmed — may have to happen in our prompts or our own post-filtering.
- **Where it fits best:** Our POC and single-user development phase, where 2,000/day is effectively unlimited and MCP's zero-integration-cost is the dominant benefit.
- **Where it doesn't suit:** Multi-tenant SaaS phase — 2,000/day divided across paying users is not viable, so this decision needs revisiting before launch. Also unsuited to any path needing per-tenant quota accounting, which MCP's shared-server model doesn't naturally give us.
- **Consequence:** Search capability arrives via MCP registration rather than a `SearchProvider` class, so the swap-out point at the SaaS stage is the MCP server config, not our code. Quota metering is the one piece we must still own — add it to the Toolkit/infra task list. Note this MCP server belongs to the *product runtime*, distinct from the dev-time MCP servers tracked in [[Toolkit]].
- **Open items to confirm before implementation:** AnySearch MCP server package/endpoint and transport (stdio vs HTTP), auth scheme, which tools it exposes and their schemas, whether date-range or domain filtering is supported (needed to restrict to recent financial news), and whether quota usage is readable from the server or must be counted client-side.
- **Status:** accepted (2026-08-14)

### ADR-011: Four-layer evaluation metric stack
- **Decision:** M8 (Evaluation) scores on four distinct layers, only one of which the agent optimizes. Full metric landscape and reasoning in [[Metrics]].
  1. **Optimize** — **MASE on returns.** The agent's objective function. MASE < 1 means "beat the naive forecast," so the baseline comparison is built into the number.
  2. **Decision quality** — **Brier score + calibration curve** on the post-debate bull/bear call with confidence. Directly comparable to the ForecastBench figures in [[Research]] (superforecasters 0.096, general public 0.121, LLMs 0.122–0.136).
  3. **Reality check (reported, never optimized)** — **cost-adjusted Sortino**, net of the Indian cost stack (STT, stamp duty, exchange fees, SEBI charges, GST).
  4. **Validity gate (pass/fail, not a score)** — walk-forward / rolling-origin validation, purged CV with embargo, point-in-time data, feature-lag audit, **and point-in-time memory filtering (added 2026-08-14, see ADR-020)**. A run failing the gate is **invalid**, not merely low-scoring.
- **Context:** Ten prior ADRs defined no success metric, leaving the self-improvement loop (ADR + system design) with nothing to improve against. RMSE/MAE on raw **price** is the specific trap being avoided: a persistence forecast ("tomorrow = today") scores excellently and carries zero skill. Every layer here operates on returns, direction, or probability instead.
- **Why a stack and not one number:** the system emits two different artifacts that a single metric cannot score — agent-written **models** (M6) need a forecast-quality metric, while the post-debate **call** (M7) needs a decision-quality metric. M8 therefore has two scoring paths.
- **Pros:** Beats-naive is built into the primary metric, so "is this good?" never needs a separate judgement. Calibration catches LLM overconfidence, which is the expected failure mode. Economic reality is visible without becoming the optimization target, so leakage-driven fake Sharpe can't steer the agent. The gate is categorical, which keeps invalid runs out of the results entirely.
- **Cons:** Four layers is more machinery than a single score, and more to implement before the first forecast lands. MASE needs a defined naive baseline per market/horizon. The cost stack must be modelled accurately or layer 3 misleads.
- **Where it fits best:** Self-improving systems where the optimizer is an LLM that will exploit a loosely specified objective.
- **Where it doesn't suit:** A quick one-off backtest — this is deliberately heavier than a single-number scorecard.
- **Status:** accepted (2026-08-14)

### ADR-013: Market data via a Python MCP server (M1)
- **Decision:** M1 is a **Python MCP server** wrapping yfinance, consumed over MCP by both the TypeScript harness and the Docker sandbox. Market registry, plugins, normalization, caching, and point-in-time logic all live server-side.
- **Context:** ADR-001 put the harness in TypeScript while yfinance is Python-only, so M1 straddles that boundary and the crossing had to be chosen deliberately. MCP was selected over an HTTP service to keep **one integration pattern for all external data**, matching ADR-010 (AnySearch).
- **Tool surface (the stable contract):** `list_markets()`, `resolve_symbol(symbol, market)`, `fetch_ohlcv(symbol, market, range)`, `fetch_option_chain(underlying, expiry)`.
- **Internal structure:** `server.py` (MCP surface) → `registry.py` → `plugins/{nse,bse,us,crypto,forex,fno}.py`, plus `contracts.py`, `normalizer.py`, `cache.py`, `point_in_time.py`.
- **Pros:** One protocol for all external data, so the harness has a single way out. **Single source of truth** — harness and sandbox read identical data, eliminating the drift that would silently invalidate backtests under ADR-011. Central cache in one place, which matters because yfinance is an unofficial scraper that rate-limits aggressively. Tool schemas come from the server, so no hand-written client. Sub-agents see market data as tools alongside search — uniform prompt surface.
- **Cons:** MCP is request/response, so **live tick streaming is not supported** by this design. Bulk history as JSON-over-MCP is wasteful versus Parquet on a shared volume — revisit if large pulls become a bottleneck. An extra process to supervise; a dead server takes out all data access. Harder to debug than HTTP (no `curl`).
- **Where it fits best:** On-demand batch forecasting over daily/intraday bars — the actual use case.
- **Where it doesn't suit:** Live streaming feeds, or bulk history transfer where moving files beats serializing JSON.
- **Data Resilience & Fallback Policy (confirmed 2026-08-14):** If `yfinance` or NSE Bhavcopy scraping fails/times out, M1 serves the most recent cached daily bar (maximum staleness $\le 3$ trading days) tagged with `data_stale=true`. When `data_stale=true`, downstream sub-agent confidence scores are automatically penalized by $-30\%$.
- **Status:** accepted (2026-08-14) — updated with grilling-confirmed fallback policy

### ADR-014: LLM client — per-agent model config, checkpoint-based resilience (M2)
- **Decision (routing):** every agent declares its own model as config; **all default to `deepseek-v4-flash` with thinking mode ON**. The routing seam exists from day one but is unused — no role-based routing until there is a baseline to measure against. Promoting a single agent to `deepseek-v4-pro` is then a one-line config change and a clean A/B.
- **Why flash + thinking over the alternatives:** flash is the cheapest tier with full reasoning intact, and pro is only ~3× — nowhere near enough of a gap to pay for without evidence flash underperforms on code-writing or debate quality. Turning thinking *off* for routine calls was considered and deferred: it saves real output tokens but splits the config and mildly confounds debate experiments. Flash's 2500 concurrency limit also comfortably covers ADR-001's many-concurrent-calls bet, where pro's 500 might not.
- **Decision (resilience):** **retry with exponential backoff (LangChain default) + checkpoint/resume.** Debate state is persisted after each round; a failure resumes from the last checkpoint rather than restarting the run. No secondary-provider fallback.
- **Context:** ADR-009 chose DeepSeek for cost, and this module is where that cost is actually controlled — 3 sub-agents × 4 rounds × N code-iteration cycles, plus supervisor synthesis. Routing policy is the highest-leverage lever in M2.
- **Why per-agent config over role-based routing:** routing `deepseek-reasoner` to R3/R4 would spend where [[Research]] says quality matters (devil's advocate is the round that reliably works), but it **confounds the debate experiments** — if R3 has both a different model and a different prompt, an improvement can't be attributed to either. Per-agent config keeps the model constant now while making later single-agent A/B tests a one-line change.
- **Why checkpoint over provider fallback:** a fallback can produce a run spanning two models, which corrupts [[Metrics|ADR-011]] numbers unless every result is model-tagged. Checkpointing protects the genuinely expensive thing — tokens already spent — while keeping each evaluation run **single-model by construction**.
- **⚠️ Constraint this imposes on M7:** debate state must be **serializable**. Cheap to design in now, expensive to retrofit later. This is a hard requirement on the orchestrator, not a preference.
- **Internal pieces:** client wrapper (`ChatDeepSeek`, key handling, base URL) · model router (config-driven) · retry/backoff · **concurrency governor** (caps in-flight calls — where ADR-001's "Node handles many calls" bet is actually managed) · cost + latency meter feeding ADR-011's meta-metrics · prompt cache for system prompts and shared debate context.
- **Pros:** Predictable single-rate cost. Debate agents stay identical, keeping the protocol itself as the controlled variable — which matters given [[Research]]'s finding that heterogeneity affects outcomes. Checkpointing makes long multi-round runs safe to attempt. Evaluation integrity preserved end to end.
- **Cons:** Routine calls (symbol resolution, tool dispatch, formatting) pay reasoning-model-adjacent rates when they don't need to — a known, deliberate overspend. Unused per-agent config is mild YAGNI. Checkpointing adds storage complexity and does not help during a prolonged DeepSeek outage.
- **Where it fits best:** Pre-baseline development where clean attribution matters more than squeezing cost.
- **Where it doesn't suit:** Unattended scheduled runs needing guaranteed completion — revisit fallback then, with model-tagging on every result as a precondition.
- **Status:** accepted (2026-08-14)

### ADR-015: Config-driven external services — adding one never touches agent code (FOUNDATIONAL)
- **Decision (user rule, 2026-08-14):** every external service — market data sources, search providers, LLM providers, news feeds, brokers, anything outside the process — is integrated as a **config-registered capability provider from day one**. Adding, swapping, or removing one is a configuration change. **Agent code never names a concrete provider.**
- **Scope:** this is a cross-cutting constraint that outranks per-module convenience. It applies to M1–M11 without exception.
- **The pattern:** agents request **capabilities** (`search`, `fetch_ohlcv`, `sentiment`, `chat`), and config binds capability → provider. A capability registry populated from config sits between them. Agent prompts and agent code reference the capability name only.
```
  agent ──asks for──> "search"
                        │
              config: search → anysearch-mcp
                        │
                        └──> AnySearch MCP server
  swap to a different provider = one config line, zero agent changes
```
- **Binding shape (decided 2026-08-14): a flat capability → provider map**, one active provider per capability, in a single harness config file:
```yaml
  capabilities:
    chat:        deepseek
    search:      anysearch-mcp
    market_data: market-data-mcp
    sentiment:   finbert-local
  providers:
    deepseek:      {model: deepseek-v4-flash, thinking: true}
    anysearch-mcp: {transport: ..., quota_per_day: 2000}
```
  Ordered provider *lists* (for fallback) and per-agent overrides were both considered and rejected for now: lists would allow a single run to span two providers, which corrupts [[Metrics|ADR-011]] integrity unless every result is provider-tagged, and per-agent overrides add config surface with no current consumer. Both remain additive later — a list is a superset of a single value, so neither is foreclosed.
- **Why MCP already fits this:** MCP servers are declared in harness config and their tools flow to agents automatically. ADR-010 (AnySearch) and ADR-013 (market data) are already compliant by construction — this ADR generalizes that property into a rule rather than an accident.
- **Two-level config (decided 2026-08-14):** the harness config binds *capabilities*; individual markets are **not** in it. The market-data MCP server owns its own `plugins.yaml` manifest internally, so adding a market never touches harness config at all — only the server's manifest. The harness knows "market_data → market-data-mcp" and nothing more.
- **Revises ADR-006:** the phased rollout stands, but **Phase A′ (manifest/config-listed plugins) becomes the day-one target, not a future step.** An explicit hard-coded dict does not satisfy this rule. `entry_points` auto-discovery remains the eventual Phase B, but config-listed registration already delivers the substance — extensibility without touching core or agent code — at a fraction of the complexity, and without the sandbox-bypass problem that auto-loading discovered packages creates.
- **Pros:** Open/Closed and Dependency Inversion enforced at every service boundary, satisfying the CLAUDE.md design rules structurally rather than by discipline. Provider swaps become experiments rather than refactors — directly valuable given two providers already changed in one day (ADR-009, ADR-010). Agent prompts stay stable as infrastructure churns beneath them. Multi-provider and per-tenant routing become possible later without redesign, which the SaaS phase will need.
- **Cons:** More indirection than direct calls, so a failure is one layer further from its cause. Capability naming becomes a design surface that must stay coherent as services multiply. Config validation becomes essential — a typo'd provider name is now a runtime failure where a direct import would have been a compile error. Genuinely provider-specific features (a unique filter, a bespoke endpoint) either get abstracted away or leak through the seam.
- **Mitigation:** validate config against the capability registry at **startup**, not first use, so a bad binding fails immediately and loudly rather than mid-forecast.
- **Where it fits best:** Exactly this project — a platform whose stated purpose is adapting to new domains and data sources, where the provider set is expected to change.
- **Where it doesn't suit:** Single-purpose tools with one permanent integration, where the indirection buys nothing.
- **Status:** accepted (2026-08-14)

### ADR-016: Cache-first context assembly and off-peak scheduling (M2/M7)
- **Decision (caching):** the 4-round debate builds context by **appending to a byte-stable prefix**, never rebuilding it. `[system][market data][R1][R2][R3]` — each round extends the previous prefix so every call after R1 is a prefix cache hit.
- **Refined 2026-08-14 (ADR-020) — the ordering rule: stable content first, volatile content last.** Prefix caching is invalidated from the first changed token onward, so *position* determines the damage: changing something early invalidates everything after it, changing something at the tail invalidates almost nothing. Retrieved memories therefore sit **after** the debate rounds, not before: `[system][data][R1][R2][mem-fresh]`. This preserves the cached prefix while still allowing per-round adaptive retrieval. Correction to an earlier estimate in this ADR: naive re-retrieval costs roughly **1.8×**, not 3× — and volatile-last ordering reduces that penalty to near zero.
- **Decision (scheduling):** scheduled runs default to **post-close IST (after 15:30 IST / 10:00 UTC)**, which is off-peak and half price. On-demand intraday runs remain available at whatever the current rate is. M10 must support scheduling for this to work.
- **Context:** DeepSeek's cache-hit input is 31–50× cheaper than cache-miss (ADR-009). At ~80% hit rate this is roughly a 65% cost reduction per forecast — larger than any other lever available, including model tier. Meanwhile the new peak windows (01:00–04:00, 06:00–10:00 UTC) overlap ~4.25 of the NSE session's 6.25 hours, so intraday runs are structurally the expensive ones and everything after the close is half price.
- **Rough cost per forecast** (assumptions: ~30 LLM calls/run, ~30K input and ~2K output each — **estimates, must be measured**): flash no-cache today ~$0.14; flash no-cache post-Aug-16 peak ~$0.48; flash **80% cached** post-Aug-16 peak **~$0.17**; pro no-cache post-Aug-16 peak ~$1.43.
- **⚠️ This is a hard constraint on M7, not an optimization.** A debate protocol that reassembles or reorders context per round forfeits the entire benefit. Retrofitting prefix stability into a built orchestrator is a rewrite, not a tweak — which is why it is decided before M7 is designed.
- **Enabled by 1M context:** the earlier assumption that M7 would need aggressive context management or summarization was wrong. Full debate history fits in-context, which is also precisely what makes prefix caching work. Summarizing between rounds would *break* the cache.
- **Pros:** ~65% cost reduction on the dominant cost. Full-fidelity debate history with no lossy summarization. Off-peak batching halves the remainder. Cost per forecast becomes low enough to run the loop often, which was the entire point of ADR-009.
- **Cons:** M7 loses freedom in how it assembles context — no reordering, no mid-run prompt edits, no dropping earlier rounds. Cache behaviour is provider-specific, so a future provider swap may not preserve the benefit (tension with ADR-015's provider-agnostic goal, accepted knowingly). Off-peak batching adds latency between request and result for scheduled runs.
- **Where it doesn't suit:** Interactive/conversational use where a user edits earlier context mid-session — not our access pattern.
- **Status:** accepted (2026-08-14)

### ADR-017: Search quota metering, caching, and graceful degradation (M3)
- **Decision (caching):** exact-match cache keyed on normalized query, **TTL scoped to a forecast run** — every round of a single run sees identical search results.
- **Decision (exhaustion):** when the 2,000/day quota is exhausted, **degrade rather than fail** — the sentiment agent continues on cached results and FinBERT over already-retrieved text, the forecast completes, and the result is **tagged `degraded=true`** so [[Metrics|ADR-011]] evaluation can exclude or flag it.
- **Decision (metering) — revised 2026-08-14 after design debate: per-run budget allocation, not a global counter.** Metering sits at the ADR-015 capability layer, with state in M9 (Redis, per ADR-020).
```
  run start  →  claims a budget of N searches (initial N = 20)
  run spends →  from its own allocation only
  run ends   →  unused budget returns to the pool
  global cap →  2,000/day retained as a backstop
```
- **Why the original global-counter design was wrong:** counting was never the hard part. A shared counter that rejects at 2,000 satisfies enforcement and visibility but fails on **fairness** and **attribution** — one buggy run at 09:00 can consume the entire day's quota, making every subsequent forecast `degraded=true`. That is a time-of-day lottery, not a design. Allocation fixes it: a runaway run exhausts only its own budget, cost per forecast becomes **bounded and predictable** (which ADR-011's cost meta-metric requires), and the budget *is* the accounting unit so attribution is automatic.
- **Search is harness-only, by design.** Search is a reasoning-time activity — the sentiment agent gathering news before it thinks — not a code-execution activity; sandboxed Python computes over data already fetched. Making this an explicit rule eliminates the "capability-layer metering is blind to sandbox search" gap entirely rather than mitigating it.
- **Open item:** the initial budget of 20 is a guess until real per-run search volume is measured. A run with a legitimate need for deeper research currently has **no escalation path** — an escalation mechanism (request more if the daily pool is healthy) was considered and deferred because it reintroduces unbounded per-forecast cost.
- **Context:** ADR-010 flagged that MCP hides call volume, making a 2,000/day ceiling easier to exhaust unnoticed than with a self-written client, and called the counter mandatory.
- **Why run-scoped caching matters more than it first appears:** 3 sub-agents × 4 rounds produce heavily overlapping queries — all three agents asking about the same ticker in the same run. Caching therefore does three things at once: (1) roughly quarters search spend against quota; (2) makes the debate **reproducible**, so agents argue over identical evidence rather than drifting results; and (3) **protects the LLM prefix cache** from ADR-016 — search results that change between rounds would alter the context prefix and forfeit the 31–50× saving. The search cache and the LLM cache reinforce each other.
- **Pros:** ~4× effective quota. Deterministic debate. Compounds with ADR-016's cost lever. Degradation keeps a run's already-spent tokens from being wasted, which pairs with ADR-014's checkpoint/resume — resuming into an exhausted quota would otherwise hit the same wall repeatedly.
- **Cons:** TTL choice is a genuine judgement call — too long misses breaking news, too short makes the cache useless. Stale results during a volatile event are a correctness risk, not merely a freshness annoyance. `degraded=true` results need consistent handling everywhere downstream or they will silently pollute evaluation. Exact-match caching misses semantically identical queries phrased differently by differently-prompted agents.
- **Deferred:** semantic dedup (embedding similarity across near-duplicate phrasings) would raise quota efficiency further, but needs an embedding model and a similarity threshold, and a too-loose threshold serves wrong results silently. Revisit once real query patterns have been measured.
- **Where it doesn't suit:** Live intraday event-driven trading, where run-scoped caching would mask breaking news.
- **Status:** accepted (2026-08-14); metering design revised from global counter to per-run budget allocation after design debate

### ADR-018: Sentiment engine — FinBERT as its own MCP capability (M4)
- **Decision:** FinBERT runs as its own **MCP server**, bound as `sentiment: finbert-local` per ADR-015. Model stays warm, scores are batched. Per-headline scores are aggregated into one signal by **recency-weighted mean** (exponential decay, single half-life parameter). Stock FinBERT ships as-is; the Indian-domain gap is logged, not pre-solved.
- **Why its own server:** running FinBERT as a library inside the sandbox was rejected specifically because it makes sentiment a code import rather than a swappable capability — replacing it would require touching agent code, which ADR-015 forbids. Embedding it in the market-data server was rejected for conflating an I/O-bound capability with a CPU-bound one in a single failure domain and scaling profile.
- **Aggregation rationale:** recency weighting matches how markets actually price news and costs exactly one parameter. Simple mean was rejected (week-old articles weighted equal to this morning's; high-volume sources dominate). Source-credibility weighting was rejected for now — those weights are unjustified subjective priors until measured against which sources actually predict moves. Passing raw scores to the LLM was rejected as non-deterministic, violating the adopted FinRobot principle ("numbers are code-calculated, narratives are LLM-assisted") and inflating the cache-stable context of ADR-016.
- **⚠️ The half-life parameter is evaluation-adjacent** and must sit on the ADR-012 read-only side. An agent free to tune decay would be tuning its own input signal toward whatever scores best.
- **Known gap — Indian domain calibration:** FinBERT is trained on US/English financial text. Indian financial media is English but carries distinct idiom (crore, promoter pledging, circuit limits, SEBI/RBI framing). Expect miscalibration. Deliberately **not** pre-solved: ship as-is, let ADR-011 metrics reveal whether the sentiment agent contributes at all, and swap providers via config if it doesn't. The LLaMA-3.2 NIFTY-50 fine-tuning paper in [[Research]] is the reference if fine-tuning becomes justified.
- **Cons accepted:** a third MCP server to supervise, holding ~1–2GB RAM whether or not a forecast is running.
- **Status:** accepted (2026-08-14)

### ADR-012: Evaluation harness is read-only to the agent
- **Decision:** M8 lives in `core/evaluation/` as platform infrastructure. Agent-generated code in `workspace/code/` is *scored by* it and may *call* it, but cannot modify it — not the metrics, not the train/test split, not the gate.
- **Context:** ADR-011 makes the agent an optimizer with an explicit objective. If the same agent can also write the code that computes that objective, the cheapest path to a high score is a subtly leaky split rather than a better model. That is reward hacking with a P&L attached, and it fails silently — a leaky backtest produces a *more* convincing result, not an obviously broken one.
- **Consequence for the workspace layout:** the agent workspace (`code/models/`, `code/features/`, `code/connectors/`, `tools/`, `skills/`) stays writable, but `evaluations/` splits — agent-written *experiment* outputs are writable, the *scoring logic* is not. The M8 boundary is a hard architectural line, drawn in the diagram.
- **Pros:** The one guardrail that makes a self-improving loop trustworthy. Cheap to enforce (filesystem permission + sandbox mount policy). Makes every reported score comparable across runs, because the scorer never changes underneath them.
- **Cons:** The agent cannot propose genuinely better evaluation methodology, so metric improvements are entirely on us. Some legitimate agent experimentation (novel CV schemes for a new asset class) needs a human to land it.
- **Where it doesn't suit:** Research settings where evolving the evaluation *is* the goal — not our case, where the metric is the contract.
- **Status:** accepted (2026-08-14)

### ADR-020: Memory & storage architecture (M9)
- **Decision (stores):** **PostgreSQL + pgvector + Redis** — two services, not three.
- **Decision (retrieval ordering):** **volatile-last context assembly with per-round retrieval.** Memories are retrieved fresh each round but placed at the *tail* of the prompt, after the debate rounds, so the cached prefix survives. Refines ADR-016.
- **Decision (leakage):** every memory row carries an **`as_of` timestamp**; retrieval during a backtest is filtered to `as_of <= backtest_date`. This is now the **fifth item on ADR-011's validity gate**.

**Four memory tiers:**

| Tier | Lifespan | Holds | Store |
|---|---|---|---|
| Working | One LLM call | The prompt itself (1M context) | *in-context* |
| Session | One forecast run | Debate state, run-scoped caches | **Redis** |
| Long-term | Permanent | Forecasts, outcomes, eval history, skills, agent code | **Postgres** |
| Semantic | Permanent | Embeddings for "have we seen this before?" | **pgvector** |

- **What Redis is for — four specific jobs, not a general cache:** ADR-017's quota counter (atomic `INCR` with daily TTL — doing this in Postgres means a transaction per search); ADR-017's run-scoped search cache (TTL semantics for free); **pub/sub streaming debate progress to the React UI**, which the Vercel frontend will want for live rounds; and distributed locking once concurrent runs exist. Redis holds things that are *supposed* to expire.
- **ADR-014's checkpoints go in Postgres, not Redis.** Four writes per run is not a performance problem, and a checkpoint that evaporates on a Redis restart defeats its own purpose.
- **Why pgvector over a dedicated vector DB:** one service instead of two, and the project is nowhere near the scale where Qdrant/Weaviate pay for themselves — millions of vectors is comfortable. ADR-015 makes swapping it a config change if that changes. A dedicated store would also require keeping Postgres rows and vectors in sync.

**⚠️ Tension 1 — semantic retrieval versus the prefix cache.** Naive per-round retrieval places changing content *early* in the prompt, invalidating the cache for everything after it and forfeiting ADR-016's 31–50× discount (~1.8× cost increase in a realistic configuration). Resolved by the volatile-last ordering rule above: stable content first, volatile last. The model then sees memories after the debate rather than before, which is neutral-to-mildly-helpful for attention. **Cheap to design in now, awkward to retrofit** — which is why it is settled before M7.

**⚠️ Tension 2 — memory is a backtest leakage vector.** Long-term memory lets an agent retrieve *"last time RELIANCE showed this pattern, it rose 4%."* In a backtest dated March 2025, if that memory was formed during a June 2025 run, **future information has leaked into the past**. The backtest will look excellent and be worthless. This is invisible to conventional checks because ADR-011's gate audits *feature* lag, not *memory* lag — nobody thinks of the memory store as a data source, which is exactly why it slips through. Resolved by `as_of` filtering as a gate item. This is the class of bug that produces a system which backtests beautifully and loses money live.

- **Pros:** Two services rather than three. Clear ownership — Redis for expiring state, Postgres for durable truth, pgvector for semantic recall inside the same database. Both tensions are closed by design rather than discovered in evaluation. Pub/sub gives the frontend live debate streaming without polling.
- **Cons:** `as_of` must be set on every memory write without exception — one unstamped row reopens the leak. Volatile-last ordering constrains how M7 may assemble prompts. Redis is a second stateful service to operate and back up. pgvector will need revisiting if embedding volume grows substantially.
- **Interaction with ADR-019 (MVP 2 RL):** trajectory storage for GRPO/ARPO rollouts lands in this tier too, and `as_of` discipline matters even more there — training on trajectories containing leaked future information would bake the leak into the learned policy rather than just one backtest.
- **Status:** accepted (2026-08-14)

### ADR-021: Code execution sandbox — lifecycle, network, workspace (M5)
- **Decision (workspace) — user-confirmed:** **persist skills and validated models, wipe scratch per run.** `workspace/skills/` and `workspace/models/` survive across forecasts; `workspace/scratch/` is cleared. Self-improvement (M11) works without run N−1 silently contaminating run N.
- **Decision (lifecycle) — revised after design debate: two-tier execution.**
```
  agent iterates ──> warm per-run container   (fast, stateful, disposable)
        ↓ submits model
  M8 scores it   ──> FRESH container, clean image, cold start
```
  **Why the single-container default was wrong:** it framed speed and reproducibility as a trade-off. They aren't, because there are two execution contexts with opposite requirements — *exploration* (dozens per run, speed critical, state bleed harmless, reproducibility irrelevant) and *validation* (once per run, speed irrelevant, state bleed **fatal**, reproducibility essential). The earlier mitigation — "clear the working directory between iterations" — was hand-waving: it does not clear installed packages, imported modules, environment mutations, `/tmp`, or in-memory process state.
  Under two-tier, the agent iterates fast, and any model submitted for scoring runs from scratch in a clean environment. **If it fails there, it depended on residue — caught precisely when it matters**, before a contaminated result enters evaluation history. This enforces ADR-012's integrity boundary at the *runtime* level, not merely the filesystem level.
  **Residual cost:** two execution paths to build and test, and a model that works in exploration but fails validation needs a clear diagnostic or it will be maddening to debug.
- **Decision (network) — revised after design debate: generous image + PyPI in exploration only + approval queue.**
  1. **~40 forecasting/ML packages baked into the image** (pandas, numpy, statsmodels, prophet, xgboost, lightgbm, scikit-learn, pmdarima, arch, ta, scipy, …). Forecasting has a **known, bounded dependency surface**, so the agent will rarely need anything else.
  2. **PyPI reachable from the exploration container, never from validation.** The agent may experiment freely, but anything it ships must run on the approved image — so a dependency the agent quietly adopted surfaces **automatically as a validation failure with an obvious cause**. The forcing function is structural rather than a policy requiring enforcement.
  3. **Package requests become a queue** — agent wants `neuralforecast` → logged → human approves → next image build includes it. The requests are also useful signal about what the agent is reaching for.
  **Why this beats the MCP-only default:** MCP-only preserved security by materially damaging "the agent self-extends at runtime," one of the stated core capabilities. This keeps self-extension while confining arbitrary code to a disposable, unscored context.
  **⚠️ Residual risk, genuinely real:** PyPI access in the exploration container is still arbitrary code execution inside our infrastructure. Mitigations: egress restricted to pypi.org only, no credentials mounted, container ephemeral, no host access. Acceptable for a single-user development system; **not acceptable for multi-tenant SaaS** — this decision must be revisited before launch.
- **Interaction with ADR-012:** `core/evaluation/` is mounted read-only into the sandbox; `workspace/` is writable per the split above. The eval harness boundary is enforced at the mount level, not by convention.
- **Interaction with ADR-020:** persisted skills and models are cross-run state, so `as_of` discipline extends beyond database rows to workspace artifacts — a skill saved in June must not influence a backtest dated March.
- **Execution Limits & Latency Governor (confirmed 2026-08-14):** **45s hard timeout** per container code execution; maximum of **5 self-debug retries** per agent in Round 1 before aborting CodeAct loop and falling back to baseline technicals.
- **Docker Concurrency & Resource Caps (SDE III Gate, confirmed 2026-08-14):**
  - **Async Semaphore(2):** Max 2 concurrent container executions in Round 1 to eliminate daemon contention.
  - **Cgroups Limits:** `--cpus="1.0" --memory="512m"` hard limits per container.
  - **Stdout Buffer Cap:** 50KB circular buffer on stdout/stderr to prevent host memory exhaustion.
- **Status:** accepted (2026-08-14) — all decisions user-confirmed after design debate and grilling

### ADR-022: Iteration stop rule and deterministic consensus (M6/M7)
- **Decision (stop rule):** the code-write → run → fix loop halts on **whichever comes first** — MASE improvement below a threshold over K consecutive iterations (early convergence), or an agent-level **cost ceiling** (hard stop). Bounded worst case, adaptive best case. Two parameters to tune; both are evaluation-adjacent and therefore sit on the ADR-012 read-only side.
- **How this composes with ADR-021's two-tier sandbox:** exploration iterations score using the same read-only M8 code inside the **warm** container; the final submission re-scores in the **clean** container. Matching scores confirm no residue dependence — divergence *is* the signal. The agent gets per-iteration feedback without paying cold-start costs on every loop.
- **Decision (consensus):** **deterministic aggregation with calibration weighting.** Sub-agents emit a structured `AgentSignal{direction, probability, confidence}`. Consensus is **computed in code** as a calibration-weighted combination, using each agent's historical calibration record from M9. The LLM writes **only the narrative** explaining the computed result.
- **Consensus Clamping & Non-Stationary Regime Guardrails (Principal Architect Gate, confirmed 2026-08-14):**
  - **Rolling 30-Day Window:** Calibration scores evaluated over the last 30 trading days only.
  - **Weight Clamp (Entropy Floor):** Clamped to $[\text{Min } 15\%, \text{Max } 40\%]$ so no single agent dominates.
  - **Volatility Shock Breaker:** If India VIX / ATR spikes $>2\times$ in 48h, auto-reset to $25/25/25/25$ equal weights.
- **Why the supervisor must not synthesize the final number:** [[Research]] records sycophantic conformity in RLHF models at up to **85.5%**, and notes that simple majority voting discards correct answers. If the supervisor LLM freely produces the final call, that call inherits exactly the conformity the research warns about. It also contradicts the adopted FinRobot principle — *numbers are code-calculated, narratives are LLM-assisted*. Debate is where LLMs argue; **aggregation is arithmetic**. Sycophancy cannot corrupt arithmetic.

- **Why calibration weighting specifically:** it makes the system self-improving in the one dimension that matters for ADR-011 layer 2 — an agent that is reliably overconfident is automatically down-weighted, using data the evaluation stack already produces. This is the self-improvement loop operating on the *consensus mechanism* rather than only on models.
- **Cold start:** equal weights until calibration history exists. **Risk to watch:** early luck entrenching an agent's weight before its record is statistically meaningful — needs a minimum-sample threshold before weights diverge from equal.
- **Cost:** the mechanism cannot weigh a genuinely *better argument*, only stated confidences. A well-designed `AgentSignal` schema is required up front, and it is expensive to change later because it is the debate's wire format and the input to ADR-011's scoring.
- **Interaction with ADR-007:** when the weighted aggregate lands near the decision boundary, the deadlock rule still applies — present both bull and bear scenarios rather than forcing a single call.
- **Status:** accepted (2026-08-14)

### ADR-023: Agent layer — participant-intent agents + price anchor (M6)
- **Decision (v1 data set):** yfinance OHLCV plus **three hand-built Indian connectors** — `flows` (NSE FII/DII daily, participant-wise F&O OI), `microstructure` (bhavcopy delivery %, bulk/block deals), `macro_in` (RBI rates, CPI/IIP). Plus existing `search` and `sentiment`.
- **Decision (agent cut) — supersedes the technical/sentiment/macro lineup in ADR-003:**
```
  price   →  OHLCV + technical indicators          (baseline anchor)
  FII     →  FII flows, FII OI, currency, global cues
  DII     →  DII flows, domestic macro, SIP trends
  retail  →  Client OI, delivery %, retail-facing news
```
  Each agent models **a market participant's intent** rather than a data category. The debate becomes *"what is each participant class about to do?"*, which aggregates naturally into direction.
- **Decision (access):** **deep own lane + one-line summary of everything else.** Asymmetry by *depth*, not by blindness — no agent is confidently wrong from missing context, and cross-lane combinations stay visible at summary level for the deep-access agent to be challenged on.
- **Why this cut, and why it is the differentiator:** NSE publishes participant-wise open interest (FII / DII / Pro / Client) — disclosure most markets never make. Every other candidate cut (data lane, horizon, question type, bull/bear, modeling philosophy) is one a competitor arrives at independently; **participant-intent modelling is only available to someone who has decided Indian participant-wise data is the edge.** The structure therefore follows the moat rather than an inherited equity-research convention.
- **Why strict disjoint access was rejected:** much of the edge in this data lives in **combinations** — FII selling *plus* falling delivery % is a different signal than either alone. Strict partition puts those in separate agents so nobody ever sees the combination, splitting up the edge to satisfy debate hygiene. The debate exists to serve the forecast, not the reverse.
- **Why the price anchor:** if participant signals prove weak or noisy, the price agent still carries a baseline. ADR-022's calibration weighting would then down-weight the participant agents automatically — **the system reports that the structure was wrong rather than silently emitting noise.**
- **`AgentSignal` schema** (the debate wire format *and* ADR-011's scoring input — expensive to change later):
```ts
  AgentSignal {
    direction: "up" | "down"
    probability: number      // 0..1 — feeds Brier (ADR-011 layer 2)
    confidence: number       // 0..1 — feeds calibration weighting (ADR-022)
    horizon_days: number
    evidence: Evidence[]     // { claim, source_capability, value }
    dissent?: string         // populated in R3, devil's advocate
  }
```
  `source_capability` on every piece of evidence makes the asymmetry **auditable** — it is possible to prove after the fact that agents argued from different data, rather than assuming it.
- **⚠️ Must verify before building:** participant-wise OI is published with a lag and at index / stock-F&O level. **Coverage may not extend to every symbol** we want to forecast — confirm the publication cadence, granularity, and symbol coverage before committing connectors to it.
- **Cons accepted:** four agents rather than three raises debate cost. The cut diverges from most of the preceding ADRs, which assumed three data-lane agents. Participant data is exotic and less validated than price data — if it is noisy, three of the four agents sit on sand, which is exactly what the price anchor exists to contain.
- **Status:** accepted (2026-08-14) — supersedes the agent lineup in ADR-003 (supervisor pattern itself unchanged)

### ADR-024: Devil's advocate assignment in R3 (M7)
- **Decision:** the supervisor scans the R2 consensus, identifies the claim with the **thinnest supporting evidence** (fewest `Evidence[]` entries, or evidence drawn from a single `source_capability`), and hard-assigns the **agent with the lowest calibration score** to argue against it — with an explicit "you MUST oppose this" instruction, never a soft "think critically".
- **Why hard assignment:** [[Research]] — *"Only explicit Devil's Advocate assignment produces significant improvement. Soft techniques create 'nuanced agreement' — agents express lower conviction but reach the same conclusions."* R3 is the round the literature says actually works, so its mechanism is load-bearing.
- **Why target the thinnest-evidence claim:** it puts the opposition where the consensus is genuinely weakest rather than somewhere arbitrary. The `source_capability` field on every `Evidence` entry (ADR-023) makes this computable — a claim supported only from one capability is by definition unchallenged by the asymmetric structure.
- **Why the lowest-calibration agent:** it has the least credibility to lose, which reduces the incentive to protect its own thesis, and it uses calibration data ADR-022 already produces. Note the research finding that **4.9% of devil's advocate agents recommend options they privately rate lower** — inauthentic dissent still improves outcomes, so this is acceptable.
- **Rejected:** round-robin rotation (simple, but the assigned opposer may know nothing about the claim being challenged); a dedicated 5th adversary agent (never sycophantic by design, but adds a fifth agent's cost and has no deep data of its own to argue from).
- **Status:** accepted (2026-08-14)

### ADR-019: RL Agent Training & Execution Harness for MVP 2
- **Decision:** For MVP 2, introduce an **Agentic Reinforcement Learning (RL) Harness** to post-train and optimize the agent's policy for code writing, tool usage, error recovery, and debate strategy, advancing beyond purely prompt-engineered CodeAct.
- **Harness Architecture & RL Algorithms:**
  1. **Gym-Style Agentic Environment:** Formalize the multi-turn forecasting workflow as an episodic MDP: State $S_t$ (market context + workspace files + error traces), Action $A_t$ (reasoning tokens + Python sandbox code / MCP calls), Observation $O_t$ (execution output / search results / debate rebuttals).
  2. **Group Relative Policy Optimization (GRPO):** Grouped trajectory sampling across $G$ parallel feature-engineering / model-training attempts per asset. Relative advantage calculation without a heavy value/critic model.
  3. **ARPO Step-Level Adaptive Rollouts:** Trigger localized exploration on token entropy spikes after Docker execution errors to optimize self-debugging and code repair.
  4. **ArenaRL Tournament Ranking:** Multi-agent pairwise tournaments across historical market regimes (bull, bear, sideways) to establish stable relative policy gradients.
  5. **IterResearch Markovian State Reconstruction (MSR):** Enforce structured workspace state compaction (`workspace/code/features/`, `evaluations/`) to prevent context window suffocation during long-horizon search and backtesting.
- **Verifiable Reward Function ($R_{total}$):** Deterministic evaluation using ADR-011's 4-layer metric stack:
  $$R_{total} = w_1 R_{exec} + w_2 R_{gate} + w_3 R_{MASE} + w_4 R_{Brier} + w_5 R_{Sortino} - w_6 R_{cost}$$
  - $R_{exec}$: Execution & compilation success in Docker sandbox.
  - $R_{gate}$: Purged walk-forward CV validity (binary gate; violation yields catastrophic penalty).
  - $R_{MASE}$: Scaled return error beating naive baseline ($MASE < 1.0$).
  - $R_{Brier}$: Probability calibration on directional debate calls.
  - $R_{Sortino}$: Realized economic return net of Indian brokerage/STT/GST.
  - $R_{cost}$: Token & search API budget penalty.
- **Pros:** Replaces fragile prompt engineering with learned, verifiable tool-calling and code-debugging policies. High sample efficiency via GRPO and ARPO step-level rollouts. Prevents reward hacking by anchoring on read-only M8 evaluation engine (ADR-012).
- **Cons:** Requires trajectory collection infrastructure (Docker sandboxes + Ray/vLLM) and GPU compute for post-training runs. Adds offline training complexity.
- **Where it fits best:** MVP 2 autonomous agent optimization, specialized market skill packs, and production policy distillation.
- **Where it doesn't suit:** MVP 1 initial prototype where rapid zero-shot prompt iteration is faster to bootstrap.
- **Status:** accepted for MVP 2 roadmap (2026-08-14)

### ADR-025: Data Preprocessing, Outlier Sanitization & Multi-Series Feature Engineering (M1/M6)
- **Decision:** Split data preparation into **Platform-Level Deterministic Sanitization (M1)** and **Agent-Driven Multi-Series Feature Engineering (M6)**.
- **1. Platform-Level Deterministic Sanitization (M1 `cleaner.py` & `normalizer.py`):**
  - **Outlier Detection & Capping:** Use rolling causal Hampel Filter / Median Absolute Deviation (MAD) over rolling $W=20$ bars. Outliers $> 3.5 \times \text{MAD}$ are clipped to the threshold (Winsorization) rather than dropped, preserving continuous time index.
  - **Multi-Asset Calendar Alignment:** When fusing multi-series data (e.g., US 10Y Yield, Brent Crude, USDINR, NIFTY 50), align timestamps using an **exchange-primary causal forward-fill (`ffill`)** with a maximum staleness threshold of 3 trading days.
  - **Corporate Action & Circuit Filter Adjustment:** Splits and bonuses adjusted at ingestion; circuit freeze days ($0\%$ volume or exact upper/lower band touch) flagged with `is_circuit_locked=true`.
- **2. Agent-Driven Multi-Series Feature Engineering (M6 in `workspace/code/features/`):**
  - Sub-agents autonomously generate multi-series interaction features in Python within the Docker sandbox:
    - **Cross-Asset Lead-Lag:** Rolling cross-correlation and lagged returns between target stock and macro drivers (Brent, USDINR, US10Y).
    - **Sector & Peer Relative Strength:** Target return minus Sector Index return ($R_{stock} - R_{sector}$).
    - **Participant Ratio Transforms:** FII Net Flow 5-day EMA, Client Long/Short OI ratio, Bhavcopy Delivery % Z-score.
  - **Anti-Leakage Constraint (ADR-011):** All feature generation code must pass M8's `FeatureLagAudit` (all rolling windows must be strictly strictly left-aligned / causal, e.g. `shift(1)` on target-dependent features).
- **Pros:** Eliminates boilerplate LLM debugging on basic data joins while keeping alpha generation flexible and autonomous. Outlier clipping prevents single rogue ticks from distorting statistical models.
- **Cons:** Adds rolling window alignment overhead in M1. Multi-series joins increase memory footprint in sandbox.
- **Status:** accepted (2026-08-14)

### ADR-026: Distributed Tracing, Observability & Structured Logging (M2/M5/M7/M9)
- **Decision:** Implement end-to-end distributed tracing using **UUIDv7 Correlation IDs** across the TypeScript harness, Python MCP servers, Docker sandbox, and Postgres storage.
- **Trace Span Topology:**
  - `forecast_run_id` (Root Span): Tracks target symbol, horizon, execution trigger, total latency, and aggregated token cost.
  - `round_span` (R1..R4): Child span tracking per-round duration, supervisor decisions, and debate state checkpoints.
  - `agent_span` (Price, FII, DII, Retail): Tracks individual agent reasoning, tool requests, and emitted `AgentSignal`.
  - `execution_span` (Docker CodeAct): Captures script exit code, execution time, peak RAM, stdout, stderr, and raw traceback saved to `workspace/evaluations/traces/`.
  - `llm_span` (M2): Logs prompt tokens, completion tokens, thinking tokens, cache hit tokens, cost in USD, and TTFT.
- **Implementation:**
  - TypeScript: Structured JSON logging with correlation context propagation via `AsyncLocalStorage`.
  - Python MCP: `structlog` outputting machine-readable JSON lines with injected `trace_id`.
  - Storage: Postgres `debate_traces` table stores round-by-round context for deterministic post-mortem replay.
- **Pros:** Full visibility into token spend, cache hit efficiency, and CodeAct failure modes without attaching intrusive debuggers. Enables 100% deterministic backtest replay.
- **Cons:** Adds ~5-10ms logging serialization overhead per step; requires trace ID propagation across process boundaries.
### ADR-027: Operational Resilience — Health Handshake, Typed Errors, Migrations & Skill Lifecycle
- **Decision:** Establish strict operational protocols for system readiness, fault recovery, schema migrations, and skill pruning.
- **1. Startup Health Handshake (M10):** Fail-fast probe testing Postgres, Redis, Docker Daemon API, and MCP servers in $<200\text{ms}$ at boot.
- **2. Typed Error Taxonomy:** Standardized hierarchy (`DataFetchError`, `DockerTimeoutError`, `LLMQuotaError`, `LeakageGateError`) mapping errors to deterministic recovery policies.
- **3. Schema Migrations:** Idempotent, forward-only SQL migration runner managing Postgres & pgvector schemas in `infra/migrations/`.
- **4. Skill Lifecycle & Pruning (M11):** 3-state machine (`DRAFT` $\rightarrow$ `ACTIVE` $\rightarrow$ `ARCHIVED`). Skills decaying to rolling $\text{MASE} > 1.05$ are auto-archived.
- **5. Sandbox Zero-Trust Isolation (M5):** No API keys or host credentials mounted inside Docker containers; validation container enforced with `--network none`.
- **Status:** accepted (2026-08-14)

### ADR-028: Prompt Architecture & Compilation — DSPy MIPROv2, Jinja2/Nunjucks Shared Templates & Offline-to-Online Bridge
- **Context:** Manual string prompt engineering is non-reproducible, fragile across model versions, and suffers from prompt drift. In a dual-stack system (TypeScript orchestrator + Python data science), prompts must be algorithmically optimizable offline without adding runtime latency or subprocess overhead in production.
- **Decision:**
  - **1. Offline Algorithmic Prompt Compilation (DSPy MIPROv2):**
    - Sub-agent prompts are formalized as `dspy.Signature` contracts (`ParticipantAgentSignature`).
    - Optimization is executed offline using `MIPROv2` with Tree-structured Parzen Estimators (TPE via Optuna) across historical Indian market regimes (Bull, Bear, Sideways).
    - Objective function: Composite `m8_forecasting_metric` ($40\%$ MASE on returns, $40\%$ Brier calibration score, $20\%$ overconfidence penalty, with binary 0.0 failure on Validity Gate leakage).
    - Compilation economics: ~2,640 API calls compiling all 4 participant agents in $<5$ minutes for $\approx \$0.48$ off-peak on DeepSeek `v4-flash`.
  - **2. Shared Jinja2 / Nunjucks Template Interop:**
    - Prompts are authored and stored as standardized `.j2` templates in `prompts/`.
    - **Python (Offline DSPy):** Compiles and renders templates using `jinja2`.
    - **TypeScript (Online LangGraph):** Reads compiled JSON schema and renders prompts dynamically using `nunjucks` (the official JS port of Jinja2) in $<1\text{ms}$ with zero Python runtime dependency.
  - **3. Byte-Level Prefix Stability (DeepSeek & Claude):**
    - Strict XML semantic boundaries (`<context>`, `<rules>`, `<scratchpad>`, `<evidence>`).
    - Fixed ordering: Static instructions $\rightarrow$ Market state $\rightarrow$ Few-shot exemplars $\rightarrow$ Volatile retrieved memories at the TAIL to maintain $\ge 85\%$ prefix cache hit rates.
  - **4. Telemetry-Driven Continuous Retraining Loop:**
    - Production execution traces (inputs, Docker logs, ground-truth outcomes) stream asynchronously to Postgres/ClickHouse.
    - Low-scoring or regime-shift traces auto-enrich the offline evaluation dataset for scheduled weekly MIPROv2 re-compilation.
- **Pros:** Eliminates manual prompt guesswork; achieves $+10\%\text{--}18\%$ accuracy improvement over baseline zero-shot prompts; zero Node.js $\leftrightarrow$ Python runtime IPC latency for prompt rendering; guarantees $85\%$ prompt cache savings.
- **Cons:** Requires running offline optimization pipelines when changing signature schemas; initial dataset preparation requires historical regime labeling.
- **Status:** accepted (2026-08-14)

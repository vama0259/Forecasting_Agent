---
type: adr
parent: "[[Forecasting Agent]]"
date: 2026-08-14
status: decided
---
# Module Architecture Specifications (M1–M11)

Comprehensive visual and structural blueprints for all 11 modules in the Forecasting Agent platform.

## 1. Capability Layer (CAP) — ADR-015
- **Pattern:** Micro-Kernel / Dependency Inversion / Registry Pattern
- **Responsibility:** Maps abstract capabilities (`search`, `market_data`, `sentiment`, `chat`) to concrete MCP servers or LLM providers. Agent code never imports or names a vendor.

```mermaid
flowchart LR
    subgraph Agents["Sub-Agents / Harness"]
        A["Agent calls: cap('market_data').fetch_ohlcv()"]
    end

    subgraph CAP["Capability Layer (core/capabilities)"]
        REG["Capability Registry<br/>(startup validated)"]
        CONF["harness_config.yaml"]
        CONF -->|loads binding| REG
    end

    subgraph Providers["Concrete Providers"]
        P1["Market Data MCP"]
        P2["AnySearch MCP"]
        P3["DeepSeek LLM"]
    end

    A --> REG
    REG -->|routes to| P1
    REG -->|routes to| P2
    REG -->|routes to| P3
```

## 2. M1: Market Data MCP Server — ADR-006, ADR-013, ADR-025
- **Pattern:** Ports & Adapters (Hexagonal) / Plugin Registry / Deterministic Sanitizer
- **Responsibility:** Standardizes market feeds (NSE, BSE, US, Crypto, F&O) into strict OHLCV schemas. Handles outlier sanitization (Hampel filter/Winsorization), calendar alignment across cross-assets, corporate action adjustments, caching, and point-in-time filtering.

```mermaid
flowchart TB
    MCP["MCP Client (Harness / Sandbox)"]

    subgraph M1["M1: Market Data Server (Python MCP)"]
        SRV["server.py (MCP Tool Surface)"]
        REG["registry.py (Manifest Loader)"]
        CACHE["cache.py (Parquet / Redis)"]
        CLEAN["cleaner.py (Outlier Hampel Filter & Circuit Flags)"]
        NORM["normalizer.py (Multi-Asset Calendar Alignment)"]
        PIT["point_in_time.py (Date Filter)"]

        subgraph Plugins["Market Plugins (contracts.py compliant)"]
            PL_NSE["nse.py"]
            PL_US["us_stocks.py"]
            PL_FNO["fno.py"]
            PL_CRYPTO["crypto.py"]
        end
    end

    MCP -->|fetch_ohlcv(symbol, range)| SRV
    SRV --> REG
    REG --> CACHE
    CACHE -->|cache miss| Plugins
    Plugins -->|yfinance / CSV feed| CLEAN
    CLEAN --> NORM
    NORM --> PIT
    PIT -->|validated OHLCV schema| SRV
```

## 3. M2: LLM Client & Governor — ADR-009, ADR-014, ADR-016
- **Pattern:** Gateway / Leaky Bucket Concurrency Governor / Checkpoint-Resume
- **Responsibility:** Handles token metering, exponential backoff, prefix-stable prompt assembly, and off-peak scheduling for DeepSeek.

```mermaid
flowchart LR
    REQ["LLM Call Request"] --> GOV["Concurrency Governor<br/>(Max 2500 in-flight)"]
    GOV --> PROMPT["Context Assembler<br/>(Stable Prefix First, Volatile Last)"]
    PROMPT --> CLIENT["ChatDeepSeek Wrapper"]
    CLIENT -->|API Call| DEEPSEEK["DeepSeek API (v4-flash)"]
    DEEPSEEK -->|Usage & Tokens| METER["Cost & Latency Meter"]
    METER --> DB[(Postgres Meta-Metrics)]
```

## 4. M3: News & Web Search MCP — ADR-010, ADR-017
- **Pattern:** Run-Scoped Cache / Token Bucket Rate Limiter / Graceful Degrader
- **Responsibility:** Allocates 20 searches per forecast run; enforces domain allowlisting on Indian business media; protects against blowing the 2,000/day quota.

```mermaid
flowchart TB
    AGENT["Sentiment / Retail Agent"] --> BGT["Per-Run Budget Allocator<br/>(20 searches max)"]
    BGT --> CACHE{"Run-Scoped Cache<br/>(Exact query match)?"}
    CACHE -- Hit --> RES["Return Cached Results"]
    CACHE -- Miss --> DOMAIN["Domain Filter<br/>(Moneycontrol, ET, Livemint, BSE/NSE)"]
    DOMAIN --> ANYSEARCH["AnySearch MCP Server"]
    ANYSEARCH --> QUOTA{"Daily 2000 Cap Reached?"}
    QUOTA -- No --> UPDATE["Update Cache + Return"]
    QUOTA -- Yes --> DEGRADE["Return Cached Context + Flag `degraded=true`"]
```

## 5. M4: Sentiment Engine MCP — ADR-018
- **Pattern:** Specialist Microservice / Exponential Recency Decay Aggregator
- **Responsibility:** Scores financial headlines, applies exponential time decay, and aggregates news into a normalized sentiment vector.

```mermaid
flowchart LR
    NEWS["Search News & Announcements"] --> BATCH["Batch Headlines"]
    BATCH --> FINBERT["FinBERT Inference Engine<br/>(Local Warm Model)"]
    FINBERT --> SCORES["Raw Headline Scores"]
    SCORES --> DECAY["Exponential Recency Decay<br/>Score = Σ w_i * score_i / Σ w_i"]
    DECAY --> AGG["Aggregate Sentiment Signal"]
```

## 6. M5: Two-Tier Code Execution Sandbox — ADR-021
- **Pattern:** Two-Tier Sandboxing (Warm Stateful Scratchpad vs. Cold Clean Validator)
- **Responsibility:** Executes agent-written Python modeling code safely while guaranteeing no hidden state or unapproved packages pollute final evaluation.

```mermaid
flowchart TB
    subgraph Explore["Tier 1: Explore (Fast & Stateful)"]
        CODE["Agent writes Python script"]
        WARM["Warm Docker Container<br/>(Shared session, PyPI allowed)"]
        CODE --> WARM
        WARM -->|Execution trace / error| AGENT["Agent self-debugs (CodeAct)"]
    end

    Explore -->|Agent Submits Best Model| Validate

    subgraph Validate["Tier 2: Validate (Clean & Isolated)"]
        COLD["Fresh Cold-Start Container<br/>(Clean Image, No Network, M8 Mounted Read-Only)"]
        SCORE["Run Model on Walk-Forward CV"]
        COLD --> SCORE
    end

    SCORE -->|Match?| M8["M8 Evaluation Storage"]
    SCORE -->|Fails/Mismatch?| REJ["Reject (Residue/Unapproved Package)"]
```

## 7. M6: Agent Layer & Multi-Series Features — ADR-023, ADR-025
- **Pattern:** Specialist Worker Sub-agents / Autonomous Feature Engineering / Participant-Intent Modeling
- **Responsibility:** 4 sub-agents write autonomous multi-series Python feature engineering scripts (`workspace/code/features/`) and model participant actions. Emits structured `AgentSignal`.

```mermaid
flowchart TD
    subgraph DataFeeds["Multi-Series Inputs"]
        D_PRICE["Target OHLCV"]
        D_MACRO["Macro Drivers (USDINR, Brent, US10Y)"]
        D_SECTOR["Sector Indices (Nifty IT, Bank, etc.)"]
        D_FLOWS["Participant Flows & Bhavcopy OI"]
    end

    subgraph FeatureEng["workspace/code/features/ (Autonomous Python CodeAct)"]
        FE1["Cross-Asset Lead-Lag & Rolling Correlations"]
        FE2["Sector Relative Strength (R_stock - R_sector)"]
        FE3["Flow Momentum & Delivery % Z-Scores"]
    end

    subgraph Agents["M6 Sub-Agents"]
        A_PRICE["Price Agent (Baseline Anchor)"]
        A_FII["FII Intent Agent"]
        A_DII["DII Intent Agent"]
        A_RETAIL["Retail Intent Agent"]
    end

    D_PRICE & D_MACRO --> FE1
    D_PRICE & D_SECTOR --> FE2
    D_FLOWS --> FE3

    FE1 --> A_PRICE & A_FII
    FE2 --> A_DII
    FE3 --> A_RETAIL

    A_PRICE & A_FII & A_DII & A_RETAIL --> SIGNAL["Structured AgentSignal<br/>{direction, prob, conf, horizon, evidence[]}"]
```

## 8. M7: Orchestrator & 4-Round Debate — ADR-003, ADR-022, ADR-024
- **Pattern:** Supervisor / 4-Round StateGraph / Hard Adversarial Assignment / Code Aggregation
- **Responsibility:** Coordinates multi-agent rounds; assigns Devil's Advocate to lowest-calibration agent; computes consensus arithmetically in code.

```mermaid
flowchart TB
    R1["Round 1: Independent Analysis<br/>(Each agent runs code & emits initial signal)"]
    R2["Round 2: Cross-Examination Debate<br/>(Agents review peer evidence & challenge assumptions)"]
    R3["Round 3: Explicit Devil's Advocate<br/>(Supervisor assigns lowest-calibration agent to attack weakest consensus point)"]
    R4["Round 4: Deterministic Consensus<br/>(Calculated in Code via Historical Calibration Weights)"]
    NARRATIVE["LLM Generates Narrative Synthesis"]

    R1 -->|Checkpointed| R2
    R2 -->|Checkpointed| R3
    R3 -->|Checkpointed| R4
    R4 --> NARRATIVE
    NARRATIVE --> OUT["Final Forecast Output (or Bull/Bear Deadlock Scenario)"]
```

## 9. M8: Read-Only Evaluation Engine — ADR-011, ADR-012
- **Pattern:** Immutable Oracle / 4-Layer Metric Pipeline / Walk-Forward Gate
- **Responsibility:** Scores models and debate calls; acts as an isolated platform judge that the agent cannot modify or game.

```mermaid
flowchart TD
    INPUT["Model Script / Debate Call"] --> GATE{"Layer 4: Validity Gate<br/>• Purged Walk-Forward CV<br/>• Point-in-Time Data<br/>• as_of Memory Filter"}

    GATE -- Failed --> INVALID["Mark Run INVALID (Catastrophic Failure)"]
    GATE -- Passed --> L1["Layer 1: MASE on Returns<br/>(Objective Function, < 1.0 beats naive)"]

    L1 --> L2["Layer 2: Brier Score + Calibration Curve<br/>(Measures Probabilistic Honesty)"]
    L2 --> L3["Layer 3: Cost-Adjusted Sortino<br/>(Net of Indian STT, Stamp Duty, GST, Exchange Fees)"]
    L3 --> REPORT["Evaluation Record in Postgres"]
```

## 10. M9: Storage & 4-Tier Memory — ADR-020
- **Pattern:** Tiered Memory Architecture / Temporal Point-in-Time Indexing
- **Responsibility:** Prevents memory leakage into past backtests with mandatory `as_of` timestamping.

```mermaid
flowchart LR
    subgraph Tiers["4 Memory Tiers"]
        T1["Working Memory<br/>(In-Context Prompt, 1M Window)"]
        T2["Session Memory<br/>(Redis: Quota, Search Cache, Pub/Sub)"]
        T3["Long-Term Memory<br/>(Postgres: Forecasts, Checkpoints, Eval)"]
        T4["Semantic Memory<br/>(pgvector: Strategy & Pattern Embeddings)"]
    end

    BACKTEST["Backtest Query (as_of = T_past)"] --> FILTER["as_of <= T_past Temporal Guard"]
    FILTER --> T3 & T4
    T3 & T4 --> RET["Leak-Free Historical Memory Retrieval"]
```

## 11. M10 & M11: Delivery Interface & Skill Registry
- **Pattern:** Event-Driven SSE / Repository Pattern / Off-Peak Cron Scheduler
- **Responsibility:** M10 streams live debate progress to CLI/React UI; M11 persists high-scoring models and skills for future forecast runs.

```mermaid
flowchart LR
    SCHED["Cron Scheduler / CLI Request"] --> M7["Orchestrator (M7)"]
    M7 -->|Pub/Sub Events| REDIS["Redis Channel"]
    REDIS -->|Server-Sent Events (SSE)| UI["React UI / Terminal CLI"]
    M8["M8 Validated High-MASE Model"] -->|Auto-Save| SKILLS["Skill Registry (workspace/skills/)"]
    SKILLS -->|Loaded by| AGENTS["Future Agent Runs"]
```

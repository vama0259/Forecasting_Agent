# Forecasting Agent — Autonomous Market & Industry Intelligence Platform

> **Claude Code for Industry Analysis.** An autonomous coding agent that writes, runs, and iterates on quantitative analysis code in Docker sandboxes. Forecasting is the first skill pack — the platform adapts to any domain through self-extending tools, connectors, and skills.

---

## 🏛️ System Architecture

```mermaid
flowchart TB

  subgraph Presentation["Presentation & Control"]
    CLI["CLI & Executive Digest Card Generator"]
    SCHED["Off-Peak Cron Scheduler (Post-15:30 IST / ADR-016)"]
  end

  subgraph Harness["TypeScript Orchestration Harness (ADR-001)"]
    M7["<b>M7 · Supervisor Orchestrator (ADR-003/022/024)</b><br/>4-Round Debate • Round Checkpointing • Volatile-Last Context<br/>Consensus Aggregation in Code • Dual-Scenario Deadlock"]

    subgraph M6_Agents["<b>M6 · Participant-Intent Agents (ADR-023)</b>"]
      A_PRICE["Price Agent (Anchor Baseline)"]
      A_FII["FII Intent Agent (Global Cues & F&O OI)"]
      A_DII["DII Intent Agent (Domestic Macro & SIPs)"]
      A_RET["Retail Intent Agent (Delivery % & News)"]
    end

    CAP["<b>Capability Layer (ADR-015)</b><br/>Config-driven capability binding (search, market_data, sentiment, chat)"]
  end

  subgraph PyMCP["Python MCP Servers & External Capabilities"]
    M1["<b>M1 · Market Data MCP (ADR-013/025)</b><br/>yfinance (.NS/.BO) • Indian Connectors (flows, bhavcopy, macro_in)<br/>Hampel Filter Sanitizer • 3-Day Cache Fallback"]
    M3["<b>M3 · Search MCP (ADR-010/017)</b><br/>AnySearch • 20/run Budget • Indian Finance Domain Filter"]
    M4["<b>M4 · Sentiment Engine (ADR-018)</b><br/>FinBERT / LLM Extraction • Exponential Recency Decay"]
    M2["<b>M2 · LLM Client (ADR-009/014)</b><br/>DeepSeek v4-flash • Thinking Mode • 2500 Concurrency Governor"]
  end

  subgraph Execution["Execution & Evaluation Isolation"]
    subgraph Sandbox["<b>M5 · Two-Tier Docker Sandbox (ADR-021)</b>"]
      EXP["Tier 1: Warm Explore (PyPI allowed, 45s Timeout, Max 5 Retries)"]
      VAL["Tier 2: Cold Clean Validate (No network, Clean image)"]
    end
    M8["<b>M8 · Read-Only Evaluation Harness (ADR-011/012)</b><br/>1: MASE on Returns • 2: Brier Calibration • 3: Cost-Adjusted Sortino<br/>4: Purged Walk-Forward CV Gate (Catastrophic fail on leak)"]
  end

  subgraph Persistence["Storage & Memory (ADR-020)"]
    PG[("PostgreSQL: Durable History & Checkpoints")]
    PGV[("pgvector: Strategy & Pattern Semantic Memory")]
    REDIS[("Redis: Quotas, Run-Scoped Caches & Pub/Sub")]
  end

  %% Interactions
  CLI & SCHED --> M7
  M7 --> M6_Agents
  M6_Agents --> CAP
  CAP --> M1 & M3 & M4 & M2

  M6_Agents -->|Writes Python CodeAct| EXP
  EXP -->|Submits Best Model| VAL
  VAL -->|Scored Validation| M8
  M8 -->|Read-only eval mount| EXP

  M7 -->|Checkpoints & Memories (as_of <= backtest_date)| PG & PGV
  M3 & M7 --> REDIS
```

---

## ⚡ Core Architectural Principles

1. **Deterministic Code Over LLM Sycophancy ([ADR-022](docs/ARCHITECTURE.md#adr-022)):** LLMs write code and argue in debate; **consensus aggregation is pure arithmetic** weighted by historical Brier calibration. Numbers are calculated, narratives are LLM-assisted.
2. **Evaluation Harness Isolation ([ADR-012](docs/ARCHITECTURE.md#adr-012)):** The agent writes the models in `workspace/code/`, but the evaluation engine `core/evaluation/` is mounted **strictly read-only**. The agent cannot grade its own homework.
3. **4-Layer Metric Stack ([ADR-011](docs/ARCHITECTURE.md#adr-011)):**
   - **Layer 1 (Objective):** MASE on returns ($<1.0$ beats naive persistence).
   - **Layer 2 (Calibration):** Brier score & reliability curves on directional probability.
   - **Layer 3 (Reality Check):** Cost-adjusted Sortino net of Indian STT, GST, stamp duty, and exchange fees.
   - **Layer 4 (Validity Gate):** Purged rolling-origin CV and point-in-time `as_of` temporal guard.
4. **Volatile-Last Prompt Caching ([ADR-016](docs/ARCHITECTURE.md#adr-016), [ADR-020](docs/ARCHITECTURE.md#adr-020)):** Appending memories to the tail of the prompt preserves DeepSeek's byte-stable prefix cache, cutting inference costs by $31\text{--}50\times$ (~$0.17$/run).
5. **Two-Tier Execution Sandbox ([ADR-021](docs/ARCHITECTURE.md#adr-021)):** Fast, stateful warm container for rapid CodeAct iteration ($45\text{s}$ timeout, 5 retries max); isolated cold-start container with `--network none` for unpolluted validation.

---

## 🥊 4-Round Participant Debate Protocol ([ADR-023](docs/ARCHITECTURE.md#adr-023), [ADR-024](docs/ARCHITECTURE.md#adr-024))

Instead of generic data lanes, agents model **market participant intent** using unique Indian market disclosures (NSE Participant-wise F&O OI & Bhavcopy delivery %):

- **Price Agent (Baseline Anchor):** Technical indicators, price action, and trend momentum.
- **FII Intent Agent:** Foreign institutional flows, index F&O positioning, global macro, and USDINR.
- **DII Intent Agent:** Domestic institutional flows, mutual fund SIP momentum, and domestic macro.
- **Retail Intent Agent:** Client F&O positioning, delivery volume spikes, and retail news sentiment.

```
Round 1: Independent Analysis  ──► Each agent runs sandboxed code & emits initial AgentSignal
Round 2: Cross-Examination     ──► Agents challenge peer evidence and cross-examine assumptions
Round 3: Devil's Advocate      ──► Supervisor hard-assigns lowest-calibration agent to attack weakest consensus
Round 4: Deterministic Math    ──► Calibration-weighted combination computes final probabilities & scenarios
```

---

## 📂 Repository Layout

```
├── core/
│   ├── capabilities/       # Capability registry & config binding (ADR-015)
│   ├── evaluation/         # Read-only evaluation harness & metric gates (ADR-011/012)
│   └── telemetry/          # Distributed tracing & Langfuse logging (ADR-026)
├── data_server/            # Python Market Data MCP server (ADR-013/025)
│   ├── contracts.py        # Pydantic schemas (OHLCV, MarketPlugin protocol)
│   ├── registry.py         # Plugin loader & manifest parser
│   ├── cleaner.py          # Hampel filter outlier sanitizer & circuit flags
│   ├── normalizer.py       # Cross-asset calendar ffill alignment
│   └── plugins/            # nse.py, us_stocks.py, fno.py, crypto.py
├── harness/                # TypeScript LangGraph.js supervisor & agents (ADR-001/003)
│   ├── agents/             # Price, FII, DII, Retail participant sub-agents
│   ├── orchestrator/       # 4-round state graph & arithmetic aggregator
│   └── sandbox/            # Docker container lifecycle managers (ADR-021)
├── workspace/              # Agent writable scratchpad
│   ├── code/features/      # Multi-series feature engineering scripts (ADR-025)
│   ├── code/models/        # Agent-generated forecasting models
│   └── skills/             # High-MASE validated strategy library (ADR-027)
├── docs/                   # System specifications, ADRs & diagrams
└── infra/                  # Dockerfiles, docker-compose.yml & SQL migrations
```

---

## 🗺️ MVP 1 Build Order

| Step | Component | Focus |
|---|---|---|
| **1** | **Capability Layer** ([ADR-015](docs/ARCHITECTURE.md#adr-015)) | Config loader, Zod schema validation & provider binding |
| **2** | **Market Data MCP** ([ADR-013](docs/ARCHITECTURE.md#adr-013), [025](docs/ARCHITECTURE.md#adr-025)) | `contracts.py` + `cleaner.py` + `yfinance` NSE plugin |
| **3** | **M8 Evaluation Engine** ([ADR-011](docs/ARCHITECTURE.md#adr-011), [012](docs/ARCHITECTURE.md#adr-012)) | MASE on returns + Purged Walk-Forward validity gate |
| **4** | **Two-Tier Docker Sandbox** ([ADR-021](docs/ARCHITECTURE.md#adr-021)) | Warm explore container + Cold validation runner |
| **5** | **Storage & Postgres** ([ADR-020](docs/ARCHITECTURE.md#adr-020), [027](docs/ARCHITECTURE.md#adr-027)) | Checkpoints, `as_of` temporal guard & SQL migrations |
| **6** | 🎯 **Milestone 6: Single Price Agent** | Proves end-to-end stack on `RELIANCE.NS` / `NIFTY 50` |
| **7** | **Indian Moat Connectors** ([ADR-023](docs/ARCHITECTURE.md#adr-023)) | FII/DII daily flows, Bhavcopy delivery %, RBI/Macro |
| **8** | **Participant Agents** ([ADR-023](docs/ARCHITECTURE.md#adr-023)) | FII, DII, Retail sub-agents + `AgentSignal` schema |
| **9** | **4-Round Debate & Consensus** ([ADR-022](docs/ARCHITECTURE.md#adr-022), [024](docs/ARCHITECTURE.md#adr-024)) | Supervisor graph, Devil's Advocate & arithmetic consensus |
| **10** | **CLI & Executive Digest Card** | User interface & off-peak batch scheduler |

---

## 📚 Documentation Index

- [Architecture Decision Records (ADR 001–027)](docs/ARCHITECTURE.md)
- [Module Specifications & Blueprints (M1–M11)](docs/MODULE_SPECIFICATIONS.md)
- [Product Strategy, ICP & Output Design](docs/PRODUCT_STRATEGY.md)
- [Metric Stack & Evaluation Reference](docs/METRICS.md)
- [Industry & Cross-Domain Roadmap](docs/INDUSTRY_ROADMAP.md)

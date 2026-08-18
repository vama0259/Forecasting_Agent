# UI Frontend Integration Design: 4-Round Adversarial Debate Viewer & Live Runner

**Date**: 2026-08-19
**Status**: Draft (Under Spec Review)
**Parent**: `[[Forecasting Agent]]`
**ADR References**: ADR-007, ADR-016, ADR-022, ADR-024, ADR-033, ADR-034

---

## 1. Executive Summary

This specification designs the production bridge connecting the **4-Round Adversarial Multi-Agent Debate Engine** (`price`, `fii`, `dii`, `retail` + `consensus`) to the **Next.js frontend in `ui/`**.

It enables two primary operational modes:
1. **Real-Time Deliberation Streaming (SSE)**: Trigger a live debate on any NSE symbol via Server-Sent Events (`/api/debate/stream?symbol=...`), streaming agent reasoning tokens, live Docker Python sandbox execution (`catboost`, `KalmanFilter`, `GARCH` logs), Round 2 peer critiques, Round 3 Devil's Advocate stress-testing, and Round 4 deterministic consensus.
2. **Instant Historical Replay (PostgreSQL)**: Instantly fetch and replay any completed debate run from the PostgreSQL `debate_rounds` table (`/api/debates`), with zero execution latency.

---

## 2. Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            NEXT.JS APP (`ui/`)                              │
│                                                                             │
│  [Symbol Selector / Runner] ──> [Live SSE Stream] or [Postgres Replay]      │
│            │                                   │                            │
│            ▼                                   ▼                            │
│   ┌─────────────────┐                 ┌─────────────────┐                   │
│   │ Checkpoint      │                 │ Participant     │                   │
│   │ Timeline (R1-4) │                 │ Cards (4 Roster)│                   │
│   └─────────────────┘                 └─────────────────┘                   │
│            │                                   │                            │
│            ▼                                   ▼                            │
│   ┌─────────────────┐                 ┌─────────────────┐                   │
│   │ Docker Sandbox  │                 │ Consensus &     │                   │
│   │ Terminal Stream │                 │ Tail-Risk Panel │                   │
│   └─────────────────┘                 └─────────────────┘                   │
└────────────┬───────────────────────────────────┬────────────────────────────┘
             │ HTTP / SSE                        │ SQL
             ▼                                   ▼
┌───────────────────────────────┐     ┌───────────────────────────────────────┐
│ Next.js API Route Handlers    │     │ PostgreSQL (`debate_rounds`,          │
│ • GET /api/debate/stream      │     │              `forecasts`,             │
│ • GET /api/debates            │     │              `search_observations`)   │
│ • GET /api/symbols            │     └───────────────────────────────────────┘
└────────────┬──────────────────┘
             │ Spawns & Streams
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ TS HARNESS & DEBATE ORCHESTRATOR (`harness/src/debate/orchestrator.ts`)      │
│ • Round 1: 4 Sub-Agents Parallel Dispatch                                   │
│ • Round 2: Peer Cross-Examinations & Deltas                                 │
│ • Round 3: Dynamic Devil's Advocate Counter-Hypotheses                      │
│ • Round 4: Deterministic Arithmetic Consensus Engine ($P_{\text{up}}, H$)   │
│ • Docker Sandbox Manager (Execute `model.py`, `catboost`, `scipy`)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Real Agent Roster & Domain Types

### 3.1 Participant Identities
Replace outdated mock types (`technical`, `sentiment`, `macro`) with the real 4-agent roster:
```typescript
export type ParticipantAgentId = 'price' | 'fii' | 'dii' | 'retail';
export type DebateAgentId = ParticipantAgentId | 'consensus';

export type DebateRoundName = 'independent' | 'critique' | 'devils-advocate' | 'consensus';
export type DebateRoundIndex = 1 | 2 | 3 | 4;
```

### 3.2 Stream Event Protocol (Discriminated Union)
```typescript
export type DebateStreamEvent =
  | { type: 'session-init'; runId: string; symbol: string; asOf: string }
  | { type: 'round-start'; roundIndex: DebateRoundIndex; roundName: DebateRoundName }
  | { type: 'agent-turn-start'; agent: ParticipantAgentId; roundIndex: DebateRoundIndex }
  | { type: 'reasoning-token'; agent: ParticipantAgentId; token: string }
  | { type: 'sandbox-execution'; agent: ParticipantAgentId; scriptName: string; code: string; stdout: string; stderr?: string; exitCode: number }
  | { type: 'agent-signal'; agent: ParticipantAgentId; roundIndex: DebateRoundIndex; direction: 'up' | 'down'; probability: number; confidence: number; degraded: boolean; evidence: Array<{ claim: string; source: string; value?: unknown }> }
  | { type: 'peer-critiques'; agent: ParticipantAgentId; critiques: Array<{ targetAgent: ParticipantAgentId; agreement: string; point: string }>; probabilityDelta: number }
  | { type: 'devils-advocate-selected'; agent: ParticipantAgentId; reason: string; catastrophicRisks: string[]; invalidationTriggers: string[] }
  | { type: 'consensus-resolved'; direction: 'up' | 'down'; probability: number; confidence: number; dispersion: number; deadlockStatus: 'RESOLVED' | 'DEADLOCK'; healthFactor: number }
  | { type: 'round-complete'; roundIndex: DebateRoundIndex }
  | { type: 'error'; message: string; detail?: string };
```

---

## 4. API Endpoints Specification

### 4.1 `GET /api/debates` (Historical Replay)
* **Query Parameters**:
  * `symbol` (optional string, e.g. `SBIFUNDS.NS`)
  * `limit` (default `10`)
* **Response**:
  ```json
  {
    "debates": [
      {
        "forecastId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "symbol": "SBIFUNDS.NS",
        "asOf": "2026-08-18",
        "consensusDirection": "down",
        "consensusProbability": 0.60,
        "consensusConfidence": 0.236,
        "dispersion": 0.0354,
        "deadlockStatus": "RESOLVED",
        "createdAt": "2026-08-18T23:12:10.570Z",
        "rounds": {
          "round1": { ... },
          "round2": { ... },
          "round3": { ... },
          "round4": { ... }
        }
      }
    ]
  }
  ```

### 4.2 `GET /api/debate/stream` (Live Server-Sent Events)
* **Query Parameters**:
  * `symbol` (required, e.g. `SBIFUNDS.NS`)
  * `asOf` (optional, defaults to current date)
* **Headers**:
  * `Content-Type: text/event-stream`
  * `Cache-Control: no-cache`
  * `Connection: keep-alive`
* **Behavior**:
  * Spawns debate execution in background.
  * Streams serialized `data: JSON.stringify(DebateStreamEvent)\n\n` frames in real-time.

### 4.3 `GET /api/symbols`
* Returns available symbols with pre-calculated historical data or active watchlists (`SBIFUNDS.NS`, `HDFCBANK.NS`, `TCS.NS`, `RELIANCE.NS`, `INFY.NS`, `ICICIBANK.NS`, `SBIN.NS`, `KOTAKBANK.NS`, `LT.NS`, `BHARTIARTL.NS`).

---

## 5. UI Component Hierarchy & Maximum Transparency Design

The UI is architected around **Radical Quantitative Transparency** so users can audit every line of Python code, chart, peer critique, and mathematical weight that produced the forecast:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header: Logo | Symbol Dropdown / Search | "Run Live Forecast" Button        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Checkpoint Timeline: [1: Independent] ──> [2: Peer Critique] ──> ...        │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ 4-Participant Roster Grid            │ Executive Consensus & Calibration Card│
│ ┌───────────────┐ ┌───────────────┐  │ ┌───────────────────────────────────┐ │
│ │ Price Action  │ │ FII Flows     │  │ │ Direction: DOWN  [ 60.0% ]        │ │
│ │ DOWN (60%)    │ │ DOWN (14%)    │  │ │ Health Factor: H = 0.50 (Penalty) │ │
│ └───────────────┘ └───────────────┘  │ │ Disagreement σ: 0.0354 (Resolved) │ │
│ ┌───────────────┐ ┌───────────────┐  │ │ Invalidation Level: ₹561.15       │ │
│ │ DII Liquidity │ │ Retail Intent │  │ └───────────────────────────────────┘ │
│ │ DOWN (62%)    │ │ DOWN (70%)    │  │                                       │
│ └───────────────┘ └───────────────┘  │                                       │
├──────────────────────────────────────┴───────────────────────────────────────┤
│ TRANSPARENT MULTI-TAB AUDIT WORKSPACE:                                       │
│                                                                              │
│ 1. [📊 Interactive Charts & Probability Evolution]:                          │
│    • Recharts Multi-Round Probability Shift: Line chart tracking how each   │
│      agent's probability moved from Round 1 -> Round 2 -> Round 3 -> Final   │
│    • Volume & Delivery Distribution Bar Chart (Up-day vs Down-day turnover)  │
│    • GARCH Volatility & Forecasted Return Bounds                             │
│                                                                              │
│ 2. [🐍 Python Scripts & Docker Sandbox Viewer]:                              │
│    • Interactive Code Browser listing every file generated in Docker:       │
│      - `retail_features.py` (CatBoost ML Classifier & delivery ratios)       │
│      - `audit4_kalman.py` (Kalman Filter state-space trend denoising)        │
│      - `devils_advocate_r3.py` (Short-covering gap & tail-risk audit)        │
│      - `model.py` (Purged walk-forward backtest script)                      │
│    • Syntax-highlighted code viewer (Shiki) + Real stdout/stderr terminal    │
│    • Execution runtime (ms) and exit code indicator                          │
│                                                                              │
│ 3. [⚔️ Adversarial Peer Cross-Examinations]:                                 │
│    • Matrix of Round 2 Critiques: Who attacked whose thesis and why          │
│    • Agreement levels (`disagrees_strongly`, `disagrees_partially`, `agrees`)│
│    • Exact probability deltas ($\Delta P$) triggered by peer evidence        │
│                                                                              │
│ 4. [🔥 Devil's Advocate Stress-Test & Invalidation Triggers]:                │
│    • Selection Rationale: Mathematical distance from group consensus        │
│    • Structural Catastrophic Risks list                                      │
│    • Explicit Price & Flow Invalidation Levels (When the model is WRONG)     │
│                                                                              │
│ 5. [🛡️ Capability Fencing & Health Audit]:                                   │
│    • Evidence provenance audit: Which tool provided each data point          │
│    • Degradation penalty log ($0.5\times$ voting haircut rationale)          │
└──────────────────────────────────────────────────────────────────────────────┘

---

## 6. Verification & Test Plan

1. **API Integration Tests (`ui/src/app/api/...`)**:
   * Test `/api/debates` returns formatted JSON from mock and real Postgres pool.
   * Test `/api/debate/stream` emits valid SSE frames with proper keep-alive and error headers.
2. **Component & Page Tests (`ui/src/app/__tests__/...`)**:
   * Update existing tests in `agent-card.test.tsx`, `reasoning-panel.test.tsx`, and `page.test.tsx` to handle 4 real agent IDs (`price`, `fii`, `dii`, `retail`).
   * Test switching between Live SSE Mode and Historical Replay Mode.
3. **End-to-End Smoke Test**:
   * Run Next.js dev server, load `http://localhost:3000`, select `SBIFUNDS.NS`, inspect the historical debate replay, and run a live forecast.

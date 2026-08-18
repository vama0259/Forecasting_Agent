# Implementation Plan: UI Frontend Integration for 4-Round Multi-Agent Adversarial Debate

**Date**: 2026-08-19
**Spec Reference**: `docs/superpowers/specs/2026-08-19-ui-frontend-debate-integration-design.md`
**Target Directory**: `ui/`
**Quality Gates**: Strict TypeScript, Vitest 100% passing, Next.js build clean.

---

## Task 1: Real Agent Roster & Shared Stream Types
- **Files**:
  - `ui/src/lib/debate/types.ts`
  - `ui/src/lib/debate/fixtures.ts`
  - `ui/tests/types.test.ts`
- **Actions**:
  1. Define `ParticipantAgentId = 'price' | 'fii' | 'dii' | 'retail'` and `DebateAgentId = ParticipantAgentId | 'consensus'`.
  2. Define `DebateStreamEvent` discriminated union (all 11 event variants).
  3. Create real fixture data modeled after the actual `SBIFUNDS.NS` and `HDFCBANK.NS` runs.
  4. Write unit tests verifying schema integrity and discriminated union narrowing.

---

## Task 2: Next.js API Routes for PostgreSQL Replay & Live SSE Streaming
- **Files**:
  - `ui/src/app/api/debates/route.ts`
  - `ui/src/app/api/symbols/route.ts`
  - `ui/src/app/api/debate/stream/route.ts`
  - `ui/src/lib/db.ts`
  - `ui/tests/api-routes.test.ts`
- **Actions**:
  1. Create `ui/src/lib/db.ts` exporting a pg Pool connecting to `STORAGE_CONNECTION_STRING`.
  2. Implement `GET /api/debates` querying `debate_rounds` grouped by `forecast_id`.
  3. Implement `GET /api/symbols` returning top Indian equities (`SBIFUNDS.NS`, `HDFCBANK.NS`, `TCS.NS`, `RELIANCE.NS`, etc.).
  4. Implement `GET /api/debate/stream` streaming Server-Sent Events from the live debate orchestrator.
  5. Write Vitest integration tests mocking pool queries and SSE stream responses.

---

## Task 3: UI Transparency Components (Script Browser, Feature Graphs & Peer Audit)
- **Files**:
  - `ui/src/components/debate/agent-card.tsx`
  - `ui/src/components/debate/checkpoint-timeline.tsx`
  - `ui/src/components/debate/sandbox-output.tsx`
  - `ui/src/components/debate/script-browser.tsx`
  - `ui/src/components/debate/debate-charts.tsx`
  - `ui/src/components/debate/peer-critiques-matrix.tsx`
  - `ui/src/components/debate/devils-advocate-panel.tsx`
  - `ui/src/components/debate/evidence-list.tsx`
  - `ui/src/components/debate/reasoning-panel.tsx`
  - `ui/tests/components/*.test.tsx`
- **Actions**:
  1. Build `ScriptBrowser`: Syntax-highlighted code viewer displaying exact Python files (`retail_features.py`, `audit4_kalman.py`, `devils_advocate_r3.py`, `model.py`) with line numbers, runtime duration, exit codes, and stdout/stderr execution output.
  2. Build `DebateCharts`:
     - Recharts multi-round line chart tracking probability shifts ($R_1 \to R_2 \to R_3 \to R_4$).
     - Volume & delivery distribution bar chart comparing up-day vs down-day turnover.
     - Volatility cone & GARCH risk bounds.
  3. Build `PeerCritiquesMatrix`: Structured visual table showing who critiqued whom, agreement levels, and probability adjustments.
  4. Build `DevilsAdvocatePanel`: Displays mathematical selection justification ($|P_i - P_{\text{majority}}|$), tested counter-hypotheses, catastrophic risks, and invalidation trigger price levels.
  5. Update `AgentCard` with capability badges, conviction meters, and degradation warnings.

## Task 4: Main Page Live Streaming & Historical Replay Orchestration
- **Files**:
  - `ui/src/app/page.tsx`
  - `ui/src/components/debate/symbol-header.tsx`
  - `ui/src/components/debate/consensus-digest.tsx`
  - `ui/tests/page.test.tsx`
- **Actions**:
  1. Build `SymbolHeader` with stock search dropdown (`SBIFUNDS.NS`, `HDFCBANK.NS`, `TCS.NS`, etc.), as-of date selector, "Run Live Debate" button, and historical replay selector.
  2. Implement `useDebateStream` React hook connecting to `/api/debate/stream` via EventSource with automatic reconnection.
  3. Build `ConsensusDigest` card with directional badge, probability gauge, health factor haircut indicator, and key support/invalidation price lines.
  4. Assemble tabbed layout in `page.tsx` allowing one-click toggling between:
     - 📊 *Charts & Probability Dynamics*
     - 🐍 *Generated Python Scripts & Terminal Logs*
     - ⚔️ *Adversarial Peer Critiques*
     - 🔥 *Devil's Advocate Tail Risks*
     - 🛡️ *Capability & Data Integrity Audit*

---

## Task 5: Full Verification, Lint & Live Smoke Testing
- **Actions**:
  1. Run `pnpm --prefix ui test` to confirm 100% test pass rate.
  2. Run `pnpm --prefix ui lint` and `pnpm --prefix ui typecheck`.
  3. Run Next.js dev server and verify live rendering on `SBIFUNDS.NS`.

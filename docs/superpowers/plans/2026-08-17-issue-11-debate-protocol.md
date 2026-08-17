# Story #11: 4-Round Adversarial Debate Protocol & Deterministic Arithmetic Consensus — Implementation Plan

> **Specification**: [`docs/superpowers/specs/2026-08-17-issue-11-debate-protocol-design.md`](file:///home/varunmalhotra/Desktop/Forecasting_Agent/docs/superpowers/specs/2026-08-17-issue-11-debate-protocol-design.md)
> **Milestone**: MVP 1 (Story #11 / Story 8)
> **Approach**: Subagent-Driven Development (SDD) with strict Test-Driven Development (TDD) per task.

---

## Task Breakdown

### Task 1: PostgreSQL Migration `006_debate_rounds.sql` & Storage Layer
- **Goal**: Create the `debate_rounds` table migration and update storage methods to persist round-by-round signals and the Round 4 consensus artifact.
- **Files to Create/Edit**:
  - `harness/src/storage/migrations/006_debate_rounds.sql`
  - `harness/src/storage/postgres-store.ts`
  - `harness/tests/storage-debate-rounds.test.ts`
- **TDD Steps**:
  1. Write unit tests in `harness/tests/storage-debate-rounds.test.ts` asserting migration execution and round persistence/retrieval.
  2. Run `pnpm --prefix harness test tests/storage-debate-rounds.test.ts` (fails).
  3. Create `006_debate_rounds.sql` and add `saveDebateRound` and `getDebateRounds` in `PostgresStore`.
  4. Run `pnpm --prefix harness test tests/storage-debate-rounds.test.ts` (passes).
  5. Commit: `git add harness/src/storage/migrations/006_debate_rounds.sql harness/src/storage/postgres-store.ts harness/tests/storage-debate-rounds.test.ts && git commit -m "feat(storage): implement debate_rounds migration and storage layer"`

---

### Task 2: Strict Debate Wire Types & Zod Schemas
- **Goal**: Implement all strict Zod schemas and TypeScript types for Round 2 critique, Round 3 Devil's Advocate, and Round 4 Consensus.
- **Files to Create/Edit**:
  - `harness/src/debate/types.ts`
  - `harness/tests/debate-types.test.ts`
- **TDD Steps**:
  1. Write schema unit tests in `harness/tests/debate-types.test.ts` asserting strict validation, extra-key rejection (`.strict()`), and weight sum refinement.
  2. Run `pnpm --prefix harness test tests/debate-types.test.ts` (fails).
  3. Implement `harness/src/debate/types.ts`.
  4. Run `pnpm --prefix harness test tests/debate-types.test.ts` and `pnpm --prefix harness run typecheck` (passes).
  5. Commit: `git add harness/src/debate/types.ts harness/tests/debate-types.test.ts && git commit -m "feat(debate): define strict Zod schemas for multi-round debate"`

---

### Task 3: Deterministic Arithmetic Consensus Engine
- **Goal**: Implement the zero-LLM mathematical consensus module with canonical $P(\text{up})_i$ normalization, Brier score calibration, degradation health scaling, dispersion metric $\sigma_{\text{debate}}$, deadlock detection, and deterministic dual scenario extraction.
- **Files to Create/Edit**:
  - `harness/src/debate/consensus.ts`
  - `harness/tests/debate-consensus.test.ts`
- **TDD Steps**:
  1. Write mathematical tests in `harness/tests/debate-consensus.test.ts` (testing opposing direction dispersion, zero-division safeguard, health-discounted confidence, degradation penalties, and deadlock trigger).
  2. Run `pnpm --prefix harness test tests/debate-consensus.test.ts` (fails).
  3. Implement `calculateConsensus` and helper methods in `harness/src/debate/consensus.ts`.
  4. Run `pnpm --prefix harness test tests/debate-consensus.test.ts` (passes).
  5. Commit: `git add harness/src/debate/consensus.ts harness/tests/debate-consensus.test.ts && git commit -m "feat(debate): implement deterministic arithmetic consensus engine"`

---

### Task 4: Debate Prompt Templates & 4-Round Orchestrator
- **Goal**: Author Round 2 (`round2_critique.j2`) and Round 3 (`round3_devils_advocate.j2`) templates, implement the `DebateOrchestrator` state machine with weighted Devil's Advocate selection, and test full multi-round execution.
- **Files to Create/Edit**:
  - `harness/prompts/debate/round2_critique.j2`
  - `harness/prompts/debate/round3_devils_advocate.j2`
  - `harness/src/debate/orchestrator.ts`
  - `harness/tests/debate-orchestrator.test.ts`
  - `harness/tests/debate-deadlock.test.ts`
- **TDD Steps**:
  1. Write tests in `harness/tests/debate-orchestrator.test.ts` and `harness/tests/debate-deadlock.test.ts` with mocked LLM turns.
  2. Run `pnpm --prefix harness test tests/debate-orchestrator.test.ts tests/debate-deadlock.test.ts` (fails).
  3. Create prompt templates and implement `DebateOrchestrator.runDebate()`.
  4. Run tests and typecheck to confirm passing.
  5. Commit: `git add harness/prompts/debate/ harness/src/debate/orchestrator.ts harness/tests/debate-orchestrator.test.ts harness/tests/debate-deadlock.test.ts && git commit -m "feat(debate): implement 4-round orchestrator and prompt templates"`

---

### Task 5: Live 4-Round Adversarial Debate Smoke Test & Verification
- **Goal**: Create `run-real-debate.ts` and execute a live end-to-end 4-round debate against real market data on `TCS.NS`, verifying round-by-round persistence in PostgreSQL, valid walk-forward backtest, and Langfuse tracing.
- **Files to Create/Edit**:
  - `harness/scripts/run-real-debate.ts`
- **Steps**:
  1. Implement `harness/scripts/run-real-debate.ts`.
  2. Run full test suite: `pnpm --prefix harness test` and `uv run pytest`.
  3. Run live smoke test: `pnpm --prefix harness exec tsx --env-file=../.env scripts/run-real-debate.ts TCS.NS`.
  4. Verify PostgreSQL `debate_rounds` records and consensus output.
  5. Perform final whole-branch review via Pro model reviewer.
  6. Commit: `git add harness/scripts/run-real-debate.ts && git commit -m "feat(harness): add live debate smoke test and finalize Story #11"`

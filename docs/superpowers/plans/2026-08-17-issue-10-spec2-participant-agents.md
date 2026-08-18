# Story #10 Spec 2: Participant Intent Sub-Agents (FII, DII, Retail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 3 remaining participant-intent sub-agents (**FII**, **DII**, and **Retail**) with strict data asymmetry, capability-fenced FastMCP tools, Nunjucks prompt templates, and concurrent 4-agent parallel pipeline dispatch.

**Architecture:** The 4 participant sub-agents (`price`, `fii`, `dii`, `retail`) execute in parallel under `dispatchParticipantAgents()` using `Promise.allSettled`. Data asymmetry is enforced at runtime via `EvidenceValidationMiddleware` using a strict Zod `CapabilitySchema` enum. FII and DII leverage `fetch_flows` and `fetch_ohlcv`; Retail leverages `fetch_microstructure`, `fetch_option_chain`, and `fetch_ohlcv`. The `price` agent remains the canonical quantitative anchor generating `/workspace/model.py` for M8 walk-forward evaluation.

**Tech Stack:** TypeScript (Node.js/ESM, LangChain, deepagents, Zod, Nunjucks, Vitest), Python 3.12 (FastMCP, yfinance, Pytest), Docker sandbox, PostgreSQL (`agent_signals` table).

**Spec:** [`docs/superpowers/specs/2026-08-17-issue-10-spec2-participant-agents-design.md`](file:///home/varunmalhotra/Desktop/Forecasting_Agent/docs/superpowers/specs/2026-08-17-issue-10-spec2-participant-agents-design.md)

## Global Constraints

- **Strict Schema Enum**: `CapabilitySchema` must be `z.enum(['market_data', 'flows', 'macro', 'microstructure', 'sentiment'])`.
- **Zero-Safe Prompt Arithmetic**: All Python calculations inside prompts must use `max(1, denominator)` to prevent runtime divide-by-zero errors.
- **Missing Data Handling**: Prompts must instruct agents to emit `explicit_absence: true` when flow/microstructure/option data is empty (holidays/weekends).
- **TypeScript Strictness**: `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` must compile with 0 errors (`tsc --noEmit`).
- **TDD Requirement**: Every task begins with a failing unit test before implementing code.

---

### Task 1: FastMCP Option Chain Nearest-Expiry Fallback in Python

**Files:**
- Modify: `src/forecasting_agent/data_server/server.py:181-244`
- Test: `tests/data_server/test_server_options.py`

**Interfaces:**
- Produces: `fetch_option_chain(underlying: str, expiry: str | None = None, as_of: str | None = None) -> FnOChainResponse`

- [ ] **Step 1: Write the failing unit test**
  Create `tests/data_server/test_server_options.py` testing `fetch_option_chain` when `expiry` is omitted or `None`.
  ```python
  from datetime import date
  from unittest.mock import MagicMock, patch
  from forecasting_agent.data_server.server import fetch_option_chain


  def test_fetch_option_chain_defaults_to_nearest_expiry():
      with patch("forecasting_agent.data_server.server.yf.Ticker") as mock_ticker:
          instance = MagicMock()
          instance.options = ["2026-08-27", "2026-09-24"]
          mock_chain = MagicMock()
          mock_chain.calls = None
          mock_chain.puts = None
          instance.option_chain.return_value = mock_chain
          mock_ticker.return_value = instance

          res = fetch_option_chain(underlying="TCS.NS")
          assert res.expiry == date(2026, 8, 27)
          assert res.strikes == []
  ```

- [ ] **Step 2: Run test to confirm initial failure**
  Run: `uv run pytest tests/data_server/test_server_options.py`

- [ ] **Step 3: Implement optional expiry fallback in `server.py`**
  Update `fetch_option_chain` signature and body in `src/forecasting_agent/data_server/server.py`:
  ```python
  @app.tool()
  def fetch_option_chain(
      underlying: str,
      expiry: str | None = None,
      as_of: str | None = None,
  ) -> FnOChainResponse:
      if as_of is not None:
          as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
          today = date.today()  # noqa: DTZ011
          if as_of_date > today:
              raise LeakageError(f"as_of date {as_of_date} is in the future relative to today ({today})")

      ticker_symbol = underlying
      if not ticker_symbol.endswith((".NS", ".BO")) and not ticker_symbol.startswith("^"):
          ticker_symbol = f"{underlying}.NS"

      strikes_map: dict[float, dict[str, Any]] = {}
      resolved_expiry_date = None
      try:
          ticker = yf.Ticker(ticker_symbol)
          options = getattr(ticker, "options", [])
          if expiry:
              target_expiry = expiry
          elif options:
              target_expiry = options[0]
          else:
              target_expiry = str(as_of or date.today())

          resolved_expiry_date = date.fromisoformat(target_expiry)
          chain = ticker.option_chain(target_expiry) if target_expiry in options else ticker.option_chain()
          calls_df = chain.calls
          puts_df = chain.puts

          if calls_df is not None and not calls_df.empty:
              for _, row in calls_df.iterrows():
                  strike = float(row.get("strike", 0.0))
                  if strike <= 0:
                      continue
                  strikes_map.setdefault(strike, {})["call_ltp"] = float(row.get("lastPrice", 0.0) or 0.0)
                  strikes_map[strike]["call_oi"] = int(row.get("openInterest", 0) or 0)

          if puts_df is not None and not puts_df.empty:
              for _, row in puts_df.iterrows():
                  strike = float(row.get("strike", 0.0))
                  if strike <= 0:
                      continue
                  strikes_map.setdefault(strike, {})["put_ltp"] = float(row.get("lastPrice", 0.0) or 0.0)
                  strikes_map[strike]["put_oi"] = int(row.get("openInterest", 0) or 0)
      except Exception as exc:
          logger.debug("Failed to fetch option chain for %s (%s): %s", ticker_symbol, expiry, exc)

      strikes: list[StrikeData] = []
      for strike_price in sorted(strikes_map.keys()):
          info = strikes_map[strike_price]
          strikes.append(
              StrikeData(
                  strike_price=strike_price,
                  call_oi=max(0, info.get("call_oi", 0)),
                  put_oi=max(0, info.get("put_oi", 0)),
                  call_ltp=max(0.0, info.get("call_ltp", 0.0)),
                  put_ltp=max(0.0, info.get("put_ltp", 0.0)),
              )
          )

      return FnOChainResponse(
          underlying=underlying,
          expiry=resolved_expiry_date or (date.fromisoformat(as_of) if as_of else date.today()),
          strikes=strikes,
          data_stale=False,
      )
  ```

- [ ] **Step 4: Run test to confirm PASS**
  Run: `uv run pytest tests/data_server/test_server_options.py`

- [ ] **Step 5: Run full Python suite for zero regressions**
  Run: `uv run pytest`

- [ ] **Step 6: Commit**
  `git add src/forecasting_agent/data_server/server.py tests/data_server/test_server_options.py && git commit -m "feat(data-server): support optional expiry fallback in fetch_option_chain"`

---

### Task 2: Strict Capability Schemas & Evidence Validation Middleware

**Files:**
- Modify: `harness/src/agents/schema.ts`
- Modify: `harness/src/agents/types.ts`
- Modify: `harness/src/middleware/evidence-validation.ts`
- Test: `harness/tests/participant-schema.test.ts`
- Modify: `harness/tests/middlewares.test.ts`

**Interfaces:**
- Produces: `CapabilitySchema`, `Capability`, `EvidenceItemSchema`, `ParticipantAgentConfigSchema`, `buildEvidenceValidationMiddleware(agentName: string, allowedCapabilities: Capability[])`

- [ ] **Step 1: Write failing unit test in `harness/tests/participant-schema.test.ts`**
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { CapabilitySchema, EvidenceItemSchema } from '../src/agents/schema.js';
  import { ParticipantAgentConfigSchema } from '../src/agents/types.js';

  describe('Capability and Schema Strictness', () => {
    it('validates CapabilitySchema allowed literals and rejects unknown capabilities', () => {
      expect(CapabilitySchema.parse('market_data')).toBe('market_data');
      expect(CapabilitySchema.parse('flows')).toBe('flows');
      expect(CapabilitySchema.parse('microstructure')).toBe('microstructure');
      expect(CapabilitySchema.parse('sentiment')).toBe('sentiment');
      expect(CapabilitySchema.parse('macro')).toBe('macro');
      expect(() => CapabilitySchema.parse('unapproved_cap')).toThrow();
    });

    it('enforces CapabilitySchema on EvidenceItemSchema', () => {
      const valid = {
        claim: 'FII long index ratio expanded to 1.4',
        source_capability: 'flows',
        value: 1.4,
        explicit_absence: false,
      };
      expect(EvidenceItemSchema.parse(valid)).toEqual(valid);

      const invalid = {
        claim: 'Some claim',
        source_capability: 'invalid_cap',
        value: 1.0,
      };
      expect(() => EvidenceItemSchema.parse(invalid)).toThrow();
    });
  });
  ```

- [ ] **Step 2: Run test to confirm failure**
  Run: `pnpm --prefix harness test tests/participant-schema.test.ts`

- [ ] **Step 3: Implement strict types in `schema.ts`, `types.ts`, and `evidence-validation.ts`**
  1. In `harness/src/agents/schema.ts`:
     Define `CapabilitySchema` and enforce on `EvidenceItemSchema.source_capability`.
  2. In `harness/src/agents/types.ts`:
     Import `CapabilitySchema` and enforce `allowedCapabilities: z.array(CapabilitySchema)`.
  3. In `harness/src/middleware/evidence-validation.ts`:
     Update signature:
     ```typescript
     import type { AgentMiddleware } from 'langchain';
     import type { AgentSignal, Capability } from '../agents/schema.js';

     export function buildEvidenceValidationMiddleware(
       agentName: string,
       allowedCapabilities: Capability[],
     ): AgentMiddleware {
       return {
         name: 'evidence-validation',
         afterModel: (state) => {
           const resp = state.structuredResponse as Partial<AgentSignal> | undefined;
           if (!resp || !resp.evidence) return;
           for (const item of resp.evidence) {
             if (!item || !allowedCapabilities.includes(item.source_capability as Capability)) {
               console.warn(
                 `[${agentName}] Evidence source_capability '${item?.source_capability}' is outside allowed set: ${allowedCapabilities.join(', ')}. Marking signal degraded.`
               );
               resp.degraded = true;
               break;
             }
           }
         },
       };
     }
     ```

- [ ] **Step 4: Run tests and typecheck to confirm PASS**
  Run: `pnpm --prefix harness test tests/participant-schema.test.ts tests/middlewares.test.ts && pnpm --prefix harness run typecheck`

- [ ] **Step 5: Commit**
  `git add harness/src/agents/schema.ts harness/src/agents/types.ts harness/src/middleware/evidence-validation.ts harness/tests/participant-schema.test.ts harness/tests/middlewares.test.ts && git commit -m "feat(harness): enforce strict CapabilitySchema across evidence items and validation middleware"`

---

### Task 3: Participant Intent Prompt Templates (FII, DII, Retail)

**Files:**
- Create: `harness/prompts/fii.j2`
- Create: `harness/prompts/dii.j2`
- Create: `harness/prompts/retail.j2`
- Test: `harness/tests/participant-prompts.test.ts`

**Interfaces:**
- Produces: Prompt templates rendered by `renderPrompt()` in `harness/src/prompts/engine.ts`.

- [ ] **Step 1: Write failing unit test in `harness/tests/participant-prompts.test.ts`**
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { renderPrompt } from '../src/prompts/engine.js';
  import type { ParticipantAgentConfig } from '../src/agents/types.js';

  describe('Participant Prompt Templates', () => {
    const baseConfig: Omit<ParticipantAgentConfig, 'name' | 'promptTemplate' | 'roleTitle' | 'description' | 'allowedCapabilities' | 'dataLaneDescription' | 'workspaceSubpath' | 'allowedWritePaths' | 'tools'> = {
      skills: [],
      maxTokenBudget: 400_000,
      horizon_days: 1,
      generatedBy: 'human',
    };

    it('renders fii.j2 with fetch_flows tool and long/short ratio guidance', () => {
      const config: ParticipantAgentConfig = {
        ...baseConfig,
        name: 'fii',
        roleTitle: 'FII Intent',
        description: 'FII intent',
        promptTemplate: 'fii.j2',
        allowedCapabilities: ['market_data', 'flows', 'macro'],
        dataLaneDescription: 'flows',
        workspaceSubpath: 'fii',
        allowedWritePaths: ['/workspace/code/features/fii/**'],
        tools: ['fetch_flows', 'fetch_ohlcv'],
      };
      const rendered = renderPrompt(config, { symbol: 'TCS.NS', as_of: '2026-08-17' });
      expect(rendered).toContain('Foreign Institutional Investor (FII)');
      expect(rendered).toContain('fetch_flows(observed_on="2026-08-17"');
      expect(rendered).toContain('/workspace/code/features/fii/');
      expect(rendered).toContain('fii_long / max(1, fii_short)');
      expect(rendered).toContain('explicit_absence: true');
    });

    it('renders dii.j2 with absorption ratio and domestic floor guidance', () => {
      const config: ParticipantAgentConfig = {
        ...baseConfig,
        name: 'dii',
        roleTitle: 'DII Intent',
        description: 'DII intent',
        promptTemplate: 'dii.j2',
        allowedCapabilities: ['market_data', 'flows', 'macro'],
        dataLaneDescription: 'flows',
        workspaceSubpath: 'dii',
        allowedWritePaths: ['/workspace/code/features/dii/**'],
        tools: ['fetch_flows', 'fetch_ohlcv'],
      };
      const rendered = renderPrompt(config, { symbol: 'TCS.NS', as_of: '2026-08-17' });
      expect(rendered).toContain('Domestic Institutional Investor (DII)');
      expect(rendered).toContain('dii_long / max(1, dii_short)');
      expect(rendered).toContain('absorption capacity');
    });

    it('renders retail.j2 with delivery pct and PCR guidance', () => {
      const config: ParticipantAgentConfig = {
        ...baseConfig,
        name: 'retail',
        roleTitle: 'Retail Intent',
        description: 'Retail intent',
        promptTemplate: 'retail.j2',
        allowedCapabilities: ['market_data', 'microstructure', 'sentiment'],
        dataLaneDescription: 'microstructure',
        workspaceSubpath: 'retail',
        allowedWritePaths: ['/workspace/code/features/retail/**'],
        tools: ['fetch_microstructure', 'fetch_option_chain', 'fetch_ohlcv'],
      };
      const rendered = renderPrompt(config, { symbol: 'TCS.NS', as_of: '2026-08-17' });
      expect(rendered).toContain('Retail & Microstructure intent');
      expect(rendered).toContain('fetch_microstructure(observed_on="2026-08-17"');
      expect(rendered).toContain('fetch_option_chain(underlying="TCS.NS"');
      expect(rendered).toContain('deliverable_quantity / max(1, quantity_traded)');
      expect(rendered).toContain('Put-Call Ratio (PCR)');
    });
  });
  ```

- [ ] **Step 2: Run test to confirm failure**
  Run: `pnpm --prefix harness test tests/participant-prompts.test.ts`

- [ ] **Step 3: Author `harness/prompts/fii.j2`, `harness/prompts/dii.j2`, and `harness/prompts/retail.j2`**
  Write the prompt templates exactly as specified in Spec Section 5.

- [ ] **Step 4: Run test to confirm PASS**
  Run: `pnpm --prefix harness test tests/participant-prompts.test.ts`

- [ ] **Step 5: Commit**
  `git add harness/prompts/fii.j2 harness/prompts/dii.j2 harness/prompts/retail.j2 harness/tests/participant-prompts.test.ts && git commit -m "feat(prompts): add FII, DII, and Retail participant intent templates"`

---

### Task 4: Complete Participant Roster Configuration & Parallel Dispatch Testing

**Files:**
- Modify: `harness/src/agents/types.ts`
- Test: `harness/tests/multi-agent-roster.test.ts`
- Test: `harness/tests/evidence-fencing.test.ts`

**Interfaces:**
- Produces: Complete 4-agent `AGENT_CONFIGS` array in `types.ts`.

- [ ] **Step 1: Write unit tests in `harness/tests/multi-agent-roster.test.ts` and `harness/tests/evidence-fencing.test.ts`**
  1. `harness/tests/multi-agent-roster.test.ts`: Asserts `AGENT_CONFIGS` contains all 4 agents (`price`, `fii`, `dii`, `retail`) and `dispatchParticipantAgents` executes 4 agents in parallel, returning 4 signals with their respective `agent_name`.
  2. `harness/tests/evidence-fencing.test.ts`: Asserts that an agent returning a prohibited capability citation (e.g. `retail` citing `flows`, or `fii` citing `microstructure`) has `degraded: true` set by `EvidenceValidationMiddleware`.

- [ ] **Step 2: Run tests to confirm failure**
  Run: `pnpm --prefix harness test tests/multi-agent-roster.test.ts tests/evidence-fencing.test.ts`

- [ ] **Step 3: Populate all 4 agents in `AGENT_CONFIGS` in `harness/src/agents/types.ts`**
  Update `AGENT_CONFIGS` with `price`, `fii`, `dii`, `retail` objects matching Spec Section 3.2.

- [ ] **Step 4: Run tests and typecheck to confirm PASS**
  Run: `pnpm --prefix harness test tests/multi-agent-roster.test.ts tests/evidence-fencing.test.ts && pnpm --prefix harness run typecheck`

- [ ] **Step 5: Commit**
  `git add harness/src/agents/types.ts harness/tests/multi-agent-roster.test.ts harness/tests/evidence-fencing.test.ts && git commit -m "feat(harness): activate 4-participant agent roster (price, fii, dii, retail)"`

---

### Task 5: End-to-End Test Suite Verification & Live 4-Agent Pipeline Smoke Run

**Files:**
- Modify: `harness/tests/comprehension-gate.test.ts` (if needed to assert across all 4 agents)
- Verify: Full Vitest suite & Python pytest suite
- Live Run: `harness/scripts/run-real-multi-pipeline.ts`

- [ ] **Step 1: Run full TypeScript harness test suite**
  Run: `pnpm --prefix harness test` (All Vitest suites must pass with 0 failures).

- [ ] **Step 2: Run full Python evaluator test suite**
  Run: `uv run pytest` (All 227+ tests must pass with 0 failures).

- [ ] **Step 3: Run TypeScript compiler strict check**
  Run: `pnpm --prefix harness run typecheck` (`tsc --noEmit` must pass with 0 errors).

- [ ] **Step 4: Execute live 4-agent forecast pipeline on `TCS.NS`**
  Run: `pnpm exec tsx --env-file=../.env scripts/run-real-multi-pipeline.ts TCS.NS`
  Verify that `result.signals` contains valid signals for all 4 agents (`price`, `fii`, `dii`, `retail`), `evalResult.verdict.status` is `VALID`, and all 4 signals are persisted to PostgreSQL `agent_signals`.

- [ ] **Step 5: Commit final verification**
  `git commit --allow-empty -m "test(harness): verify 4-participant intent pipeline live end-to-end"`

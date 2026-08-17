---
type: adr
date: 2026-08-17
status: proposed
parent: "[[Forecasting Agent]]"
---

# Issue #10 (Participant Agents) — decisions log, not yet a formal spec

Captured from a long design conversation, to survive a session boundary before the formal
`writing-plans`-style spec is authored. Every item below was decided with the user in this
session; none of it is implemented yet. Next session should turn this into a real spec via
`reviewing-specs`' verify→ponytail→grill loop before any code is touched.

## Pre-flight findings (verified against real code/data, not assumed)

1. **`FlowRecord` has no `symbol` field.** NSE's Participant-wise OI report is market-wide, not
   per-stock — confirmed against NSE's live raw CSV tonight (`Client Type, Future Index Long,
   Future Index Short, Future Stock Long, Future Stock Short...`, no symbol column, checked back
   to April 2026). FII and DII agents cannot claim "FII sold this stock" — only "FII flow was
   negative market-wide, and this stock's own price/delivery reacted this way."
2. **`EvalRequest` has no `horizon` field; `PurgedWalkForward` raises on `horizon > 1`.** A real
   signal tonight (TCS.NS) emitted `horizon_days: 20` — unscoreable today. Decision: pin all
   agents to `horizon_days: 1` for now (see below), revisit multi-day once purging exists.
3. **The "pre-registered direction-resolution rule" issue #10 and two docs cite does not exist
   as a document.** It is one undocumented, untested line — `(returns > 0.0).astype(int)` in
   `evaluation/brier.py:14`. Needs to become a real, documented, tested rule as part of this
   story (see below).
4. **Issue #10 still lists #26 as a hard blocker** ("needed before this story ships, not
   after"). The user already overruled that sequencing tonight when deferring #26 — this is
   stale issue text, not a new blocker. Correct on the issue when work starts.
5. **`single-agent.ts` is hardcoded to exactly one agent (Price) by name** — `buildPriceAnchorAgent`
   is imported and called directly, no loop, no generic "build any agent" path. The file name
   itself assumes one agent. This must be generalized before FII/DII/Retail can be added without
   duplicating the whole pipeline three times.
6. **Prompts are hardcoded strings, not the `.j2` template files ADR-028 specifies.**
   `buildForecastPrompt(symbol, asOf)` in `single-agent.ts` builds Price's prompt as a plain
   string. No `harness/prompts/` directory exists. `nunjucks` is not installed.
7. **`workspace/code/features/<agent_name>/` does not exist.** Issue #10 requires this scaffold
   for agents to write their Python into; nothing has been created yet.
8. **Sandbox concurrency is `Semaphore(2)`** (`harness/src/sandbox/manager.ts`), already built
   and tested from #7. Running all 4 agents in parallel is safe — thinking/tool-calls have no
   limit, only the Docker execution step is throttled to 2 at a time, automatically.

## Decisions locked in tonight

### Scope split
- **Two separate specs, not one.** Spec 1 = harness generalization only (this doc's scope).
  Spec 2 = FII/DII/Retail agents, written only after Spec 1 is built and re-verified with Price
  running through the new path. Rationale: prove the shared foundation once, cheaply, on the
  agent that already works, before 3 new agents depend on it.

### Agent roster
- **Exactly 4 agents, fixed: Price, FII, DII, Retail.** Not dynamic. ADR-022's calibration
  weighting (an agent's trust score builds over repeated runs) requires a stable identity across
  runs — a dynamically-renamed/reshaped roster has no persistent record to weight against. The 4
  map to real NSE disclosure categories, not an arbitrary choice. Dynamic agent selection is a
  legitimate future story, explicitly deferred, not rejected — revisit once there's a real,
  working fixed-4 baseline to justify redesigning around.
- **Leave a `generatedBy: "human" | "agent"` field on the agent config now, unused.** Costs
  nothing today (every config sets `"human"`), but means a future "harness generates its own
  agent config" story doesn't require redesigning the config shape — just start populating that
  field.

### The generalization itself
- **Replace 4 hypothetically-separate `buildXAgent()` functions with one
  `buildParticipantAgent(config)`.** Price/FII/DII/Retail become config objects fed into the same
  function, not 4 separately-named functions. This is what actually protects future extensibility
  (a 5th agent, or a dynamically-generated one) — otherwise every new agent means writing new
  code, not just new data.
- **The pipeline holds one list of agent configs and loops over it**
  (`for config of AGENT_CONFIGS: run buildParticipantAgent(config)`), rather than hardcoding
  named calls to each agent. Adding a 5th agent later means appending to the list, not editing
  the loop.
- **Prompts move to real `.j2` template files**, one per agent, loaded via the ADR-028-specified
  mechanism (`nunjucks` at runtime). Not a rebuild of the agent wiring — only the prompt-delivery
  piece changes. Price's existing hardcoded prompt gets migrated as part of this work, since the
  file is already being touched.
- **`workspace/code/features/<agent_name>/`** — separate subfolder per agent (matches the issue's
  literal `<agent_name>` pattern), not one shared folder, to avoid a naming collision when two
  agents run in parallel and happen to write a same-named file at the same moment.

### Direction / horizon / scoring
- **`horizon_days` is forced to exactly `1` in the schema itself** (not merely convention) — the
  scorer cannot grade anything else today, and issue #10 already showed a real crash risk from a
  claimed value the scorer can't honor.
- **Flat-day rule: a day with zero price movement counts as "not up."** Matches the existing
  one-line rule (`returns > 0.0`) exactly — this is documentation + a real test, not a behavior
  change. Direction stays strictly binary (`up`/`down`) — no third "neutral"/"flat" option. This
  was already rejected once in the 2026-08-14 design review specifically because a neutral option
  lets an agent dodge making a scorable claim, which destroys the calibration record ADR-022's
  weighting depends on, and because Brier scoring requires a binary event to be mathematically
  well-defined at all.

### FII / DII framing
- **Market-wide flow + the target stock's own reaction, not a false stock-specific flow claim.**
  Honest framing given finding #1 above: "FII flow was net negative market-wide today, and this
  stock's price/delivery reacted like X" — correlation stated as correlation, not causation.
- **FII and DII share the data-fetching/logic code** (one module, each supplies which flow number
  to read — foreign vs domestic), **but each gets its own separate `.j2` prompt file** rather than
  one shared prompt template — their reasoning framing can genuinely differ even though the
  underlying data-fetch mechanism doesn't.

### Missing data handling
- **A dedicated explicit-absence field/flag in the evidence shape**, not free text and not a
  silent `0`. Many symbols have no FII/DII participant-OI coverage at all (index/stock-F&O level
  only). A silent zero would read as "no flow happened" when the truth is "no data exists" —
  issue #10's own testing checklist calls this out by name.

### Retail scope
- **Retail ships on flows + delivery only, for now.** News/sentiment input depends on #21
  (search, done) + #22 (FinBERT, in progress in its own session) — not blocking, added later once
  #22 lands, same pattern as every other deferral tonight.

### Failure handling
- **One agent failing twice (existing retry-once pattern exhausted) marks that agent
  degraded — the run continues with the remaining agents**, rather than failing the whole
  forecast. Consistent with how a search-quota shortfall is already handled (`degraded=true`
  tagging exists in the schema/pipeline already for the search case).

### Concurrency
- **All 4 agents launch in parallel.** Thinking/tool-calls have no concurrency limit; the
  existing `Semaphore(2)` on Docker execution (#7, already tested) automatically staggers the
  code-execution moments — no new concurrency-management code needed.

### Testing
- **Each agent's tests are written alongside that agent**, by whoever builds it, matching the
  "build FII/DII/Retail in parallel" decision — not deferred to a single pass at the end (which
  would repeat the exact mistake the Comprehension Gate was added tonight to prevent: building
  before verifying).

## Explicitly deferred / out of scope for Spec 1 and Spec 2

- Multi-day horizons (needs `PurgedWalkForward` purging support — separate future story)
- Dynamic/harness-generated agent rosters (the `generatedBy` field reserves space for this, but
  no code implements it yet)
- Retail's news/sentiment input (depends on #22, not blocking)
- #26's factor baseline ladder (already deferred earlier tonight, unrelated blocker corrected)

## Open, not yet answered when this was saved

- Exact shape of `invokeAgentTurn`/retry/timeout handling once genericized across 4 agents (was
  mid-investigation of `harness/src/pipeline/agent-turn.ts` when this was captured)
- How MCP tool-loading should be scoped per-agent (deep-lane vs one-line-summary access, per
  ADR-023) — not yet designed at the code level
- Langfuse tracing shape when 4 agents run in one debate round instead of 1
- Whether to survey other open-source agent harnesses (Codex, others) for prior art on the
  "harness decides vs agent decides" boundary before finalizing Spec 1 — user requested this,
  explicitly deferred to next session due to a usage checkpoint rather than rushed tonight

## Next session should

1. Do the external prior-art research the user asked for (how other agent harnesses like Codex
   draw the "harness owns vs agent owns" boundary) before finalizing Spec 1.
2. Turn this decisions log into a real spec via `reviewing-specs` (verify → ponytail → grill,
   two consecutive `APPROVED` rounds) — this document is not that spec.
3. Only after Spec 1 clears review: write the implementation plan, delegate, verify cold.
4. Spec 2 (FII/DII/Retail) waits until Spec 1 is built and re-verified with Price running
   through the new generalized path.

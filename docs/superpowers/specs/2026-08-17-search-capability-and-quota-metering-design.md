---
type: adr
date: 2026-08-17
status: proposed
parent: "[[Forecasting Agent]]"
---

# M3 Search Capability & Per-Run Quota Metering — Design Spec

**Issue:** #21 · **ADRs:** ADR-010 (AnySearch via its MCP server), ADR-017 (per-run budget allocation, run-scoped cache, graceful degradation), ADR-015 (config-driven capability binding), ADR-020 (Redis as run state) · **Depends on:** #4 (capability layer, merged), Redis (running), #8 (Postgres storage, merged) · **Blocks:** #10 Retail lane

## 0. Provider facts — verified live, not from documentation

Every claim in this section was obtained by calling the real server on 2026-08-16/17. This matters because ADR-010 left five open items marked "confirm before implementation," and #19 set the precedent that provider facts get verified against the wire, not a README.

| Open item (ADR-010) | Verified answer | How |
|---|---|---|
| Package / endpoint | `https://api.anysearch.com/mcp` | `initialize` → `200`, `serverInfo: {name: "anysearch-mcp-server", version: "1.0.0"}` |
| Transport | Streamable HTTP, protocol `2025-03-26`. Stateless — no `Mcp-Session-Id` returned. | Response headers on `initialize` |
| Auth scheme | `Authorization: Bearer <key>`. **Anonymous access also works** — `initialize`, `tools/list` and a real `search` all returned `200` with no credential. | Live calls with no auth header |
| Tools exposed | `search`, `batch_search`, `extract`, `get_sub_domains` | `tools/list` |
| Date-range filtering | **Not supported.** No date, recency, or time-window parameter on any tool. | Full `inputSchema` dump |
| Domain filtering | **Not a site allowlist.** `domain` is a 17-value vertical routing enum (`general`, `finance`, `academic`, …); `sub_domain` routes within a vertical. Neither restricts results to specific publishers. | Full `inputSchema` dump |
| Quota readable from server | **No.** Zero rate-limit or quota headers on any response (`content-type`, `date`, `x-request-id`, CloudFront headers only). | Response header dump on `initialize` and `tools/call` |

Two further findings that shape the design and appear in no document:

**Results are an unstructured markdown blob, not structured JSON.** A `tools/call` on `search` returns `result.content = [{type: "text", text: "..."}]` — one text item, 20,592 bytes for 5 results. There is no `structuredContent`, no per-result object, no `published_date`. The blob's internal shape is:

```
## Search Results (5 results, 287ms)

### 1. <title>
- **URL**: <url>
<body text>

### 2. <title>
...
```

**A representative Indian-equity query is mostly off-allowlist, and hostnames carry `www.`.** Two live queries:

| Query | Hostnames returned | Survive the Session-6 allowlist |
|---|---|---|
| `Reliance Industries share price news today NSE` | etnownews.com, google.com, economictimes.indiatimes.com, livemint.com, cnbctv18.com | 2 / 5 |
| `Reliance Industries quarterly results NSE` | www.business-standard.com, economictimes.indiatimes.com, www.moneycontrol.com, www.cnbctv18.com, www.etnownews.com | 2 / 5 |

Two things follow. The allowlist is a **strong** filter (2/5 both times), not a formality, so it must be config-driven and widenable against evidence. And results arrive as `www.moneycontrol.com`, not `moneycontrol.com` — a hostname equality check would reject every allowed result. Suffix matching is a correctness requirement, not a nicety (§7).

## 0a. Design decisions this spec makes on its own

ADR-010 and ADR-017 already carry the four-part analysis for *whether* to use AnySearch and *how* to meter it. Three choices below are this spec's, not theirs, so they get the same treatment per CLAUDE.md's design-decision rule.

**Client-side markdown parsing (§0 forces it; the choice is how to fail).**
- *Pros:* the only way to get per-result URLs at all, since the provider ships one text blob. Enables the allowlist, per-result archiving, and rank preservation. Pure function, testable against real captured bytes with no network.
- *Cons:* couples us to an unversioned, provider-controlled format. A silent format change is a silent capability loss.
- *Fits best:* providers that return human-readable output and no structured alternative — exactly this one.
- *Doesn't suit:* any provider offering `structuredContent` or a JSON schema; if AnySearch adds one, the parser should be deleted, not maintained alongside it.

**A separate `search_observations` table instead of `observation_archive` (§8).**
- *Pros:* grain matches (one row per result per query per run); a `query` column exists, which the AC requires; no unique-index collision between runs; removes any dependency on #19's unmerged branch.
- *Cons:* a second archive concept in the schema, and "the observation archive" now means two tables to anyone reading the AC literally.
- *Fits best:* observation streams whose natural key is a request, not a calendar day.
- *Doesn't suit:* the daily-file downloads `observation_archive` was built for — those genuinely want dedup on `(source, observed_on, sha256)`, which would be wrong here.

**`ioredis` with hand-written Lua rather than a queue/lock library (§5).**
- *Pros:* every mutation is one atomic server-side script, which is the actual requirement; no extra abstraction between us and semantics we need to reason about precisely; `defineCommand` gives typed call sites.
- *Cons:* Lua is a second language in the codebase with no type checking and no debugger; correctness rests on tests against a real Redis, which is why every script invariant in §12 is exercised against one rather than a mock.
- *Fits best:* small, fixed sets of multi-key invariants — exactly four scripts here, none likely to grow.
- *Doesn't suit:* anything needing fair queueing, leases, or renewal; a real lock manager earns its keep there, and this design has none of those needs.

## 1. Purpose

Give the harness a metered, cached, provider-agnostic `search` capability so #10's Retail lane has a sentiment source, and so ADR-017's cost bound — *cost per forecast is bounded and predictable* — is enforced by construction rather than by hope.

The design point ADR-017 settled and this spec implements: metering is **per-run budget allocation**, not a global counter. A global counter enforces the ceiling but loses fairness and attribution — one buggy run at 09:00 exhausts the day and makes every later forecast `degraded=true`. Allocation makes the budget the accounting unit, so a runaway run exhausts only itself.

## 2. Components

```
harness/src/search/
  types.ts            -- SearchResult, SearchOutcome, SearchCapability, SearchRunLifecycle, error classes
  parser.ts           -- AnySearchResultParser: markdown blob -> SearchResult[]
  allowlist.ts        -- DomainAllowlist: hostname suffix matching, config-driven
  provider.ts         -- AnySearchProvider: MCP tools/call -> parse -> SearchResult[]; implements CapabilityProvider.healthCheck
  budget.ts           -- SearchBudgetLedger: claim / spend / release, Redis + Lua
  cache.ts            -- RunScopedSearchCache: normalise -> Redis get/set, run-scoped TTL
  capability.ts       -- AnySearchCapability: composes the six below; implements SearchCapability (agents) + SearchRunLifecycle (pipeline)
  tool.ts             -- buildSearchTool(capability, runId): the metered StructuredTool the LLM sees (§3a)
  redis.ts            -- createRedisClient(config): ioredis factory + graceful close
harness/src/storage/
  migrations/004_search_observations.sql
  repository.ts       -- + saveSearchObservations(); saveForecast() gains `degraded`
harness/src/config.ts -- McpServerSchema becomes a stdio | http union; new `search` config block
```

New dependency: **`ioredis@^6.0.0`** (installed and verified; `engines.node >= 20`, satisfied by the harness's `>=24`). Chosen over `node-redis` for first-class `defineCommand` Lua scripting — every mutation here must be a single atomic script — and because Redis is already the project's run-state store per ADR-020.

**Import it as `import { Redis } from 'ioredis'`, never as a default import.** ioredis v6 ships CJS with `export { default } from "./Redis"`, and under this repo's `module: NodeNext` + `verbatimModuleSyntax: true` the default form resolves to a namespace object. Verified:

```
import Redis from 'ioredis'    -> TS2709 Cannot use namespace 'Redis' as a type
                                  TS2351 This expression is not constructable   (13 further errors)
import { Redis } from 'ioredis' -> tsc --noEmit exit 0 under the harness's exact strict flags
```

This is the kind of detail that costs an implementation round if the spec asserts the package name and stops there.

**Composition, not inheritance.** `AnySearchCapability` owns six collaborators and coordinates them; none of them know about each other. The first two are pure and need no infrastructure at all to test:

- `AnySearchResultParser` — bytes in, `SearchResult[]` out. Pure.
- `DomainAllowlist` — `SearchResult[]` in, partitioned out. Pure.
- `SearchBudgetLedger` — Redis only. Knows nothing about search.
- `RunScopedSearchCache` — Redis only. Knows nothing about budgets.
- `AnySearchProvider` — MCP only. Knows nothing about budgets or caching.
- the storage `Pool` — passed to `saveSearchObservations` at §4 step 7. Listed because it is a real constructor dependency, easy to miss when reading §4 in isolation.

This is the Dependency Inversion point ADR-015 requires: agents receive a `SearchCapability` typed against the `search` capability name and never learn the provider's identity.

## 3. The one method agents see

```ts
// What agents receive. One method. It knows nothing about runs beginning or ending.
interface SearchCapability extends CapabilityProvider {
  search(runId: string, query: string): Promise<SearchOutcome>;
}

// What the pipeline receives. Agents never see this.
interface SearchRunLifecycle {
  beginRun(runId: string): Promise<number>;   // returns the granted budget
  endRun(runId: string): Promise<number>;     // returns the refunded remainder
}

// One class implements both; each consumer is typed against only what it uses.
class AnySearchCapability implements SearchCapability, SearchRunLifecycle { /* ... */ }

interface SearchOutcome {
  results: SearchResult[];   // allowlist-filtered, possibly empty
  source: 'provider' | 'cache' | 'degraded';
  degraded: boolean;         // true once this run has been denied budget at least once
}
```

The split is Interface Segregation doing real work, not ceremony. An agent handed `beginRun`/`endRun` could claim a second budget or release its own mid-run; an agent typed against `SearchCapability` cannot express either. And the pipeline, typed against `SearchRunLifecycle`, never imports `SearchBudgetLedger` — it does not need to know a ledger exists, which is the Dependency Inversion point ADR-015 asks for at every service boundary.

`endRun` is also the single place where **both** run-scoped stores are torn down: `ledger.release(runId)` and `localDegraded.delete(runId)`. Splitting those across two callers is how one of them gets forgotten.

`SearchOutcome.degraded` is sticky per run: once a run is denied, every subsequent outcome in that run reports `degraded: true`, including cache hits. A run that ran out of budget produced a forecast on partial evidence, and that is true of the whole run, not of one call.

**`CapabilityMap` must be narrowed for this to be callable at all.** `harness/src/capabilities/types.ts` currently declares `search: CapabilityProvider`, and `CapabilityProvider` has only `healthCheck?`. Verified — `registry.resolve('search').search(runId, q)` fails to compile:

```
TS2339: Property 'search' does not exist on type 'CapabilityProvider'.
```

The fix is one line, following the precedent already in the file: `search: SearchCapability`, exactly as `market_data: MarketDataProvider` does today. Confirmed that precedent works — `registry.resolve('market_data').fetch_ohlcv(...)` compiles clean through the same generic. Without this change the capability is registrable but unusable, which is the kind of gap that reads fine in prose and stops an implementer cold.

Stickiness is stored, not inferred — the `degraded` field on the run hash (§5), so it survives a resumed run and so a cache hit can report it without re-deriving why. Two more ledger operations, both one-liners, both listed here because §5's three scripts do not cover them:

```ts
markDegraded(runId): Promise<boolean>  // guarded Lua below; false if the run key is gone
isDegraded(runId):   Promise<boolean>  // HGET search:run:{id} degraded === '1'
```

`markDegraded` **must be Lua**, and the reason was found by testing rather than reasoning. A plain `HSET search:run:{id} degraded 1` on a missing or expired key does not no-op — Redis creates the hash, and the new key inherits **no TTL**:

```
HSET on missing key -> exists: 1  ttl: -1     (immortal key, leaked forever)
```

Since `markDegraded` fires exactly when a run has been denied budget — which includes the case where the run key expired mid-run (`spend` returned `-1`) — the un-guarded version leaks a permanent key on precisely the path it is meant to handle. The guard:

```lua
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'degraded', 1)
return 1
```

Verified: returns `0` and creates nothing on a missing key; returns `1`, sets the field, and leaves the existing TTL untouched (600 → 600) on a live key.

`isDegraded` is a plain `HGET` and needs no guard — a missing key reads as `null`, which is correctly falsy.

**A process-local backstop covers the case where the Redis flag is gone.** If the run key expires mid-run, `markDegraded` correctly refuses to resurrect it — but then `isDegraded` reads `false`, the run finishes, and its forecast is persisted with `degraded = false` despite having searched on an exhausted or lost allocation. That is silent, and it is precisely the con ADR-017 names: "`degraded=true` results need consistent handling everywhere downstream or they will silently pollute evaluation." A forecast wrongly marked clean is worse than one wrongly marked degraded, because evaluation cannot exclude what it cannot see.

`AnySearchCapability` — the class, not the interface — therefore holds a private `Set<string>` of run ids it has degraded in this process, and reports `degraded = redisFlag || localDegraded.has(runId)`. No new store, and it fails in the safe direction. The Redis field is still the primary — it is what survives a resumed run in a fresh process — and the set is what survives a lost key in a live one. Neither alone covers both.

**The set is cleared in `endRun`**, alongside the ledger release — which is exactly why both live behind one method (§3). Without the delete the harness accumulates every run id it has ever degraded for the lifetime of the process, unbounded in the long-running configuration this eventually ships as. A backstop that leaks is a bug wearing a safety net's clothes.

## 3a. How the agent actually reaches it — the metered tool wrapper

`SearchCapability` is a plain object. Agents in this codebase do not consume objects; `buildPriceAnchorAgent({ tools })` takes `StructuredTool[]`, and `single-agent.ts` fills that array from `mcpClient.getTools()`. Nothing in §3 is reachable by an LLM until it is a tool. This is the seam where the whole design succeeds or is silently bypassed, so it is specified rather than left implied.

```ts
// harness/src/search/tool.ts
export function buildSearchTool(capability: SearchCapability, runId: string): StructuredTool {
  return tool(
    async ({ query }) => JSON.stringify(await capability.search(runId, query)),
    {
      name: 'search_news',
      description: 'Search recent Indian financial news. Returns results from approved financial portals only.',
      schema: z.object({ query: z.string().min(1).describe('One search intent, in natural language.') }),
    },
  );
}
```

Verified: `tool()` from `@langchain/core/tools` returns a `DynamicStructuredTool`, which is a `StructuredTool` — the exact type `buildPriceAnchorAgent` accepts.

Two rules follow, and both are load-bearing:

1. **The raw AnySearch MCP tools never enter the agent's tool array.** `single-agent.ts` currently does `tools = await mcpClient.getTools()` for the market-data server and passes the lot. If the AnySearch server were connected the same way, the LLM would receive the provider's own unmetered `search` alongside our wrapper and could call either. The search server is therefore connected only *inside* `AnySearchProvider`, never through the pipeline's general tool-collection path.
2. **`runId` is bound at construction, not passed by the model.** If `forecast_run_id` were a tool parameter, an LLM could supply another run's id and spend its budget — an unlikely accident and a trivial exploit, and either way the accounting unit stops being trustworthy. Closing it over the run makes the wrong value unrepresentable rather than merely discouraged.

This also keeps the agent's prompt surface honest: the model sees one tool called `search_news`, not four provider tools plus a budget concept it has no business reasoning about.

**Where it all gets constructed.** `harness/scripts/run-real-pipeline.ts` is the only real entrypoint, and it currently builds `Pool`, config, and nothing else before calling `runSingleAgentPipeline`. It gains: the `ioredis` client, `SearchBudgetLedger`, `RunScopedSearchCache`, `AnySearchProvider`, and the `AnySearchCapability` composed from them — then registers that capability and awaits `validateAll()` (§9). The capability is passed into `runSingleAgentPipeline`, which calls `beginRun`/`endRun` and builds the per-run tool via `buildSearchTool(capability, runId)`, appending it to the `tools` array alongside the market-data tools. Naming this is not pedantry: §3a's wrapper needs a `runId` that only exists inside `runForecast`, while the capability itself is process-scoped, so the two are constructed at different levels and an implementer who guesses will put them in the same place.

## 3b. Cost meter — the AC subtask with no consumer yet

Issue #21 lists "emit spend per run into the cost meter feeding ADR-011's meta-metrics." **No cost meter exists in this repo** — nothing named or shaped like one appears anywhere. Rather than invent an interface with no consumer, or quietly drop the subtask, this design emits the number into the one place that already aggregates per-run facts.

Settled spend is derivable with no extra bookkeeping: `endRun` returns the refunded remainder, and `beginRun` returned the grant, so `spend = granted − refunded`. `runForecast` already calls `trace.update({ metadata: { symbol, runId } })`, and `TraceHandle.update` accepts an arbitrary `metadata` record — verified in `tracing/langfuse.ts`. So:

```ts
trace.update({ metadata: { symbol, runId, search_granted, search_spent, search_degraded } });
```

Four fields, no new subsystem, and the run's search cost lands on the same Langfuse trace as everything else ADR-011 will want to join against. When a real cost meter is built it reads these; until then the number is recorded rather than lost. Stated as a deliberate minimum, not as a claim that the cost-meter subtask is fully built.

## 4. Data flow

`isDegraded(runId)` below is shorthand for the combined check of §3 — `await ledger.isDegraded(runId) || localDegraded.has(runId)` — never the Redis field alone.

```
search(runId, query)
  1. normalised = normalise(query)                    -- NFKC, lowercase, collapse whitespace, trim
  2. cached = cache.get(runId, normalised)
       hit  -> return { results: cached, source: 'cache', degraded: isDegraded(runId) }          [0 units]
  3. granted = ledger.spend(runId, units = 1)         -- atomic Lua
       denied -> ledger.markDegraded(runId)           -- guarded Lua; may be a no-op if the key is gone
                 localDegraded.add(runId)             -- the backstop that makes the no-op harmless
                 return { results: [], source: 'degraded', degraded: true }                      [0 units]
  4. raw = provider.call('search', { query, max_results })   -- MCP tools/call, AbortSignal-bounded
  5. parsed = parser.parse(raw)                       -- throws SearchResponseFormatError on shape drift
  6. { allowed, rejected } = allowlist.partition(parsed)
  7. repository.saveSearchObservations(pool, runId, query, normalised, [...allowed, ...rejected])
  8. cache.set(runId, normalised, allowed)            -- TTL = run_ttl_seconds
  9. return { results: allowed, source: 'provider', degraded: isDegraded(runId) }
```

Step 3 writes the degraded flag to **both** stores unconditionally. Writing only Redis would leave the flag lost exactly when `markDegraded` is a no-op — the expired-key case — which is the hole §3's backstop exists to close.

**Lifecycle call sites.** Run boundaries belong to the pipeline, in `harness/src/pipeline/single-agent.ts`, against the `SearchRunLifecycle` interface:

- `beginRun(runId)` in `runForecast()`, immediately after the MCP client connects and before the first `agent.invoke()`. Internally: `ledger.claim(runId, initial_run_budget)`. The returned grant is logged via the existing `logStage()`.
- `endRun(runId)` in `runForecast()`'s **existing `finally` block**, alongside `adapter.dispose()` and `mcpClient.close()`. Internally: `ledger.release(runId)` plus the local-set delete. That block already runs on success, on validation failure, and on throw, so ordinary failures refund without new machinery.

Naming the seam matters because a claim placed inside `search()` would re-claim on every call, and §5's idempotence guard would then silently mask the mistake rather than surface it.

Order is deliberate at three points:

- **Cache before budget.** A repeat query inside a run must cost zero units — that is the effective-quota multiplier ADR-017 is built on, and the reason every debate round sees identical evidence.

  **The ~4× figure holds for sequential repeats only, and this design does not yet deliver it under concurrency.** ADR-017 justifies the multiplier with "3 sub-agents × 4 rounds produce heavily overlapping queries." If those sub-agents run *concurrently*, two identical queries both miss the cache, both spend a unit, and both call the provider — steps 2 and 3 are not atomic with respect to each other, and there is no single-flight guard. The fix is a small in-flight `Map<cacheKey, Promise<SearchOutcome>>` so the second caller awaits the first's result instead of issuing its own request. It is **deferred**, not overlooked: the pipeline is single-agent today, so no two searches in a run can overlap, and a guard written now would be untestable against the concurrency pattern it is meant to handle. It must land with the multi-agent debate (#10 onward), and until it does the honest claim is "up to ~4× on sequential overlap," not "~4×."
- **Spend before the provider call, and no refund on provider failure.** If the HTTP call fails after we decremented, the unit stays spent. We cannot know whether AnySearch counted it server-side, so we over-count rather than under-count. Under-counting would breach the ceiling this story exists to enforce.
- **Persist before caching, and persist rejects too.** Everything the provider returned is archived, including allowlist-rejected results (`allowed = false`). The allowlist is a guess that will be re-tuned; retrospective tuning is only possible if the rejected results were kept. Persistence is not conditional on the filter's opinion.

**An archive write failure is fatal to the run, not swallowed.** The AC requires every result persisted, and a result the evaluation stack cannot see is a forecast that cannot be reproduced — ADR-011's validity gate depends on the evidence trail existing. Swallowing the error would return good-looking results while silently voiding that guarantee. This is also the consistent choice: the run already dies at `saveForecast()` if Postgres is down, so a search that survives a dead archive would only defer the same failure to a later, more confusing point. The spent unit is not refunded (see above).

**Every provider call is bounded by a timeout.** `AnySearchProvider` takes `provider_timeout_ms` (default 15000) and passes `AbortSignal.timeout(provider_timeout_ms)` as `config.signal` on the tool invocation. No signal composition: `search()` takes no caller-supplied signal because nothing calls it with one, and `healthCheck(signal)` simply forwards the registry's signal, which `CapabilityRegistry.#probe` has already bounded at 5s. `AbortSignal.any()` was considered and dropped — it exists and composes correctly on this runtime (verified), but adding it now would be one more branch guarding a caller that does not exist. It stays additive. `Promise.race` is not sufficient: the losing promise keeps its socket open and holds the event loop, which is the same class of failure `single-agent.ts` already carries a comment about for the MCP child process. An unbounded provider call would hang a forecast run indefinitely with the unit already spent, and nothing upstream imposes a deadline.

Verified against the live server: `tool.invoke(args, { signal: AbortSignal.timeout(50) })` rejected after **51 ms**. But note the shape of what comes back —

```
ToolException: Error calling tool search: McpError: MCP error -32001: TimeoutError: The operation was aborted due to timeout
```

— the adapter wraps the abort in a `ToolException` whose class carries no timeout marker. So `SearchProviderTimeoutError` is raised by **checking our own `signal.aborted` in the catch block**, never by string-matching `"TimeoutError"` in the message. The message text is three layers of third-party formatting deep and will not survive a dependency bump.

## 5. Budget ledger — Redis keys and atomicity

Three key shapes — one hash per run, one counter per IST day, and one cache entry per distinct query within a run:

| Key | Type | Contents | TTL |
|---|---|---|---|
| `search:run:{forecast_run_id}` | hash | `granted`, `remaining`, `degraded` | `run_ttl_seconds` (default 21600 = 6h) |
| `search:quota:{YYYY-MM-DD}` | string | integer count of units **allocated and not yet returned** | `EXPIREAT` next IST midnight + 1h grace |
| `search:cache:{forecast_run_id}:{sha256(normalised_query)}` | string | JSON array of the allowlist-**filtered** results | `run_ttl_seconds` |

The cache key hashes the normalised query rather than embedding it. An agent-authored query is unbounded text and may contain spaces, newlines, or colons — all legal in a Redis key but hostile to `KEYS`-style debugging and to the key-shape convention above, and an unbounded key wastes memory proportional to the query. A fixed-width SHA-256 is one line and removes the whole class of concern. Collisions are not a practical consideration at this cardinality.

Storing the **filtered** set, not the raw set, is what makes the cache honour ADR-017's reproducibility goal: a later hit within the run returns byte-identical results to the first call, including the allowlist's verdict. Caching pre-filter results and re-filtering on read would let a config reload mid-run change what a "cached" result contains.

**What the daily key actually bounds, stated precisely because "2,000/day cap" is misleading on its own.** It counts *outstanding allocations plus settled spend*, not raw searches issued. While a run is live its full grant is debited even if it has spent 3 of 20; the remainder is credited back at `release`. Two consequences the operator needs to know:

- The ceiling on **fully-funded concurrent runs** is `daily_cap / initial_run_budget` = 100, independent of how little each one searches. The 101st is not rejected — partial grant gives it 0 and it starts degraded, which is the designed behaviour, not an edge case.
- End-of-day, the key equals the day's true spend, because every completed run returned its unused remainder. Verified: a run granted 20 that spent all 20 refunds 0 and the counter correctly retains 20; a run granted 20 that spent 0 refunds 20 and the counter returns to its prior value.

This is the intended behaviour of allocation — reserving capacity is the mechanism that makes per-run cost bounded — but it is a different quantity from "2,000 searches happened," and the cost meter feeding ADR-011 must read settled spend, not this key mid-day.

The daily key's date component and its expiry are both computed in **Asia/Kolkata**, not UTC and not "86400 seconds from first write." A relative `EXPIRE` drifts the window by the write latency every day; over a month the "daily" boundary walks measurably. The date string and the `EXPIREAT` target come from the same IST clock so they cannot disagree.

Four Lua scripts in total — `claim`, `spend`, `release` here, and `markDegraded` in §3. Each is a single script because each either spans two keys or must not create one, and this repo already runs four concurrent sessions:

**`claim(runId, n)`** — idempotent, partial-grant.
```lua
-- KEYS[1]=runKey KEYS[2]=dailyKey  ARGV[1]=n ARGV[2]=dailyCap ARGV[3]=runTtl ARGV[4]=midnightEpoch
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {tonumber(redis.call('HGET', KEYS[1], 'granted')), 1}   -- already claimed; do NOT re-allocate
end
local used  = tonumber(redis.call('GET', KEYS[2]) or '0')
local grant = math.min(tonumber(ARGV[1]), tonumber(ARGV[2]) - used)
if grant < 0 then grant = 0 end
if grant > 0 then redis.call('INCRBY', KEYS[2], grant) end
if redis.call('TTL', KEYS[2]) < 0 then redis.call('EXPIREAT', KEYS[2], tonumber(ARGV[4])) end
redis.call('HSET', KEYS[1], 'granted', grant, 'remaining', grant, 'degraded', 0)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return {grant, 0}
```
Idempotence is not decoration: ADR-014's checkpoint/resume re-enters a run, and a second `claim` that re-allocated would silently double a run's budget and lose its spent state.

Partial grant (`min(N, cap - used)`) rather than all-or-nothing: near the daily ceiling a run gets 7 units instead of 0, which is a working degraded run instead of a dead one.

**`spend(runId, units)`** — never goes negative.
```lua
local remaining = redis.call('HGET', KEYS[1], 'remaining')
if remaining == false then return -1 end          -- no allocation, or the run key expired
remaining = tonumber(remaining)
local n = tonumber(ARGV[1])
if remaining < n then return 0 end                -- denied; caller marks degraded
redis.call('HINCRBY', KEYS[1], 'remaining', -n)
return n
```
`-1` (expired) and `0` (exhausted) are distinct return values and are logged differently — an expired allocation is an infrastructure symptom, an exhausted one is normal operation.

**`release(runId)`** — atomic read-and-delete, refund only what the delete actually removed.
```lua
local remaining = redis.call('HGET', KEYS[1], 'remaining')
if remaining == false then return 0 end
redis.call('DEL', KEYS[1])
local r = tonumber(remaining)
if r > 0 then redis.call('DECRBY', KEYS[2], r) end
return r
```
The `DEL` sits inside the same script as the `DECRBY`, so a duplicate `release` — a `finally` block firing alongside an explicit call, a retried shutdown path — finds no key and refunds nothing. Split across two round-trips this double-refunds and inflates the pool above its own ceiling.

**Cache keys are not deleted at release.** `search:cache:{run_id}:{hash}` keys carry the same `run_ttl_seconds` and are left to expire. `release` deletes only the run hash. Deleting them would mean `SCAN`-ing a keyspace pattern — a per-run scan against a shared Redis, for keys that are already run-scoped, already bounded by the run's own budget (at most `granted` of them), and already dead to every reader. The TTL is the cheaper correct answer.

**Leaked allocations.** `release` is called from a `finally` in the pipeline, so ordinary failures still refund. A hard process kill leaks that run's remaining units until `search:run:*` expires — but the units stay debited from the daily key until IST midnight, since nothing watches for the expiry. Bounded (crashed runs × N) and reset daily; accepted for single-user MVP1, logged in §10 rather than solved with a reaper that would be more machinery than the leak is worth.

## 6. Metering unit

**One unit = one query submitted to the provider**, not one tool call.

`batch_search` accepts up to 5 queries in a single call. Denominating in tool calls would hand any run a silent 5× multiplier on its allocation. `SearchCapability.search()` submits exactly one query, so the rule reads as 1:1 today and stays correct when batching is added.

**M3 binds only the `search` tool — and binding is an explicit filter, not an assumption.** `MultiServerMCPClient.getTools()` returns all four AnySearch tools; verified live, it returned `batch_search, extract, get_sub_domains, search`. `AnySearchProvider` therefore selects by name and throws if the named tool is absent:

```ts
const tool = (await client.getTools()).find((t) => t.name === 'search');
if (!tool) throw new SearchProviderError('anysearch exposes no "search" tool');
```

Nothing else from that server reaches the agent's tool list. Without this filter the three unmetered tools would flow straight to the agent through the same mechanism that makes MCP convenient — `batch_search` alone would let one tool call spend five units the ledger never sees, which is the ADR-010 "MCP hides call volume" risk arriving through the front door.

`batch_search`, `extract`, and `get_sub_domains` are deliberately not exposed. Each would add a metering path, a parse path, and a test surface for capability the AC does not ask for — `batch_search` is a quota-efficiency optimisation with no measured query volume to optimise against, `extract` fetches a page rather than searching, and `get_sub_domains` only matters for vertical routing this design does not use. All three remain additive: the unit rule already accommodates them, and adding one is a provider-level change with no effect on the ledger or the cache.

`domain`/`sub_domain` are also left unset — Path A (general search) is AnySearch's documented default, and the `finance` vertical routes to structured instruments (tickers, quotes), not to the Indian-portal news this capability needs.

## 7. Domain allowlist — client-side, by necessity

The provider has no site-filtering parameter (§0), so the allowlist is applied to result hostnames after parsing.

```yaml
search:
  allowed_domains:
    - moneycontrol.com
    - economictimes.indiatimes.com
    - livemint.com
    - bseindia.com
    - nseindia.com
```

Matching is on registrable-suffix equality: `hostname === d || hostname.endsWith('.' + d)`. Both halves are load-bearing and both are evidence-driven:

- The `endsWith('.' + d)` half is what admits `www.moneycontrol.com`, which is the form the provider actually returns (§0). Equality alone rejects every allowed result.
- `includes()` is wrong: `notmoneycontrol.com.evil.tld` contains `moneycontrol.com` and must not match. Suffix matching with the leading dot rejects it, and the leading dot is what stops `evilmoneycontrol.com` too.

URLs that fail `new URL()` are rejected, not passed through.

Consequences stated plainly, because the AC does not:

- **A search returning zero allowed results still spends a unit.** The provider request happened. Charging only for useful results would make spend a function of the filter's aggressiveness, and the filter is the thing most likely to change.
- **The filter is aggressive.** Measured 2/5 pass rate on a representative query (§0). `cnbctv18.com` and `etnownews.com` are legitimate Indian financial publishers absent from the Session-6 list. The list is config, not code, so widening it is a config edit and #10 can tune it against real retrieval data.

## 8. Persistence — a new table, not `observation_archive`

The AC says "persisted to the observation archive." This design writes to a **new `search_observations` table** instead. The reason is grain, not preference:

`observation_archive` (#19's `003_observation_archive.sql`) is one row per source-file per day: `(source, observed_on, retrieved_at, uri, sha256, bytes_len, status)`, with `UNIQUE (source, observed_on, sha256) WHERE status='ok'`. A search result is one row per result per query per run. Forcing it in breaks two ways: there is no column for `query` — which the AC explicitly requires — and the unique index **rejects** a second run archiving the same article on the same day, destroying exactly the per-run provenance this story needs.

```sql
CREATE TABLE IF NOT EXISTS search_observations (
  id               uuid PRIMARY KEY,
  forecast_run_id  uuid NOT NULL,
  query            text NOT NULL,
  normalized_query text NOT NULL,
  provider         text NOT NULL,
  result_rank      int  NOT NULL,
  title            text,
  url              text,
  hostname         text,
  allowed          boolean NOT NULL,
  content          text,
  retrieved_at     timestamptz NOT NULL
);
CREATE INDEX idx_search_obs_run   ON search_observations (forecast_run_id, retrieved_at DESC);
CREATE INDEX idx_search_obs_query ON search_observations (normalized_query);

ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS degraded boolean NOT NULL DEFAULT false;
```

`content` holds the result body, and it is not optional: ADR-017's degradation path is explicitly "continues on cached results and FinBERT over already-retrieved text," so the text has to survive the run that fetched it. It is also the table's growth driver — the measured payload is ~4KB per result (20,592 bytes for 5), so a 20-search run retaining 10 results each is roughly 800KB, and 100 runs/day is ~80MB/day. No retention policy is defined here; flagged in §13 rather than pre-solved, since the right policy depends on what #10 actually re-reads.

Numbered `004`. `runMigrations` keys `schema_migrations` by filename and skips already-applied names, so `004` applying before or after #19's `003` is safe in either merge order — and since this story adds its own table, it carries **no dependency on #19's unmerged branch at all**.

The `forecasts.degraded` column is the second half of the AC's "`degraded=true` propagates through to stored results." Today `saveForecast()` writes a fixed column list with no degraded field, so propagation is not free — it needs the column, a `degraded` field on the `Forecast` type, and the pipeline reading `SearchOutcome.degraded` at persist time.

## 9. Configuration and startup validation

`McpServerSchema` is stdio-only today (`{command, args}`), and `single-agent.ts` hands the parsed object straight to `MultiServerMCPClient`. AnySearch is HTTP. Verified in `langchain-mcp-adapters@0.6.0`'s `types.d.ts`: the client already accepts `{transport: "http", url, headers}` natively, so our config shape maps 1:1 with no adapter layer.

```ts
const StdioMcpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});
const HttpMcpServerSchema = z.object({
  transport: z.literal('http'),
  url: z.url(),                                       // zod 4 form; `z.string().url()` is the legacy path
  headers: z.record(z.string(), z.string()).default({}),
});
export const McpServerSchema = z.union([HttpMcpServerSchema, StdioMcpServerSchema]);
```

Verified against the repo's own `zod@4.4.3` and its exact `tsconfig.json` flags (`NodeNext`, `strict`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — compiles clean, and at runtime: stdio shape accepted, http shape accepted with headers preserved, `{url}` without `transport` rejected, `{transport: 'http', url: 'not-a-url'}` rejected. The union ordering matters: `HttpMcpServerSchema` first, so an http entry never falls through to the stdio branch and fails with a confusing "command is required".

```yaml
mcp_servers:
  anysearch:
    transport: http
    url: https://api.anysearch.com/mcp
    headers:
      Authorization: Bearer ${ANYSEARCH_API_KEY}
capabilities:
  search: anysearch
search:
  initial_run_budget: 20        # ADR-017's N; a guess until #10 measures real volume
  daily_cap: 2000               # ADR-010's account quota; unverified from the server (§0)
  run_ttl_seconds: 21600        # crash bound on a leaked allocation (§5)
  provider_timeout_ms: 15000    # hard deadline on every provider call (§4)
  max_results: 10               # provider max; also the context-size lever -- ~4KB of body per result
  allowed_domains: [...]
redis:
  url: ${REDIS_URL}
```

`ANYSEARCH_API_KEY` is a required env var: `config-loader.ts` already throws `ConfigValidationError` listing every unset `${VAR}`, so a missing key fails at startup with a named variable rather than at first search. The user confirmed they hold a key.

**`.env.example` is a cross-branch coupling, and it will conflict.** Verified: the file is **not tracked on `main` or `dev`** — it exists only on `feat/issue-30-angelone-connector`, where a parallel session is introducing it with the Angel One credentials. So this branch cannot simply "add a line to it." #21 creates the file with its own two entries (`ANYSEARCH_API_KEY`, `REDIS_URL`) if it merges first, and appends if #30 merges first; either way the second merge takes a trivial additive conflict in that file. Recorded so it reads as expected coordination rather than a surprise at merge time. Neither `REDIS_URL` nor any `ANYSEARCH*` name is referenced anywhere in the repo today, and neither `search:` nor `redis:` collides with an existing top-level `harness_config.yaml` key (`llm`, `mcp_servers`, `capabilities`, `storage`, `tracing`, `sandbox`, `eval`) — all three checked, not assumed. Anonymous access is **not** used as a fallback — the harness fails loudly instead, because an unauthenticated run would silently meter against a different, undocumented rate limit than the 2,000/day this design allocates from.

Secret handling is already covered: `Interpolator.used` collects every interpolated value and `ConfigValidationError` redacts them, so the expanded key never reaches a config error message. `CapabilityHealthError` does **not** redact — noted in §10, since a health-check failure message must therefore never be built from the header value.

### Startup validation — the machinery exists but nothing runs it

The AC asks that "startup validation fails loudly on a bad binding." Two pieces of machinery already exist for that, and **neither is currently reachable from a real run.** Verified:

- `grep -rn "CapabilityRegistry|validateAll|createCapabilityAccessor" src scripts` returns hits **only inside `registry.ts` itself**. The sole consumer anywhere in the repo is `tests/registry.test.ts`. `single-agent.ts` and `run-real-pipeline.ts` never construct a registry — they go `config.capabilities.market_data` → `config.mcp_servers[...]` → `new MultiServerMCPClient` directly. The capability layer from #4 is, on the pipeline path, dead code.
- `run-real-pipeline.ts` — the only real entrypoint — **does not call `loadConfig` at all.** It builds a `HarnessConfig` object literal inline from `process.env`, hardcoding `capabilities: { chat: 'llm', search: 'llm', sentiment: 'llm', market_data: 'market' }`. So `config-loader.ts`'s dangling-binding check never executes in a real run either.

An earlier draft of this spec said "wiring the method is the whole change." That was wrong, and it is exactly the kind of claim that reads plausibly and costs an implementation round. The actual work:

1. `run-real-pipeline.ts` switches to `loadConfig('harness/harness_config.yaml')` instead of the inline literal, so interpolation, schema validation, and the dangling-binding check all run. This is the smallest change that makes gate 1 real, and it retires a config literal that has already drifted from the YAML.

   **This one carries real regression risk and must not be done casually.** The two configs launch the market-data MCP server *differently*:

   | | market-data launch |
   |---|---|
   | `run-real-pipeline.ts` (working today) | `command: 'bash'`, `args: ['-c', 'cd <absolute REPO_ROOT> && exec uv run python -m forecasting_agent.data_server.server']` |
   | `harness_config.yaml` (untested by any real run) | `command: 'uv'`, `args: ['run', '--directory', '..', 'python', '-m', 'forecasting_agent.data_server.server']` |

   The YAML form depends on the process's cwd being `harness/` for `--directory ..` to resolve; the inline form is cwd-independent by construction. Switching entrypoints therefore changes how the *only currently-working pipeline* starts its data server. The plan task that makes this switch must reconcile the YAML entry against the form known to work and then prove the market-data server still launches — a passing search test says nothing about it. Sequence the switch **before** the search wiring so a breakage is attributable to one change rather than two.
2. The construction site instantiates a `CapabilityRegistry`, registers the search capability, and awaits `validateAll()` **before** the first pipeline run. `AnySearchProvider.healthCheck(signal)` issues `tools/list` and asserts a tool named `search` is present; `validateAll()` already races each probe against a 5s timeout and throws `CapabilityHealthError` on any failure. That part genuinely is already built — it just has no caller.

**Scope note, stated rather than absorbed silently.** Item 1 and item 2 are broader than "add a search capability" — they activate a layer #4 delivered but never connected. #21 does the minimum to make its own AC true: register and validate `search`, and route the real entrypoint through `loadConfig`. It does **not** migrate `market_data` onto the registry, even though the same argument applies to it, because that is #4's unfinished wiring rather than #21's, and touching the market-data path risks the one pipeline that currently works end-to-end.

## 10. Sandbox reachability — what is enforced, and what is not

**AC:** "no search path is reachable from a sandbox container."

**What is enforced by this story — and the argument is structural, not procedural.** `SandboxBackendAdapter` extends `BaseSandbox` and exposes exactly four methods: `execute`, `uploadFiles`, `downloadFiles`, `dispose`. There is no container-facing tool registry at all. The agent's tools — including `search_news` — are LangChain `StructuredTool`s invoked in the **harness process**; the container is on the other side of an exec/file boundary and never receives a tool array. So "search is not bound into the sandbox" is not a rule someone must remember to follow; there is no mechanism by which it could be.

(An earlier draft proposed asserting "no search-named tool in the sandbox toolset." That test is unwriteable — there is no such toolset to assert against. Dropped rather than fudged into something that would pass while checking nothing.)

Containers also receive no search credential: `getOrCreateWarmContainer` sets `Memory`, `NanoCpus`, and `Binds`, and passes **no `Env` key whatsoever**. The writeable regression test is therefore the environment one — inspect a real created container and assert no `ANYSEARCH_*` variable is present — which guards against a future change that starts forwarding host env into containers.

**What is not enforced, with evidence.** The explore tier has default bridge networking (deliberately — ADR-021 gives it PyPI for self-extension), and AnySearch serves anonymous requests. Running a probe inside the real `forecasting-sandbox:latest` image:

```
default bridge   -> SANDBOX_REACHED_ANYSEARCH 200 ['batch_search','extract','get_sub_domains','search']
--network none   -> SANDBOX_BLOCKED URLError [Errno -3] Temporary failure in name resolution
```

The validate tier is correctly sealed. The explore tier is not, and **withholding the API key does not close it** — anonymous access needs no credential. Agent-written Python in the explore tier can therefore reach search outside the ledger's view, which is precisely the gap ADR-017 claims to have "eliminated entirely rather than mitigated." Today that claim is a rule without enforcement.

Closing it means egress filtering — a custom Docker network plus an allowlisting proxy, with `pip` reconfigured to use it — inside `SandboxManager`, the sandbox image, and `docker-compose.yml`. That is the sandbox story's surface (#7), not the search story's, and those files are live in other parallel sessions. **Deferred with the reproduction above, filed as its own issue.** This AC ships partially satisfied and is reported as such.

## 11. Failure handling

| Failure | Detection | Result |
|---|---|---|
| Run has no allocation left | `spend` Lua returns `0` | `markDegraded`, `SearchOutcome{results: [], source: 'degraded', degraded: true}`. Run **completes**. |
| Daily cap reached at claim time | `claim` returns `grant = 0` | Run starts already degraded; every search returns the degraded outcome. Run completes. |
| Run key expired mid-run | `spend` returns `-1` | Same degraded outcome, logged at `warn` with the run id — distinguishes infra fault from normal exhaustion. |
| Provider HTTP/MCP error | `tools/call` rejects | `SearchProviderError`. Unit is **not** refunded (§4). Caller degrades that query; the run continues. |
| Provider hangs | `AbortSignal.timeout(provider_timeout_ms)` fires | `SearchProviderTimeoutError` — a distinct type from `SearchProviderError`, because "AnySearch is slow" and "AnySearch rejected us" need different operator responses. Unit not refunded. Run continues. |
| `search` tool absent from the server | name filter finds nothing (§6) | `SearchProviderError` at `healthCheck` — startup fails, not first search. |
| Archive write fails (Postgres down) | `saveSearchObservations` rejects | Propagates; the run fails (§4). Deliberate: an unpersisted result voids reproducibility, and the run would die at `saveForecast()` regardless. |
| Response shape drifts | `parser.parse()` finds no `### N.` blocks in a non-empty blob | Throws `SearchResponseFormatError` — **fails loud**. A silent empty parse is indistinguishable from "no news exists" and would quietly poison sentiment. |
| Result URL unparseable | `new URL()` throws | Result recorded with `allowed = false`, `hostname = null`. Not an error. |
| Redis unreachable at claim | `ioredis` connect error | Startup/claim fails loudly. Un-metered search is not an acceptable fallback — it is the failure mode the story exists to prevent. |
| Redis unreachable at release | connect error in `finally` | Logged; run result stands. Units leak until IST midnight (§5). |

## 12. Testing

**Unit — no Redis, no network, no Docker:**
- `AnySearchResultParser` against a **recorded real fixture** (the 20,592-byte blob captured live in §0), asserting 5 results with exact titles and URLs. Invented markdown would test the parser against our own assumptions rather than the provider's actual bytes.
- Parser throws `SearchResponseFormatError` on a non-empty blob with no `### N.` blocks; returns `[]` for the genuinely-empty-results blob.
- `DomainAllowlist`: exact match, subdomain match, `notmoneycontrol.com.evil.tld` rejected, unparseable URL rejected.
- Config: `McpServerSchema` accepts both stdio and http shapes; rejects `{url}` without `transport`; dangling `capabilities.search` binding throws `ConfigValidationError`.

**Integration — real Redis (`ioredis` against the running container):**
- *A run cannot exceed its allocation* — 21 spends against a 20-unit grant yields 20 successes and 1 denial.
- *A runaway run exhausts only its own budget* — run A drains 20, run B still claims 20; B's spends succeed.
- *Repeated identical queries within a run cost one unit* — 5 identical queries, `remaining` decremented exactly once, 4 outcomes report `source: 'cache'`.
- *Exhaustion completes and tags* — after denial, `SearchOutcome.degraded` is `true`, `results` is empty, nothing throws, and subsequent **cache hits also report `degraded: true`** (stickiness).
- *Claim is idempotent* — two `claim` calls for one run leave `granted` unchanged and the daily counter incremented once.
- *Release refunds once* — daily counter returns to its pre-claim value after one `release`; a second `release` changes nothing.
- *Partial grant* — with the daily counter pre-set to `cap - 7`, a 20-unit claim grants exactly 7.
- *Daily key expiry is IST-anchored* — `TTL` on the daily key matches seconds-to-next-IST-midnight (+grace) within tolerance, not 86400.
- *`markDegraded` never resurrects an expired run* — against a deleted run key it returns false and `EXISTS` stays `0`; against a live key with a TTL it sets the field and `TTL` is unchanged. This is a regression test for a defect this spec's own first revision contained, so it is not optional.
- *Provider timeout raises the timeout type* — a provider stub that never resolves, with `provider_timeout_ms` set low, yields `SearchProviderTimeoutError` and not `SearchProviderError`, and the classification comes from `signal.aborted` rather than the message text.
- *Degradation survives a lost run key* — degrade a run, `DEL` its run key, then search again: the outcome still reports `degraded: true` via the process-local backstop, and the forecast persists as degraded. Asserting only the Redis field here would pass while the real hole stayed open.
- *`endRun` tears down both stores* — after `endRun`, `EXISTS search:run:{id}` is `0` **and** a subsequent `search` on the same id reports `degraded: false`. Asserting only the Redis side would let the in-process set leak undetected, which is the defect this test exists for.

- *The agent's tool array contains the wrapper and none of the provider's tools* — build the pipeline's tool list with the search server configured, then assert exactly one search-related tool is present and it is `search_news`. This is the regression test for §3a rule 1; without it, a future refactor that routes AnySearch through `mcpClient.getTools()` restores unmetered access silently and every other test still passes.
- *`runId` is not a tool parameter* — the wrapper's JSON schema exposes only `query`, so a model cannot address another run's budget (§3a rule 2).

**Type-level (compile-time, part of `pnpm typecheck`):**
- The ISP boundary holds — a `SearchCapability`-typed reference cannot reach `beginRun`, pinned with `@ts-expect-error`. If the split ever collapses, that directive becomes an unused-expect-error and the typecheck fails, which is the whole point of asserting it this way rather than in prose.

**Integration — real Postgres:** `saveSearchObservations` round-trips allowed and rejected rows for one run; `saveForecast` persists `degraded = true`.

**Integration — real Docker:** a real created container's environment contains no `ANYSEARCH_*` variable (§10).

**Integration — startup validation (§9):**
- *A bad binding fails loudly* — `capabilities.search` pointing at a server absent from `mcp_servers` throws `ConfigValidationError` naming `capabilities.search`, via `loadConfig`. Requires the entrypoint to actually call `loadConfig`, which is part of this story's scope.
- *A dead provider fails at startup, not at first search* — a registered search capability whose `healthCheck` rejects makes `validateAll()` throw `CapabilityHealthError` before any run begins.

**End-to-end smoke — real AnySearch, real Redis, real Postgres, no mocks:**
```
claim(run, 20) -> search("...") -> real MCP call -> parse -> filter -> persist
              -> repeat identical query (asserts cache hit, no spend)
              -> drain to 0 (asserts degraded, run completes)
              -> release (asserts daily counter restored)
```
**This one test is opt-in, gated on `RUN_LIVE_SEARCH_E2E=1`, and is the only test in the suite that touches the live provider.** Every other test above uses real Redis and real Postgres but a stubbed provider. The reason is not flakiness — it is that `pnpm test` runs vitest over everything, so an ungated live smoke would spend real AnySearch quota on every local test run and every CI job, against the same 2,000/day ceiling this entire story exists to protect. A test suite that drains the budget it is testing is a self-defeating design, and it would do so silently, since the spend lands in the daily counter exactly like production spend. Gating it also keeps the suite runnable offline, which the rest of the tests already are.

Explicitly **harness-level, not a forecast run.** The pipeline is still single-agent price-anchor; there is no sentiment agent and no debate, so "every debate round sees identical results" has no debate to exercise. The cache's round-stability property is proven by the repeat-query assertion, and the plan says so rather than dressing a harness exercise as an integration test it is not.

## 13. Deliberately deferred

- **Explore-tier network egress restriction** (§10) — filed against #7 with the reproduction. This story's single partial AC.
- **`batch_search` / `extract` / `get_sub_domains`** (§6) — additive; no measured query volume yet to justify the extra metering and parse paths.
- **Semantic dedup across near-duplicate phrasings** — ADR-017 defers it: a loose similarity threshold serves wrong results silently. Exact-match only.
- **Budget escalation** — ADR-017 rejects it as reintroducing unbounded per-forecast cost. `N = 20` stays a guess until #10 produces real volume.
- **Leaked allocations from hard process kills** (§5) — bounded and daily-reset; a reaper costs more than the leak.
- **`CapabilityHealthError` does not redact secrets** — no current path puts a secret in a health-check message, but the asymmetry with `ConfigValidationError` is a trap for whoever writes the next `healthCheck`. Noted, not fixed here.
- **Provider markdown format is unversioned** — the parser is coupled to a shape AnySearch can change without notice. Mitigated by failing loud (§11) rather than by pinning a version the provider does not offer.
- **Single-flight for concurrent identical queries** (§4) — must land with the multi-agent debate, since it cannot be tested against a single-agent pipeline. Until then the cache multiplier applies to sequential overlap only.
- **A real cost meter** (§3b) — settled spend is emitted to Langfuse trace metadata because no cost-meter subsystem exists to emit it to. The AC subtask is satisfied in substance, not by building the consumer.
- **Migrating `market_data` onto the capability registry** (§9) — the same dead-code argument applies to it, but that is #4's unfinished wiring, and the market-data path is the only pipeline that currently works end to end.
- **No retention policy on `search_observations.content`** (~80MB/day at 100 runs, §8). Deferred until #10 shows what actually gets re-read; a policy written now would be guessing at the access pattern.
- **`extract` is unbound, so a result's full article body is never fetched** — only the ~4KB snippet AnySearch returns inline. If FinBERT turns out to need full articles, `extract` is the tool and it costs one unit per call; noted so #10 discovers this from the spec rather than from a shortfall.

## 14. Verification log

Everything in this spec that could be run, was run, on 2026-08-16/17 against real infrastructure — the live AnySearch server, the running Redis and Postgres containers, the real sandbox image, and `tsc` under this repo's exact strict flags. Recorded so a later reader can tell asserted claims from tested ones. Several rows record a claim that turned out **false**; those are kept, because a spec that only lists its confirmations hides where its author was wrong.

| Claim | Method | Result |
|---|---|---|
| AnySearch endpoint, transport, auth, tool list, schemas | Raw `curl` JSON-RPC `initialize` + `tools/list` | Confirmed; §0 table |
| No date filter, no site allowlist, no quota headers | Full `inputSchema` dump + response header dump | Confirmed absent |
| Results are one markdown blob, `### N.` / `- **URL**:` | Two real `tools/call` responses | 5/5 blocks parsed, 5/5 URLs extracted, both queries |
| Allowlist pass rate | Two real queries | 2/5 both times; hostnames carry `www.` |
| `MultiServerMCPClient` speaks Streamable HTTP to AnySearch | `getTools()` against the live server | `batch_search, extract, get_sub_domains, search` |
| `ioredis` v6 import shape | `tsc --noEmit` under the harness's exact flags | Default import: 15 errors. Named import: exit 0 |
| Zod union accepts both transports, rejects malformed | `tsc` + runtime `safeParse` | 4/4 as specified |
| `claim` is idempotent | Real Redis, second claim on same run | grant unchanged at 20, `reused=1`, daily counter still 20 |
| A run cannot exceed its allocation | Real Redis, 21 spends on a 20 grant | 20 ok, 1 denied |
| A runaway run exhausts only itself | Real Redis, drain A then claim B | B granted 20 |
| Partial grant near the ceiling | Real Redis, daily preset to cap−7 | grant = 7 |
| `release` refunds once, double-release is a no-op | Real Redis | Refund correct; second call returns 0, counter unchanged |
| Spend against a missing allocation is distinguishable | Real Redis | Returns `-1`, not `0` |
| Daily TTL is IST-anchored, not 86400 | Real Redis `TTL` vs computed | 76388 == 76388, `is86400 = false` |
| Migration 004 applies as one multi-statement query | Real Postgres, `runMigrations`' exact pattern | Applied; `forecasts.degraded` present |
| Archive round-trips allowed and rejected rows | Real Postgres insert + select | Both rows returned with correct `allowed` flags |
| `degraded=true` persists on a forecast | Real Postgres | `[{"degraded":true}]` |
| Explore tier reaches AnySearch; validate tier does not | Real `forecasting-sandbox:latest` container, both network modes | Reached / blocked, §10 |
| un-guarded `HSET` leaks a TTL-less key | Real Redis | `exists: 1, ttl: -1` — the first design was wrong; guarded Lua adopted (§3) |
| guarded `markDegraded` preserves TTL | Real Redis | Missing key: returns 0, creates nothing. Live key: sets field, TTL 600 → 600 |
| MCP tool honours `config.signal` | Live server, `AbortSignal.timeout(50)` | Rejected at 51 ms — but as `ToolException`, so detect via `signal.aborted`, not the message (§4) |
| the spec's public types compile | `tsc --noEmit` on `SearchResult`/`SearchOutcome`/`SearchCapability` + parser + allowlist, under the repo's exact flags | Clean, no non-null assertions needed despite `noUncheckedIndexedAccess` |
| allowlist admits `www.` and rejects the spoof | Runtime, real hostnames | `www.moneycontrol.com` → allowed, `notmoneycontrol.com.evil.tld` → rejected |
| `AbortSignal.any` composes on both legs | Runtime, Node 24 | Works — then dropped as YAGNI (§4), recorded so the removal is a choice, not an oversight |
| is `resolve('search').search(...)` callable today? | `tsc --noEmit` against the real `CapabilityRegistry` | **No** — `TS2339`. `CapabilityMap` needs narrowing (§3) |
| does the `MarketDataProvider` narrowing precedent work? | `tsc --noEmit` on `resolve('market_data').fetch_ohlcv(...)` | Clean — the one-line fix is proven, not assumed |
| the ISP split compiles and actually segregates | `tsc --noEmit`, one class implementing both interfaces, registered on the real registry | Clean, **including** the `@ts-expect-error` on `forAgent.beginRun` — so the boundary is enforced by the compiler, not by convention |
| do the new config keys and env names collide? | `grep` over the repo and `harness_config.yaml`'s top-level keys | No collisions — `search:`/`redis:` free, `REDIS_URL`/`ANYSEARCH*` unreferenced |
| does `.env.example` exist to append to? | `git ls-tree` across `main`, `dev`, `feat/issue-30-…` | **Only on #30's branch** — cross-branch coupling, §9 |
| does `pnpm test` run everything by default? | `package.json` scripts + the `storage-integration.test.ts` precedent | Yes, `vitest run` with no tagging — so the live-provider smoke must be env-gated or the suite spends real quota (§12) |
| does `describe.skipIf` actually gate on an env var? | Real vitest 4.1.10 run, gated block containing a deliberately failing assertion | `1 passed \| 1 skipped` — the failing test never ran, so the gate is proven, not assumed |
| can an agent even reach a `SearchCapability`? | Read `price-anchor.ts` + `@langchain/core` tool types | **No** — agents take `StructuredTool[]`. `tool()` returns `DynamicStructuredTool extends StructuredTool`, so a wrapper is required; §3a added |
| is `CapabilityRegistry` wired into any real run? | `grep -rn "CapabilityRegistry\|validateAll" src scripts` | **No** — hits only inside `registry.ts`; sole consumer is `tests/registry.test.ts`. #4's layer is dead code on the pipeline path (§9) |
| does the real entrypoint call `loadConfig`? | Read `scripts/run-real-pipeline.ts` | **No** — builds a `HarnessConfig` literal inline, so the dangling-binding check never runs; and its market-data launch differs from the YAML's (§9) |
| can settled spend reach a trace? | Read `tracing/langfuse.ts` | Yes — `TraceHandle.update` takes an arbitrary `metadata` record, and `runForecast` already calls it (§3b) |
| is there a container-facing toolset to assert against? | Read `sandbox/deepagents-adapter.ts` | **No** — `execute`/`uploadFiles`/`downloadFiles`/`dispose` only. The proposed §10 test was unwriteable and was dropped |

| the branch is green with the new dependency | `pnpm typecheck`, `pnpm lint`, `pnpm test` | typecheck and lint clean; 72 passed, 5 failed |
| those 5 failures are not ours | same tests run from a clean `main` worktree | **Identical failures on pristine `main`** — `SASL: client password must be a string`, i.e. `TEST_DATABASE_URL` is unset. Pre-existing and environmental |

The dev database was returned to its exact prior state after the migration probe (`search_observations` dropped, `forecasts.degraded` dropped, test rows deleted; 8 tables and 7 forecast columns confirmed restored).

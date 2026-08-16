# M3 Search Capability & Per-Run Quota Metering (#21) — Implementation Plan

> **For agentic workers:** implementation goes to Gemini via `agy` (`gemini-delegated-implementation`), one task at a time, verified inline after each task — not executed by this plan's author directly. Each task carries the exact test Gemini must get green, a ready-to-paste delegation prompt, and a validator brief. Never accept Gemini's "tests pass" — re-run the exact command from a cold shell (CLAUDE.md's documented Gemini quality gap).

**Goal:** A metered, cached, provider-agnostic `search` capability. A run claims a budget of 20 at start, spends from its own allocation, returns the remainder at end; repeat queries within a run cost nothing; exhaustion degrades rather than fails; every result is archived with its query; and the agent reaches all of it through one tool it cannot bypass.

**Spec:** `docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md` — cleared `reviewing-specs` with two consecutive `APPROVED` verdicts. **Read §0, §3, §3a, §5 and §9 before touching any task.** This plan cites seams; it does not restate the spec's reasoning.

**Architecture:** `AnySearchCapability` composes six collaborators (parser, allowlist, ledger, cache, provider, pool) and implements two interfaces — `SearchCapability` for agents, `SearchRunLifecycle` for the pipeline. Budget state is Redis, mutated only through four Lua scripts. The agent never sees the provider: it gets one `search_news` `StructuredTool` with `runId` bound at construction.

**Tech stack:** TypeScript/Node 24, `ioredis@^6`, `langchain-mcp-adapters`, `@langchain/core` tools, `pg`, `zod@4`, `vitest@4`.

## Global constraints

- Every new file gets a one-line top-of-file abstract; every exported function/class gets a one-line input/output comment. No multi-line docstrings (CLAUDE.md hard rule).
- `pnpm lint` and `pnpm typecheck` must pass in `harness/` after every task — Gemini runs these itself under `--mode accept-edits`, not deferred.
- **`import { Redis } from 'ioredis'` — never the default import.** Verified: the default form fails under this repo's `NodeNext` + `verbatimModuleSyntax` with 15 errors. Spec §2.
- Redis and Postgres run in Docker already (`forecasting_agent-redis-1`, `forecasting_agent-postgres-1`). Redis integration tests hit the real instance on `127.0.0.1:6379` and must namespace their keys under a per-test prefix and clean up, because other sessions share that instance.
- **No test may call the live AnySearch API except Task 12's**, which is gated behind `RUN_LIVE_SEARCH_E2E=1`. Everything else uses the committed fixture. An ungated live test spends real quota on every `pnpm test` — spec §12.
- The 5 pre-existing failures in `tests/storage.test.ts` and `tests/storage-integration.test.ts` reproduce on pristine `main` (`TEST_DATABASE_URL` unset). **They are not yours to fix and not evidence of a regression.** Baseline for every task: `Tests 5 failed | N passed`.
- No task pushes, opens a PR, or touches the Obsidian vault.
- **Test-code convention, stated so it reads as a choice rather than an omission.** Tasks 1–7 carry paste-ready test files, because their assertions encode exact literals — fixture hostnames, Lua return codes, TTL bounds, schema rejections — that are easy to get subtly wrong and hard to recover from a description. Tasks 8–12 carry an explicit assertion list instead of full source, because their tests are mostly wiring against stubs whose shape depends on the previous task's committed signatures; writing that source now would pin it to signatures that do not exist yet. **The assertion lists are the contract**: every listed assertion must appear in the delivered test, and the validator brief checks for them by name. Do not treat a shorter test suite as acceptable because the plan did not hand over the source.

## Task dependency graph

```
T1 (deps + config schema)
 ├─ T2  (entrypoint -> loadConfig)      RISKY, isolated, do early and verify alone
 ├─ T3  (parser)          ─┐
 ├─ T4  (allowlist)       ─┤ independent, parallelisable in worktrees
 ├─ T7  (migration+repo)  ─┘
 ├─ T5  (budget ledger)
 ├─ T6  (cache)
 └─ T8  (provider)  <- needs T3
        └─ T9  (capability)  <- needs T3,T4,T5,T6,T7,T8
             └─ T10 (tool wrapper)
                  └─ T11 (pipeline wiring)
                       └─ T12 (live smoke, gated)
```

T3, T4 and T7 touch disjoint files and may be dispatched to Gemini concurrently in separate worktrees. Everything else is sequential.

---

## Task 0 (done — do not redo): real fixture captured

`harness/tests/fixtures/anysearch-search-response.json` was captured from the live server before this plan was written, so no task needs to spend quota to obtain test data. It holds one real `tools/call` response for `"Reliance Industries quarterly results NSE"`:

- 5 result blocks, 4,842 bytes of result text
- hostnames in order: `trendlyne.com`, `www.ril.com`, `www.screener.in`, `www.business-standard.com`, `www.moneycontrol.com`
- against the configured allowlist exactly **one** survives (`www.moneycontrol.com`), so the fixture exercises a 1-allowed / 4-rejected partition

`harness/tests/fixtures/capture-anysearch-fixture.ts` regenerates it and is documented as costing one unit of live quota. Do not run it during implementation.

---

## Task 1: dependency, config schema, and the `CapabilityMap` narrowing

**Files:**
- Modify: `harness/package.json` (already has `ioredis@^6.0.0` from spec work — verify, don't re-add)
- Modify: `harness/src/config.ts`, `harness/src/capabilities/types.ts`, `harness/harness_config.yaml`
- Create: `harness/src/search/types.ts`, `.env.example`
- Test: `harness/tests/config.test.ts` (extend), `harness/tests/search/types.test.ts`

**Interfaces:**
- Produces: `McpServerSchema` as a `z.union([HttpMcpServerSchema, StdioMcpServerSchema])`; `SearchConfigSchema` and `RedisConfigSchema` on `HarnessConfigSchema`; `SearchResult`, `SearchOutcome`, `SearchCapability`, `SearchRunLifecycle`, and the four error classes; `CapabilityMap.search` narrowed from `CapabilityProvider` to `SearchCapability`.
- Consumed by: every later task.

**Seam note.** `CapabilityMap.search` is currently `CapabilityProvider`, which has only `healthCheck?`. Verified: `registry.resolve('search').search(...)` fails with `TS2339`. Narrow it exactly as `market_data: MarketDataProvider` already does — that precedent is confirmed to compile. Union order matters: `HttpMcpServerSchema` **first**, so an http entry never falls through to stdio and reports a confusing "command is required".

`.env.example` does not exist on this branch — it is tracked only on `feat/issue-30-angelone-connector`. Create it with only this story's two variables; an additive merge conflict with #30 is expected and fine.

- [ ] **Step 1: Write the failing tests**

```typescript
// harness/tests/search/types.test.ts
import { describe, it, expect } from 'vitest';
import { HarnessConfigSchema } from '../../src/config.js';

const base = {
  llm: { provider: 'deepseek', model: 'm', api_key: 'k' },
  capabilities: { chat: 'llm', search: 'anysearch', sentiment: 'llm', market_data: 'market' },
  storage: { connection_string: 'postgres://x' },
  tracing: { langfuse_public_key: 'a', langfuse_secret_key: 'b', langfuse_base_url: 'http://x' },
  redis: { url: 'redis://127.0.0.1:6379' },
  search: {
    initial_run_budget: 20,
    daily_cap: 2000,
    run_ttl_seconds: 21600,
    provider_timeout_ms: 15000,
    max_results: 10,
    allowed_domains: ['moneycontrol.com'],
  },
};

describe('McpServerSchema transport union', () => {
  it('accepts an http server with headers', () => {
    const r = HarnessConfigSchema.safeParse({
      ...base,
      mcp_servers: { anysearch: { transport: 'http', url: 'https://api.anysearch.com/mcp', headers: { Authorization: 'Bearer x' } } },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.mcp_servers.anysearch).toMatchObject({ transport: 'http', headers: { Authorization: 'Bearer x' } });
  });

  it('still accepts a stdio server', () => {
    const r = HarnessConfigSchema.safeParse({ ...base, mcp_servers: { market: { command: 'uv', args: ['run'] } } });
    expect(r.success).toBe(true);
  });

  it('rejects a url with no transport, and a malformed url', () => {
    expect(HarnessConfigSchema.safeParse({ ...base, mcp_servers: { a: { url: 'https://x/mcp' } } }).success).toBe(false);
    expect(HarnessConfigSchema.safeParse({ ...base, mcp_servers: { a: { transport: 'http', url: 'nope' } } }).success).toBe(false);
  });
});

describe('search + redis config blocks', () => {
  it('fills in every search default when only allowed_domains is given', () => {
    const r = HarnessConfigSchema.safeParse({ ...base, mcp_servers: {}, search: { allowed_domains: ['moneycontrol.com'] } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.search).toMatchObject({
        initial_run_budget: 20, daily_cap: 2000, run_ttl_seconds: 21600, provider_timeout_ms: 15000, max_results: 10,
      });
    }
  });

  it('rejects a search block with no allowed_domains — the filter must never be empty by accident', () => {
    expect(HarnessConfigSchema.safeParse({ ...base, mcp_servers: {}, search: { allowed_domains: [] } }).success).toBe(false);
  });

  it('rejects a non-positive budget', () => {
    const r = HarnessConfigSchema.safeParse({ ...base, mcp_servers: {}, search: { ...base.search, initial_run_budget: 0 } });
    expect(r.success).toBe(false);
  });
});
```

```typescript
// harness/tests/search/capability-map.test-d.ts  (type-level; runs under `pnpm typecheck`)
import { CapabilityRegistry } from '../../src/capabilities/registry.js';
import type { SearchCapability, SearchRunLifecycle } from '../../src/search/types.js';

const registry = new CapabilityRegistry();
const cap = registry.resolve('search');
void cap.search('run-1', 'q'); // must compile once CapabilityMap is narrowed

declare const concrete: SearchCapability & SearchRunLifecycle;
const forAgent: SearchCapability = concrete;
// @ts-expect-error -- ISP: the agent-facing type must not expose run lifecycle
void forAgent.beginRun('run-1');
```

- [ ] **Step 2: Run to verify red**

Run: `cd harness && pnpm vitest run tests/search/types.test.ts`
Expected: `FAIL` — `Cannot find module '../../src/search/types.js'`, and the config assertions fail because `search`/`redis` are not on the schema.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md sections 2, 3 and 9 first.

In harness/, make these changes. Do not touch any other file.

1. harness/src/config.ts
   - Replace McpServerSchema with a union, HTTP variant FIRST so http entries never fall through to stdio:
       const StdioMcpServerSchema = z.object({ command: z.string().min(1), args: z.array(z.string()).default([]) });
       const HttpMcpServerSchema = z.object({ transport: z.literal('http'), url: z.url(), headers: z.record(z.string(), z.string()).default({}) });
       export const McpServerSchema = z.union([HttpMcpServerSchema, StdioMcpServerSchema]);
     Use z.url(), NOT z.string().url() — this repo is on zod 4.
   - Add to HarnessConfigSchema:
       redis: z.object({ url: z.string().min(1) })
       search: z.object({
         initial_run_budget: z.number().int().positive().default(20),
         daily_cap: z.number().int().positive().default(2000),
         run_ttl_seconds: z.number().int().positive().default(21600),
         provider_timeout_ms: z.number().int().positive().default(15000),
         max_results: z.number().int().min(1).max(10).default(10),
         allowed_domains: z.array(z.string().min(1)).min(1),
       })

2. harness/src/search/types.ts (new). Export:
   - interface SearchResult { rank: number; title: string; url: string | null; hostname: string | null; content: string }
   - interface SearchOutcome { results: SearchResult[]; source: 'provider' | 'cache' | 'degraded'; degraded: boolean }
   - interface SearchCapability extends CapabilityProvider { search(runId: string, query: string): Promise<SearchOutcome> }
   - interface SearchRunLifecycle { beginRun(runId: string): Promise<number>; endRun(runId: string): Promise<number> }
   - class SearchProviderError extends Error
   - class SearchProviderTimeoutError extends SearchProviderError
   - class SearchResponseFormatError extends Error
   Each class sets this.name in its constructor.

3. harness/src/capabilities/types.ts — change `search: CapabilityProvider` to `search: SearchCapability`, importing from '../search/types.js'. Follow exactly how market_data: MarketDataProvider is already declared.

4. harness/harness_config.yaml — add an anysearch mcp_servers entry (transport: http, url: https://api.anysearch.com/mcp, headers.Authorization: "Bearer ${ANYSEARCH_API_KEY}"), point capabilities.search at "anysearch", and add the redis: and search: blocks matching the schema above. allowed_domains: moneycontrol.com, economictimes.indiatimes.com, livemint.com, bseindia.com, nseindia.com.

5. .env.example (new, repo root) — ANYSEARCH_API_KEY= and REDIS_URL=redis://127.0.0.1:6379 with a one-line comment each. Nothing else.

Style (hard rules): every file starts with a one-line abstract comment; every exported function/class/interface gets a ONE-LINE comment saying what it takes and returns. No multi-line docstrings. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search tests/config.test.ts
All must pass. Note that 5 tests in tests/storage*.test.ts fail because TEST_DATABASE_URL is unset — that is pre-existing, leave it alone.
```

- [ ] **Step 4: Verify green** — `cd harness && pnpm vitest run tests/search tests/config.test.ts` → PASS; `pnpm typecheck` → clean (this is what proves the `@ts-expect-error` ISP assertion).

- [ ] **Step 5: Validator brief (run inline, cold shell — do not trust the report)**
  1. `git status` — confirm exactly the six intended files changed, nothing else, and nothing written outside the repo.
  2. Re-run `pnpm typecheck` yourself. **Specifically confirm the `@ts-expect-error` in `capability-map.test-d.ts` does not itself error** — if `beginRun` were reachable, TS reports an *unused* expect-error and the ISP boundary is broken.
  3. `grep -n "z.string().url()" src/config.ts` must return nothing (zod-4 form required).
  4. Confirm `package.json` still declares `ioredis` and `pnpm-lock.yaml` is consistent (`pnpm install --frozen-lockfile`).
  5. Confirm `harness_config.yaml` parses through the real loader, not just the schema: `npx tsx -e "import {loadConfig} from './src/config-loader.js'; console.log(Object.keys(loadConfig('harness_config.yaml', {ANYSEARCH_API_KEY:'x', REDIS_URL:'redis://x', LLM_MODEL:'m', LLM_API_KEY:'k', STORAGE_CONNECTION_STRING:'p', LANGFUSE_PUBLIC_KEY:'a', LANGFUSE_SECRET_KEY:'b', LANGFUSE_BASE_URL:'http://x'})))"`

- [ ] **Step 6: Commit** — `feat(harness): add search config schema, types, and capability narrowing (#21)`

---

## Task 2: route the real entrypoint through `loadConfig` — RISKY, isolate it

**Files:**
- Modify: `harness/scripts/run-real-pipeline.ts`, `harness/harness_config.yaml`

**Interfaces:**
- Produces: a `run-real-pipeline.ts` that obtains `HarnessConfig` from `loadConfig('harness_config.yaml')` instead of an inline literal, so interpolation, schema validation and the dangling-binding check all execute in a real run.

**Seam note — read this before starting.** The inline literal and the YAML launch the market-data MCP server *differently*:

| | market-data launch |
|---|---|
| `run-real-pipeline.ts` (works today) | `command: 'bash'`, `args: ['-c', 'cd <absolute REPO_ROOT> && exec uv run python -m forecasting_agent.data_server.server']` |
| `harness_config.yaml` (never exercised by a real run) | `command: 'uv'`, `args: ['run','--directory','..','python','-m','forecasting_agent.data_server.server']` |

The YAML form depends on cwd being `harness/`; the inline form is cwd-independent. **Reconcile the YAML to the form known to work** (the `bash -c` form, with the repo root interpolated from an env var rather than hardcoded), then prove the market-data server still launches. This is the only task that can break the one pipeline that currently works end to end, which is why it is sequenced alone and before any search wiring — a breakage here must be attributable to one change.

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/config-loader-entrypoint.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config-loader.js';
import { ConfigValidationError } from '../src/errors.js';

const env = {
  ANYSEARCH_API_KEY: 'k', REDIS_URL: 'redis://127.0.0.1:6379', REPO_ROOT: '/repo',
  LLM_MODEL: 'm', LLM_API_KEY: 'k', STORAGE_CONNECTION_STRING: 'postgres://x',
  LANGFUSE_PUBLIC_KEY: 'a', LANGFUSE_SECRET_KEY: 'b', LANGFUSE_BASE_URL: 'http://x',
};

describe('harness_config.yaml is loadable by the real entrypoint', () => {
  it('loads and binds every capability to a defined server', () => {
    const config = loadConfig('harness_config.yaml', env);
    expect(config.capabilities.search).toBe('anysearch');
    expect(config.mcp_servers.anysearch).toBeDefined();
    expect(config.mcp_servers.market).toBeDefined();
  });

  it('fails loudly when a capability points at an undefined server', () => {
    expect(() => loadConfig('tests/fixtures/harness_config.dangling.yaml', env)).toThrow(ConfigValidationError);
  });

  it('redacts the interpolated api key from validation errors', () => {
    try {
      loadConfig('tests/fixtures/harness_config.dangling.yaml', { ...env, ANYSEARCH_API_KEY: 'super-secret-value' });
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-value');
    }
  });
});
```

- [ ] **Step 2: Run to verify red**

Run: `cd harness && pnpm vitest run tests/config-loader-entrypoint.test.ts`
Expected: `FAIL` — the dangling fixture does not exist yet, and `capabilities.search` is still `'llm'`.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md section 9 ("Startup validation") in full before starting. It explains why this change is risky.

In harness/:

1. harness/harness_config.yaml — change the `market` mcp_servers entry to the cwd-independent form that is known to work in scripts/run-real-pipeline.ts today:
     market:
       command: bash
       args: ["-c", "cd ${REPO_ROOT} && exec uv run python -m forecasting_agent.data_server.server"]
   Do NOT keep the `uv run --directory ..` form; it depends on the process cwd and has never been exercised by a real run.

2. harness/tests/fixtures/harness_config.dangling.yaml (new) — a copy of harness_config.yaml whose capabilities.search points at a server name that is NOT in mcp_servers. Used to prove startup fails loudly.

3. harness/scripts/run-real-pipeline.ts — delete the inline `const config: HarnessConfig = {...}` literal and replace it with `const config = loadConfig(join(import.meta.dirname, '..', 'harness_config.yaml'));`. Keep everything else (Pool construction, runMigrations, runSingleAgentPipeline call, the memSnapshot logging, the final process.exit(0)) exactly as it is. REPO_ROOT must come from the environment now, so keep exporting a sensible default if it is unset.

Do not add Redis, search capability, or any tool wiring in this task — that is Task 11.

Style (hard rules): one-line file abstract; one-line input/output comment on every exported function. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/config-loader-entrypoint.test.ts tests/config.test.ts
```

- [ ] **Step 4: Verify green** — the three new tests pass.

- [ ] **Step 5: Validator brief (this one needs a REAL run, not just tests)**
  1. `git status` — only the four intended files.
  2. Re-run the test command cold.
  3. **Prove the market-data MCP server still launches**, because no unit test covers it. From `harness/`, with `REPO_ROOT` set:
     `npx tsx -e "import {loadConfig} from './src/config-loader.js'; import {MultiServerMCPClient} from 'langchain-mcp-adapters'; const c=loadConfig('harness_config.yaml'); const m=new MultiServerMCPClient({market:c.mcp_servers.market}); const t=await m.getTools(); console.log('market tools:', t.map(x=>x.name)); await m.close();"`
     Expected: the market-data tool list (e.g. `fetch_ohlcv`), not a spawn error. **If this fails, the task is not done** — a green unit suite here proves nothing about the subprocess.
  4. Confirm no secret appears in any error path: `grep -rn "api_key\|Authorization" scripts/run-real-pipeline.ts` should show none added.

- [ ] **Step 6: Commit** — `refactor(harness): load real pipeline config from harness_config.yaml (#21)`

---

## Task 3: `AnySearchResultParser` — markdown blob to `SearchResult[]`

**Files:** Create `harness/src/search/parser.ts`; test `harness/tests/search/parser.test.ts`. Parallelisable with T4, T7.

**Interfaces:**
- Consumes: `SearchResult`, `SearchResponseFormatError` (T1).
- Produces: `class AnySearchResultParser { parse(text: string): SearchResult[] }` — consumed by T8.

**Seam note.** Input is `result.content[0].text` from the MCP response — one markdown blob, no structured alternative (spec §0). Blocks are delimited by `^### N. ` and each carries a `- **URL**: <url>` line. **On a non-empty blob that yields zero blocks, throw `SearchResponseFormatError`** — a silent empty parse is indistinguishable from "no news exists" and would quietly poison sentiment. A genuinely-empty result set returns `[]`. That distinction is the whole point of this class.

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/search/parser.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnySearchResultParser } from '../../src/search/parser.js';
import { SearchResponseFormatError } from '../../src/search/types.js';

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/anysearch-search-response.json'), 'utf8'),
) as { response: { result: { content: { text: string }[] } } };
const BLOB = fixture.response.result.content[0]!.text;

describe('AnySearchResultParser', () => {
  const parser = new AnySearchResultParser();

  it('parses every result out of the real captured response', () => {
    const results = parser.parse(BLOB);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.hostname)).toEqual([
      'trendlyne.com', 'www.ril.com', 'www.screener.in', 'www.business-standard.com', 'www.moneycontrol.com',
    ]);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(results.every((r) => r.title.length > 0)).toBe(true);
    expect(results.every((r) => r.content.length > 0)).toBe(true);
  });

  it('returns [] for a genuinely empty result set', () => {
    expect(parser.parse('## Search Results (0 results, 12ms)\n')).toEqual([]);
  });

  it('throws on a non-empty blob it cannot parse, rather than returning []', () => {
    expect(() => parser.parse('the provider changed its output format entirely')).toThrow(SearchResponseFormatError);
  });

  it('keeps a result whose URL is unparseable, with a null hostname', () => {
    const results = parser.parse('## Search Results (1 results, 1ms)\n\n### 1. Broken\n- **URL**: not-a-url\nbody\n');
    expect(results).toHaveLength(1);
    expect(results[0]!.hostname).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify red** — `FAIL`, `Cannot find module '../../src/search/parser.js'`.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read section 0 of docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md — it documents the exact response shape, captured live.

Create harness/src/search/parser.ts exporting `class AnySearchResultParser` with one method:
  parse(text: string): SearchResult[]

Behaviour:
- Split the blob on /^### \d+\. /m and drop the leading segment (the "## Search Results (N results, Xms)" header).
- For each block: the first line is the title (trim it); the URL is the capture of /^- \*\*URL\*\*: (\S+)$/m, or null if absent; hostname is new URL(url).hostname, or null if url is null OR new URL() throws; content is the whole block text; rank is the 1-based index.
- If the blob produces zero blocks AND the blob is non-empty AND it does not look like an empty result set, throw SearchResponseFormatError with a message that includes the first 120 characters of the blob. Treat a blob matching /^##\s*Search Results \(0 results/ as a legitimately empty set and return [] for it.
- Never throw for a bad URL — that result is kept with hostname null.

Import SearchResult and SearchResponseFormatError from './types.js'.

Style (hard rules): one-line file abstract at the top; one-line input/output comment on the class and on the method. No multi-line docstrings. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search/parser.test.ts
```

- [ ] **Step 4: Verify green** — 4/4 pass.

- [ ] **Step 5: Validator brief**
  1. `git status` — only two files.
  2. Re-run the test cold.
  3. **Confirm the fixture was not edited to make the test pass**: `git diff --stat tests/fixtures/` must be empty. This is the highest-risk shortcut on this task.
  4. Adversarial input check, run yourself: parse a blob with a `### 1.` block but no URL line — must return one result with `url: null`, not throw.

- [ ] **Step 6: Commit** — `feat(harness): add AnySearch markdown result parser (#21)`

---

## Task 4: `DomainAllowlist` — hostname suffix matching

**Files:** Create `harness/src/search/allowlist.ts`; test `harness/tests/search/allowlist.test.ts`. Parallelisable with T3, T7.

**Interfaces:**
- Produces: `class DomainAllowlist { constructor(domains: readonly string[]); partition(results: SearchResult[]): { allowed: SearchResult[]; rejected: SearchResult[] } }` — consumed by T9.

**Seam note.** Match on `hostname === d || hostname.endsWith('.' + d)`. Both halves are load-bearing and both are evidence-driven: the suffix half is what admits `www.moneycontrol.com`, which is the form the provider actually returns; the leading dot is what rejects `notmoneycontrol.com` and `evilmoneycontrol.com`. **`includes()` is wrong** and is the defect this task's tests exist to prevent. A `null` hostname is always rejected.

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/search/allowlist.test.ts
import { describe, it, expect } from 'vitest';
import { DomainAllowlist } from '../../src/search/allowlist.js';
import type { SearchResult } from '../../src/search/types.js';

const r = (hostname: string | null): SearchResult => ({ rank: 1, title: 't', url: 'https://x/', hostname, content: 'c' });

describe('DomainAllowlist', () => {
  const list = new DomainAllowlist(['moneycontrol.com', 'nseindia.com']);

  it('admits an exact host and a www subdomain', () => {
    expect(list.partition([r('moneycontrol.com'), r('www.moneycontrol.com')]).allowed).toHaveLength(2);
  });

  it('rejects suffix-spoofing hosts', () => {
    const { allowed, rejected } = list.partition([
      r('notmoneycontrol.com'), r('evilmoneycontrol.com'), r('moneycontrol.com.evil.tld'),
    ]);
    expect(allowed).toHaveLength(0);
    expect(rejected).toHaveLength(3);
  });

  it('rejects a null hostname', () => {
    expect(list.partition([r(null)]).allowed).toHaveLength(0);
  });

  it('preserves order and returns every input in exactly one bucket', () => {
    const input = [r('moneycontrol.com'), r('google.com'), r('www.nseindia.com')];
    const { allowed, rejected } = list.partition(input);
    expect(allowed.map((x) => x.hostname)).toEqual(['moneycontrol.com', 'www.nseindia.com']);
    expect(rejected.map((x) => x.hostname)).toEqual(['google.com']);
    expect(allowed.length + rejected.length).toBe(input.length);
  });
});
```

- [ ] **Step 2: Run to verify red** — `Cannot find module '../../src/search/allowlist.js'`.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Create harness/src/search/allowlist.ts exporting `class DomainAllowlist`.

  constructor(domains: readonly string[])
  partition(results: SearchResult[]): { allowed: SearchResult[]; rejected: SearchResult[] }

A result is allowed when its hostname is non-null AND some configured domain d satisfies:
    hostname === d || hostname.endsWith('.' + d)

Do NOT use String.prototype.includes or a bare endsWith(d) without the leading dot — both admit
suffix-spoofing hosts like "notmoneycontrol.com" and "moneycontrol.com.evil.tld". The tests
specifically check these.

Preserve input order within each bucket. Every input must appear in exactly one bucket.
Import SearchResult from './types.js'.

Style (hard rules): one-line file abstract; one-line input/output comment on the class and the method. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search/allowlist.test.ts
```

- [ ] **Step 4: Verify green** — 4/4.

- [ ] **Step 5: Validator brief**
  1. `git status` — two files.
  2. Re-run cold.
  3. `grep -n "includes(" src/search/allowlist.ts` must return nothing.
  4. Run one adversarial case yourself that the suite does not cover: a configured domain given as `.moneycontrol.com` (leading dot) must not crash or double-match.

- [ ] **Step 6: Commit** — `feat(harness): add domain allowlist filter for search results (#21)`

---

## Task 5: `SearchBudgetLedger` — Redis + four Lua scripts

**Files:** Create `harness/src/search/redis.ts`, `harness/src/search/budget.ts`; test `harness/tests/search/budget.test.ts`.

**Interfaces:**
- Produces: `createRedisClient(url)`; `class SearchBudgetLedger` with `claim(runId, n): Promise<{granted:number; reused:boolean}>`, `spend(runId, units): Promise<number>`, `release(runId): Promise<number>`, `markDegraded(runId): Promise<boolean>`, `isDegraded(runId): Promise<boolean>` — consumed by T9.

**Seam note — the four scripts are in spec §3 and §5 verbatim; copy them, do not re-derive.** Four things were established by testing and are non-negotiable:

1. `claim` is **idempotent** — a second claim for the same run returns the existing grant and does not re-allocate. ADR-014's resume re-enters a run.
2. `release` does `DEL` and `DECRBY` **inside one script**, so a double release refunds nothing.
3. `markDegraded` **must be Lua with an `EXISTS` guard**. A plain `HSET` on a missing key creates it with **no TTL** (verified: `exists: 1, ttl: -1`) — an immortal key leaked on exactly the path the function exists to serve.
4. The daily key is IST-anchored via `EXPIREAT`, never `EXPIRE 86400`.

Tests share a Redis instance with other sessions — namespace every key under a unique per-test prefix and delete it in `afterEach`.

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/search/budget.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import { SearchBudgetLedger } from '../../src/search/budget.js';

const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
let redis: Redis;
let ledger: SearchBudgetLedger;
let prefix: string;
let n = 0;

beforeEach(() => {
  redis = new Redis(URL);
  prefix = `t21:${process.pid}:${n++}:`;
  ledger = new SearchBudgetLedger(redis, { dailyCap: 2000, runTtlSeconds: 600, keyPrefix: prefix });
});
afterEach(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe('SearchBudgetLedger', () => {
  it('a run cannot exceed its allocation', async () => {
    await ledger.claim('A', 20);
    let ok = 0;
    for (let i = 0; i < 21; i += 1) if ((await ledger.spend('A', 1)) === 1) ok += 1;
    expect(ok).toBe(20);
  });

  it('a runaway run exhausts only its own budget', async () => {
    await ledger.claim('A', 20);
    for (let i = 0; i < 20; i += 1) await ledger.spend('A', 1);
    expect((await ledger.claim('B', 20)).granted).toBe(20);
    expect(await ledger.spend('B', 1)).toBe(1);
  });

  it('claim is idempotent and does not double-allocate', async () => {
    const first = await ledger.claim('A', 20);
    const second = await ledger.claim('A', 20);
    expect(first).toEqual({ granted: 20, reused: false });
    expect(second).toEqual({ granted: 20, reused: true });
    expect(Number(await redis.get(await ledger.dailyKey()))).toBe(20);
  });

  it('grants partially when the daily pool is nearly exhausted', async () => {
    await redis.set(await ledger.dailyKey(), 1993);
    expect((await ledger.claim('C', 20)).granted).toBe(7);
  });

  it('release refunds the remainder exactly once', async () => {
    await ledger.claim('A', 20);
    await ledger.spend('A', 5);
    expect(await ledger.release('A')).toBe(15);
    expect(await ledger.release('A')).toBe(0);
    expect(Number(await redis.get(await ledger.dailyKey()))).toBe(5);
  });

  it('distinguishes an exhausted run from one with no allocation', async () => {
    await ledger.claim('A', 1);
    await ledger.spend('A', 1);
    expect(await ledger.spend('A', 1)).toBe(0);
    expect(await ledger.spend('NEVER-CLAIMED', 1)).toBe(-1);
  });

  it('anchors the daily key to IST midnight, not 86400 seconds out', async () => {
    await ledger.claim('A', 1);
    const ttl = await redis.ttl(await ledger.dailyKey());
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(90000);
    expect(ttl).not.toBe(86400);
  });

  it('markDegraded never resurrects an expired run key', async () => {
    const key = `${prefix}run:GONE`;
    await redis.del(key);
    expect(await ledger.markDegraded('GONE')).toBe(false);
    expect(await redis.exists(key)).toBe(0);
  });

  it('markDegraded sets the flag and preserves the run key TTL', async () => {
    await ledger.claim('A', 20);
    const before = await redis.ttl(`${prefix}run:A`);
    expect(await ledger.markDegraded('A')).toBe(true);
    expect(await ledger.isDegraded('A')).toBe(true);
    expect(await redis.ttl(`${prefix}run:A`)).toBeLessThanOrEqual(before);
    expect(await redis.ttl(`${prefix}run:A`)).toBeGreaterThan(before - 5);
  });
});
```

- [ ] **Step 2: Run to verify red** — `Cannot find module '../../src/search/budget.js'`.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read sections 3 and 5 of docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md.
They contain the four Lua scripts VERBATIM. Copy them exactly. Do not re-derive or "improve" them —
each line encodes a failure found by testing, and section 3 documents one (HSET creating a TTL-less
key) that a naive implementation reintroduces.

1. harness/src/search/redis.ts — export createRedisClient(url: string): Redis.
   MUST be `import { Redis } from 'ioredis'` — the default import does not compile under this repo's
   NodeNext + verbatimModuleSyntax settings.

2. harness/src/search/budget.ts — export `class SearchBudgetLedger`.
   constructor(redis: Redis, opts: { dailyCap: number; runTtlSeconds: number; keyPrefix?: string })
   Register the four scripts with redis.defineCommand in the constructor.

   Keys (keyPrefix defaults to 'search:'):
     `${prefix}run:${runId}`            hash: granted, remaining, degraded
     `${prefix}quota:${istDate}`        string counter

   Methods:
     dailyKey(): Promise<string>   — the current IST-dated quota key (tests use it)
     claim(runId, n): Promise<{ granted: number; reused: boolean }>
     spend(runId, units): Promise<number>   — units on success, 0 denied, -1 no allocation
     release(runId): Promise<number>        — refunded remainder
     markDegraded(runId): Promise<boolean>  — false if the run key is gone
     isDegraded(runId): Promise<boolean>

   IST handling: compute the date string AND the EXPIREAT target from the same Asia/Kolkata clock.
   Offset is +05:30. Next IST midnight in epoch seconds, plus a 3600s grace. Never EXPIRE 86400.

Style (hard rules): one-line file abstract; one-line input/output comment on every exported class and
method. No multi-line docstrings. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search/budget.test.ts
Redis is already running on 127.0.0.1:6379. The tests namespace their keys — do not flush the database.
```

- [ ] **Step 4: Verify green** — 9/9.

- [ ] **Step 5: Validator brief — the highest-risk task in this plan**
  1. `git status`; re-run the suite cold.
  2. **`redis-cli`-equivalent leak check**: after the suite, confirm no `t21:*` keys survive and, critically, that no key exists with `TTL == -1` under the ledger's prefix. Run via `npx tsx`: connect, `keys('search:*')` and `keys('t21:*')`, print each key's TTL. **Any `-1` is a fail** — that is the immortal-key defect.
  3. **Verify `release` is genuinely atomic**, not two round-trips: `grep -n "DEL" src/search/budget.ts` — the `DEL` must appear inside a Lua string, never as a `redis.del(...)` call next to a separate `decrby`.
  4. **Verify `markDegraded` has the `EXISTS` guard**: `grep -n "EXISTS" src/search/budget.ts` must show it inside the markDegraded script.
  5. Confirm no `EXPIRE` with a literal 86400 anywhere: `grep -n "86400" src/search/budget.ts` — only acceptable inside an IST-midnight computation, not as a TTL argument.
  6. Re-run the suite a **second time in the same Redis** to prove idempotence across runs (CLAUDE.md: a non-idempotent test produced a false "all green" on #8).

- [ ] **Step 6: Commit** — `feat(harness): add Redis-backed per-run search budget ledger (#21)`

---

## Task 6: `RunScopedSearchCache`

**Files:** Create `harness/src/search/cache.ts`; test `harness/tests/search/cache.test.ts`.

**Interfaces:**
- Produces: `class RunScopedSearchCache { normalise(q: string): string; get(runId, normalised): Promise<SearchResult[] | null>; set(runId, normalised, results): Promise<void> }` — consumed by T9.

**Seam note.** Key is `search:cache:{runId}:{sha256(normalised)}` — hashed, because an agent-authored query is unbounded text. Normalisation is NFKC → lowercase → collapse whitespace → trim. **Store the allowlist-filtered set**, so a later hit in the same run returns byte-identical results including the filter's verdict. TTL is `run_ttl_seconds`; keys are never explicitly deleted (spec §5 — no `SCAN` on release).

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/search/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import { RunScopedSearchCache } from '../../src/search/cache.js';
import type { SearchResult } from '../../src/search/types.js';

const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
let redis: Redis; let cache: RunScopedSearchCache; let prefix: string; let n = 0;

const results: SearchResult[] = [{ rank: 1, title: 't', url: 'https://www.moneycontrol.com/a', hostname: 'www.moneycontrol.com', content: 'c' }];

beforeEach(() => {
  redis = new Redis(URL);
  prefix = `t21c:${process.pid}:${n++}:`;
  cache = new RunScopedSearchCache(redis, { runTtlSeconds: 600, keyPrefix: prefix });
});
afterEach(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe('RunScopedSearchCache', () => {
  it('normalises case, whitespace and unicode form', () => {
    expect(cache.normalise('  Reliance   RESULTS\n')).toBe('reliance results');
    expect(cache.normalise('Reliance results')).toBe(cache.normalise('reliance   Results'));
  });

  it('round-trips results and misses for an unseen query', async () => {
    const k = cache.normalise('Reliance results');
    expect(await cache.get('A', k)).toBeNull();
    await cache.set('A', k, results);
    expect(await cache.get('A', k)).toEqual(results);
  });

  it('is scoped to the run — another run does not see the entry', async () => {
    const k = cache.normalise('Reliance results');
    await cache.set('A', k, results);
    expect(await cache.get('B', k)).toBeNull();
  });

  it('sets a bounded TTL, never a persistent key', async () => {
    const k = cache.normalise('Reliance results');
    await cache.set('A', k, results);
    const [key] = await redis.keys(`${prefix}cache:A:*`);
    expect(key).toBeDefined();
    const ttl = await redis.ttl(key!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('hashes the query rather than embedding it in the key', async () => {
    const k = cache.normalise('a query with spaces and: colons');
    await cache.set('A', k, results);
    const [key] = await redis.keys(`${prefix}cache:A:*`);
    expect(key).not.toContain('colons');
    expect(key).toMatch(/[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run to verify red** — module not found.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Create harness/src/search/cache.ts exporting `class RunScopedSearchCache`.

  constructor(redis: Redis, opts: { runTtlSeconds: number; keyPrefix?: string })   // prefix defaults to 'search:'
  normalise(query: string): string
  get(runId: string, normalised: string): Promise<SearchResult[] | null>
  set(runId: string, normalised: string, results: SearchResult[]): Promise<void>

- normalise: query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
- key: `${prefix}cache:${runId}:${sha256hex(normalised)}` using node:crypto createHash('sha256').
  Hash it — do NOT embed the raw query in the key.
- set: JSON.stringify the results, SET with EX runTtlSeconds. Never SET without an expiry.
- get: return null on a miss; JSON.parse on a hit.
- Import { Redis } from 'ioredis' (named import — the default import does not compile here).

Style (hard rules): one-line file abstract; one-line input/output comment on the class and each method. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search/cache.test.ts
```

- [ ] **Step 4: Verify green** — 5/5.

- [ ] **Step 5: Validator brief**
  1. `git status`; re-run cold.
  2. Leak check: after the suite, no `search:cache:*` or `t21c:*` key may have `TTL == -1`.
  3. `grep -n "set(" src/search/cache.ts` — confirm every `set` passes an expiry argument; a bare `SET` is a persistent-key bug the TTL test may not catch if the prefix differs.

- [ ] **Step 6: Commit** — `feat(harness): add run-scoped search result cache (#21)`

---

## Task 7: migration 004 + repository functions

**Files:** Create `harness/src/storage/migrations/004_search_observations.sql`; modify `harness/src/storage/repository.ts`, `harness/src/storage/types.ts`; test `harness/tests/search/search-observations.test.ts`. Parallelisable with T3, T4.

**Interfaces:**
- Produces: `search_observations` table; `forecasts.degraded` column; `saveSearchObservations(pool, row)`; `saveForecast` accepting `degraded` — consumed by T9 and T11.

**Seam note.** A separate table, **not** `observation_archive` — the grain differs (one row per result per query per run vs one row per source-file per day), that table has no `query` column, and its `UNIQUE (source, observed_on, sha256)` index would reject two runs archiving the same article on the same day. Numbered `004`; `runMigrations` keys `schema_migrations` by filename, so applying before or after #19's unmerged `003` is safe either way. **Persist rejected results too** (`allowed = false`) — the allowlist will be re-tuned and that is only possible against kept data. Verified: this exact SQL applies as one multi-statement query, which is how `runMigrations` executes it.

- [ ] **Step 1: Write the failing test**

```typescript
// harness/tests/search/search-observations.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../../src/storage/migrator.js';
import { saveSearchObservations, saveForecast } from '../../src/storage/repository.js';

const pool = new Pool({ connectionString: process.env.STORAGE_CONNECTION_STRING ?? 'postgresql://harness:harness@127.0.0.1:5432/harness' });
const runId = randomUUID();

beforeAll(async () => { await runMigrations(pool, 'src/storage/migrations'); });
afterAll(async () => {
  await pool.query('DELETE FROM search_observations WHERE forecast_run_id = $1', [runId]);
  await pool.query("DELETE FROM forecasts WHERE symbol = 'TEST21'");
  await pool.end();
});

describe('search_observations', () => {
  it('persists allowed and rejected results together, in one call', async () => {
    await saveSearchObservations(pool, [
      { forecast_run_id: runId, query: 'RELIANCE news', normalized_query: 'reliance news', provider: 'anysearch',
        result_rank: 1, title: 'A', url: 'https://www.moneycontrol.com/a', hostname: 'www.moneycontrol.com',
        allowed: true, content: 'body', retrieved_at: new Date() },
      { forecast_run_id: runId, query: 'RELIANCE news', normalized_query: 'reliance news', provider: 'anysearch',
        result_rank: 2, title: 'B', url: 'https://www.google.com/b', hostname: 'www.google.com',
        allowed: false, content: 'body', retrieved_at: new Date() },
    ]);
    const rows = await pool.query('SELECT allowed, hostname FROM search_observations WHERE forecast_run_id = $1 ORDER BY result_rank', [runId]);
    expect(rows.rows).toEqual([
      { allowed: true, hostname: 'www.moneycontrol.com' },
      { allowed: false, hostname: 'www.google.com' },
    ]);
  });

  it('two runs may archive the same article on the same day', async () => {
    const other = randomUUID();
    await saveSearchObservations(pool, [
      { forecast_run_id: other, query: 'q', normalized_query: 'q', provider: 'anysearch', result_rank: 1,
        title: 'A', url: 'https://www.moneycontrol.com/a', hostname: 'www.moneycontrol.com',
        allowed: true, content: 'body', retrieved_at: new Date() },
    ]);
    const rows = await pool.query('SELECT count(*) FROM search_observations WHERE url = $1', ['https://www.moneycontrol.com/a']);
    expect(Number(rows.rows[0].count)).toBeGreaterThanOrEqual(2);
    await pool.query('DELETE FROM search_observations WHERE forecast_run_id = $1', [other]);
  });

  it('persists a degraded forecast', async () => {
    await saveForecast(pool, { symbol: 'TEST21', horizon: '5d', prediction: {}, confidence: 0.5, as_of: new Date(), degraded: true });
    const rows = await pool.query("SELECT degraded FROM forecasts WHERE symbol = 'TEST21'");
    expect(rows.rows[0].degraded).toBe(true);
  });

  it('defaults degraded to false when not supplied', async () => {
    await saveForecast(pool, { symbol: 'TEST21', horizon: '5d', prediction: {}, confidence: 0.5, as_of: new Date() });
    const rows = await pool.query("SELECT degraded FROM forecasts WHERE symbol = 'TEST21' ORDER BY created_at DESC LIMIT 1");
    expect(rows.rows[0].degraded).toBe(false);
  });
});
```

The second test is the one that justifies this task's whole design choice: it would **fail** against `observation_archive`, whose `UNIQUE (source, observed_on, sha256)` index rejects exactly this case.

- [ ] **Step 2: Run to verify red** — `relation "search_observations" does not exist`.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read section 8 of docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md
for the exact DDL and the reasoning for a separate table.

1. harness/src/storage/migrations/004_search_observations.sql — exactly the DDL in spec section 8:
   the search_observations table, its two indexes, and
   ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS degraded boolean NOT NULL DEFAULT false;
   Use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS so it is re-runnable.
   Do NOT modify or renumber 001/002/003.

2. harness/src/storage/types.ts — add a SearchObservation interface matching the columns, and add
   `degraded?: boolean` to Forecast.

3. harness/src/storage/repository.ts —
   - saveSearchObservations(pool, observations: SearchObservation[]): Promise<void> — a single
     multi-row parameterised INSERT, not a loop of queries. Generate ids with randomUUID like the
     other save* functions do.
   - saveForecast: add the degraded column to its INSERT, defaulting to false when not supplied.
     Do not change any other behaviour or column of saveForecast.

Style (hard rules): one-line file abstract on new files; one-line input/output comment on every
exported function. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search/search-observations.test.ts
Postgres is running: postgresql://harness:harness@127.0.0.1:5432/harness
```

- [ ] **Step 4: Verify green.**

- [ ] **Step 5: Validator brief**
  1. `git status` — confirm migrations 001–003 are untouched: `git diff --stat src/storage/migrations/` must show only `004_*` added.
  2. Re-run cold, then **run the migration a second time** to prove idempotence (`IF NOT EXISTS` actually present).
  3. Confirm `saveSearchObservations` issues **one** query for N rows: `grep -c "pool.query" ` in that function should be 1, not inside a loop.
  4. Confirm the existing `saveForecast` tests still pass — this task modifies a function the working pipeline depends on.

- [ ] **Step 6: Commit** — `feat(harness): add search_observations table and repository writes (#21)`

---

## Task 8: `AnySearchProvider` — MCP call, timeout, healthCheck

**Files:** Create `harness/src/search/provider.ts`; test `harness/tests/search/provider.test.ts`. Needs T3.

**Interfaces:**
- Consumes: `AnySearchResultParser` (T3), `MultiServerMCPClient`.
- Produces: `class AnySearchProvider implements CapabilityProvider { search(query): Promise<SearchResult[]>; healthCheck(signal): Promise<void>; close(): Promise<void> }` — consumed by T9.

**Seam note — two rules that carry the whole metering guarantee:**

1. **Select the `search` tool by name and bind only it.** `getTools()` returns all four AnySearch tools (verified live). If the others reach an agent, `batch_search` alone lets one call spend five units the ledger never sees.
2. **Timeout via `AbortSignal.timeout(provider_timeout_ms)` passed as `config.signal`.** Verified: it aborts at ~51 ms for a 50 ms budget. But the rejection arrives as a `ToolException` whose class carries no timeout marker — so classify by checking **your own `signal.aborted`** in the catch block, never by string-matching `"TimeoutError"` in the message.

`healthCheck` issues `tools/list` and throws if no tool named `search` exists, so a bad binding fails at startup rather than at first search.

- [ ] **Step 1: Write the failing test** — inject a fake MCP client (constructor-injected, so no network): assert the provider calls only the `search` tool; that a 4-tool list yields a bound tool named `search`; that a missing `search` tool makes `healthCheck` reject; that a never-resolving tool with `provider_timeout_ms: 50` rejects with `SearchProviderTimeoutError` and not `SearchProviderError`; and that a thrown non-abort error yields `SearchProviderError`.

- [ ] **Step 2: Run to verify red** — module not found.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read sections 4 (the timeout paragraph), 6 and 9 of
docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md.

Create harness/src/search/provider.ts exporting `class AnySearchProvider`.

  constructor(deps: { getTools: () => Promise<StructuredTool[]>; parser: AnySearchResultParser;
                      maxResults: number; timeoutMs: number })
  search(query: string): Promise<SearchResult[]>
  healthCheck(signal: AbortSignal): Promise<void>

Take getTools as an injected function, NOT a MultiServerMCPClient constructed internally — the tests
must run with no network.

search():
  - Resolve the tool named exactly 'search' from getTools(). If absent, throw SearchProviderError.
  - const signal = AbortSignal.timeout(this.timeoutMs)
  - await tool.invoke({ query, max_results: this.maxResults }, { signal })
  - Extract the text: the invoke result may be a string, or an object with a content array of
    { type, text } items. Handle both; concatenate text items.
  - Pass the text to parser.parse() and return the result.
  - In catch: if signal.aborted, throw SearchProviderTimeoutError. Otherwise throw
    SearchProviderError wrapping the cause. NEVER inspect the error message text to decide which —
    the adapter wraps aborts in a ToolException whose message is three layers of third-party
    formatting deep.
  - Let SearchResponseFormatError from the parser propagate unchanged.

healthCheck(signal): call getTools() and throw SearchProviderError if no tool named 'search' is
present. Honour the passed signal.

Bind ONLY the 'search' tool. Never expose batch_search, extract or get_sub_domains anywhere.

Style (hard rules): one-line file abstract; one-line input/output comment on the class and each method. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search/provider.test.ts
Do NOT call the live AnySearch API in any test.
```

- [ ] **Step 4: Verify green.**

- [ ] **Step 5: Validator brief**
  1. `git status`; re-run cold.
  2. **`grep -n "TimeoutError\|includes('timeout')" src/search/provider.ts`** — any message-string matching is a fail; classification must come from `signal.aborted`.
  3. `grep -n "batch_search\|get_sub_domains\|extract" src/search/provider.ts` must return nothing.
  4. Confirm no test hit the network: `grep -rn "api.anysearch.com" tests/search/provider.test.ts` must return nothing.
  5. Confirm the timeout test actually measures — a test that mocks timers rather than exercising `AbortSignal.timeout` proves nothing about the real path.

- [ ] **Step 6: Commit** — `feat(harness): add AnySearch MCP provider with abort-bounded calls (#21)`

---

## Task 9: `AnySearchCapability` — the composition

**Files:** Create `harness/src/search/capability.ts`; test `harness/tests/search/capability.test.ts`. Needs T3–T8.

**Interfaces:**
- Produces: `class AnySearchCapability implements SearchCapability, SearchRunLifecycle` — consumed by T10, T11.

**Seam note.** The full flow is spec §4; implement it in that exact order. Four points decided by testing:

1. **Cache is checked before budget** — a repeat query costs zero units.
2. **Spend happens before the provider call and is never refunded on provider failure.** We cannot know whether AnySearch counted it server-side; over-counting is the safe direction.
3. **On denial, write the degraded flag to both stores** — `ledger.markDegraded` *and* the process-local `Set`. The Lua guard makes the Redis write a no-op when the run key is gone, and the local set is what makes that harmless. `degraded` is reported as `redisFlag || localSet.has(runId)`.
4. **`endRun` clears both** the ledger allocation and the local set. A backstop that never clears is an unbounded leak in a long-running process.

An archive-write failure **propagates** — it is not swallowed. An unpersisted result voids reproducibility, and the run would die at `saveForecast` anyway.

- [ ] **Step 1: Write the failing test** — with a stub provider, real Redis, and a stub repository writer: repeat query costs one unit and reports `source: 'cache'`; exhaustion returns `{results: [], source: 'degraded', degraded: true}` without throwing; a cache hit after degradation still reports `degraded: true`; degradation survives a `DEL` of the run key (process-local backstop); `endRun` removes the run key **and** clears the local set (a later `search` on that id reports `degraded: false`); rejected results are persisted with `allowed: false`; a rejecting repository makes `search` reject.

- [ ] **Step 2: Run to verify red** — module not found.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read sections 3, 3a and 4 of
docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md IN FULL first.
Section 4 has the numbered flow; implement it in exactly that order.

Create harness/src/search/capability.ts exporting `class AnySearchCapability`
implementing SearchCapability and SearchRunLifecycle.

  constructor(deps: {
    provider: AnySearchProvider;          // already parses internally — do not add a parser here
    allowlist: DomainAllowlist;
    ledger: SearchBudgetLedger;
    cache: RunScopedSearchCache;
    saveObservations: (rows: SearchObservation[]) => Promise<void>;
    initialBudget: number;
  })

  private readonly #localDegraded = new Set<string>()

  beginRun(runId): Promise<number>  -> ledger.claim(runId, initialBudget), return granted
  endRun(runId): Promise<number>    -> const refunded = await ledger.release(runId);
                                       this.#localDegraded.delete(runId); return refunded
  healthCheck(signal)               -> delegate to provider.healthCheck(signal)

  search(runId, query): Promise<SearchOutcome>
    1. const normalised = cache.normalise(query)
    2. const cached = await cache.get(runId, normalised)
       if cached -> return { results: cached, source: 'cache', degraded: await this.#isDegraded(runId) }
    3. const spent = await ledger.spend(runId, 1)
       if spent !== 1 -> await ledger.markDegraded(runId); this.#localDegraded.add(runId);
                         return { results: [], source: 'degraded', degraded: true }
    4. const parsed = await provider.search(query)
    5. const { allowed, rejected } = allowlist.partition(parsed)
    6. await saveObservations([...allowed, ...rejected].map(...)) with allowed:true/false, the raw
       query, the normalised query, provider 'anysearch', and retrieved_at = new Date().
       DO NOT catch this — a failure must propagate.
    7. await cache.set(runId, normalised, allowed)     // the FILTERED set, not the raw set
    8. return { results: allowed, source: 'provider', degraded: await this.#isDegraded(runId) }

  #isDegraded(runId): (await ledger.isDegraded(runId)) || this.#localDegraded.has(runId)

Do not add retries, fallbacks, or a refund on provider failure. Do not swallow any error.

Style (hard rules): one-line file abstract; one-line input/output comment on the class and each
method (including private ones). No multi-line docstrings. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search/capability.test.ts
```

- [ ] **Step 4: Verify green.**

- [ ] **Step 5: Validator brief**
  1. `git status`; re-run cold; re-run a second time (shared Redis — prove idempotence).
  2. **Confirm the ordering by reading the code**, not the tests: cache read must precede `ledger.spend`; `saveObservations` must precede `cache.set`.
  3. `grep -n "catch" src/search/capability.ts` — there must be no `try/catch` around the persistence call.
  4. Confirm the refund-on-failure defect is absent: `grep -n "release\|refund" src/search/capability.ts` — `release` may appear only inside `endRun`.
  5. Confirm `#localDegraded.delete` exists in `endRun`. Its absence is an unbounded memory leak no unit test will notice.

- [ ] **Step 6: Commit** — `feat(harness): compose metered, cached AnySearch capability (#21)`

---

## Task 10: `buildSearchTool` — the only surface the LLM sees

**Files:** Create `harness/src/search/tool.ts`; test `harness/tests/search/tool.test.ts`. Needs T9.

**Interfaces:**
- Produces: `buildSearchTool(capability: SearchCapability, runId: string): StructuredTool` — consumed by T11.

**Seam note.** Verified: `tool()` from `@langchain/core/tools` returns a `DynamicStructuredTool`, which is the `StructuredTool` that `buildPriceAnchorAgent` accepts. **`runId` is closed over, never a tool parameter** — if the model could supply it, it could spend another run's budget, and the accounting unit stops being trustworthy. The schema exposes `query` and nothing else.

- [ ] **Step 1: Write the failing test** — the returned tool is named `search_news`; its JSON schema has exactly one property, `query`, and no `runId`; invoking it calls `capability.search` with the closed-over `runId`; the result is a JSON string containing the outcome.

- [ ] **Step 2: Run to verify red** — module not found.

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read section 3a of docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md.

Create harness/src/search/tool.ts exporting:
  buildSearchTool(capability: SearchCapability, runId: string): StructuredTool

Use `tool()` from '@langchain/core/tools':
  name: 'search_news'
  description: 'Search recent Indian financial news. Returns results from approved financial portals only.'
  schema: z.object({ query: z.string().min(1).describe('One search intent, in natural language.') })
  implementation: async ({ query }) => JSON.stringify(await capability.search(runId, query))

runId is closed over from the parameter. It MUST NOT appear in the zod schema — a model that could
supply a runId could spend another run's budget.

Style (hard rules): one-line file abstract; one-line input/output comment on the exported function. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/search/tool.test.ts
```

- [ ] **Step 4: Verify green.**

- [ ] **Step 5: Validator brief**
  1. `git status`; re-run cold.
  2. **Inspect the tool's actual JSON schema at runtime** and assert `runId` is absent — reading the source is not enough, since a zod change could reintroduce it.
  3. Confirm the description does not leak budget/quota concepts to the model.

- [ ] **Step 6: Commit** — `feat(harness): expose metered search to agents as search_news tool (#21)`

---

## Task 11: pipeline wiring — registry, lifecycle, tool injection, cost meter

**Files:** Modify `harness/src/pipeline/single-agent.ts`, `harness/scripts/run-real-pipeline.ts`; test `harness/tests/search/pipeline-wiring.test.ts`. Needs T2, T9, T10.

**Interfaces:**
- Produces: a pipeline that claims a budget, injects `search_news`, persists `degraded`, emits settled spend, and releases in `finally`.

**Seam note — five changes, each with a specific failure it prevents:**

1. `run-real-pipeline.ts` constructs the Redis client, ledger, cache, provider and capability; registers the capability on a `CapabilityRegistry`; and `await registry.validateAll()` **before** the first run. The registry currently has no consumer anywhere outside its own test — this is what makes the "fails loudly on a bad binding" AC real.
2. `runForecast` calls `beginRun(runId)` after the MCP client connects, before the first `agent.invoke()`.
3. `buildSearchTool(capability, runId)` is appended to the `tools` array. **The AnySearch server must not be added to the pipeline's `MultiServerMCPClient`** — if it were, the LLM would receive the provider's own unmetered tools alongside the wrapper.
4. `endRun(runId)` goes in the **existing `finally` block**, next to `adapter.dispose()` and `mcpClient.close()`.
5. `trace.update({ metadata: { symbol, runId, search_granted, search_spent, search_degraded } })` — settled spend is `granted − refunded`. `TraceHandle.update` accepts an arbitrary metadata record (verified). `saveForecast` gets `degraded`.

- [ ] **Step 1: Write the failing test** — with the capability and sandbox mocked: `beginRun` is called once before the agent invoke; the tool array contains exactly one search-named tool and it is `search_news`; `endRun` is called in `finally` even when the agent throws; `saveForecast` receives `degraded: true` when the run degraded; the trace metadata carries `search_granted`/`search_spent`.

- [ ] **Step 2: Run to verify red.**

- [ ] **Step 3: Gemini delegation prompt (paste verbatim)**

```
Read sections 3a (the "Where it all gets constructed" paragraph), 3b and 9 of
docs/superpowers/specs/2026-08-17-search-capability-and-quota-metering-design.md.

1. harness/scripts/run-real-pipeline.ts
   - Build: createRedisClient(config.redis.url), SearchBudgetLedger, RunScopedSearchCache,
     AnySearchResultParser, AnySearchProvider (its getTools comes from a MultiServerMCPClient
     constructed with ONLY config.mcp_servers[config.capabilities.search]), and AnySearchCapability.
   - const registry = new CapabilityRegistry(); registry.register('search', capability);
     await registry.validateAll();   // before the first pipeline run
   - Pass the capability into runSingleAgentPipeline.
   - Close the Redis client and that MCP client in the existing finally.

2. harness/src/pipeline/single-agent.ts
   - RunSingleAgentPipelineParams gains `search: SearchCapability & SearchRunLifecycle`.
   - In runForecast, after the market-data MCP client connects and BEFORE the first agent.invoke():
       const granted = await search.beginRun(runId); logStage(runId, `search: budget granted=${granted}`);
   - Append buildSearchTool(search, runId) to the tools array passed to buildPriceAnchorAgent.
     DO NOT add the anysearch server to this file's MultiServerMCPClient — the market-data server
     is the only one it connects to. The agent must reach search only through the wrapper.
   - In the EXISTING finally block, alongside adapter.dispose() and mcpClient.close():
       const refunded = await search.endRun(runId);
     and compute spent = granted - refunded.
   - Before the existing trace.update call, extend its metadata to:
       { symbol, runId, search_granted: granted, search_spent: spent, search_degraded: degraded }
     where degraded comes from the last SearchOutcome observed, or false if search was never used.
   - Pass degraded through to saveForecast.

Do not change the sandbox, validate-tier, or retry logic in any way.

Style (hard rules): one-line input/output comment on every function you add or change signature of. 120 char lines.

Then run: pnpm lint && pnpm typecheck && pnpm vitest run tests/
```

- [ ] **Step 4: Verify green** — and confirm the pre-existing 5 storage failures are still exactly 5.

- [ ] **Step 5: Validator brief**
  1. `git status`; re-run the **whole** suite cold, and diff the failure count against the 5-failure baseline. Any new failure is a regression in the working pipeline.
  2. **`grep -n "anysearch" src/pipeline/single-agent.ts` must return nothing** — if the search server appears in this file's MCP client, unmetered provider tools reach the LLM and the story's central guarantee is void.
  3. Confirm `endRun` is inside `finally`, not on the success path: read the block; a happy-path-only release leaks the whole allocation on every failed run.
  4. Confirm `validateAll()` is awaited *before* the first run, not after.
  5. Re-run the Task 2 market-data launch probe — this task edits the same entrypoint.

- [ ] **Step 6: Commit** — `feat(harness): wire metered search into the forecast pipeline (#21)`

---

## Task 12: live end-to-end smoke + sandbox regression, then close out

**Files:** Create `harness/tests/search/live-smoke.test.ts`, `harness/tests/search/sandbox-no-credentials.test.ts`.

**Seam note.** This is the only test permitted to call the live provider, and it is gated behind `RUN_LIVE_SEARCH_E2E=1` via `describe.skipIf` — verified working on vitest 4.1.10 (a deliberately failing gated test was skipped). Ungated, it would spend real quota on every `pnpm test`, against the very ceiling this story protects. It is **harness-level, not a forecast run**: there is no sentiment agent and no debate yet, so "every debate round sees identical results" has no debate to exercise; the repeat-query assertion is what proves the cache's round-stability property.

- [ ] **Step 1: Write the tests**
  - *Live smoke (gated):* `beginRun` → real `search_news` invocation against live AnySearch → assert results are non-empty and every hostname is on the allowlist → repeat the identical query and assert `source: 'cache'` with the ledger's `remaining` unchanged → drain the budget and assert `{source: 'degraded', degraded: true}` with no throw → `endRun` and assert the daily counter returns to its pre-claim value.
  - *Sandbox regression (needs Docker, ungated):* create a real warm container through `SandboxManager` and assert its inspected `Config.Env` contains no `ANYSEARCH_*` variable.

- [ ] **Step 2: Run the sandbox test to verify red**, then implement nothing — it should pass immediately, since `getOrCreateWarmContainer` sets no `Env` at all. **A test that passes on first write is only meaningful if you prove it can fail**: temporarily add an `ANYSEARCH_API_KEY` to the container's `Env`, watch it go red, then revert. Record both outcomes.

- [ ] **Step 3: Run the live smoke with a real key**

```bash
cd harness && RUN_LIVE_SEARCH_E2E=1 ANYSEARCH_API_KEY=<key> pnpm vitest run tests/search/live-smoke.test.ts
```

- [ ] **Step 4: Verify the whole suite** — `pnpm lint && pnpm typecheck && pnpm test`, expecting the 5 pre-existing storage failures and nothing else.

- [ ] **Step 5: Final validator brief (do all of this inline, cold)**
  1. `git status` across the worktree — no stray files, nothing written outside the repo, nothing written to the Obsidian vault.
  2. Confirm `ioredis` is in `package.json` **and** `pnpm-lock.yaml` (`pnpm install --frozen-lockfile` must succeed).
  3. Redis leak sweep: no key under `search:*` with `TTL == -1`.
  4. Confirm the daily counter is back to its pre-test value — a smoke test that permanently debits quota is itself the bug.
  5. Re-measure, don't assume: report the actual number of units the smoke test spent.
  6. Confirm the gated test really is skipped by default: run `pnpm test` **without** the env var and check the live smoke reports as skipped, not passed.

- [ ] **Step 6: Commit** — `test(harness): add gated live search smoke and sandbox credential regression (#21)`

---

## Closing out (after all twelve tasks verify)

1. **Report the partial AC honestly.** "No search path is reachable from a sandbox container" ships **partially satisfied**. What is enforced: no search tool or credential ever crosses into a container, and the sandbox backend exposes only exec/file operations, so there is no mechanism by which a tool could. What is not: the explore tier has default bridge networking and AnySearch serves anonymous requests, so agent-written Python can still reach it outside the ledger's view. Reproduction is in spec §10.
2. **File the deferred network hole** as a GitHub issue against the sandbox story (#7), with the two probe commands and their outputs.
3. **Obsidian sync** (CLAUDE.md hard rule): `Daily/2026-08-17.md`, move #21 to Done on the Kanban, tick the checklist in `Projects/Forecasting Agent.md`, and add the ADR-shaped note for the decisions this spec made on its own (§0a) with `type: adr`, `date: 2026-08-17`, `status: decided`, `parent: "[[Forecasting Agent]]"`.
4. **Do not push or open a PR** without explicit go-ahead.

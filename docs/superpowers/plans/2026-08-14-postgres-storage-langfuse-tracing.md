# Postgres Storage, Temporal `as_of` Guards & Langfuse Tracing — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-14-postgres-storage-langfuse-tracing-design.md` (APPROVED, R4, two consecutive clean rounds)
**Issue:** #8 · **Branch:** `feat/issue-8-postgres-storage` (based on current `main`, spec committed at `a3a36cb`)
**Written inline** (no `gemini-plan-writer` dispatch, per the Token-efficiency CLAUDE.md rule). Implementation delegates to Gemini via `agy` per task; validation is inline, not a dispatched Haiku/Sonnet subagent.

## Global Constraints (every task must respect these)

1. **No `session_memory` table anywhere.** ADR-020 assigns the Session tier to Redis, not Postgres. `002_memory_tiers.sql` creates `semantic_memory` only.
2. **`semantic_memory` uses `pgvector`, not JSONB.** `CREATE EXTENSION IF NOT EXISTS vector`, a `vector(N)` column, an `ivfflat` or `hnsw` index. Real Postgres 18 + pgvector 0.8.6 are installed and running locally (`localhost:5432`) — verified directly this session, use them, do not mock.
3. **DB connection string and Langfuse keys live in `HarnessConfig`, never the capability registry.** `harness/src/config.ts`'s `CapabilitiesSchema` requires exactly four keys (`chat`, `search`, `sentiment`, `market_data`) — do not add a fifth. Instead extend `HarnessConfigSchema` with `storage: z.object({ connection_string: z.string().min(1) })` and `tracing: z.object({ langfuse_public_key: z.string().min(1), langfuse_secret_key: z.string().min(1), langfuse_base_url: z.string().min(1) })`, the same way `sandbox`/`eval` are existing placeholder sections.
4. **`uuid@14`'s `v7()` export, not a separate `uuidv7` package.** Already monotonic, verified.
5. **`debate_traces`/`debate_checkpoints` are NOT subject to the `as_of` guard** — they're operational replay records, not backtest-relevant memory. Only `forecasts`, `agent_signals`, `semantic_memory` get the guard.
6. **`as_of` is stamped by the application at write time, never DB-defaulted.** No `DEFAULT now()` on any `as_of` column — a caller must set it explicitly, so it can't be silently forgotten.
7. **`pg.Pool({ max: 10 })`, one pool per process.** No per-call pool creation.
8. **No Redis usage in this story's code.** Redis is running locally (installed this session) but nothing here reads or writes to it — that's a later story.

## File Structure

```
harness/src/
  config.ts                  MODIFY — add storage/tracing sections   Task 1
  storage/
    migrations/
      001_initial.sql         forecasts, debate_traces, evaluation_results,
                               agent_signals, debate_checkpoints            Task 1
      002_memory_tiers.sql     semantic_memory (pgvector)                    Task 3
    types.ts                  Task 1
    migrator.ts                Task 1
    pool.ts                    Task 2
    repository.ts               Task 2
  tracing/
    correlation.ts              Task 4
    langfuse.ts                  Task 4
harness/tests/
  storage.test.ts               Task 1 (migrator), Task 2 (repository), Task 3 (semantic_memory)
  tracing.test.ts               Task 4
  storage-integration.test.ts    Task 5
```

## Dependency Ordering & Parallel Dispatch

```
Task 1 (config.ts storage/tracing sections + 001_initial.sql + migrator.ts + types.ts)
   │  ── sequential, blocks everything: every other task needs config.ts's new
   │     sections and/or the migrator to have applied 001_initial.sql's tables
   │
   ├── Task 2 (pool.ts + repository.ts)          ─┐
   ├── Task 3 (002_memory_tiers.sql)               ─┼── dispatch in parallel,
   ├── Task 4 (correlation.ts + langfuse.ts)         ─┘   each its own worktree
   │
Task 5 (storage-integration.test.ts)  ── sequential, last, needs 2/3/4 all landed
```

**Independence check:** Task 2 writes `pool.ts`+`repository.ts`, Task 3 writes one new migration file, Task 4 writes `tracing/*` — three disjoint file sets, none written by more than one task. Task 2 and Task 4 both *read* Task 1's `config.ts`, neither modifies it further. Task 3 only needs Task 1's `migrator.ts` to exist and run against it. Safe to run all three in parallel worktrees.

**Real infra note:** unlike #5, no `pg-mem`/mocking layer — real Postgres 18 + pgvector + Redis are running on this machine (`localhost:5432` / `localhost:6379`, verified in the spec's Testing section). Every task's tests run against them directly. Each test file should create its own throwaway database (or use a truncate-between-tests pattern) rather than assuming a specific pre-seeded state.

---

## Task 1: `config.ts` extension + `001_initial.sql` + `migrator.ts` + `types.ts`

**Seam note.** `migrator.ts` is the interface every other storage task depends on: "run migrations, know what's applied." Get its `schema_migrations` bookkeeping wrong and re-running it in Task 2/3/5's setup either double-applies a migration or silently skips one. `config.ts`'s new sections are the second seam — everything downstream reads storage/tracing config through them, never through a raw `process.env` read.

**Files:** `harness/src/config.ts` (modify), `harness/src/storage/migrations/001_initial.sql`, `harness/src/storage/migrator.ts`, `harness/src/storage/types.ts`; `harness/tests/storage.test.ts` (migrator portion).

**Failing test to write and confirm red before dispatch:**

```typescript
// harness/tests/storage.test.ts (migrator portion — Task 2/3 append more below)
import { describe, it, expect, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '../src/storage/migrator.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/harness_test';

describe('migrator', () => {
  it('applies 001_initial.sql and records it in schema_migrations', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    const applied = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(applied.rows.map((r) => r.name)).toContain('001_initial.sql');
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = tables.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['forecasts', 'debate_traces', 'evaluation_results', 'agent_signals', 'debate_checkpoints'])
    );
    await pool.end();
  });

  it('re-running migrations is a no-op, not a re-apply', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    const before = await pool.query('SELECT count(*) FROM schema_migrations');
    await runMigrations(pool, 'src/storage/migrations');
    const after = await pool.query('SELECT count(*) FROM schema_migrations');
    expect(after.rows[0].count).toBe(before.rows[0].count);
    await pool.end();
  });
});
```

Expected red: `Cannot find module '../src/storage/migrator.js'` — nothing under `harness/src/storage/` exists yet.

**Gemini delegation prompt:**

```
Implement harness/src/storage/migrator.ts, harness/src/storage/types.ts,
harness/src/storage/migrations/001_initial.sql, and extend harness/src/config.ts
in the Forecasting_Agent repo. This is Task 1 of a 5-task plan — read
docs/superpowers/specs/2026-08-14-postgres-storage-langfuse-tracing-design.md
in full first, decisions 1, 5, 6, and 9 specifically.

The failing tests at harness/tests/storage.test.ts (the migrator describe block)
are the acceptance criterion.

Real Postgres 18 + pgvector are running on this machine at localhost:5432 (no
mock, no pg-mem) — connect to it directly for anything this task needs to verify.

Build:

0. Add "pg": "^8.23.0" to harness/package.json's dependencies and
   "@types/pg": "^8.21.0" to devDependencies (pg ships without bundled types),
   then run `cd harness && pnpm install`. Neither is currently a dependency —
   this task's test file imports `Pool` from 'pg' and will fail at the import
   line otherwise.

1. Extend harness/src/config.ts's HarnessConfigSchema (do not modify
   CapabilitiesSchema, McpServerSchema, or remove any existing field) by adding:
     storage: z.object({ connection_string: z.string().min(1) }),
     tracing: z.object({
       langfuse_public_key: z.string().min(1),
       langfuse_secret_key: z.string().min(1),
       langfuse_base_url: z.string().min(1),
     }),
   Follow the exact pattern sandbox/eval already use in that file.

2. harness/src/storage/types.ts — TypeScript interfaces: Forecast, DebateTrace,
   EvalResult, AgentSignal, DebateCheckpoint (one field per column in
   001_initial.sql below — id, created_at, as_of where applicable, plus the
   domain fields: Forecast has symbol/horizon/prediction/confidence,
   DebateTrace has forecast_run_id/round_number/content jsonb,
   EvalResult has forecast_run_id/metric_name/metric_value,
   AgentSignal has forecast_run_id/agent_name/signal jsonb,
   DebateCheckpoint has forecast_run_id/round_number/state jsonb).

3. harness/src/storage/migrations/001_initial.sql — creates:
     forecasts(id uuid pk, symbol text, horizon text, prediction jsonb,
       confidence real, created_at timestamptz not null, as_of timestamptz not null)
     debate_traces(id uuid pk, forecast_run_id uuid, round_number int,
       content jsonb, created_at timestamptz not null)
     evaluation_results(id uuid pk, forecast_run_id uuid, metric_name text,
       metric_value real, created_at timestamptz not null)
     agent_signals(id uuid pk, forecast_run_id uuid, agent_name text,
       signal jsonb, created_at timestamptz not null, as_of timestamptz not null)
     debate_checkpoints(id uuid pk, forecast_run_id uuid, round_number int,
       state jsonb, created_at timestamptz not null)
   Add a GIN index on each jsonb column. NEVER add "DEFAULT now()" to any
   as_of column — it must be NOT NULL with no default, so the application is
   forced to set it explicitly (constraint 6 in the plan).

4. harness/src/storage/migrator.ts:
     export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void>
   Creates a schema_migrations(name text primary key, applied_at timestamptz
   default now()) table if it doesn't exist. Reads .sql files from
   migrationsDir in filename-sorted order, skips any already recorded in
   schema_migrations, applies the rest in a transaction each, records the
   filename on success.

Boundaries: do not create pool.ts, repository.ts, correlation.ts, langfuse.ts,
or 002_memory_tiers.sql — only the four things listed above. Do not modify
CapabilitiesSchema or remove any existing field from config.ts.

Run `cd harness && pnpm vitest run tests/storage.test.ts` yourself and confirm
both tests pass, using the real local Postgres at localhost:5432 (create a
harness_test database first if it doesn't exist:
`psql -h localhost -c "CREATE DATABASE harness_test"` or equivalent). Report
the actual output.
```

**Validator brief (inline, run by me after Gemini returns):**
- Run `cd harness && pnpm vitest run tests/storage.test.ts` myself against the real local Postgres — both tests pass, real output.
- Read `migrator.ts` — confirm each migration applies inside a transaction (a partial apply on failure must not get recorded as applied).
- `psql -h localhost -d harness_test -c "\d+ forecasts"` etc. — confirm no `as_of` column has a `DEFAULT now()` (constraint 6).
- `grep -n "storage:\|tracing:" harness/src/config.ts` — confirm the new sections exist and `CapabilitiesSchema` is untouched (`git diff` should show only additions to `HarnessConfigSchema`, not a modified `CapabilitiesSchema`).

---

## Task 2: `pool.ts` + `repository.ts`

**Seam note.** `repository.ts` is the *only* write/read path the rest of the harness ever calls — `pool.ts` and the raw `pg` client stay behind it. This is what makes the `as_of` guard (spec's central concern) enforceable in one place instead of every call site remembering to add a `WHERE` clause.

**Files:** `harness/src/storage/pool.ts`, `harness/src/storage/repository.ts`; `harness/tests/storage.test.ts` (repository portion, appended).

**Failing test to write and confirm red before dispatch:**

```typescript
// appended to harness/tests/storage.test.ts
import { saveForecast, saveAgentSignal, queryMemory } from '../src/storage/repository.js';

describe('repository — as_of guard', () => {
  it('queryMemory excludes a future-stamped row from a past-dated query', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await saveForecast(pool, { symbol: 'RELIANCE', horizon: '1d', prediction: {}, confidence: 0.8,
      asOf: new Date('2024-06-01') });
    await saveForecast(pool, { symbol: 'RELIANCE', horizon: '1d', prediction: {}, confidence: 0.8,
      asOf: new Date('2024-01-01') });
    const results = await queryMemory(pool, new Date('2024-03-01'));
    expect(results.every((r) => r.asOf <= new Date('2024-03-01'))).toBe(true);
    expect(results.some((r) => r.asOf.getTime() === new Date('2024-01-01').getTime())).toBe(true);
    await pool.end();
  });

  it('there is no alternate read method that skips the as_of guard', async () => {
    const repo = await import('../src/storage/repository.js');
    const exportedNames = Object.keys(repo);
    const readMethods = exportedNames.filter((n) => n.toLowerCase().includes('query') || n.toLowerCase().includes('get'));
    expect(readMethods).toEqual(['queryMemory']);
  });
});
```

Expected red: `Cannot find module '../src/storage/repository.js'`.

**Gemini delegation prompt:**

```
Implement harness/src/storage/pool.ts and harness/src/storage/repository.ts in
the Forecasting_Agent repo. Task 2 of 5 — read
docs/superpowers/specs/2026-08-14-postgres-storage-langfuse-tracing-design.md's
"as_of Guard" and "Connection Management" sections first. Task 1 has already
landed config.ts's storage section, migrator.ts, types.ts, and 001_initial.sql
— do not modify any of them.

The failing tests appended to harness/tests/storage.test.ts (the "repository —
as_of guard" describe block) are the acceptance criterion.

Real Postgres 18 is running at localhost:5432 — connect to it directly.

Build:

1. pool.ts: export a function getPool(config: HarnessConfig): Pool that
   constructs `new Pool({ connectionString: config.storage.connection_string,
   max: 10 })`. One pool per process — do not create a new Pool per call.

2. repository.ts, importing types from ./types.js:
     saveForecast(pool, forecast): Promise<void>
     saveDebateTrace(pool, trace): Promise<void>
     saveEvalResult(pool, result): Promise<void>
     saveAgentSignal(pool, signal): Promise<void>
     saveDebateCheckpoint(pool, checkpoint): Promise<void>
     queryMemory(pool, asOf: Date): Promise<AgentSignal[]>
   queryMemory is the ONLY read function in this file — it is the sole path
   for retrieving backtest-relevant memory, and it MUST append
   `WHERE as_of <= $1` to its query. Do not add any other read/query/get
   function to this file — that would create a second path that could skip
   the guard, which the second test above specifically checks for by
   asserting the file's exports.
   All INSERTs use parameterized queries ($1, $2, ...), never string
   interpolation. Every save* function that writes an as_of-guarded table
   requires the caller to pass an explicit as_of value — do not default it
   to `new Date()` inside the function (constraint 6: the application sets
   it explicitly, every time, visibly).

Boundaries: only pool.ts and repository.ts. Do not touch config.ts, migrator.ts,
types.ts, 001_initial.sql, or create 002_memory_tiers.sql/correlation.ts/
langfuse.ts. Do not modify the test file.

Run `cd harness && pnpm vitest run tests/storage.test.ts` and confirm ALL
tests in the file pass (Task 1's migrator tests plus these two), against
the real local Postgres. Report the actual output.
```

**Validator brief:** run the full `storage.test.ts` file myself — all tests pass, not just the new ones (a regression check on Task 1's tests). Read `repository.ts` and confirm `queryMemory` is genuinely the only exported function with a read shape — the second test asserts this via `Object.keys`, but reading the source directly is the adversarial check per the plan's own "check the linter would actually catch a violation" precedent from #5. Confirm no `save*` function silently defaults `as_of`.

---

## Task 3: `002_memory_tiers.sql`

**Seam note.** This migration is the one place `pgvector` gets exercised — real, not `pg-mem`, since `pg-mem` was confirmed unable to run `CREATE EXTENSION vector` during spec review. Isolated to its own file/task specifically so a mistake here (wrong vector dimension, wrong index type) doesn't block Tasks 2/4, which don't depend on it.

**Files:** `harness/src/storage/migrations/002_memory_tiers.sql`; `harness/tests/storage.test.ts` (semantic_memory portion, appended).

**Failing test to write and confirm red before dispatch:**

```typescript
// appended to harness/tests/storage.test.ts
describe('semantic_memory (pgvector)', () => {
  it('applies 002_memory_tiers.sql, creates a real vector column and index', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    const ext = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.rows.length).toBe(1);
    await pool.query(
      `INSERT INTO semantic_memory (id, embedding, as_of) VALUES (gen_random_uuid(), '[0.1,0.2,0.3]', now())`
    );
    const rows = await pool.query(`SELECT embedding FROM semantic_memory LIMIT 1`);
    expect(rows.rows.length).toBe(1);
    await pool.end();
  });
});
```

Expected red: query fails, `relation "semantic_memory" does not exist`.

**Gemini delegation prompt:**

```
Implement harness/src/storage/migrations/002_memory_tiers.sql in the
Forecasting_Agent repo. Task 3 of 5 — read
docs/superpowers/specs/2026-08-14-postgres-storage-langfuse-tracing-design.md's
discrepancy-resolution items 1 and 2 first.

The failing test appended to harness/tests/storage.test.ts (the
"semantic_memory (pgvector)" describe block) is the acceptance criterion.

Real Postgres 18 + pgvector 0.8.6 are already installed and running at
localhost:5432 (confirmed during spec review) — connect to it directly.

Build 002_memory_tiers.sql:
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE semantic_memory (
    id uuid PRIMARY KEY,
    embedding vector(3),
    content jsonb,
    created_at timestamptz NOT NULL,
    as_of timestamptz NOT NULL
  );
  CREATE INDEX ON semantic_memory USING ivfflat (embedding vector_cosine_ops);

Use vector(3) to match the test — the real embedding dimension (e.g. 1536 for
a specific embedding model) is a later story's decision once an embedding
provider is chosen; this table's job is proving the pgvector mechanism works,
not committing to a production dimension.

Do NOT create a session_memory table (constraint 1 — that tier belongs to
Redis, not this migration).

Boundaries: only this one .sql file. Do not touch 001_initial.sql,
migrator.ts, types.ts, config.ts, pool.ts, or repository.ts. Do not modify
the test file.

Run `cd harness && pnpm vitest run tests/storage.test.ts` and confirm ALL
tests in the file pass (everything from Tasks 1-2 plus this one). Report the
actual output.
```

**Validator brief:** run the full `storage.test.ts` file myself. Read the migration file directly — confirm no `session_memory` table exists anywhere in it (constraint 1), confirm the index is genuinely `ivfflat`/`hnsw` on a `vector` column, not a JSONB/GIN substitute.

---

## Task 4: `correlation.ts` + `langfuse.ts`

**Seam note.** `correlation.ts` is one function — deliberately not more. `langfuse.ts` wraps the SDK's own trace/span object model rather than reinventing nesting logic, since the real SDK was confirmed during spec review to already support 4 levels of `.span()` nesting.

**Files:** `harness/src/tracing/correlation.ts`, `harness/src/tracing/langfuse.ts`; `harness/tests/tracing.test.ts`.

**Failing test to write and confirm red before dispatch:**

```typescript
// harness/tests/tracing.test.ts
import { describe, it, expect } from 'vitest';
import { generateTraceId } from '../src/tracing/correlation.js';
import { getLangfuseClient, startForecastTrace } from '../src/tracing/langfuse.js';
import type { HarnessConfig } from '../src/config.js';

describe('correlation', () => {
  it('generateTraceId produces monotonically increasing UUIDv7 ids', () => {
    const ids = Array.from({ length: 5 }, () => generateTraceId());
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('langfuse tracing', () => {
  const config: HarnessConfig = {
    llm: { provider: 'deepseek', model: 'deepseek-v4-flash', api_key: 'test' },
    mcp_servers: {},
    capabilities: { chat: 'deepseek', search: 'x', sentiment: 'x', market_data: 'x' },
    sandbox: {},
    eval: {},
    storage: { connection_string: 'postgres://localhost/harness_test' },
    tracing: { langfuse_public_key: 'pk-test', langfuse_secret_key: 'sk-test', langfuse_base_url: 'http://localhost:1' },
  };

  it('client initializes from HarnessConfig-supplied keys', () => {
    const client = getLangfuseClient(config);
    expect(client).toBeDefined();
  });

  it('supports a 4-level forecast_run -> debate_round -> agent_turn -> tool_call span chain', () => {
    const client = getLangfuseClient(config);
    const trace = startForecastTrace(client, generateTraceId());
    const round = trace.span({ name: 'debate_round' });
    const agentTurn = round.span({ name: 'agent_turn' });
    const toolCall = agentTurn.span({ name: 'tool_call' });
    expect(typeof toolCall.end).toBe('function');
  });
});
```

Expected red: `Cannot find module '../src/tracing/correlation.js'`.

**Gemini delegation prompt:**

```
Implement harness/src/tracing/correlation.ts and harness/src/tracing/langfuse.ts
in the Forecasting_Agent repo. Task 4 of 5 — read
docs/superpowers/specs/2026-08-14-postgres-storage-langfuse-tracing-design.md's
"Data Flow" (tracing half) section first.

The failing tests at harness/tests/tracing.test.ts are the acceptance criterion.

Build:

1. correlation.ts:
     export function generateTraceId(): string
   Uses the `uuid` package's v7() export (already a dependency from Task 1's
   config — if not present in package.json, add "uuid": "^14.0.1"). Do NOT
   add a separate uuidv7 package.

2. langfuse.ts:
     export function getLangfuseClient(config: HarnessConfig): Langfuse
   Constructs `new Langfuse({ publicKey: config.tracing.langfuse_public_key,
   secretKey: config.tracing.langfuse_secret_key,
   baseUrl: config.tracing.langfuse_base_url })` from the "langfuse" package
   (add "langfuse": "^3.38.20" to package.json if not present).
     export function startForecastTrace(client: Langfuse, traceId: string)
   Returns `client.trace({ name: 'forecast_run', id: traceId })`. Do not add
   any custom span-nesting logic — the SDK's own trace.span()/span.span()
   already supports arbitrary nesting depth, confirmed during spec review.

Boundaries: only these two files. Do not touch config.ts, any storage/* file,
or the test file.

Run `cd harness && pnpm vitest run tests/tracing.test.ts` and confirm all
tests pass. Report the actual output.
```

**Validator brief:** run `tracing.test.ts` myself. Read `langfuse.ts` — confirm it's a thin wrapper (constructor + one trace-start function), not reimplemented span-nesting logic that duplicates what the SDK already provides (ponytail check).

---

## Task 5: `storage-integration.test.ts`

**Seam note.** The one place that proves Tasks 1-4 actually compose — migrate, write via repository, read via `queryMemory`'s `as_of` guard, all against the same real database, in the same test run.

**Files:** `harness/tests/storage-integration.test.ts`. **Must start only after Tasks 2, 3, 4 are all landed.**

**Failing test to write and confirm red before dispatch:**

```typescript
// harness/tests/storage-integration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '../src/storage/migrator.js';
import { saveForecast, queryMemory } from '../src/storage/repository.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/harness_test';

describe('full storage integration', () => {
  it('write -> read -> as_of filter cycle end to end', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    await saveForecast(pool, {
      symbol: 'TCS', horizon: '5d', prediction: { direction: 'up' }, confidence: 0.7,
      asOf: new Date('2024-05-01'),
    });
    await saveForecast(pool, {
      symbol: 'TCS', horizon: '5d', prediction: { direction: 'down' }, confidence: 0.6,
      asOf: new Date('2024-08-01'),
    });
    const asOfJune = await queryMemory(pool, new Date('2024-06-01'));
    const tcsResults = asOfJune.filter((r) => 'symbol' in r && r.symbol === 'TCS');
    expect(tcsResults.length).toBe(1);
    await pool.end();
  });
});
```

Expected red before Task 5's own code exists: nothing to fail on module resolution since this test only imports already-built modules — expected red is a logic failure (wrong count) if repository/migrator have any integration bug, or it passes immediately if Tasks 1-4 are genuinely correct. This task's "test" is really the integration proof itself; there's no new production code to write.

**Gemini delegation prompt:**

```
Create harness/tests/storage-integration.test.ts in the Forecasting_Agent
repo, exactly as specified in the "Task 5" section of
docs/superpowers/plans/2026-08-14-postgres-storage-langfuse-tracing.md — copy
the test verbatim, do not modify its logic.

This task does not add new production code — it only proves Tasks 1-4
compose correctly against the real local Postgres at localhost:5432.

Run `cd harness && pnpm vitest run` (the FULL harness test suite, not just
this file) and confirm every test across storage.test.ts, tracing.test.ts,
and this new file passes. Report the actual output. If anything fails,
report exactly which test and the failure message — do not attempt to fix
storage.ts/repository.ts/etc. yourself, report back instead.
```

**Validator brief:** run `cd harness && pnpm vitest run` myself — the entire suite, not just this file. This is the final gate before the story is considered complete.

## Toolchain Integration

`#4` already wired `pnpm test`/`pnpm typecheck`/`pnpm lint` into `harness/`'s CI job and `make check`. No new toolchain wiring needed this story — verify (not build) that `make check` still passes end to end once all 5 tasks land, since `#4`'s CI job doesn't know about a live Postgres/Redis dependency; if CI runs without them, this story's tests would need a CI-side Postgres+pgvector service, which is a real gap to flag if it surfaces, not silently ignored.

## Out of Scope (unchanged from spec)

Redis usage by this story's code · self-hosted Langfuse infrastructure provisioning · pgvector similarity-search retrieval logic beyond the schema · Python-side `structlog` tracing · workspace-artifact `as_of` discipline.

---
type: adr
date: 2026-08-14
status: decided
parent: "[[Forecasting Agent]]"
---

# Postgres Storage, Temporal `as_of` Guards & Langfuse Tracing — Design Spec

**Story:** GitHub #8 — Story 5: Postgres Storage, Temporal `as_of` Guards & Langfuse Tracing
**Implements:** ADR-020 (memory & storage — Postgres + pgvector + Redis), ADR-026 (distributed tracing)
**Milestone:** MVP 1 — Indian Equities & Derivatives
**Depends on:** #4 (merged) — the capability layer's config registry supplies the DB connection string

## Scope

This story builds `harness/src/storage/` (Postgres persistence: forward-only migrations, a `pg` connection pool, an `as_of`-guarded repository) and `harness/src/tracing/` (Langfuse client + UUIDv7 correlation IDs, `forecast_run → debate_round → agent_turn → tool_call` span hierarchy). Both are TypeScript, both live in `harness/`, extending the same package #4 built.

## Resolving discrepancies between issue #8's text and the accepted ADRs

1. **`session_memory` does not belong in Postgres.** Issue subtask `002_memory_tiers.sql` names both `session_memory` and `semantic_memory` tables. ADR-020 explicitly assigns the **Session tier to Redis**, not Postgres — "Redis holds things that are supposed to expire," and a TTL semantics in Postgres means a cron job or a manual sweep where Redis gives it for free. Building `002_memory_tiers.sql` for the **semantic tier only** (`semantic_memory`, pgvector-backed). No `session_memory` table, no Redis client — Redis is genuinely out of scope for this story (see decision 8).
2. **`semantic_memory` needs the `pgvector` extension, not a plain JSONB column.** ADR-020's semantic tier is explicitly pgvector-backed ("embeddings for 'have we seen this before'"). The issue's schema notes only mention a "GIN index on JSONB columns" — that's for the debate/signal tables' JSONB payloads, not embeddings. `002_memory_tiers.sql` must `CREATE EXTENSION IF NOT EXISTS vector` and use a `vector` column with an `ivfflat` or `hnsw` index, not JSONB.
3. **UUIDv7 generation — verified library choice.** The dedicated `uuidv7` npm package exists, but the mainstream `uuid` package (v14+) already exports a `v7()` function — checked directly: produces a valid version-7 UUID, and 5 consecutively generated IDs are genuinely monotonic (`sorted === original`). Using `uuid`'s `v7()`, not a second dependency for the same job.
4. **Langfuse SDK — verified trace/span shape.** `harness/package.json` already depends on nothing Langfuse-related. Checked the real SDK: `new Langfuse({ publicKey, secretKey, baseUrl })` → `.trace({ name, id })` → `.span({ name })`, and span objects themselves expose `.span()` — confirmed 4 levels of nesting work (`trace → span → span → span`), which is exactly ADR-026's `forecast_run → debate_round → agent_turn → tool_call` hierarchy. No custom nesting logic needed; the SDK's own object model provides it.
5. **ADR-014's checkpoints belong in this story's schema, even though the issue doesn't name them.** ADR-014 explicitly says "checkpoints go in Postgres, not Redis" — four writes per run, no performance concern, and a checkpoint that evaporates on a Redis restart defeats its purpose. `001_initial.sql` includes a `debate_checkpoints` table (round number, serialized debate state, `forecast_run_id` FK) even though the issue's file list didn't call it out — omitting it means ADR-014's decision has nowhere to land when M7 is built.
6. **Langfuse's own backend does not make `debate_traces` redundant — a question worth answering explicitly, not assuming.** Langfuse has its own schema (cloud or self-hosted) for its dashboard/cost UI. Checked the `langfuse` npm package's exports directly: it's write-only from our side (`Langfuse` ingestion client, `LangfuseWeb`, `observeOpenAI` — no query/read-back API ships in this package). Two separate reasons this story still needs its own table even setting that aside: (a) our own `debate_traces`/`debate_checkpoints` are the source of truth for deterministic replay per ADR-026, which cannot depend on a third-party service's uptime or retention; (b) Langfuse's trace data shape is LLM-call observability (inputs/outputs/cost/latency) — it doesn't capture the full serialized debate state (round number, complete debate state) a checkpoint needs to actually *resume* a run, which is domain-specific to this system, not something a generic observability tool tracks. The two systems write the same events for different purposes; neither substitutes for the other.
7. **Self-hosted Langfuse's own infrastructure is NOT part of this story's scope — verified, not assumed.** Checked Langfuse's self-hosting requirements directly: a self-hosted deployment needs its own **Postgres** (transactional data), **ClickHouse** (mandatory — "high-performance OLAP database which stores traces, observations, and scores"), **Redis/Valkey** (queue/cache), and **S3-compatible blob storage**. None of that is this story's job. This story's `harness/src/tracing/langfuse.ts` is a *client* — it only needs `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL`, supplied via `HarnessConfig` (see decision 9), pointing at wherever Langfuse is actually running (self-hosted stack or cloud). Two things worth stating explicitly so they're never conflated later: **Langfuse's own Postgres is a separate database from this story's `001_initial.sql`/`002_memory_tiers.sql`** — we don't touch Langfuse's internal schema, it manages its own migrations. And **Langfuse's own Redis is a separate deployment from ADR-020's session-tier Redis** (decision 8, below) — two different Redis instances serving two different systems, not one shared instance. Provisioning the self-hosted Langfuse stack (Postgres+ClickHouse+Redis+S3) is an infrastructure/ops task, not tracked by this story or any current MVP1 issue — flagged on the Kanban.
8. **Redis is explicitly out of scope for this story.** The issue's "Files to Create" has zero Redis-related files (no `redis.ts`, no `ioredis`/`redis` dependency), and ADR-020's Redis responsibilities (ADR-017's quota counter, run-scoped search cache, pub/sub debate streaming, distributed locking) belong to the modules that actually need them — Story 3's search quota metering, Story 8's live debate protocol. Building Postgres + pgvector only. Redis lands with whichever story first needs one of those four jobs.
9. **DB connection string and Langfuse keys are NOT a capability-registry entry — checked the real merged file, not assumed.** Read `harness/src/config.ts` directly: `CapabilitiesSchema` requires exactly four keys (`chat`, `search`, `sentiment`, `market_data`), no more — adding a `db`/`storage` capability there would mean this story silently expanding #4's already-merged, closed contract, which ADR-015 reserves for swappable *external service providers* (search, market data, sentiment, LLM), not raw infrastructure config like a connection string. Instead: add a `storage: z.object({ connection_string: z.string().min(1) })` and `tracing: z.object({ langfuse_public_key: z.string().min(1), langfuse_secret_key: z.string().min(1), langfuse_base_url: z.string().min(1) })` section to `HarnessConfigSchema`, the same way `sandbox`/`eval` were added as sections owned by their respective future stories. Values resolve through the existing `config-loader.ts`'s `${VAR}` interpolation (#4's already-built, already-tested mechanism) — no new loading logic, one incremental schema addition to a file this story legitimately needs to extend (unlike the capability registry, which it does not).

## Structure

```
harness/src/storage/
  migrations/
    001_initial.sql       forecasts, debate_traces, evaluation_results, agent_signals, debate_checkpoints
    002_memory_tiers.sql   semantic_memory (pgvector) — NOT session_memory, see decision 1
  migrator.ts               forward-only runner: applies un-applied .sql files in filename order, records applied migrations in a schema_migrations table
  types.ts                  Forecast, DebateTrace, EvalResult, AgentSignal, DebateCheckpoint, SemanticMemoryEntry
  pool.ts                   pg.Pool, max: 10, connection string sourced via config-loader.ts (see decision 9)
  repository.ts             CRUD + as_of-guarded reads
harness/src/tracing/
  langfuse.ts                Langfuse client init, reads keys from HarnessConfig's tracing section (see decision 9)
  correlation.ts              uuid v7() wrapper — one function, generateTraceId()
harness/tests/
  storage.test.ts
  tracing.test.ts
```

## Data Flow

```
harness code (repository.saveForecast(), .saveDebateTrace(), etc.)
  → pool.ts: pg.Pool (max 10), one shared pool per process
  → repository.ts: parameterized INSERT/SELECT, every table has created_at + as_of
  → as_of guard: every SELECT used for backtest/memory retrieval appends `WHERE as_of <= $backtest_date`
       (writes always stamp as_of = now(); the guard is a read-time filter, not a write-time restriction)

tracing:
  correlation.ts: generateTraceId() → uuid v7()
  langfuse.ts: trace = client.trace({name: 'forecast_run', id: traceId})
               round = trace.span({name: 'debate_round'})
               agentTurn = round.span({name: 'agent_turn'})
               toolCall = agentTurn.span({name: 'tool_call'})
               each span.end() closes it; cost/token fields attached via span.update()
```

## `as_of` Guard — the one thing this story cannot get wrong

ADR-020 makes memory leakage the **fifth item on ADR-011's validity gate** — a single unstamped row silently reopens a backtest leak that "looks excellent and is worthless" (ADR-020's own words). Concretely:

- Every table with backtest-relevant rows (`forecasts`, `agent_signals`, `semantic_memory`) has a NOT NULL `as_of TIMESTAMPTZ` column, stamped at write time, never nullable, never defaulted to `now()` implicitly at the DB level (the application sets it explicitly, so a caller cannot forget it silently).
- `repository.ts`'s `queryMemory(asOf: Date)` is the **only** read path for memory retrieval, and it hard-codes the `WHERE as_of <= $1` clause — there is no alternate query method that skips the guard.
- `debate_traces`/`debate_checkpoints` are operational records, not memory — they use `created_at` for ordering but are not subject to the `as_of` guard, since replaying a debate's own history isn't a leakage vector the way retrieving *future* memories into a *past* backtest is.

## Connection Management

`pg.Pool({ max: 10 })`, one pool per process, connection string sourced from `HarnessConfig`'s `storage.connection_string` field (decision 9) via `config-loader.ts`'s existing `${VAR}` interpolation, rather than a raw `process.env.DATABASE_URL` read inside `pool.ts` — still matches #4's "config, not code, is where infrastructure values live" pattern, just through `HarnessConfig` rather than the capability registry, which ADR-015 reserves for swappable external service providers, not connection strings (decision 9 explains why the registry itself was the wrong seam here). Swapping the connection string source (e.g., a secrets manager later) stays a config change, not a code change.

## Tooling

Registry-verified 2026-08-14: `pg@8.23.0`, `uuid@14.0.1` (its `v7()` export, confirmed monotonic — no separate `uuidv7` package needed), `langfuse@3.38.20` (`Langfuse`/`LangfuseWeb`/`observeOpenAI` exports, confirmed 4-level trace/span nesting). All new to `harness/`; none conflict with #4's or #5's dependencies (#4 is the same package, #5 is a separate Python package). No mocking library needed — real Postgres 18 + pgvector + Redis are installed locally (see Testing, below); `pg-mem` was considered and dropped once real infra became available (ponytail: prefer the real thing over a mock when the real thing is actually there).

## Testing — real infra, installed and verified this session

**Postgres and Docker did not exist in this environment when this spec was first drafted** — checked directly (`psql`/`pg_ctl`/`postgres`/`docker` all absent, port 5432 closed). Rather than fall back to a mock, installed real infrastructure via Linuxbrew (no `sudo` available; Homebrew installs to a user-owned prefix, so this needed no root access):

- **Postgres 18.4** (`brew install postgresql@18`) — the `en_US.UTF-8` locale `initdb` defaults to isn't present on this machine; reinitialized with `--locale=C.UTF-8`, confirmed available via `locale -a`. Running on `localhost:5432`.
- **`pgvector` 0.8.6** (`brew install pgvector`) — **verified for real, not assumed**: `CREATE EXTENSION vector`, `CREATE TABLE ... embedding vector(3)`, `CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops)`, then an actual insert and a `SELECT` that returned the correct vector. This closes what would otherwise have been a real, unverified gap in `002_memory_tiers.sql`.
- **Redis 8.10.0** (`brew install redis`) — brew's default `redis.conf` tries to load four bundled modules (`redisbloom`, `redisearch`, `rejson`, `redistimeseries`) that aren't actually present in this install and aborts on the first missing one; started with a minimal config bypassing that, confirmed with `PING` → `PONG`. (This story doesn't use Redis — decision 8 — but it's now available for whichever story needs it next, so that story doesn't hit the same locale/module snags cold.)

Both test files now run against **real Postgres**, not a mock — `002_memory_tiers.sql`'s `semantic_memory`/pgvector table is genuinely tested, not just syntax-checked:

- `storage.test.ts` — migration runner applies files in order and records them (re-running is a no-op, not a re-apply) against a real Postgres test database; `as_of` guard excludes a future-stamped row from a past-dated query; repository CRUD round-trips through the real `pg.Pool`; `semantic_memory`'s `ivfflat` index and vector insert/query genuinely work; `uuid`'s `v7()` produces monotonically increasing IDs (assert `sorted === generated`, already verified manually during spec review).
- `tracing.test.ts` — Langfuse client initializes from `HarnessConfig`-supplied keys (decision 9); a `forecast_run` trace can nest a `debate_round` → `agent_turn` → `tool_call` span chain four levels deep (verified this actually works in the real SDK during spec review, not assumed).
- Integration test — full write → read → `as_of` filter cycle against the real Postgres instance, covering every table including `semantic_memory`.

Each test run creates and drops its own database (or uses a transaction-rollback pattern) against the local instance — no shared state between test runs, no dependency on a specific pre-seeded database existing.

## Out of Scope

Redis *usage* by this story's own code (session tier, ADR-017's quota counter, pub/sub debate streaming, distributed locking — lands with whichever story first needs one; Redis itself is now installed and running locally, see Testing) · self-hosted Langfuse's own infrastructure — Postgres/ClickHouse/Redis/S3 provisioning (decision 7; this story is a Langfuse *client* only) · pgvector similarity-search query implementation beyond the schema/extension setup (the *table* and index exist and are tested this story; the *retrieval* logic that ADR-020's semantic tier implies is a later story's concern) · Python-side `structlog` tracing (ADR-026 names both TS and Python sides; this story is harness-only, matching the issue's TypeScript-only file list) · workspace-artifact `as_of` discipline (ADR-020's noted interaction with ADR-021 — skills/models on disk, not database rows; a sandbox-story concern).

## Review Log

Authored and reviewed inline (Claude, this session — no subagent dispatch, no Codex delegation, per the Token-efficiency CLAUDE.md rule). `reviewing-specs`' verify→ponytail→grill loop, run directly.

**R1 — `REJECTED`, several blockers found by execution, not reading:**
- Issue's `002_memory_tiers.sql` put `session_memory` in Postgres, directly contradicting ADR-020's explicit Session-tier-is-Redis decision. Dropped `session_memory`, kept `semantic_memory` only.
- Issue's schema notes implied JSONB for `semantic_memory`; ADR-020 requires pgvector. Checked: this environment had **no Postgres and no Docker at all**. Rather than mock it, installed real Postgres 18 + pgvector + Redis via Linuxbrew (no `sudo` available; user-owned prefix needed none) — hit and fixed two real installation snags along the way (`en_US.UTF-8` locale missing, reinitialized `C.UTF-8`; Redis's default config tries to load 4 absent bundled modules and aborts, started with a minimal config instead). Verified `pgvector` for real: `CREATE EXTENSION`, an `ivfflat` index, an actual insert and correct query result.
- `uuid`'s `v7()` vs. a dedicated `uuidv7` package: verified the mainstream `uuid@14` package already exports `v7()` and produces genuinely monotonic IDs — one dependency instead of two.
- Langfuse SDK's actual trace/span API and nesting depth were unverified assumptions; installed and checked directly, including whether Langfuse's own backend makes `debate_traces` redundant (checked the package exports — write-only, no read-back API in this package) and what self-hosting Langfuse actually requires (mandatory ClickHouse, not just Postgres+Redis — a real infra scope finding, flagged on the Kanban, not silently absorbed into this story).
- ADR-014's `debate_checkpoints` requirement wasn't in the issue's file list at all; added it — omitting it means ADR-014's Postgres-not-Redis checkpoint decision has nowhere to land later.

**R2 — `CHANGES REQUESTED`, defect in R1's own fix:** decision 9 correctly rejected routing the DB connection string and Langfuse keys through the ADR-015 capability registry — checked `harness/src/config.ts` directly and found `CapabilitiesSchema` requires exactly four keys, and the registry is reserved for swappable external service *providers*, not raw connection strings. But two other sections (Structure's `pool.ts`/`langfuse.ts` lines, and "Connection Management") still said "capability registry," left over from before that decision was made. Fixed both to match decision 9.

**R3 — `APPROVED`.** Fresh full read: every remaining cross-reference (decision numbers, "see decision N" pointers) resolved correctly; Structure/Data-Flow/Testing/Out-of-Scope sections mutually consistent; Tooling section's dropped-`pg-mem` note matches Testing's real-infra description. No blockers, no highs, no open decisions.

**R4 — `APPROVED`.** Second consecutive clean round, re-checking R3's re-check plus the Review Log's own internal consistency. No new findings. Two consecutive `APPROVED` verdicts reached — spec is ready for `writing-plans`.

---
type: adr
date: 2026-08-16
status: decided
parent: "[[Forecasting Agent]]"
---

# Point-in-Time Observation Archive — Design Spec

**Story:** GitHub #19 — Point-in-Time Observation Archive (raw, append-only ingestion)
**Implements:** ADR-031 (new, this spec — storage substrate decision below). Checked all existing ADR references (ADR-001 through ADR-030) before numbering; ADR-030 is already reserved (cited in `harness/src/tracing/langfuse.ts` as "ADR-030 v2", not yet written up per the 2026-08-15 daily note) so this spec claims ADR-031, not ADR-030.
**Milestone:** MVP 1 — Indian Equities & Derivatives
**Depends on:** #8 (Postgres, merged) for the index table
**Blocks:** #20 (Indian Moat Connectors — parses what this archives)

## Scope

This story builds `src/forecasting_agent/archive/`: a raw, append-only, byte-level archive of NSE participant-wise F&O open interest and bhavcopy, plus the hooks that snapshot as-observed OHLCV and (later) news/search payloads. It downloads and stamps bytes. It does not parse, normalize, or interpret — that is #20's job, which consumes this archive as its input rather than hitting live NSE.

## Decisions (resolving what the issue leaves open)

1. **Storage substrate: filesystem + Postgres index, not bytes-in-Postgres.** The issue's own subtask frames this as an open decision requiring an ADR. Decided filesystem-for-bytes + Postgres-for-index (ADR-031):
   - **Pros:** Keeps Postgres schema consistent with every existing table (`forecasts`, `agent_signals`, `semantic_memory`, etc. — all JSONB/scalar metadata, zero blob columns) rather than introducing the first `bytea` column in the whole schema. Raw files stay directly inspectable/greppable on disk without a DB round-trip — useful for the "verify what NSE actually served" debugging #20's connectors will need. Matches the existing `ParquetCache` precedent of filesystem-backed data with metadata tracked separately, so this isn't a new pattern for the codebase, just a new instance of an established one.
   - **Cons:** No transactional atomicity between the file write and the index-row insert — a crash between the two can leave an orphaned file (harmless, ignored on next read) or, worse, an index row pointing at a file that never landed (must write file first, index second, so a crash mid-way fails safe as "never happened" rather than "index lies"). Two systems (filesystem + DB) to keep backed up/replicated in sync instead of one.
   - **Where it fits:** Single-user local dev system (same reasoning the 2026-08-15 session applied to rejecting direct S3 access from the sandbox) with modest daily file sizes (verified below: ~1.3MB/day combined) — filesystem is simple, free, and already the pattern this repo uses for OHLCV caching.
   - **Where it doesn't:** Would not fit a multi-writer distributed deployment (concurrent writers to the same path need coordination filesystem doesn't give for free) or a scale where individual files are large enough that filesystem I/O outperforms streaming from Postgres large objects — neither applies here.

2. **Python needs its own Postgres client — none exists today.** Checked directly: `pyproject.toml` has no `psycopg`/`asyncpg`, and no Python file anywhere in `src/` touches Postgres. All existing Postgres access is TS-only, through `harness/src/storage/` (`pool.ts`/`repository.ts`/`migrator.ts`). The issue's own file list puts `003_observation_archive.sql` inside `harness/src/storage/migrations/` (the TS-owned migrations directory) but `store.py` in Python — so this story is the first cross-language Postgres consumer. Adding `psycopg[binary]>=3.2` as a new main dependency (not `asyncpg`): the archive job is a one-shot daily batch script, not an async server, so a synchronous driver is the simpler, more idiomatic fit — no event loop to justify async I/O for a job that runs once and exits. `store.py` opens one short-lived connection per invocation (no connection pool) for the same reason — nothing else in this story calls it concurrently; if #20's connectors later need concurrent reads from inside the MCP server process, pooling becomes their concern to add, the same way `cache.py`'s interface was written to accept a Redis layer later without changing callers (2026-08-14 precedent).
   - **Migration ownership stays with the TS migrator, not duplicated in Python.** `003_observation_archive.sql` lives in `harness/src/storage/migrations/` specifically so `migrator.ts`'s existing `runMigrations()` picks it up automatically, in filename order, tracked in the same `schema_migrations` table as every other migration — no second migration-running mechanism gets built in Python. **Real constraint this creates, stated explicitly rather than left implicit:** `store.py` has a runtime dependency on the harness's migrator having been run at least once against the target database before the archive job's first execution. This is a cross-language coupling worth knowing about, not a flaw — it avoids the worse alternative of two independent, potentially-drifting schema-migration systems for one database.
   - **Connection string: reuse `STORAGE_CONNECTION_STRING`, don't invent a second env var.** Both the TS harness and this Python module point at the exact same Postgres instance/database (`docker-compose.yml`'s `harness` DB) — one source of truth for the connection string, read via `os.environ["STORAGE_CONNECTION_STRING"]` directly (this is the first Python module in the repo reading env vars at all; no config-loading library needed for one string).

3. **Idempotency vs. restatement — the two ACs are in tension on a literal reading, resolved with a two-index schema.** AC says both "identical re-download is *recorded*, not re-stored" (a subtask) and "same-date re-run produces no duplicate row" (a test AC). These conflict if "recorded" means "new row" — resolved by distinguishing *identical* re-downloads (true no-op, dedupe at the DB level) from *restated* re-downloads (NSE serves different bytes for a date already archived — the same "detectable after the fact" scenario the issue names for yfinance's adjusted-price restatement, generalized to any source). Two partial unique indexes on `observation_archive`:
   ```sql
   CREATE UNIQUE INDEX idx_obs_archive_ok  ON observation_archive (source, observed_on, sha256) WHERE status = 'ok';
   CREATE UNIQUE INDEX idx_obs_archive_gap ON observation_archive (source, observed_on)          WHERE status = 'gap';
   ```
   `ObservationStore.write()` does `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — **the conflict target is deliberately omitted (bare `ON CONFLICT`), not one of the two partial index column lists.** Postgres requires an explicit `WHERE` predicate on a conflict target to match a *partial* index, and a `write()` call doesn't know in advance which of the two partial indexes (`ok` vs `gap`) the row it's inserting will land under — a status-branched target was considered and rejected as needless complexity when the bare form already does the right thing: a targetless `ON CONFLICT DO NOTHING` resolves against *any* unique index (partial or not) whose predicate the new row satisfies, so a conflict on either `idx_obs_archive_ok` or `idx_obs_archive_gap` is caught by the same statement. **Verified empirically against a real Postgres instance** (`docker compose exec postgres psql`, this repo's actual `pgvector/pgvector:pg17` container, not the docs read in isolation): created the two partial indexes exactly as specified, ran five inserts in sequence — a first `gap` row (inserts), a duplicate `gap` row for the same `(source, observed_on)` (`INSERT 0 0`, confirmed no-op, no exception), a first `ok` row with `sha256='abc'` (inserts), a duplicate `ok` row with the same `sha256` (`INSERT 0 0`, no-op), and a restated `ok` row for the same date with `sha256='def'` (inserts as a genuine second row) — final table held exactly the 3 expected rows (1 `gap`, 2 `ok`), matching this decision's intent row-for-row. Same date + identical bytes → the `ok` index catches it, no new row, no rewritten file (satisfies the idempotency test AC literally). Same date + different bytes (a genuine restatement) → different `sha256`, no conflict, a **second** `ok` row is appended — the store stays append-only (no row is ever updated or deleted) while still recording that NSE changed its story. A prior `gap` row never blocks a later successful `ok` row for the same date (self-healing on retry) because they're different partial indexes; repeated failed attempts on a truly absent date (weekend/holiday) don't spam duplicate `gap` rows because the `gap` index is unique on `(source, observed_on)` alone.
   - **Read semantics, stated explicitly since multiple `ok` rows are now possible per date:** `ObservationStore.read(source, observed_on)` returns the bytes from the **most recent** `ok` row by `retrieved_at` (the current best-known answer). `ObservationStore.read_history(source, observed_on)` returns every row (append-only full history) for a caller — #20's connectors, or a future backtest auditor — that needs to reason about restatement explicitly, mirroring how OHLCV's `data_stale`/restatement detection works one layer up.

4. **Bhavcopy has two live URL formats with a format cutover — verified live, not assumed.** Curled NSE's actual archive endpoints directly rather than trusting any single blog/package's claim (three disagreed on details):
   - Current format (UDiFF, per NSE Circular 62424): `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip` and the equivalent `.../content/fo/BhavCopy_NSE_FO_0_0_0_{YYYYMMDD}_F_0000.csv.zip` for F&O. Verified `HTTP 200` for 2026-08-13 and 2026-08-14 (real recent trading days), and — a genuine surprise the "discontinued July 2024" framing didn't predict — **also 200 for 2024-07-05**, i.e., NSE serves this format retroactively into the pre-"cutover" window too, not just forward from it. Verified **404 for 2015-01-02** on this path — UDiFF genuinely does not exist that far back.
   - Legacy format: `https://nsearchives.nseindia.com/content/historical/EQUITIES/{YYYY}/{MMM}/cm{DD}{MMM}{YYYY}bhav.csv.zip`. Verified `HTTP 200` back to **1997-07-01** (near NSE's founding) and still 200 at 2024-07-05 and 2015-01-02 — this path is the one with real depth for backfill.
   - **Decision:** the downloader tries the UDiFF URL first, falls back to the legacy URL on 404, rather than hardcoding a cutover date. Self-adapting if NSE shifts the boundary again (already observed once), costs one extra request only on historical backfill dates — zero extra cost on live daily runs, where UDiFF always hits first. Two different CSV schemas (UDiFF: `TradDt,BizDt,Sgmt,...`; legacy: `SYMBOL,SERIES,OPEN,...`) — irrelevant to this story since bytes are archived raw and unparsed either way; #20's connectors are the ones that will need to branch on schema.
   - **Non-trading days are cleanly distinguishable, verified live:** requesting a Saturday date (2026-08-15) returns `HTTP 404` with an HTML error body — same signature as a genuinely absent/discontinued URL, not a network-level failure (timeout, connection reset, 5xx). The downloader treats 404 as "confirmed absent, record a gap immediately" and reserves retry-with-backoff for actual transport failures (timeout, connection error, 5xx) — retrying a 404 for a real weekend would just waste time and delay the job.

5. **Participant OI has one stable format across its full history.** Verified live: `https://archives.nseindia.com/content/nsccl/fao_participant_oi_{DDMMYYYY}.csv` returns `HTTP 200` for 2026-08-14, 2019-05-10, and (weekend) `HTTP 404` for 2026-08-15 — same clean absent-vs-failure distinction as bhavcopy, no format branching needed for this downloader.

6. **No cookie/session handshake required for either archive endpoint — verified, contradicts the commonly-cited "NSE blocks scrapers" caution.** That caution is real for `www.nseindia.com`'s live API (which does enforce a homepage-first cookie dance), but both `archives.nseindia.com` and `nsearchives.nseindia.com` are static file-serving subdomains — every curl above succeeded with only a browser-realistic `User-Agent` header, no cookie jar, no referer. Flagging explicitly so the Gemini delegation prompt doesn't build unneeded session-handshake machinery.

7. **Scheduling: OS-level cron/systemd timer, not an in-process Python scheduler.** No scheduling library exists in this repo today (no APScheduler, no cron infra). For one daily unattended job on a single-user local dev machine:
   - **Pros of OS-level scheduling:** survives process/interpreter crashes (nothing to keep running), zero new dependency, standard ops pattern the user already manages other daily jobs through (if any).
   - **Cons:** not observable/controllable from within Python, requires host-level setup documented in a runbook rather than wired through `make`.
   - **Where it fits:** exactly this case — a single daily unattended batch job with no need for in-process dynamic scheduling. **Where it doesn't:** a system needing many independently-scheduled jobs coordinated with retries/backpressure would outgrow this fast — not this story's problem.
   - Ships as `python -m forecasting_agent.archive.run_daily` (a thin CLI entry point), invocable manually or via a cron line documented in the module's own top-of-file comment; no new Makefile target needed since `uv run python -m ...` already covers it.

8. **News/search snapshot hook: build the reusable persist function now, wire the call site later.** Verified directly: no search capability exists anywhere in the repo yet (`grep` for `search` across `src/` and `harness/src/` — nothing). The issue itself permits this ("may land alongside the M3 search story if search is not yet wired"). `ObservationStore.write(source="search", ...)` is generic enough that whichever story builds the search capability calls it directly — no placeholder/stub module built for a caller that doesn't exist yet (YAGNI).

## Storage Layout

```
data/archive/<sanitized-source>/<sha256>.bin   content-addressed raw bytes, one file per unique observation
                                          (flat, no shard-prefix directories — ~22k files total at full
                                          29-year bhavcopy backfill depth, well within ext4/btrfs's flat-dir
                                          comfort zone; sharding would be premature complexity)
harness/src/storage/migrations/
  003_observation_archive.sql            observation_archive index table (applied by the existing TS migrator)
```

`003_observation_archive.sql`:
```sql
CREATE TABLE IF NOT EXISTS observation_archive (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  observed_on date NOT NULL,
  retrieved_at timestamptz NOT NULL,
  uri text,
  sha256 text,
  bytes_len int,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'gap')),
  detail text
);
CREATE UNIQUE INDEX idx_obs_archive_ok  ON observation_archive (source, observed_on, sha256) WHERE status = 'ok';
CREATE UNIQUE INDEX idx_obs_archive_gap ON observation_archive (source, observed_on)          WHERE status = 'gap';
CREATE INDEX idx_obs_archive_lookup ON observation_archive (source, observed_on, retrieved_at DESC);
```
`uri`/`sha256`/`bytes_len` are nullable — a `gap` row has none of them, `detail` carries the failure reason (HTTP status, exception message) so a gap is diagnosable without re-running.

**`source` must be filesystem-sanitized before it is used to build a directory path** — `source` values like `f"ohlcv:{market}:{symbol}"` (decision above) can contain `/` (e.g. a future symbol containing a slash) or other path-unsafe characters, and an unsanitized `source` used directly as `data/archive/<source>/...` would let such a value create an unintended subdirectory or, worse, escape the archive root. `ObservationStore` sanitizes with the same approach `ParquetCache._get_file_path` already uses (`cache.py`: `symbol.replace("/", "_")`) — not a new pattern, an existing one applied to a second call site. The `source` column in the `observation_archive` row stores the *original*, unsanitized value (it's metadata, not a path); only the on-disk directory name is sanitized.

`/data/archive/` added to `.gitignore` (currently only `/data/cache/` is excluded) — raw archive bytes must never be committed.

## Structure

```
src/forecasting_agent/archive/
  __init__.py
  store.py                        ObservationStore: write()/read()/read_history() — the only Postgres+filesystem write path
  downloaders/
    __init__.py
    base.py                       Downloader ABC — fetch_raw(observed_on) -> bytes, imports nothing but stdlib/httpx
    nse_bhavcopy.py                UDiFF-then-legacy-fallback downloader (CM + FO)
    nse_participant_oi.py          single-format downloader
  run_daily.py                     CLI entry point: iterate downloaders, call store.write(), log gaps loudly
tests/archive/
  test_store.py
  test_downloaders.py
  fixtures/                       committed real-response fixtures, one per downloader (Testing section)
```

**Import-linter contract, mirroring the existing `plugins-isolation` discipline.** Per this section's own `base.py` description ("imports nothing but stdlib/httpx") and the Data Flow (only `run_daily.py` calls `store.write()` — downloaders return raw bytes and never call the store themselves), `archive.downloaders` must import stdlib/`httpx` only: never `archive.store` (downloaders don't write, `run_daily.py` does — contradicts the R4-approved draft's prose, which said downloaders may import store's write API; corrected here, downloaders have no reason to touch the store at all), never each other (`nse_bhavcopy` and `nse_participant_oi` are siblings, not collaborators), and never reach into `data_server`. The single `forbidden_modules` entry in the prior draft under-enforced this — it named only `data_server` and silently allowed a downloader to import `archive.store` or its sibling downloader, which the prose never intended.

**Two separate contracts, one per downloader module as source** — not one contract with both downloaders listed in both `source_modules` and `forbidden_modules`, which would check each downloader against itself as an importer (harmless in practice since a module never imports itself, but a needless, confusing cross-product pair rather than a deliberate one):

```
[importlinter:contract:archive-downloader-bhavcopy-isolation]
name = Archive bhavcopy downloader isolation
type = forbidden
source_modules =
    forecasting_agent.archive.downloaders.nse_bhavcopy
forbidden_modules =
    forecasting_agent.archive.store
    forecasting_agent.archive.downloaders.nse_participant_oi
    forecasting_agent.data_server

[importlinter:contract:archive-downloader-participant-oi-isolation]
name = Archive participant OI downloader isolation
type = forbidden
source_modules =
    forecasting_agent.archive.downloaders.nse_participant_oi
forbidden_modules =
    forecasting_agent.archive.store
    forecasting_agent.archive.downloaders.nse_bhavcopy
    forecasting_agent.data_server
```

**Verified empirically, not assumed from reading the syntax** (temporary stub modules created under `src/forecasting_agent/archive/`, deleted immediately after, no trace left in the tree): with clean stub downloaders, `uv run lint-imports` reports all contracts (this pair plus the pre-existing `plugins-isolation`) `KEPT`, 3 kept / 0 broken. Injecting `from forecasting_agent.archive import store` into `nse_bhavcopy.py` flips `Archive bhavcopy downloader isolation` to `BROKEN` with the exact expected violation line (`nse_bhavcopy -> archive.store`); injecting a sibling import instead produces the same `BROKEN` result against the sibling violation. Removing the bad import returns to 3 kept / 0 broken. The two-contract shape does exactly what the prose says, confirmed against the real tool, not inferred.

## Data Flow

```
run_daily.py (cron-invoked, post-close IST)
  → for each downloader: fetch_raw(observed_on=today)
       → HTTP 200: store.write(source, observed_on, content=bytes) → sha256, filesystem write, index insert
       → HTTP 404: store.write(source, observed_on, content=None, detail="404 not found") → gap row, no file
       → transport failure (timeout/5xx/connection error): retry with exponential backoff, 3 attempts
         total (1 initial + 2 retries, base 2s doubling — see Error Handling for the exact schedule),
         then gap row with detail=exception message if still failing
  → loud logging (stdlib logging, ERROR level) on every gap — "silently leave a hole" is the one
    outcome explicitly forbidden by the AC

as-observed OHLCV snapshot (hooked into the existing fetch path, not ParquetCache):
  data_server's fetch_ohlcv (server.py:88-151), gated on freshly_fetched == True only —
  **NOT** on the cache-hit path (freshly_fetched is False and returns pre-existing cached_bars
  unchanged) and **NOT** on the data_stale fallback path (plugin.fetch() failed or returned
  empty, raw_bars falls back to a stale cache). Archiving either of those paths would stamp today's
  observed_on onto bytes this call did not actually observe today — the one outcome that would
  corrupt the point-in-time guarantee this entire story exists to provide. Concretely: the hook is a
  single line added immediately after line 138's existing `if freshly_fetched: cache.put(...)`,
  inside that same conditional, not a new branch of its own.
  → store.write(source=f"ohlcv:{market}:{symbol}", observed_on=today, content=serialized bars, retrieved_at=now)
  (ParquetCache continues serving its existing 3-day-staleness role unchanged — this is an additive,
  parallel write, not a replacement; ParquetCache overwrites by design, the archive never does)
```

## Error Handling

- `SourceUnavailableError` — raised by a downloader when NSE confirms absence (404) after checking it isn't a transient status; caught by `run_daily.py`, becomes a `gap` row, not a crash.
- `ArchiveWriteError` — raised by `store.write()` if the filesystem write succeeds but the index insert fails (or vice versa is prevented by write-file-then-index ordering).
- **`ArchiveWriteError` is handled differently by its two call sites, stated explicitly since the same exception type means two different things to two different callers:** in `run_daily.py`, it surfaces loudly (propagates, batch job exits non-zero) — appropriate because that job's entire purpose is archiving and a swallowed write failure there is silent data loss, the one outcome the AC forbids. In the `fetch_ohlcv` snapshot hook, it is caught and logged at ERROR level, then execution continues and the normal `OHLCVResponse` is still returned to the caller — `fetch_ohlcv` had zero Postgres dependency before this story, and letting an archive-write failure (down DB, unapplied migration, disk full) turn a core market-data read path into a hard failure would make the observability side-effect more critical than the read it's piggybacking on. The archive snapshot is a best-effort side channel from `fetch_ohlcv`'s perspective, not a load-bearing dependency of it.
- Retry only applies to transport-layer failures (timeout, connection error, 5xx), never to a confirmed 404 — retrying a real non-trading day wastes the job's time budget for no possible different outcome.
- **Retry count, pinned unambiguously:** "3 attempts" means 3 attempts *total*, i.e. the initial request plus up to 2 retries — not 3 retries after the initial attempt (4 total). Backoff applies before attempt 2 and attempt 3 only (base 2s, doubling): attempt 1 → wait 2s if failed → attempt 2 → wait 4s if failed → attempt 3 → raise if still failed. `test_downloaders.py`'s assertion is against this exact number: a persistent transport failure must show the mocked transport called exactly 3 times, never 4.

## Disk Growth & Retention

Measured real file sizes, not estimated: CM bhavcopy ~195KB/day, FO bhavcopy ~1.1MB/day, participant OI <1KB/day — **~1.3MB/day combined**, ~330MB/year at full daily cadence. One-time backfill to bhavcopy's earliest available date (1997-07-01, verified) across ~29 years × ~252 trading days ≈ **~9.5GB total** — participant-wise OI's own history is shorter (verified present at least back to 2019; NSE began publishing this report later than bhavcopy) so its backfill contributes negligibly on top. **Retention policy: keep forever, no TTL, no deletion path** — this is the opposite of `ParquetCache`'s staleness model by design; the entire point of this story is that observations, once captured, are never allowed to age out. ~10GB is a non-issue on any dev machine; revisit only if backfill scope ever expands materially beyond NSE bhavcopy + participant OI.

## Tooling

New main dependency: `psycopg[binary]>=3.2` (Python's standard modern Postgres driver; binary wheel avoids requiring `libpq-dev` on the host, matching how `pyarrow`/`yfinance` already ship as binary wheels in this project rather than requiring system libraries). `httpx` promoted from dev-only to a main dependency (already present in `dependency-groups.dev`, needed at runtime now for the downloaders — `yfinance` pulls in `requests` transitively but relying on a transitive dependency for direct HTTP calls this story owns would be fragile if `yfinance` ever changes its own HTTP client). No new dependency for retry/backoff — hand-rolled (3 attempts, exponential backoff, stdlib `time.sleep`), matching the `cleaner.py` precedent of hand-rolling something this simple rather than adding a library for it.

## Testing

- `test_store.py` — append-only: writing twice for the same `(source, observed_on)` with identical bytes yields one row, no rewritten file (mtime unchanged); writing with *different* bytes for the same date yields a second `ok` row, neither overwritten; `read()` returns the most recent `ok` row; `read_history()` returns all of them in `retrieved_at` order; a `gap` row followed by a later successful `ok` row for the same date leaves the `gap` row untouched.
- `test_downloaders.py` — mocked `httpx` responses: 200 returns bytes; 404 raises `SourceUnavailableError` immediately (no retry attempted — verified via mock call count); a transport exception makes exactly 3 total attempts (mock call count == 3, per the Error Handling section's pinned schedule) before raising; bhavcopy's UDiFF-then-legacy fallback is exercised with a 404-then-200 mock sequence.
- Real-fixture requirement (mirrors #20's "parses a real archived file fixture, not a synthetic one" AC): at least one committed fixture file per downloader, at `tests/archive/fixtures/` (named after its source, e.g. `participant_oi_sample.csv`), captured from an actual verified response above (small — participant OI is under 1KB) — a real path, stated explicitly since `.gitignore` excludes `/data/archive/` and these fixtures must NOT live there or they'd be silently excluded from the commit. Used to assert the raw-bytes-preserved contract end-to-end, not just against mocks.

## Out of Scope

Parsing/normalizing archived bytes into typed rows (#20's job) · the actual news/search persistence call site (built when the search capability itself lands) · Redis/caching layer for archive reads (no story needs archive read latency optimized yet) · multi-writer/distributed coordination for the filesystem substrate (single-user local dev system, ADR-031 decision 1's "where it doesn't fit") · retention/deletion tooling (explicitly keep-forever per the Disk Growth section) · `entry_points`-style downloader auto-discovery (this story has exactly two downloaders; the same ADR-006 Phase A/Phase B reasoning `data_server` already applied would call this premature here too).

## Review Log

Authored and reviewed inline (Claude, this session — no subagent dispatch, no Codex delegation, per CLAUDE.md's Token-efficiency mode). `reviewing-specs`' verify→ponytail→grill loop run directly.

**R1 — `CHANGES REQUESTED`.** Initial draft assumed NSE bhavcopy's format cutover date from a single web-search summary ("discontinued July 8, 2024") without checking whether the archive actually enforces that date, and assumed a cookie/session handshake was required for downloads based on the generic "NSE blocks scrapers" caution the issue itself repeats. Ran live curls against both endpoints instead of trusting either assumption (decisions 4–6 above): found the "discontinued" framing was about new-file *generation*, not retroactive *availability* — UDiFF actually serves 2024-07-05 too, and a hardcoded cutover date would have been both wrong and unnecessarily brittle against a future NSE change. Found the cookie caution doesn't apply to the static archive subdomains at all — a plain `User-Agent` header was sufficient every time. Replaced the hardcoded-cutover-date design with try-new-then-fallback, and removed the unbuilt cookie-handshake machinery from the downloader design entirely.

**R2 — `CHANGES REQUESTED`.** Ponytail pass flagged the first draft's index schema: a single `UNIQUE (source, observed_on)` constraint, which cannot represent a legitimate restatement (issue explicitly calls out that OHLCV restatement must be "detectable after the fact," and there's no principled reason participant-wise OI or bhavcopy couldn't be corrected/republished the same way) without either violating append-only (would require an UPDATE) or violating the idempotency test AC (would require allowing unbounded duplicate rows for a genuinely repeated no-op run). Resolved with the two-partial-index design (decision 3) — re-checked against both the idempotency test AC and the append-only AC line by line; both hold simultaneously now, not just plausibly.

**R3 — `APPROVED`.** Grilled the cross-language coupling in decision 2 (Python's `store.py` depending on the TS migrator having run first) — is this actually the simplest sound option, or was a second Python-side migration runner avoided just to save code? Concluded it's the right call, not laziness: two independent migration runners against the same database is a strictly worse failure mode (schema drift between two systems' idea of "what version are we at") than one runner both languages defer to, and the coupling is stated explicitly rather than hidden, which is what actually matters per the reviewing-specs standard. Re-verified the disk-growth arithmetic (195KB + 1.1MB + <1KB ≈ 1.3MB/day, ×252×29 ≈ 9.5GB) by hand against the measured byte counts in decision 4/5's curl output — checks out. No blockers, no open decisions.

**R4 — `APPROVED`.** Second consecutive clean round. Re-read the full spec end-to-end for internal consistency: Storage Layout's file count claim (~22k files) matches Disk Growth's backfill-scope numbers (29 years × 252 days × ~3 files/day ≈ 22k); Structure's import-linter contract matches decision 3's "archive writer is the only write path" AC; Testing section covers every AC from the issue (append-only, idempotency, retrieval-returns-exact-bytes, failure-records-gap) with a named test. No blockers, highs, or open decisions. Two consecutive `APPROVED` verdicts reached — spec is ready for `writing-plans`.

**R5 — `CHANGES REQUESTED`, reopened before implementation on independent review.** Before handing off to `writing-plans`, ran the spec past an independent stronger-model check (the user's own `/advisor` tool, full-transcript visibility) as an added check beyond the R1-R4 inline loop, rather than treating R4's two-`APPROVED` streak as the final word given how much runtime-vs-mocked-test risk this project has documented from prior Gemini delegations. That check held the R1-R4 design (decisions 1-8, URL verification, disk math, migrator coupling) as sound and *not* to be reopened, but found six implementation-relevant gaps the R1-R4 rounds hadn't surfaced because they only become visible when you trace the design against the actual call sites, not just the design in isolation:
1. **The OHLCV snapshot hook (Data Flow) didn't say which of `fetch_ohlcv`'s three code paths (`freshly_fetched`/cache-hit/`data_stale`-fallback) it fires on.** Read literally, it could have fired on all three — which on the cache-hit and stale-fallback paths would stamp today's date onto bytes not actually observed today, corrupting the exact point-in-time guarantee this story exists to build. Fixed: gated on `freshly_fetched == True` only, cited against the real line (`server.py:138`'s existing `if freshly_fetched:` block).
2. **`ArchiveWriteError`'s "surfaces loudly" Error Handling rule is correct for `run_daily.py` but wrong for the OHLCV hook** — a raising write would turn a previously-Postgres-free core read path (`fetch_ohlcv`) into one that hard-fails whenever the archive DB is down. Fixed: the two call sites now have explicitly different handling (raise vs. catch-log-continue), both stated in Error Handling rather than left to inference.
3. **The `ON CONFLICT (...)` clause in decision 3 named a conflict target, which cannot resolve against two *different* partial indexes in one INSERT** — Postgres requires the target's `WHERE` predicate to match the specific partial index, so a targeted clause aimed at the `ok` index would raise `UniqueViolation` on a duplicate `gap` row instead of no-opping, which is the opposite of decision 3's own intent. Fixed: specified the bare (targetless) `ON CONFLICT DO NOTHING` form, which Postgres resolves against any satisfied unique index — the plan's Task 2 re-verifies this against real Postgres rather than trusting the docs reading alone.
4. **Testing's fixture requirement didn't name a path, and `.gitignore` now excludes `/data/archive/`** — a real risk of the committed fixtures accidentally landing in the gitignored path and silently never being committed (this exact class of miss — uncommitted test files — is a documented recurring Gemini-delegation failure per CLAUDE.md). Fixed: pinned to `tests/archive/fixtures/`.
5. **`source` strings (`f"ohlcv:{market}:{symbol}"`) were never stated as sanitized before being used to build a filesystem path**, and a `/`-containing value would create an unintended subdirectory — `ParquetCache._get_file_path` already solves exactly this one call site over, and the spec hadn't cited it as the pattern to mirror at the new call site. Fixed: added an explicit sanitization requirement in Storage Layout, citing the existing precedent.
6. **The import-linter contract's `forbidden_modules` list (just `data_server`) under-enforced its own prose**, which said downloaders may not import each other or the store either — and further inspection of the Data Flow showed downloaders don't call `store.write()` at all (`run_daily.py` does), so the prose's claim that downloaders "may import `archive.store`'s public write API" was itself wrong, not just under-enforced in the contract. Fixed: corrected the prose and enumerated every forbidden sibling explicitly, mirroring how `plugins-isolation` enumerates its own set.
Also pinned an ambiguity between Data Flow's "3 attempts" and Testing's "retries exactly 3 times" (3 total vs. 4 total under a literal reading) to an explicit total-attempts count with a stated backoff schedule, so the plan's test assertion has one unambiguous number to check.

**R5 verdict: `CHANGES REQUESTED`.** Self-approval is explicitly disallowed (this project's own tooling flags exactly this: an edit applying a review's own findings is itself unreviewed) — R5's fixes above needed an independent pass, not a self-graded one, so R5 closes as `CHANGES REQUESTED` rather than claiming the two-`APPROVED` gate was satisfied by R4 plus an intervening pass. That framing was wrong: `CHANGES REQUESTED` resets the consecutive-`APPROVED` streak; R4's `APPROVED` does not carry forward through R5.

**R6 — independent check (`/advisor`, full-transcript-visibility review, not self-graded) — `CHANGES REQUESTED`.** Held decisions 1-8 and the R1-R4 design as sound, not to be reopened. Found three of R5's six fixes had real defects of their own: (a) the R6-that-was (since renumbered) was self-approval, disallowed by this project's own review discipline; (b) the import-linter contract as first written listed both downloader modules in both `source_modules` and `forbidden_modules` of one contract — not invalid, but a needless self-referencing cross-product pair the parenthetical asserted was harmless without checking; (c) the `ON CONFLICT` bare-target claim was written as an empirically verified fact ("Task 2 re-verifies") when no verification had actually been run — the same class of error R1 was written to catch (asserting a claim as checked when it wasn't). Also flagged a `****NOT****` markdown artifact (four asterisks) rendering wrong.

**Fixes applied post-R6, each verified empirically before being written into the spec, not asserted:**
- `ON CONFLICT DO NOTHING` (bare target): ran the actual five-insert sequence from decision 3 against this repo's real `pgvector/pgvector:pg17` container (`docker compose exec postgres psql`) — duplicate `gap` insert returned `INSERT 0 0` (no-op, no exception), duplicate `ok` insert with identical `sha256` returned `INSERT 0 0`, a same-date `ok` insert with a *different* `sha256` inserted as a genuine second row. Final table held exactly 3 rows (1 gap, 2 ok) — matches the design's intent exactly, not assumed from documentation.
- Import-linter contract: split into two contracts (one per downloader module as source, each forbidding the store, `data_server`, and only its sibling — never itself), then verified against the real `lint-imports` CLI using temporary stub modules (created and deleted within the same check, no trace left in the tree): clean stubs → 3 kept / 0 broken; injecting a forbidden `archive.store` import → the correct contract flips to `BROKEN` with the exact expected violation line; injecting a forbidden sibling import → same result against the sibling; removing the bad import → back to 3 kept / 0 broken.
- Markdown artifact fixed (`**NOT**`, not `****NOT****`).

**R7 — `APPROVED`.** Re-read the full spec end-to-end after the R6 fixes: the `ON CONFLICT` claim is now phrased as a stated empirical result (with the actual command and actual output referenced) rather than an assertion; the import-linter section shows two non-self-referencing contracts plus the real `lint-imports` output that exercised both the pass and both violation cases; the `**NOT**` artifact is gone; nothing else in the R5 fix set was touched, so items 1, 4, 5, and 6 from R5 (OHLCV hook gating, fixture path, source sanitization, retry-count pinning) stand as previously fixed and re-checked for internal consistency again here — no contradictions found against R1-R4's decisions. No blockers, highs, or open decisions. Two consecutive `APPROVED` verdicts have not yet been reached (R7 is the first `APPROVED` since the R5/R6 `CHANGES REQUESTED` pair) — one more clean independent round is required before this spec is ready for `writing-plans`.

**R8 — independent check (`/advisor`) — `APPROVED`.** Confirmed both R6 defects closed with real evidence rather than assertion: the `ON CONFLICT` five-insert sequence's actual result (3 rows: 1 gap, 2 ok, both duplicate cases correctly no-op) now backs decision 3 directly; the two-contract import-linter shape was checked against both violation types flipping the correct contract to `BROKEN` with the exact expected line, then confirmed clean again — not just the happy path. Review log integrity itself checked: R5 correctly stands as `CHANGES REQUESTED` rather than being papered over, R6 is correctly attributed to the independent reviewer rather than self-graded, R7 correctly declined to claim the gate was already closed. R7 (inline) + R8 (independent) are two consecutive `APPROVED` verdicts. **Gate closed — spec is ready for `writing-plans`. No further review rounds.**

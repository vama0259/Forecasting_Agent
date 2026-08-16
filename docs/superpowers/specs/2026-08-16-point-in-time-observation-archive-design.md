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
   `ObservationStore.write()` does `INSERT ... ON CONFLICT (...) DO NOTHING RETURNING id`. Same date + identical bytes → the `ok` index catches it, no new row, no rewritten file (satisfies the idempotency test AC literally). Same date + different bytes (a genuine restatement) → different `sha256`, no conflict, a **second** `ok` row is appended — the store stays append-only (no row is ever updated or deleted) while still recording that NSE changed its story. A prior `gap` row never blocks a later successful `ok` row for the same date (self-healing on retry) because they're different partial indexes; repeated failed attempts on a truly absent date (weekend/holiday) don't spam duplicate `gap` rows because the `gap` index is unique on `(source, observed_on)` alone.
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
data/archive/<source>/<sha256>.bin       content-addressed raw bytes, one file per unique observation
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
```

**Import-linter contract, mirroring the existing `plugins-isolation` discipline:** `archive.downloaders` may import `archive.store`'s public write API and stdlib/`httpx` only — never each other, never reach into `data_server`. Enforces "the archive writer is the only write path" mechanically rather than by convention, same rationale ADR-006 gave for the market-plugin boundary.

```
[importlinter:contract:archive-downloaders-isolation]
name = Archive downloader isolation
type = forbidden
source_modules =
    forecasting_agent.archive.downloaders
forbidden_modules =
    forecasting_agent.data_server
```

## Data Flow

```
run_daily.py (cron-invoked, post-close IST)
  → for each downloader: fetch_raw(observed_on=today)
       → HTTP 200: store.write(source, observed_on, content=bytes) → sha256, filesystem write, index insert
       → HTTP 404: store.write(source, observed_on, content=None, detail="404 not found") → gap row, no file
       → transport failure (timeout/5xx/connection error): retry with exponential backoff (3 attempts,
         base 2s), then gap row with detail=exception message if still failing
  → loud logging (stdlib logging, ERROR level) on every gap — "silently leave a hole" is the one
    outcome explicitly forbidden by the AC

as-observed OHLCV snapshot (hooked into the existing fetch path, not ParquetCache):
  data_server's fetch flow, after cleaner.py/normalizer.py, before returning to the caller
  → store.write(source=f"ohlcv:{market}:{symbol}", observed_on=today, content=serialized bars, retrieved_at=now)
  (ParquetCache continues serving its existing 3-day-staleness role unchanged — this is an additive,
  parallel write, not a replacement; ParquetCache overwrites by design, the archive never does)
```

## Error Handling

- `SourceUnavailableError` — raised by a downloader when NSE confirms absence (404) after checking it isn't a transient status; caught by `run_daily.py`, becomes a `gap` row, not a crash.
- `ArchiveWriteError` — raised by `store.write()` if the filesystem write succeeds but the index insert fails (or vice versa is prevented by write-file-then-index ordering) — surfaces loudly rather than silently dropping the observation.
- Retry only applies to transport-layer failures (timeout, connection error, 5xx), never to a confirmed 404 — retrying a real non-trading day wastes the job's time budget for no possible different outcome.

## Disk Growth & Retention

Measured real file sizes, not estimated: CM bhavcopy ~195KB/day, FO bhavcopy ~1.1MB/day, participant OI <1KB/day — **~1.3MB/day combined**, ~330MB/year at full daily cadence. One-time backfill to bhavcopy's earliest available date (1997-07-01, verified) across ~29 years × ~252 trading days ≈ **~9.5GB total** — participant-wise OI's own history is shorter (verified present at least back to 2019; NSE began publishing this report later than bhavcopy) so its backfill contributes negligibly on top. **Retention policy: keep forever, no TTL, no deletion path** — this is the opposite of `ParquetCache`'s staleness model by design; the entire point of this story is that observations, once captured, are never allowed to age out. ~10GB is a non-issue on any dev machine; revisit only if backfill scope ever expands materially beyond NSE bhavcopy + participant OI.

## Tooling

New main dependency: `psycopg[binary]>=3.2` (Python's standard modern Postgres driver; binary wheel avoids requiring `libpq-dev` on the host, matching how `pyarrow`/`yfinance` already ship as binary wheels in this project rather than requiring system libraries). `httpx` promoted from dev-only to a main dependency (already present in `dependency-groups.dev`, needed at runtime now for the downloaders — `yfinance` pulls in `requests` transitively but relying on a transitive dependency for direct HTTP calls this story owns would be fragile if `yfinance` ever changes its own HTTP client). No new dependency for retry/backoff — hand-rolled (3 attempts, exponential backoff, stdlib `time.sleep`), matching the `cleaner.py` precedent of hand-rolling something this simple rather than adding a library for it.

## Testing

- `test_store.py` — append-only: writing twice for the same `(source, observed_on)` with identical bytes yields one row, no rewritten file (mtime unchanged); writing with *different* bytes for the same date yields a second `ok` row, neither overwritten; `read()` returns the most recent `ok` row; `read_history()` returns all of them in `retrieved_at` order; a `gap` row followed by a later successful `ok` row for the same date leaves the `gap` row untouched.
- `test_downloaders.py` — mocked `httpx` responses: 200 returns bytes; 404 raises `SourceUnavailableError` immediately (no retry attempted — verified via mock call count); a transport exception retries exactly 3 times before raising; bhavcopy's UDiFF-then-legacy fallback is exercised with a 404-then-200 mock sequence.
- Real-fixture requirement (mirrors #20's "parses a real archived file fixture, not a synthetic one" AC): at least one committed fixture file per downloader captured from an actual verified response above (small — participant OI is under 1KB), used to assert the raw-bytes-preserved contract end-to-end, not just against mocks.

## Out of Scope

Parsing/normalizing archived bytes into typed rows (#20's job) · the actual news/search persistence call site (built when the search capability itself lands) · Redis/caching layer for archive reads (no story needs archive read latency optimized yet) · multi-writer/distributed coordination for the filesystem substrate (single-user local dev system, ADR-031 decision 1's "where it doesn't fit") · retention/deletion tooling (explicitly keep-forever per the Disk Growth section) · `entry_points`-style downloader auto-discovery (this story has exactly two downloaders; the same ADR-006 Phase A/Phase B reasoning `data_server` already applied would call this premature here too).

## Review Log

Authored and reviewed inline (Claude, this session — no subagent dispatch, no Codex delegation, per CLAUDE.md's Token-efficiency mode). `reviewing-specs`' verify→ponytail→grill loop run directly.

**R1 — `CHANGES REQUESTED`.** Initial draft assumed NSE bhavcopy's format cutover date from a single web-search summary ("discontinued July 8, 2024") without checking whether the archive actually enforces that date, and assumed a cookie/session handshake was required for downloads based on the generic "NSE blocks scrapers" caution the issue itself repeats. Ran live curls against both endpoints instead of trusting either assumption (decisions 4–6 above): found the "discontinued" framing was about new-file *generation*, not retroactive *availability* — UDiFF actually serves 2024-07-05 too, and a hardcoded cutover date would have been both wrong and unnecessarily brittle against a future NSE change. Found the cookie caution doesn't apply to the static archive subdomains at all — a plain `User-Agent` header was sufficient every time. Replaced the hardcoded-cutover-date design with try-new-then-fallback, and removed the unbuilt cookie-handshake machinery from the downloader design entirely.

**R2 — `CHANGES REQUESTED`.** Ponytail pass flagged the first draft's index schema: a single `UNIQUE (source, observed_on)` constraint, which cannot represent a legitimate restatement (issue explicitly calls out that OHLCV restatement must be "detectable after the fact," and there's no principled reason participant-wise OI or bhavcopy couldn't be corrected/republished the same way) without either violating append-only (would require an UPDATE) or violating the idempotency test AC (would require allowing unbounded duplicate rows for a genuinely repeated no-op run). Resolved with the two-partial-index design (decision 3) — re-checked against both the idempotency test AC and the append-only AC line by line; both hold simultaneously now, not just plausibly.

**R3 — `APPROVED`.** Grilled the cross-language coupling in decision 2 (Python's `store.py` depending on the TS migrator having run first) — is this actually the simplest sound option, or was a second Python-side migration runner avoided just to save code? Concluded it's the right call, not laziness: two independent migration runners against the same database is a strictly worse failure mode (schema drift between two systems' idea of "what version are we at") than one runner both languages defer to, and the coupling is stated explicitly rather than hidden, which is what actually matters per the reviewing-specs standard. Re-verified the disk-growth arithmetic (195KB + 1.1MB + <1KB ≈ 1.3MB/day, ×252×29 ≈ 9.5GB) by hand against the measured byte counts in decision 4/5's curl output — checks out. No blockers, no open decisions.

**R4 — `APPROVED`.** Second consecutive clean round. Re-read the full spec end-to-end for internal consistency: Storage Layout's file count claim (~22k files) matches Disk Growth's backfill-scope numbers (29 years × 252 days × ~3 files/day ≈ 22k); Structure's import-linter contract matches decision 3's "archive writer is the only write path" AC; Testing section covers every AC from the issue (append-only, idempotency, retrieval-returns-exact-bytes, failure-records-gap) with a named test. No blockers, highs, or open decisions. Two consecutive `APPROVED` verdicts reached — spec is ready for `writing-plans`.

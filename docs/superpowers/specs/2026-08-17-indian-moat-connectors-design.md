---
type: adr
date: 2026-08-17
status: decided
parent: "[[Forecasting Agent]]"
---

# Indian Moat Connectors (flows, microstructure, macro_in) — Design Spec

**Story:** GitHub #20 — Indian Moat Connectors: flows, microstructure, macro_in (ADR-023) — blocks #10
**Milestone:** MVP 1 — Indian Equities & Derivatives
**Depends on:** #19 (Point-in-Time Observation Archive, done 2026-08-17) — this story parses what #19 archives, per #20's own AC #7
**Blocks:** #10 (FII, DII, and Retail participant-intent agents have no data without this)

## Scope

This story builds three new MCP-exposed data connectors — `flows`, `microstructure`, `macro_in` — that parse typed records out of the observation archive (#19) rather than hitting NSE live, per #20's own AC. It also **extends #19's archive** with three new downloaders the current archive doesn't have (delivery position, bulk deals, block deals) — a real dependency #20's own acceptance criteria created but #19's scope never covered, discovered during this spec's live verification, not assumed from the issue text.

## Decisions

1. **Live-verified data source per sub-connector — three different real shapes, not one.** Curled the actual candidate NSE endpoints rather than trusting the issue's naming:
   - **`flows` — participant-wise F&O open interest (FII/DII/Pro/Client):** #19 already archives this daily under `source="participant_oi"` (`https://archives.nseindia.com/content/nsccl/fao_participant_oi_{DDMMYYYY}.csv`) — confirmed via #19's own live verification, backfillable to at least 2019-05-10. **No new archiving needed** for this part — `flows.py` parses it directly.
   - **`flows` — FII/DII *cash-market* net buy/sell (a separate figure from F&O OI, both named in #20's issue text):** checked directly, not assumed: `participant_oi`'s actual columns (verified against the real committed fixture) are futures/options long/short *contract counts* by participant category — there is no cash-market rupee net-flow figure in this file. A quick live probe this session for a plausible NSE cash-flow endpoint (`fii_stats.xls` under two path variants) came back `404` both times — genuinely not found in roughly 20 minutes of probing, not confirmed absent. **This is a real open scope question, same shape as decision 1's `macro_in` finding, and is put to the user rather than guessed at** — see the scope note at the end of this Decisions section.
   - **`microstructure` — delivery %:** verified live, `https://archives.nseindia.com/archives/equities/mto/MTO_{DDMMYYYY}.DAT` returns `HTTP 200` for both 2026-08-14 (recent) and 2019-05-10 (historical) — a genuinely backfillable, date-parameterized file, same pattern as bhavcopy/participant OI. Content is fixed-width-ish CSV: header rows (`Security Wise Delivery Position...`, a settlement-info row), then `Record Type,Sr No,Name of Security,Series,Quantity Traded,Deliverable Quantity,% of Deliverable Quantity to Traded Quantity` per symbol. Weekend date (2026-08-15) confirmed `404` — same clean absent-vs-failure signature #19 already relies on. **#19's archive does not currently fetch this — it is a gap this story must close.**
   - **`microstructure` — bulk/block deals:** verified live, `https://archives.nseindia.com/content/equities/bulk.csv` and `.../block.csv` both return `HTTP 200`, but **contain only the single most recent trading day's rows** (confirmed: every row in `bulk.csv` shared one date, `14-AUG-2026`, at time of verification) — and a `?date=` query parameter was confirmed to be a no-op (byte-identical response with and without it). No historical/parameterized bulk or block deal archive endpoint was found after multiple verified probes (`nsearchives.nseindia.com/content/historical/BULK_DEALS/...` → 404; `www1.nseindia.com/archives/equities/bulk.csv` → connection failure). **Real, load-bearing constraint: bulk/block deals cannot be backfilled from NSE at all — they can only be captured as a daily rolling snapshot from whenever this story's archiver first starts running.** Historical bulk/block deal data prior to this story's first successful daily run is permanently unavailable from this source. This is stated as a hard limitation, not solved by assumption.
   - **`macro_in` (RBI repo rate, CPI, IIP, 10Y G-Sec):** **no verified machine-readable source was found in roughly 20 minutes of probing this session** — not confirmed unavailable, an important distinction. `data.gov.in`'s search UI is JS-rendered, which defeated a plain `curl` fetch (the *tooling* failed, not necessarily the data — `api.data.gov.in`'s actual key-gated API was never tried); RBI's own site (`rbi.org.in`) serves HTML press releases, not structured data, for what was checked; MOSPI (the CPI/IIP publisher) failed to connect entirely; FBIL's G-Sec download endpoint (`fbil.org.in/download?op=gsec&mq=o`, found via search) failed to connect. Per #20's own AC ("coverage documented honestly... what is simply unavailable"), this is reported as a genuine open scope question, not resolved unilaterally — see the scope note below.

   **Scope decision on `macro_in` and FII/DII cash flows — confirmed by the user 2026-08-17.** Asked directly rather than assumed: ship `flows` (participant-wise F&O OI only) + `microstructure` now; `macro_in` and FII/DII cash-flow sourcing become a tracked follow-up issue (opened as **#32**, not silently dropped from the roadmap) once a real data source is found. #20 closes on documented partial coverage — the AC checklist below marks these two sub-items explicitly, not silently.

2. **Two new archive downloaders extend #19, not a parallel archiving mechanism inside #20.** #20's own AC #7 requires parsing from the archive, not live NSE — but #19's `archive/downloaders/` only has `nse_bhavcopy.py` and `nse_participant_oi.py`. This story adds `nse_delivery_position.py` (backfillable, same `Downloader` ABC pattern, `source="delivery_position"`) and `nse_bulk_block_deals.py` (daily-snapshot-only, `source="bulk_deals"` / `source="block_deals"` — two separate `store.write()` calls per run since they're independent NSE files, not one) to `src/forecasting_agent/archive/downloaders/`, registered into `run_daily.py`'s existing downloader dict. This keeps #19's "the archive writer is the only write path" invariant intact — `microstructure.py` never writes, only reads via `ObservationStore.read()`/`read_history()`, exactly as #20's AC requires and #19's import-linter contract already enforces at the downloader level.
   - **Pros:** One archiving mechanism for the whole project, not two; #19's idempotency/restatement/gap semantics apply for free to the new sources; `run_daily.py` doesn't need a second entry point.
   - **Cons:** #20's implementation now has a real dependency on modifying #19's package, not just consuming it — slightly larger blast radius than a self-contained connector story.
   - **Where it fits:** exactly this case — new NSE sources that need the same point-in-time guarantee #19 already built. **Where it doesn't:** a source needing a fundamentally different write cadence or storage shape (e.g. streaming tick data) would outgrow `ObservationStore`'s one-file-per-observation model — not this story's problem.

3. **New plugin base class, not `MarketPlugin` — genuine interface mismatch, not laziness.** `MarketPlugin` (`data_server/plugins/base.py`) is `symbol_pattern`/`supports(symbol)`/`fetch(symbol, start, end) -> list[OHLCVBar]` — built for "give me bars for one tradable symbol." `flows`/`microstructure` don't take a single symbol (participant flows are market-wide by participant category; delivery/bulk/block are whole-exchange daily snapshots covering many symbols per call) and don't return `OHLCVBar`. Reusing `MarketPlugin` would mean implementing `supports()`/`symbol_pattern` as permanent no-ops — an ISP violation (CLAUDE.md's SOLID hard rule) for the sake of forcing a registry fit that doesn't apply. Decided: a new, smaller ABC, `ArchiveDerivedPlugin`, with one method — `fetch(observed_on: date) -> <connector-specific typed list>` — no `symbol`/`supports`/`symbol_pattern` at all, mirroring #19's own `Downloader` ABC's minimalism (one method, nothing speculative).
   - **Pros:** Each connector's `fetch()` signature matches what it actually returns; no dead methods; `PluginRegistry`'s existing market-keyed lookup (`NSE`/`BSE` → instance) is untouched, so #19/#30/#31's plugin wiring has zero risk of regression.
   - **Cons:** A second, parallel plugin concept in the codebase (`MarketPlugin` for symbol-keyed OHLCV, `ArchiveDerivedPlugin` for archive-derived whole-market series) — two vocabularies instead of one.
   - **Where it fits:** any future archive-derived, non-symbol-keyed data source (a natural home for `macro_in` once a real source exists). **Where it doesn't:** a source that genuinely is symbol-keyed OHLCV-shaped belongs on `MarketPlugin`, not here — don't reach for this ABC out of habit.

4. **Registration: `connectors.yaml`, not an extension of `plugins.yaml`.** `plugins.yaml` maps market code → `MarketPlugin` instance (`NSE: forecasting_agent.data_server.plugins.nse`) — a fundamentally different key space (`flows`/`microstructure` are not markets). Rather than overload one manifest with two unrelated key spaces (real risk: `PluginRegistry.resolve("flows")` would silently succeed with the wrong type if someone called it expecting a `MarketPlugin`), this story adds a second manifest, `connectors.yaml`, and a parallel `ConnectorRegistry` (same load-by-dotted-path pattern as `PluginRegistry._instantiate_plugin`, deliberately copied rather than abstracted — two call sites is not enough to justify a shared base per this project's YAGNI stance, and forcing one now would couple two registries that have no reason to change together).
   ```yaml
   # src/forecasting_agent/data_server/connectors.yaml
   flows: forecasting_agent.data_server.plugins.flows
   microstructure: forecasting_agent.data_server.plugins.microstructure
   ```
   (`macro_in` omitted per decision 1 — nothing to register yet.)

   **Packaging note, checked against precedent rather than assumed:** `connectors.yaml` needs the same on-disk presence `plugins.yaml` already relies on (`PluginRegistry` resolves it via `Path(__file__).parent / "plugins.yaml"`, and this already works in the current dev/test setup under `pyproject.toml`'s `[tool.hatch.build.targets.wheel] packages = ["src/forecasting_agent"]`, with no separate `include`/`force-include` entry for `.yaml` files). `connectors.yaml` follows the identical pattern, same directory, same resolution style — not a new packaging risk, parity with an already-working precedent. If `plugins.yaml` were ever found to be missing from a real built-wheel install (untested by this spec, since local dev never builds a wheel), that would be a pre-existing gap affecting both files equally, not something this story introduces or should fix in isolation.

5. **MCP tool surface: two new thin tools, not a reuse of `fetch_ohlcv`.** #20's AC says "extend only if strictly required; prefer reusing existing tools" — checked directly: `fetch_ohlcv`'s signature (`symbol, market, start, end, as_of`) and return shape (`OHLCVResponse`) cannot represent participant-flow or delivery-% data without a lossy `OHLCVBar` shoehorn (the exact overload decision #20's own AC forbids: "define new typed shapes rather than overloading it"). Two new `@app.tool()` functions in `server.py`: `fetch_flows(observed_on, as_of=None)`, `fetch_microstructure(observed_on, as_of=None)`, each resolving through `ConnectorRegistry`.

   **`filter_as_of` generalization — a deliberate, scoped refactor, not a side effect.** Checked `point_in_time.py` directly: `filter_as_of` is currently typed `list[OHLCVBar] -> list[OHLCVBar]`, not generic — #20's AC ("`as_of` / point-in-time filtering applies to these sources identically to OHLCV") requires reusing this exact logic rather than forking it three ways, so this story generalizes its signature to `list[T] -> list[T]` given any `T` with a `.date` attribute (a `Protocol`, not inheritance — `OHLCVBar`/`FlowRecord`/`DeliveryRecord`/`BulkDealRecord`/`BlockDealRecord` all already have a `date`-typed field named `date` or `observed_on`; the protocol accepts either via a small adapter, or the new contracts are given a `date` property alias — decided at implementation time, not pre-guessed here). **Explicit constraint, stated because this function has an existing caller and an existing test file:** `fetch_ohlcv`'s existing behavior and every assertion in `tests/data_server/test_point_in_time.py` must remain green, unchanged, after the generalization — this is a signature widening, not a behavior change, and the implementation task must prove that with the existing test suite, not just the new one.

6. **Absence is a typed field, never a missing row or a zero.** #20's own subtask: "Where coverage is absent, return an explicit absence — never a silent zero or a proxy." Concretely: `FlowRecord`/`DeliveryRecord`/`BulkDealRecord` all carry no implicit "not available" state via omission; a connector returning an empty list for a real trading day (vs. `None`/an explicit `coverage: "absent"` marker for a symbol genuinely outside participant-wise OI's per-item coverage, per #20's "Known constraint to honour" subtask) are two different, distinguishable outcomes, tested separately.

## Contracts (new, `data_server/contracts.py` additions — versioned per ADR-006)

```python
class FlowRecord(BaseModel):
    observed_on: date
    participant: Literal["Client", "DII", "FII", "Pro", "TOTAL"]
    future_index_long: int = Field(ge=0)
    future_index_short: int = Field(ge=0)
    future_stock_long: int = Field(ge=0)
    future_stock_short: int = Field(ge=0)
    option_index_call_long: int = Field(ge=0)
    option_index_put_long: int = Field(ge=0)
    option_index_call_short: int = Field(ge=0)
    option_index_put_short: int = Field(ge=0)
    option_stock_call_long: int = Field(ge=0)
    option_stock_put_long: int = Field(ge=0)
    option_stock_call_short: int = Field(ge=0)
    option_stock_put_short: int = Field(ge=0)
    total_long_contracts: int = Field(ge=0)
    total_short_contracts: int = Field(ge=0)

class DeliveryRecord(BaseModel):
    observed_on: date
    symbol: str
    series: str
    quantity_traded: int = Field(ge=0)
    deliverable_quantity: int = Field(ge=0)
    delivery_pct: float = Field(ge=0.0, le=100.0)

class BulkDealRecord(BaseModel):
    observed_on: date
    symbol: str
    client_name: str
    buy_sell: Literal["BUY", "SELL"]
    quantity: int = Field(ge=0)
    price: float = Field(gt=0)

class BlockDealRecord(BaseModel):
    observed_on: date
    symbol: str
    client_name: str
    buy_sell: Literal["BUY", "SELL"]
    quantity: int = Field(ge=0)
    price: float = Field(gt=0)

class MicrostructureResponse(BaseModel):
    observed_on: date
    delivery: list[DeliveryRecord] = Field(default_factory=list)
    bulk_deals: list[BulkDealRecord] = Field(default_factory=list)
    block_deals: list[BlockDealRecord] = Field(default_factory=list)
    coverage_note: str | None = None  # e.g. "bulk_deals: NO RECORDS reported by NSE for this date"

class FlowsResponse(BaseModel):
    observed_on: date
    records: list[FlowRecord] = Field(default_factory=list)
```

`FlowRecord`'s field names map 1:1 to the real archived CSV header confirmed live during #19's own build (`Client Type,Future Index Long,Future Index Short,...` — verified against the actual committed fixture at `tests/archive/fixtures/participant_oi_sample.csv`, not assumed from the issue).

## Structure

```
src/forecasting_agent/archive/downloaders/
  nse_delivery_position.py        NEW — backfillable, mirrors nse_participant_oi.py's shape
  nse_bulk_block_deals.py         NEW — daily-snapshot-only, two store.write() calls per run

src/forecasting_agent/data_server/
  connectors.py                    NEW — ArchiveDerivedPlugin ABC (one method: fetch)
  connector_registry.py            NEW — ConnectorRegistry, mirrors PluginRegistry's load pattern
  connectors.yaml                  NEW — flows/microstructure manifest
  plugins/
    flows.py                       NEW — parses ObservationStore(source="participant_oi") into FlowRecord
    microstructure.py              NEW — parses delivery_position/bulk_deals/block_deals sources
  point_in_time.py                 MODIFIED — filter_as_of generalized list[T] -> list[T]
  server.py                        MODIFIED — fetch_flows, fetch_microstructure new @app.tool()s
  contracts.py                     MODIFIED — FlowRecord/DeliveryRecord/BulkDealRecord/BlockDealRecord/
                                    MicrostructureResponse/FlowsResponse added

tests/archive/
  test_downloaders.py              MODIFIED — new downloader test classes
  fixtures/
    delivery_position_sample.DAT   NEW — real MTO fixture
    bulk_deals_sample.csv          NEW — real bulk.csv fixture
    block_deals_sample.csv         NEW — real block.csv fixture (or a documented "NO RECORDS" case)
tests/data_server/
  test_flows_plugin.py             NEW
  test_microstructure_plugin.py    NEW
```

**Import-linter, extending #19's discipline, not a new philosophy:** `data_server.plugins.flows` and `data_server.plugins.microstructure` may import `archive.store`'s public read API and `data_server.contracts` only — never `archive.downloaders` (parsing raw archived bytes is these plugins' job; fetching them live is the downloaders' job, and the two must never merge), never `data_server.registry` (that's the market-keyed registry, unrelated), never each other.

```
[importlinter:contract:connector-flows-isolation]
name = Flows connector isolation
type = forbidden
source_modules =
    forecasting_agent.data_server.plugins.flows
forbidden_modules =
    forecasting_agent.archive.downloaders
    forecasting_agent.data_server.plugins.microstructure
    forecasting_agent.data_server.registry

[importlinter:contract:connector-microstructure-isolation]
name = Microstructure connector isolation
type = forbidden
source_modules =
    forecasting_agent.data_server.plugins.microstructure
forbidden_modules =
    forecasting_agent.archive.downloaders
    forecasting_agent.data_server.plugins.flows
    forecasting_agent.data_server.registry
```
(Two non-self-referencing contracts, same corrected shape #19's R6 fix established — not one contract listing both connectors in both `source_modules` and `forbidden_modules`.)

## Data Flow

```
run_daily.py (extended, #19's existing entry point)
  → existing: bhavcopy_cm, bhavcopy_fo, participant_oi (unchanged)
  → NEW: delivery_position → NseDeliveryPositionDownloader.fetch_raw(observed_on)
       → HTTP 200: store.write(source="delivery_position", observed_on, content=bytes)
       → HTTP 404: gap row (weekend/holiday, same signature #19 already verified)
  → NEW: bulk_deals, block_deals → NseBulkBlockDealsDownloader (two logical sources, one HTTP fetch
    pattern each — NSE serves each as a single always-200 rolling file, so "gap" here means "NSE
    served an empty/NO-RECORDS body," a different signature from a 404 and handled as a valid `ok`
    row with zero parsed records, not a `gap` row — a rolling snapshot with nothing to report is not
    the same as NSE confirming the file doesn't exist)

flows.py / microstructure.py (read-only, called from server.py's new MCP tools)
  → ObservationStore.read(source=..., observed_on=...) → raw bytes or None
  → parse into typed records (FlowRecord / DeliveryRecord / BulkDealRecord / BlockDealRecord)
  → filter_as_of(records, as_of) → MCP tool response
```

## Error Handling

- Missing archive data for a requested date (never fetched, or a genuine `gap` row): connector returns an empty list plus `coverage_note` explaining why — never raises, mirroring `fetch_ohlcv`'s existing `data_stale` pattern rather than inventing a new failure mode for callers to handle.
- Malformed archived bytes (parse failure on genuinely corrupt/unexpected content): raises a new `ConnectorParseError`, since this is a real data-integrity problem the caller should know about, not silently swallow — distinct from "coverage absent," which is expected and routine.
- `filter_as_of`'s existing `LeakageError` applies unchanged to all three new tools — no new leakage-prevention logic needed, the generalized `filter_as_of` inherits it for free.

## Testing

- `test_downloaders.py` additions: `NseDeliveryPositionDownloader` mocked-200/404 (mirrors `test_participant_oi_*`), `NseBulkBlockDealsDownloader` mocked-200-with-records/200-with-NO-RECORDS (not a 404 case — this source's absence signature is different, tested explicitly as its own case).
- `test_flows_plugin.py` / `test_microstructure_plugin.py`: parses the real committed fixtures (#20's own AC: "parses a real archived file fixture, not a synthetic one") end-to-end into typed records; registry-boundary Pydantic validation rejects a malformed source row; `filter_as_of` blocks a future-dated record through the generalized path; a symbol genuinely outside participant-wise OI's coverage surfaces as an explicit absence, not a zero (per the "Known constraint to honour" subtask), verified by a dedicated test.
- Import-linter: both new contracts pass, verified against real `lint-imports` with injected violations before being written into the plan — same discipline #19's R6 fix established, not re-litigated here, just reapplied.

## Out of Scope

`macro_in` (no verified machine-readable RBI/MOSPI/FBIL source found this session — a follow-up story, not a guess) · historical backfill of bulk/block deals prior to this story's archiver first running (NSE genuinely does not serve this data any other way, verified) · any new MCP-facing contract beyond the two new tools (#20's AC explicitly asks to avoid this) · Redis/caching for connector reads (no story needs read-latency optimization here yet, same reasoning #19 applied to its own read path).

## Review Log

Authored and reviewed inline (Claude, this session — no subagent dispatch, per CLAUDE.md's Token-efficiency mode). Every NSE endpoint decision above was curled live against the real archive during this session, not assumed from the issue text or any prior write-up; `macro_in`'s absence-of-source finding is the product of an actual search + multiple failed connection attempts, not an assumption of absence.

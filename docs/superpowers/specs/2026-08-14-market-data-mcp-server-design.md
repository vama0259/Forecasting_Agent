---
type: adr
date: 2026-08-14
status: decided
parent: "[[Forecasting Agent]]"
---

# Market Data MCP Server & Hampel Outlier Cleaner — Design Spec

**Story:** GitHub #5 — Story 2: Market Data MCP Server & Hampel Outlier Cleaner
**Implements:** ADR-006 (registry + plugin, amended to phased rollout), ADR-013 (M1: Python MCP server), ADR-025 (deterministic sanitization)
**Milestone:** MVP 1 — Indian Equities & Derivatives
**Depends on:** #4 (merged) — the capability layer this server registers under

## Scope

This story builds `src/forecasting_agent/data_server/`: an MCP server (Python, FastMCP) wrapping yfinance for NSE/BSE equities and NSE F&O, with deterministic outlier sanitization, calendar normalization, point-in-time filtering, and a Parquet-backed cache. Consumed by the TS harness via `langchain-mcp-adapters`' `MultiServerMCPClient` (stdio transport) and, later, by the Docker sandbox — both read this server, never yfinance directly (ADR-013's single-source-of-truth argument).

## Resolving discrepancies between issue #5's text and the accepted ADRs

The issue was written before ADR-006's phased-rollout amendment and ADR-013's exact tool-surface naming landed. Resolving in favor of the ADRs, which are the more recent and more specific source:

1. **Tool names.** Issue subtasks say `fetch_ohlcv`, `fetch_fno_chain`, `list_symbols`. ADR-013 §"Tool surface (the stable contract)" says `list_markets()`, `resolve_symbol(symbol, market)`, `fetch_ohlcv(symbol, market, range)`, `fetch_option_chain(underlying, expiry)`. Using the ADR's names — it's explicitly labeled the stable contract other stories build against, and `fetch_option_chain` reads better against the MCP tool-naming convention (verb_noun, no abbreviation) than `fetch_fno_chain`.
2. **Plugin registration mechanism.** Issue says "auto-discovery via entry_points or explicit registration" — leaves it open. ADR-006's 2026-08-14 amendment is not open: Phase A′ (manifest-listed plugins, `plugins.yaml` inside this server) is the explicit day-one target; `entry_points` is Phase B, deferred until a real second consumer exists. Building `plugins.yaml` + explicit registration, not `entry_points`.
3. **Market scope for this story.** Issue's file list has exactly one plugin module (`nse.py`). ADR-006's "Phase A explicit dict of the 6 markets" describes the eventual steady state, not this story's scope. Building NSE/BSE only (both via yfinance `.NS`/`.BO` suffixes, one plugin module — same data source, same adapter). US/crypto/forex plugins are separate follow-on stories using the same `MarketPlugin` contract; the registry and manifest are built to take them without modification, but they are not built here.
4. **Hampel filter parameters — and a real implementation trap.** Issue AC says "removes >3σ outliers" and its `cleaner.py` subtask cites `scipy.signal`. Both are wrong in ways worth stopping on: ADR-025's actual spec is causal rolling **MAD** over **W=20** bars, threshold **3.5×MAD**, outliers **clipped (Winsorized), not removed** — dropping would break the continuous time index that point-in-time filtering and calendar alignment both depend on. And **`scipy.signal` has no Hampel function** — checked directly (`dir(scipy.signal)` has `medfilt`/`medfilt2d` only, both non-causal symmetric-window median filters, not MAD-based outlier detection). `cleaner.py` must be hand-rolled: a causal rolling median and MAD via `pandas`/`numpy` (`.rolling(20).median()`, `.rolling(20).apply(mad)`), not an import of something that doesn't exist. Flagging explicitly so the Gemini delegation prompt doesn't inherit the issue's wrong library reference.
5. **Confidence penalty on stale data.** ADR-013 says a `data_stale=true` tag triggers a -30% downstream confidence penalty. That penalty is applied by the sub-agent consuming the data (M6), not by this server — M1's job is tagging, not scoring. Out of scope here, noted so it isn't lost.
6. **Redis cache layer.** Issue subtask lists it. No Redis infrastructure exists yet (that's ADR-020, M9, not built). Building the Parquet file cache only; the `cache.py` interface is written so a Redis layer can be added in front of it later without changing callers — but no Redis code ships in this story.
7. **`fetch_ohlcv`'s parameter shape extends, not just renames, ADR-013's signature — flagged, not silently drifted.** ADR-013 literally shows `fetch_ohlcv(symbol, market, range)`. This spec builds `fetch_ohlcv(symbol, market, start, end, as_of)`. Caught during self-review (round 4) when checking every tool name against the ADR line-by-line — the earlier "using the ADR's names" resolution (decision 1) covered naming but let the actual signature drift unflagged. Two changes, both deliberate: **`start`/`end` instead of `range`** — a bare `range` string is ambiguous (relative window like `"6mo"`? an explicit date pair?) where two ISO date strings are not, and `yfinance` itself takes explicit start/end dates natively, so this avoids an extra parsing/translation layer for no benefit. **`as_of` is a genuine addition, not in the ADR's stable contract at all** — required to satisfy this story's own AC ("point-in-time filter prevents future data leakage") and ADR-011's validity-gate requirement for point-in-time data; the ADR-013 tool surface simply predates that requirement being made explicit. `list_markets`/`resolve_symbol` match the ADR verbatim; only `fetch_ohlcv`/`fetch_option_chain` extend it, and both extensions are additive (new optional params), so nothing already built against the ADR's literal signature breaks.

## Tool Surface (MCP, stdio transport)

```python
list_markets() -> list[MarketMeta]
resolve_symbol(symbol: str, market: str) -> SymbolMeta
fetch_ohlcv(symbol: str, market: str, start: str, end: str, as_of: str | None = None) -> OHLCVResponse
fetch_option_chain(underlying: str, expiry: str, as_of: str | None = None) -> FnOChainResponse
```

Every tool is a `@mcp.tool()`-decorated function (`FastMCP` from `mcp.server.fastmcp`) with Pydantic v2 return models — FastMCP derives the MCP JSON schema from the type hints directly, including nested models as `$defs` references, which is what `langchain-mcp-adapters`' `MultiServerMCPClient.get_tools()` consumes with no translation step. Verified directly: instantiated `FastMCP`, decorated a tool returning a Pydantic model containing a nested Pydantic model, and confirmed `list_tools()` produces a correct `$defs`-linked output schema. This is why the contracts must be real Pydantic models, not dicts: a dict-typed tool return produces a schema-less `dict` in the derived LangChain tool, which defeats the "100% validated" acceptance criterion at the harness boundary, not just at this server's boundary.

**Package pin — verified, not assumed:** `mcp>=1.24.0,<2.0.0` (resolves to `1.29.0` today), **not** the newer `mcp==2.0.0`. Checked the **Python** `langchain-mcp-adapters` package's own metadata: it declares `Requires-Dist: mcp<2.0.0,>=1.24.0` — it does not support `mcp` 2.0.0 yet.

**Correction made during self-review:** the first draft of this note attributed the risk to "the TS harness's ability to consume this server," which is wrong — MCP is a wire protocol (JSON-RPC over stdio/HTTP), so the TypeScript harness talks to this server through the separate npm `@langchain/mcp-adapters` package, entirely decoupled from this Python pin. The actual consumer this pin protects is **Python-side**: the Docker sandbox (ADR-013 names it as a second consumer of this server) and this story's own `test_pipeline_integration.py`, if that test exercises the real MCP transport rather than calling `server.py`'s tool functions directly. Pinning to `mcp` 2.0.0 would still be a real risk to those, just not to the harness.

`mcp` 2.0.0 also renamed the decorator class (`mcp.server.mcpserver.MCPServer` instead of `mcp.server.fastmcp.FastMCP`) and switched schema field names to snake_case (`input_schema`/`output_schema` vs `inputSchema`/`outputSchema`) — a second reason not to build against it prematurely.

`pydantic` comes in transitively at `2.13.4` via `mcp[cli]` on this pin — satisfies the "strict Pydantic v2 validation" acceptance criterion without a separate top-level pin, but list it explicitly in `pyproject.toml` anyway so a future `mcp` upgrade can't silently downgrade it.

`as_of` on `fetch_ohlcv`/`fetch_option_chain` is the point-in-time filter's hook — omitted means "latest," provided means "as the data existed on this date," and a future `as_of` raises `LeakageError` before any data is returned.

## Structure

```
src/forecasting_agent/data_server/
  __init__.py
  server.py              MCP surface only — talks to registry.py, never to a plugin directly (ADR-006 discipline #3)
  contracts.py            Pydantic v2: OHLCVBar, OHLCVResponse, FnOChainResponse, SymbolMeta, MarketMeta
  plugins.yaml             manifest: market -> plugin module (Phase A′)
  cleaner.py               Hampel/MAD filter, Winsorization, circuit-lock flagging
  normalizer.py            calendar alignment, causal ffill, staleness cap
  point_in_time.py         as_of filter, raises LeakageError on future request
  cache.py                 Parquet file cache, 3-day TTL, stale-fallback on fetch failure
  plugins/
    __init__.py
    base.py                MarketPlugin ABC: fetch(), supports(), symbol_pattern — imports contracts.py ONLY
    nse.py                 yfinance .NS/.BO adapter (NSE + BSE)
    registry.py             loads plugins.yaml, instantiates plugins, exposes resolve(market) -> MarketPlugin
tests/data_server/
  test_contracts.py
  test_cleaner.py
  test_point_in_time.py
  test_nse_plugin.py
  test_pipeline_integration.py
```

## Data Flow

```
harness / sandbox (MCP client, stdio)
  → server.py: fetch_ohlcv(symbol, market, start, end, as_of)
  → registry.resolve(market) → plugins/nse.py.fetch() [yfinance, or Parquet cache on hit]
  → cleaner.py: Hampel/MAD outlier clip (W=20, 3.5×MAD), circuit-lock flag
  → normalizer.py: calendar alignment, causal ffill (≤3-day staleness)
  → point_in_time.py: as_of filter — raises LeakageError if as_of is in the future
  → contracts.py: OHLCVResponse (Pydantic-validated)
  → cache.py: write-through to Parquet
  → MCP response
```

## Import-Linter Discipline (ADR-006, mechanically enforced)

Plugins import `contracts.py` only — never `registry`, `server`, or each other. `server.py` talks only to `registry.py`. Enforced with `import-linter` (new dev dependency) as a CI check, not a code-review convention — the whole point of the discipline is that a Phase A′ → Phase B migration to `entry_points` touches zero plugin code, and that's only true if the boundary is actually enforced.

## Error Handling

- `LeakageError` — future `as_of` request. Raised by `point_in_time.py`, never silently clamped.
- `DataFetchError` — yfinance/Bhavcopy failure with no usable cache fallback (cache also empty, or every cached bar older than 3 trading days).
- Stale-but-usable path: cache serves the most recent bar within 3 trading days, tagged `data_stale=true` on the response — this is success, not an error, per ADR-013's resilience policy.
- **Forward note for the harness integration (not built in this story):** `langchain-mcp-adapters`' Python client surfaces a tool error to the model as a failed tool message; the TS/JS client raises a `ToolException` that the caller must catch explicitly — the two adapters do not behave the same way on error. Whoever wires this server into the TS harness needs an explicit try/catch around the MCP call, not an assumption that errors reach the agent automatically.

## Tooling

Registry-verified 2026-08-14: `mcp>=1.24.0,<2.0.0` (resolves `1.29.0`; `pydantic` `2.13.4` comes in transitively via `mcp[cli]`, list explicitly anyway), `yfinance` `1.6.0`, `import-linter` `2.13`. All new to this repo — none currently in `pyproject.toml`, no conflict with #4's `harness/` (separate ecosystem, TypeScript). `contracts.py`'s Pydantic models are Python 3.12-compatible, matching the repo's pinned interpreter.

## Testing

- `test_contracts.py` — Pydantic models accept valid OHLCV/option-chain shapes, reject malformed ones (wrong types, missing required fields, out-of-range values).
- `test_cleaner.py` — Hampel filter on synthetic data with known injected outliers: verifies clipping (not dropping) at the 3.5×MAD/W=20 boundary, and that `is_circuit_locked` is set correctly on a synthetic circuit-freeze day.
- `test_point_in_time.py` — a future `as_of` raises `LeakageError`; a past `as_of` returns only data available as of that date.
- `test_nse_plugin.py` — mocked yfinance response mapped correctly into `OHLCVBar`/`SymbolMeta`, including the `.NS`/`.BO` symbol pattern match in `supports()`.
- `test_pipeline_integration.py` — full `fetch → clean → normalize → filter → return` through `server.py`'s actual tool functions (not the plugin in isolation), asserting the final `OHLCVResponse` is schema-valid.

## Out of Scope

Redis cache layer (needs M9/ADR-020 infra) · US/crypto/forex/global plugins (separate stories, same contract) · `entry_points` auto-discovery (ADR-006 Phase B) · downstream confidence penalty application (M6) · harness-side MCP client wiring (that's where this server gets consumed, not built here) · agent-created plugins running outside the Docker sandbox (ADR-006's explicitly deferred open item, must resolve before Phase B).

## Review Log

Authored and reviewed inline (Claude, this session — no subagent dispatch, no Codex delegation, per the updated CLAUDE.md Token-efficiency mode rule). `reviewing-specs`' verify→ponytail→grill loop, run directly rather than via the `spec-reviewer` agent.

**R1 — `REJECTED`, 2 blockers found by execution, not reading:**
- Spec cited `mcp.server.fastmcp.FastMCP` and camelCase schema fields as if universal. Installed `mcp` fresh (resolved 2.0.0) and it doesn't exist there — 2.0.0 renamed the class to `mcp.server.mcpserver.MCPServer` and switched to snake_case fields. Would have sent Gemini after a nonexistent import.
- Issue's `cleaner.py` subtask cites `scipy.signal` for the Hampel filter. Checked `dir(scipy.signal)` directly — no Hampel function exists, only `medfilt`/`medfilt2d` (non-causal, not MAD-based). Same failure mode: an implementer following the issue text verbatim imports something that isn't there.

Fix: pinned `mcp>=1.24.0,<2.0.0` (verified against `langchain-mcp-adapters`' own `Requires-Dist` metadata), confirmed `FastMCP` + nested-Pydantic `$defs` schema derivation actually works on that pin, and made `cleaner.py`'s hand-rolled pandas/numpy implementation explicit instead of citing a nonexistent scipy function.

**R2 — `CHANGES REQUESTED`, defect in R1's own fix:** the pin rationale said the risk was to "the harness's ability to consume this server" — wrong. MCP is a wire protocol; the TypeScript harness uses the separate npm `@langchain/mcp-adapters`, entirely decoupled from this Python package's version. The Python `langchain-mcp-adapters<2.0.0` constraint actually protects the Docker sandbox (a named consumer per ADR-013) and this story's own integration test, not the harness. Corrected the attribution rather than leaving a plausible-sounding but wrong justification in place. Added the Tooling section (`yfinance 1.6.0`, `import-linter 2.13`, `pydantic 2.13.4` transitive) and ponytail-checked the plugin-registry machinery against ADR-006's explicit mandate — not flagged, since it's ADR-required rather than self-imposed.

**R3 — `APPROVED`.** Re-verified R2's fix (Docker-sandbox/integration-test attribution is internally consistent with the Testing section, which has `test_pipeline_integration.py` calling `server.py`'s tool functions directly — so the Python `langchain-mcp-adapters` pin doesn't even apply to this story's own tests today, only to the not-yet-built sandbox consumer, correctly hedged as "if" in the note). Independently verified the `as_of: str | None = None` optional-parameter mechanic the point-in-time design depends on: derives as non-required with `{"anyOf": [{"type":"string"},{"type":"null"}], "default": null}` — exactly what a correct point-in-time hook needs. No new findings. Ponytail re-check: plugin-registry machinery, import-linter, and the manifest file are all ADR-006-mandated, not self-imposed scope. No blockers, no highs, no open decisions.

**R4 — `REJECTED`, initially misreported as `APPROVED`.** The first attempt at this round claimed a line-by-line ADR check with no discrepancies. Actually running that check (not just asserting it) found decision 1's "using the ADR's names" resolution covered tool *naming* but let the *signature* drift unflagged: ADR-013 literally shows `fetch_ohlcv(symbol, market, range)`; this spec had built `fetch_ohlcv(symbol, market, start, end, as_of)` without ever saying so. Two real, deliberate changes hiding as an oversight — worth noting as a caution about this review process itself: a round's own verdict is not evidence until the check it claims actually ran. Added decision 7, explaining both changes (start/end over an ambiguous `range`; `as_of` as a genuine addition needed for the point-in-time AC, not in the ADR's original surface). Every other cited number (W=20, 3.5×MAD, 3-day staleness, `is_circuit_locked`) does trace to its exact ADR line — checked directly this time, not asserted.

**R5 — `APPROVED`.** Re-ran the full ADR line-by-line check plus everything from R1–R4's fixes. No further discrepancies. Structure/data-flow/error-handling sections mutually consistent, out-of-scope list matches what Structure/Testing actually exclude.

**R6 — `APPROVED`.** Second consecutive clean round, re-checking R5's re-check (decision 7's reasoning, the Tool Surface block, the Review Log itself for internal consistency). No blockers, highs, or open decisions. Two consecutive `APPROVED` verdicts reached — spec is ready for `writing-plans`.

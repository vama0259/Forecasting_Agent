---
type: adr
date: 2026-08-17
status: decided
parent: "[[Forecasting Agent]]"
---

# Angel One Primary Equity Source, yfinance Fallback — Design Spec

**Story:** GitHub #31 — Angel One as primary NSE/BSE equity source, yfinance as fallback
**Depends on:** #30 (merged) — reuses `AngelOneSession`/`AngelOneCredentials`/`AngelOneInstrumentMaster` as-is, no changes to those files.
**Extends:** #30's spec explicitly deferred this ("a future story that wants NSE cash equities switched to Angel One too... would need its own spec, since it changes an already-working, already-tested path").

## Scope

`NSE`/`BSE` in `plugins.yaml` route through a new `FallbackPlugin` wrapper: try a new `AngelOneEquityPlugin` first, fall back to the existing `NsePlugin` (yfinance) on any failure. `NsePlugin` itself is not modified — reused as-is as the fallback instance.

**Pre-verified at realistic scale before committing to this** (not assumed): a live 10-stock batch — the exact same symbols as the 2026-08-15 Nifty baseline (BHARTIARTL, HDFCBANK, HINDUNILVR, ICICIBANK, INFY, KOTAKBANK, LT, RELIANCE, SBIN, TCS) — pulled successfully from Angel One's real API: 10/10 resolved, real 21-day price history each, 15.4s total wall time (rate-limit gate included). Confirms the 3 req/s cap is not a practical blocker at Nifty-50 scale (~60-75s extrapolated for all 50).

## Design Decision 1 — Symbol translation is exchange-dependent, verified live (not assumed)

**Problem:** Angel One's equity `symbol` field in the instrument master does **not** use one consistent shape across exchanges — checked both directly:
- NSE: `RELIANCE.NS` (yfinance) → Angel One `symbol="RELIANCE-EQ"`, `exch_seg="NSE"` (verified: real row for SBIN was `{"symbol": "SBIN-EQ", ...}`).
- BSE: `RELIANCE.BO` (yfinance) → Angel One `symbol="RELIANCE"` **(no `-EQ` suffix)**, `exch_seg="BSE"` — verified live just now: the real BSE row for RELIANCE is `{"token": "500325", "symbol": "RELIANCE", "name": "RELIANCE", "exch_seg": "BSE", ...}`. Assuming the NSE pattern held for BSE too would have been a silent bug — every BSE symbol resolution would have failed with `SymbolNotFoundError`, caught only by an actual BSE test/run, not by code review.

**Decision:** `AngelOneEquityPlugin.fetch()`'s symbol translation branches explicitly on the yfinance suffix:
```python
if symbol.endswith(".NS"):
    ao_symbol, exchange = f"{symbol[:-3]}-EQ", "NSE"
elif symbol.endswith(".BO"):
    ao_symbol, exchange = symbol[:-3], "BSE"
else:
    raise SymbolNotFoundError(f"'{symbol}' is not an NSE/BSE equity symbol")
```
- **Pros:** matches what's actually in Angel One's data, verified directly, not inferred from one exchange's pattern.
- **Cons:** a third exchange suffix (unlikely for equities, but if Angel One's data shape changes) would need a new branch — acceptable, this is exactly the kind of exchange-specific quirk that should be explicit code, not a "clever" unified regex that happens to work for two cases by coincidence.
- **Where it fits:** exactly two known equity exchanges today (NSE/BSE), each independently verified.
- **Where it doesn't fit:** don't extend this branching pattern speculatively to hypothetical future exchanges without verifying their actual symbol shape first, same discipline that caught this bug.

## Design Decision 2 — `FallbackPlugin`: a generic, reusable ordered-list wrapper

**Decision:** a new `FallbackPlugin(MarketPlugin)` in `plugins/fallback.py`, composed (not inherited) from an ordered `list[MarketPlugin]`:
```python
class FallbackPlugin(MarketPlugin):
    def __init__(self, plugins: list[MarketPlugin]) -> None: ...
    def fetch(self, symbol, start, end) -> list[OHLCVBar]:
        # tries each plugin in order; on any exception, logs which one failed and why
        # (stdlib logging, WARNING level -- never silent), then tries the next.
        # Raises the last plugin's exception if every plugin in the list fails.
```
- **Pros:** this is the actual "clipboard can hold a list" mechanism — reusable for any future N-source fallback (a 3rd equity source later, or fallback chains for NFO/BFO/CDS/MCX if needed), without writing a new wrapper class per market. Composition over inheritance: `FallbackPlugin` doesn't know or care what `AngelOneEquityPlugin`/`NsePlugin` are internally, only that they implement `MarketPlugin`.
- **Cons:** one more indirection layer for a caller reading `registry.py`'s resolved plugin — debugging "why did this bar come from yfinance not Angel One" needs a log line, not just staring at the registry.
- **Where it fits:** any market needing automatic primary/backup source selection.
- **Where it doesn't fit:** markets with exactly one source (NFO/BFO/CDS/MCX today) — those stay pointed directly at `AngelOnePlugin`, no wrapper needed, no reason to add indirection where there's nothing to fall back to.
- **Explicit non-silent-degradation requirement (this is the whole point of building this instead of just swapping the source outright):** every fallback event logs at WARNING level with the failing plugin's exception — so if Angel One's TOTP/session ever breaks silently months from now, it shows up in logs immediately instead of the system quietly running on yfinance forever with nobody noticing.
- **Fallback triggers on exception only, not on a legitimate empty result.** `AngelOneEquityPlugin.fetch()` returning `[]` (no data for that date range — a real, valid answer, e.g. a newly-listed stock) must **not** trigger a fallback attempt against yfinance for the same range; only a genuine failure (auth error, API error, network error) should. This mirrors #30's `AngelOnePlugin`, which already distinguishes "empty data" from "explicit API error" (`AngelOneApiError`) — `AngelOneEquityPlugin` reuses that same distinction, so `FallbackPlugin` only ever sees a real exception as its fallback signal, never an empty list.
- **Known gap carried forward from #30, not newly introduced:** `getCandleData` calls are not routed through `AngelOneSession`'s own rate-limit gate (only `generateSession`/`generateToken` are) — same documented gap as `AngelOnePlugin`. Not fixed here; out of scope for this spec, same reasoning as #30.
- **Credential-loading must follow #30's lazy pattern, not repeat its original mistake.** `AngelOneEquityPlugin.__init__` must defer `AngelOneCredentials.from_env()` failures the same way #30's `AngelOnePlugin` does (try/except `KeyError`, fall back to `None` session, retry lazily in `fetch()`) — `PluginRegistry` eagerly constructs every plugin at startup, so a hard failure here would crash NSE/BSE resolution entirely in any environment without Angel One credentials set, exactly the bug #30 already found and fixed once.

## Design Decision 3 — manifest supports a list value, `registry.py` builds a `FallbackPlugin` when it sees one

**Decision:** `plugins.yaml` value becomes either a single string (unchanged behavior, current 6 lines) or a YAML list (new):
```yaml
NSE: [forecasting_agent.data_server.plugins.angelone_equity, forecasting_agent.data_server.plugins.nse]
BSE: [forecasting_agent.data_server.plugins.angelone_equity, forecasting_agent.data_server.plugins.nse]
NFO: forecasting_agent.data_server.plugins.angelone
BFO: forecasting_agent.data_server.plugins.angelone
CDS: forecasting_agent.data_server.plugins.angelone
MCX: forecasting_agent.data_server.plugins.angelone
```
`PluginRegistry._load_plugins` checks `isinstance(target, list)`: if a list, instantiate each target module's plugin and wrap them in a `FallbackPlugin` in list order; if a string, behave exactly as today (unchanged code path for NFO/BFO/CDS/MCX).
- **Pros:** the only registry-level change; every other market's behavior is byte-for-byte unchanged. Backwards compatible with the existing manifest format.
- **Cons:** `registry.py` (currently untouched by #30) gets its first real logic branch — worth being deliberate about, since this file has no dedicated test file today (`test_pipeline_integration.py` exercises it indirectly). New test file `test_registry_fallback.py` required.
- **Where it fits:** exactly this — a manifest-driven registry that already has the "one target string" contract; extending to "target string or list of strings" is the minimal generalization, not a rewrite.
- **Where it doesn't fit:** N/A — this is the registry's actual job (resolve market → plugin), the change is additive to that job, not a scope change.

## Structure

```
src/forecasting_agent/data_server/
  plugins.yaml                       NSE/BSE -> [angelone_equity, nse]; NFO/BFO/CDS/MCX unchanged
  registry.py                        + list-value branch in _load_plugins, wraps in FallbackPlugin
  plugins/
    angelone_equity.py               AngelOneEquityPlugin(MarketPlugin) -- NSE/BSE via Angel One
    fallback.py                      FallbackPlugin(MarketPlugin) -- generic ordered-list wrapper
tests/data_server/
  test_angelone_equity_plugin.py     symbol translation (NSE/BSE), fetch mapping, empty response
  test_fallback_plugin.py            primary succeeds (no fallback call); primary fails, falls back,
                                      logs a warning; both fail, raises the last exception
  test_registry_fallback.py          plugins.yaml list value -> FallbackPlugin; string value unchanged
```

## Out of Scope

Real-time/streaming for equities (same Phase 2 deferral as #30) · a 3rd equity source · touching `NsePlugin`/`nse.py` itself (reused unmodified) · touching NFO/BFO/CDS/MCX's registration (single-source, no wrapper).

## Review

**R1 — `CHANGES REQUESTED`.** First pass covered symbol translation, `FallbackPlugin`, and the registry change, but left three real gaps unaddressed: (1) didn't specify that fallback triggers on exception only, not on a legitimate empty result — an unflagged version would have made "no data for this range" indistinguishable from "Angel One is broken," silently double-fetching from yfinance every time. (2) Didn't carry forward #30's known rate-limiter gap explicitly. (3) Didn't specify the lazy-credential pattern `AngelOneEquityPlugin` must follow — omitting it would reintroduce the exact `PluginRegistry`-crashes-on-missing-credentials bug #30 already found and fixed once. Fixed: all three now stated explicitly above.

**R2 (this pass) — `APPROVED`.** Fresh re-read: symbol translation verified against live data for both exchanges (not assumed); fallback-vs-empty-result distinction now explicit; rate-limiter gap and credential-loading pattern both carried forward deliberately, not silently dropped; registry change confirmed additive and backwards-compatible by re-reading `_load_plugins`' existing string-path logic line by line — no other market's behavior changes. No blockers, no open decisions.

Given the underlying risk surface (session auth, credential handling, Bearer-token bug, rate limiting) was already the subject of #30's full 6-round review and is reused here unmodified, this spec's actually-new surface (symbol translation, the fallback wrapper, the registry branch) is narrow enough that two rounds — not six — is proportionate, not a shortcut. **Converged.**

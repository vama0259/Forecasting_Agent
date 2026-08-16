---
type: adr
date: 2026-08-17
status: decided
parent: "[[Forecasting Agent]]"
---

# Angel One SmartAPI — Historical OHLCV Plugin (Phase 1) — Design Spec

**Story:** GitHub #30 — Angel One SmartAPI connector (F&O/currency/commodity OHLCV)
**Implements:** extends ADR-006's `MarketPlugin` contract (no interface change) with a second concrete plugin
**Depends on:** #5 (merged) — `data_server/` plugin architecture already in place
**Vault decision this builds on:** `Projects/Forecasting Agent/Kanban.md`, 2026-08-15 — Angel One scoped **data-only, no order placement**
**Not #20:** #20 ("Indian Moat Connectors: flows, microstructure, macro_in") needs FII/DII flow data, delivery %, and RBI macro series sourced from the Point-in-Time Observation Archive (#19) — a different data type, archive-sourced not live-API-sourced. Corrected during review (round 4) after reading #20's actual acceptance criteria directly rather than relying on the vault's 2026-08-15 note, which itself flagged this as undecided ("scope... not yet decided — revisit"). This spec does not close #20; #30 tracks it instead.

## Scope

**Phase 1 only** (this spec): a new `AngelOnePlugin` implementing the existing `MarketPlugin.fetch()` contract, sourcing daily historical OHLCV for NFO, BFO, CDS, and MCX — the four segments `NsePlugin`/yfinance cannot serve at all today. Registered under new market keys in `plugins.yaml`; `NsePlugin` and its NSE/BSE equity keys are untouched.

**Empty/missing data:** `AngelOnePlugin.fetch()` returns `[]` on an empty or missing candle response (holiday, invalid range, no data for that `symboltoken`) — same contract `NsePlugin.fetch()` already uses for an empty yfinance frame, kept symmetric across both plugins so callers above the registry don't need per-plugin empty-handling.

**Explicitly deferred, not built here:** real-time WebSocket streaming (LTP/OHLC/Full modes), 5-level market depth, and per-instrument Open Interest + Greeks. Reason: `MarketPlugin.fetch(symbol, start, end) -> list[OHLCVBar]` is a synchronous, stateless, date-range call — it has no shape for a persistent stream, a depth snapshot, or an OI+Greeks record. Forcing streaming through this interface would mean widening the ABC (breaking `NsePlugin`'s contract) or bolting an unrelated capability onto a plugin whose registry-level identity is "one `fetch()` per market." That's a second interface (`MarketStream` or similar) and a second registry path — a separate design decision with its own review loop, not a rider on this one. Flagging so the deferral is recorded, not lost.

**Order placement:** never in scope, in this spec or any future one, per the 2026-08-15 vault decision. Angel One's single API key grants order-management access at the credential level — Section "Order-placement boundary" below covers how this spec enforces "never used" as a code-level guarantee anyway, not just a policy statement.

## Verified facts (evidence, not memory — Iron Law)

Checked live against angel-one's own SDK repo, PyPI, and SmartAPI community/forum posts (WebSearch, 2026-08-17; the smartapi.angelbroking.com docs pages themselves are a JS SPA that WebFetch cannot render, so verification went through the SDK source and forum instead):

| Claim | Evidence |
|---|---|
| `smartapi-python` package exists, name/version | `pypi.org/pypi/smartapi-python/json` → `1.5.5`. |
| `pyotp` package exists, name/version | `pypi.org/pypi/pyotp/json` → `PyOTP 2.10.0`, `requires_python >=3.8` — compatible with this repo's pinned 3.12. |
| **`smartapi-python`'s PyPI `requires_dist` under-declares its real dependencies — caught by actually installing it, not by reading metadata.** | Built a scratch venv, `uv pip install smartapi-python pyotp`, then `import SmartApi` — **failed twice**: first `ModuleNotFoundError: No module named 'logzero'`, then after adding it, `ModuleNotFoundError: No module named 'websocket'` (from `websocket-client`). Both are hard, top-level, unconditional imports in `SmartApi/__init__.py`'s import chain (`smartConnect.py` imports `logzero`; `smartApiWebsocket.py`, imported unconditionally even though this spec never uses it, imports `websocket`) — **you cannot `import SmartApi` at all without both installed**, regardless of whether streaming is used. PyPI's declared `requires_dist` (`requests`, `six`, `python-dateutil`) is incomplete. This is exactly the "declared dependencies weren't actually verified" failure class CLAUDE.md's Gemini-delegation section warns about — catching it here, before any implementation, not after a broken `import`. |
| Login call shape | Read `SmartConnect.generateSession` source directly (installed package, not README): `generateSession(self, clientCode, password, totp)` → POSTs `{"clientcode", "password", "totp"}`, and on success sets **and returns** `jwtToken`, `refreshToken`, **and `feedToken` together** in one call (`user['data']['feedToken']` is set inline). Correction from an earlier README-search summary that claimed `feedToken` needed a separate `getfeedToken()` network call — reading the source shows `getfeedToken()` is a plain accessor for the value `generateSession` already stored, not a second request. |
| **SDK error-handling contract — verified by reading `_request`/`generateToken` source, not assumed.** | `SmartConnect._request` only **raises** when the response carries a specific `error_type` (`TokenException`, `InputException`, etc. — enumerated in `SmartApi.smartExceptions`); a plain `{"status": false, "message": ...}` failure response is **returned normally, not raised** — callers must check `response["status"]` themselves. Separately, `generateToken(refresh_token)` (the intraday refresh call) does **not** check `status` before indexing — it does `response['data']['jwtToken']` unconditionally, so an expired/invalid `refreshToken` raises a raw, undocumented `KeyError`, not a clean SDK exception. `AngelOneSession`'s refresh path must catch this (`KeyError` or a `status`-check before calling `generateToken` isn't possible since the SDK itself doesn't pre-check) and fall back to a full TOTP re-login rather than let a `KeyError` escape to `fetch()`'s caller. |
| Request timeout | `SmartConnect.__init__`: `self.timeout = timeout or self._default_timeout`, and `_default_timeout = 7` (seconds), passed to every `requests.request(...)` call — confirmed no unbounded network call exists in the SDK's HTTP path. |
| Historical candle call shape | `SmartConnect.getCandleData(historicDataParams)` → POSTs the dict as-is to `/rest/secure/angelbroking/historical/v1/getCandleData`; verified route path directly from `SmartConnect._routes`. Expected keys (from source + forum examples): `exchange`, `symboltoken`, `interval`, `fromdate`, `todate` — **requires a numeric `symboltoken`, not a bare symbol string.** This is the single biggest interface gap vs. `NsePlugin` (see "Symbol resolution" below). |
| Historic API rate limit | SmartAPI forum ("Changes in API Rate Limit"): **3 requests/second** on the historic endpoint. |
| Historic API date-range cap | Forum/marketcalls.in writeup: `ONE_DAY` interval capped at **2000 candles per request** — matches the vault's "up to 2000 days" note, confirming that note as accurate, not aspirational. |
| Historical data now free | SmartAPI forum release note, "Free Historical Data Access for Indices, NSE, NFO, BSE, BFO, MCX, and CDS with SmartAPI" — confirms all six target segments are covered under the free tier, no separate paid subscription blocking this. |
| Instrument master (symbol → token mapping) — **downloaded and parsed the live file directly**, not taken from a forum description | `margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json`, fetched 2026-08-17: 155,399 records. Confirmed exact field names from real rows: `token` (→ `symboltoken` for `getCandleData`), `symbol` (the tradingsymbol string, e.g. `"SBIN-EQ"`, `"NIFTY25AUG26FUT"`, `"SENSEX27MAR74000PE"`), `exch_seg` (exchange segment string), `name` (underlying, e.g. `"NIFTY"` — unused by Phase 1's lookup, kept for a possible future "list contracts for underlying" feature, not built here). **Confirmed `exch_seg` values present in the live file, verbatim, resolving Decision 1's market-key naming as a checked fact rather than a forum-title inference:** `NSE` (9,920 rows), `BSE` (12,868), `NFO` (35,282), `BFO` (40,880), `CDS` (9,812), `MCX` (17,115) — plus `NCDEX`/`NCO`, out of scope. All four of this spec's target codes (`NFO`/`BFO`/`CDS`/`MCX`) match exactly. No query API; the whole file is downloaded and searched client-side. |
| TOTP is a separate enablement step from API key creation | `smartapi.angelbroking.com/enable-totp` — client code + trading password/MPIN + email/SMS OTP → produces a QR code and a base32 **TOTP seed** to feed `pyotp.TOTP(seed).now()`. This is **not** the "Trading and API key" the user already has from the app-registration dashboard — it's a separate secret. **Open precondition, not a design decision:** confirm this has been done and the seed is saved before implementation starts, or `generateSession` will fail at the first real call regardless of how correct the code is. |
| Session/token validity | SmartAPI forum ("token's validity period"): `jwtToken` valid ~2.5 hours; the whole session (regardless of refresh) is invalidated at midnight server time; `refreshToken` can mint a new `jwtToken` intraday via a separate `generateToken` call without redoing TOTP. Drives the session-refresh design below. |

## Design Decision 1 — New market keys, not a replacement of NSE/BSE

**Decision:** register `AngelOnePlugin` under four new `plugins.yaml` keys — `NFO`, `BFO`, `CDS`, `MCX` — pointing at a new `forecasting_agent.data_server.plugins.angelone` module. `NSE`/`BSE` keep pointing at `NsePlugin` (yfinance), unchanged.

- **Pros:** zero risk to the working, zero-auth, zero-cost equity path (`NsePlugin`); closes yfinance's F&O/currency/commodity coverage gap for Indian markets (tracked as #30, not #20 — see header); additive registry change (`registry.py`'s `_load_plugins` already supports N keys → 1 module or N keys → N modules with no code change needed, verified by reading `registry.py` directly).
- **Cons:** two different data sources for "Indian markets" now live side by side (yfinance for cash equities, Angel One for derivatives/commodities/currency) — a caller asking "give me NSE equity OHLCV" and "give me NIFTY futures OHLCV" gets routed through two completely different auth/rate-limit/reliability profiles, which the registry's flat `market -> plugin` mapping doesn't surface as a distinction to the caller.
- **Where it fits:** any story that's explicitly scoped to live F&O/commodity/currency price data for Indian markets (this one, #30).
- **Where it doesn't fit:** a future story that wants NSE *cash equities* switched to Angel One too (e.g., for OI-adjacent equity data Angel One has and yfinance doesn't) — that would need its own spec, since it changes an already-working, already-tested path (`NsePlugin` + `test_nse_plugin.py` + `test_pipeline_integration.py`), not an empty one.

## Design Decision 2 — Auth/session as a composed helper, not baked into the plugin

**Decision:** `AngelOnePlugin` holds an `AngelOneSession` instance (composition); the plugin never calls `generateSession`/`generateToken` itself, only asks the session object for a valid `jwtToken`.

```python
class AngelOneSession:
    def __init__(self, credentials: AngelOneCredentials) -> None: ...
    def get_valid_token(self) -> str:
        """Return a jwtToken, refreshing or re-logging-in as needed. Never raises with a secret in the message."""
```

- **Pros (Single Responsibility, testability):** `AngelOnePlugin.fetch()` stays a thin translation (symbol → token, call candle API, map rows → `OHLCVBar`) that unit-tests exactly like `NsePlugin.fetch()` does today (mock the session, assert on bars) — `test_nse_plugin.py`'s pattern (`@patch(".yf.download")`) carries over as `@patch(".AngelOneSession.get_valid_token")`. Session refresh/midnight-expiry logic gets its own isolated tests without needing a fake HTTP candle response for every auth-path test case.
- **Cons:** one more class/file than the minimum possible (`nse.py` has zero auth surface, this needs `angelone.py` + `angelone_session.py` or equivalent — not a single-file plugin).
- **Where it fits:** any external API with a login/token lifecycle independent of the per-call data shape — exactly this case.
- **Where it doesn't fit:** stateless, keyless APIs (yfinance) — which is why `NsePlugin` correctly has no such class and shouldn't grow one to "match."
- **Error-handling contract — required because the SDK's own error handling has two gaps, both confirmed against the installed source:** (1) the SDK raises exceptions only for a specific set of `error_type` values (`TokenException`, `InputException`, …) — a plain `{"status": false, ...}` failure response is returned normally, not raised, so `AngelOneSession` must check `response["status"]` after every `generateSession`/`getCandleData` call itself, not rely on a try/except. (2) `generateToken` (the intraday refresh call) indexes `response['data']['jwtToken']` with no `status` guard at all — an expired/invalid `refreshToken` makes it raise a raw `KeyError`. `AngelOneSession.get_valid_token()` must catch that `KeyError` specifically on the refresh path and treat it as "refresh failed" → fall through to a full TOTP `generateSession` re-login, not let the `KeyError` propagate out of `fetch()`. Two different failures (soft `status:false` vs. a bare `KeyError`) get normalized to the same internal "refresh invalid, re-login" outcome — they should not surface as different exception types to `AngelOnePlugin.fetch()`'s caller, since both have the identical correct response (re-authenticate). Any exception `AngelOneSession` raises on a hard auth failure (e.g. bad MPIN on the fallback re-login, not just an expired refresh) must use the SDK's own `response["message"]` string verbatim — never interpolate `credentials.mpin`/`credentials.totp_secret`/`credentials.api_key` into a custom message, which is the concrete way "the error message leaks a secret" checklist item would bite here.
- **Registry interaction — verified, not assumed:** `PluginRegistry._load_plugins` instantiates one plugin instance **per unique `plugins.yaml` target string** and reuses it across all market keys pointing at that target (`module_instances` dict, read directly in `registry.py`). Four keys → one module target means **one `AngelOnePlugin` instance, one `AngelOneSession`, one login** for the process lifetime — not four logins. This matters because Angel One's own TOTP-based login is a stateful, rate-limited action in itself; the registry's existing caching behavior is what makes "log in once, reuse across NFO/BFO/CDS/MCX" free, with no extra code.

## Design Decision 3 — Symbol resolution via a cached instrument-master lookup

**Problem:** `getCandleData` needs `(exchange, symboltoken)`, not a symbol string. `NsePlugin.supports()`/`fetch()` never had to resolve anything — yfinance takes the ticker directly.

**Decision:** a small `AngelOneInstrumentMaster` helper, owned by `AngelOnePlugin`, that:
1. Downloads `OpenAPIScripMaster.json` lazily on first use via `httpx.get(url, timeout=30)` — **explicit timeout required**, since this is a raw HTTP call this spec writes itself (not routed through `SmartConnect`, which has its own 7s default only for SmartAPI's own endpoints) and a large file over a slow connection is exactly the "network call without a timeout hangs forever" failure mode the review checklist flags. `httpx` chosen over adding `requests`: `httpx>=0.28.0` is already declared in this repo's `pyproject.toml` — **but caught on this re-read: only in the `dev` dependency-group** (installed for testing, e.g. an MCP test client), **not** `[project.dependencies]` (the runtime set). `angelone_instruments.py` calling `httpx.get(...)` at runtime means `httpx` must move to `[project.dependencies]`, not just be referenced as if already available there — a production install (`uv sync --no-dev` or equivalent) currently would not have it. Still the right call over adding `requests` as a second HTTP client for one GET call, just requires this one-line `pyproject.toml` promotion, not a new dependency. Caches the parsed table in memory for the process lifetime (it's a large, slow-changing file — re-downloading per call would blow the 3 req/s limit before the actual candle call even runs).
2. Exposes `resolve(tradingsymbol: str, exchange: str) -> str` — looks up the row where `symbol == tradingsymbol and exch_seg == exchange` and returns its `token` field (the exact `symboltoken` value `getCandleData` needs — field names confirmed against the live file, not assumed), raising a plugin-local `SymbolNotFoundError` if absent.
3. **Symbol contract for this plugin:** callers pass Angel One's own `symbol` string exactly as it appears in the instrument master (real examples pulled directly from the live file: `"NIFTY25AUG26FUT"` for an NFO future, `"SENSEX27MAR74000PE"` for a BFO option), not a synthesized format. `supports()` narrows by exchange-appropriate suffix (`FUT`/`CE`/`PE` for NFO/BFO, currency-pair patterns for CDS, commodity patterns for MCX) as a fast pre-check before the (slower) instrument-master lookup runs.

- **Pros:** no guessing at a symbol-translation scheme; matches what Angel One itself publishes, so a caller can copy a `tradingsymbol` straight from Angel One's own docs/UI and it works.
- **Cons:** callers of this plugin need Angel-One-shaped symbols, not the human-friendly shape `NsePlugin` accepts (`RELIANCE.NS`) — an inconsistency across plugins in the same registry that any orchestration code above the registry needs to be aware of (worth a follow-up: a `resolve_symbol` normalization layer at the MCP-server tool-surface level, already named in the existing `market-data-mcp-server-design.md` ADR's `resolve_symbol(symbol, market)` tool — that tool is the right seam to hide this difference, not something this plugin should try to paper over itself).
- **Where it fits:** exchanges whose own instrument identity *is* the token/symbol pair (most Indian broker APIs).
- **Where it doesn't fit:** don't extend this pattern to `NsePlugin` — yfinance's suffix scheme is simpler and already works; changing it to match Angel One's shape "for consistency" would be a regression for no benefit (ponytail: don't unify two working, different things because they're now adjacent in the same file tree).

## Design Decision 4 — Credentials via environment, single frozen dataclass

```python
@dataclass(frozen=True)
class AngelOneCredentials:
    api_key: str
    client_code: str
    mpin: str
    totp_secret: str

    @classmethod
    def from_env(cls) -> "AngelOneCredentials": ...  # ANGELONE_API_KEY / _CLIENT_CODE / _MPIN / _TOTP_SECRET
```

- **Pros:** matches the repo's existing secret-handling convention (`harness/.env.example` documents var names, not values); one read-once construction point means credentials never get threaded through call sites as loose strings; a frozen dataclass can't be mutated mid-session.
- **Cons:** four required env vars is more setup friction than `NsePlugin`'s zero — unavoidable given Angel One requires all four for `generateSession`.
- **Where it fits:** any plugin needing multi-factor credentials at construction time.
- **Where it doesn't fit:** N/A for this repo's other plugins today.
- **Action needed:** no root `.env` exists yet (only `harness/.env.example` for the TS harness's `LLM_API_KEY`). This spec adds a root-level `.env.example` (Python side) documenting the four `ANGELONE_*` var names with no values, and root `.env` stays gitignored (already covered by the repo's existing `.gitignore` pattern for `.env` — verify at implementation time, not assumed here). **The actual key/MPIN/TOTP seed values are never pasted into chat, code, or committed files** — the user enters them directly into `.env` locally.

## Credential-leak mitigation — Blocker-severity finding, fixed here (verified, not assumed)

Reading `SmartConnect._request`'s source (installed package) shows: on **any** `{"status": false}` response — a mistyped MPIN, an expired TOTP, a transient network blip, anything — it unconditionally calls `logger.error(f"... Request: {params} ...")`, where `params` for the login call is the raw `{"clientcode", "password": <plaintext MPIN>, "totp": <plaintext code>}` dict. That `logger` is `logzero`'s shared, module-level default logger (`from logzero import logger` — confirmed in the source header), which by default writes to **stderr** with no redaction. Reproduced directly: called `logger.error(...)` with a fake `mpin=1234 totp=999999` string and watched it print. This is a real credential-leak path in the third-party SDK, not hypothetical — and this repo has Langfuse tracing wired into the harness (recent commits group runs into traces), so anything landing on stderr during a traced run risks being swept into observability infra, not just a local terminal.

**Fix (tested, not assumed):** `AngelOneSession.__init__` calls `logzero.loglevel(logging.CRITICAL + 1)` before constructing any `SmartConnect` instance — this silences the shared `logzero` default logger process-wide. Verified directly: re-ran the same `logger.error(...)` call after setting the level and confirmed nothing printed. This is a global side effect on a third-party library's shared logger (not scoped to just this plugin's calls), which is worth stating plainly rather than leaving implicit — acceptable here because (a) nothing else in this repo imports `logzero` (checked: not in `pyproject.toml` today, this spec is what introduces it), and (b) the alternative — leaving a plaintext-MPIN log line reachable — is strictly worse. If a future dependency also uses `logzero` and needs its own log output, this decision will need revisiting; flagging so it isn't a silent global mutation nobody remembers making.

## Design Decision 5 — Order-placement boundary enforced by omission, not by credential scope

Angel One issues **one** API key per app; there is no "market-data-only, no-orders" key tier — confirmed by the user's own dashboard showing a single "Trading and API key" (not two separate keys). The boundary the vault decided on (2026-08-15: "data-only, no order placement") therefore cannot be enforced by what the credential *can* do — it can do orders. It's enforced by what this code *ever calls*.

- **Decision:** `AngelOneSession`/`AngelOnePlugin` implement and expose exactly the calls this spec needs (`generateSession`, `generateToken`, `getCandleData`, instrument-master HTTP GET) and nothing else. No `placeOrder`/`modifyOrder`/`cancelOrder`/`getOrderBook`/`getPosition` wrapper is written, imported, or reachable from any code path in `plugins/angelone*.py`. This is a grep-able, code-review-able guarantee ("does this module import or reference any order-management SmartConnect method — no"), not a runtime permission check, because there is no runtime permission to check against.
- **Pros:** simple, verifiable by reading the file; no false sense of security from a credential-scoping mechanism that doesn't exist.
- **Cons:** it's a code-discipline guarantee, not a platform-enforced one — a future PR *could* add an order call without anything stopping it at the credential layer. Mitigation: this is exactly what `reviewing-specs`'/code-review's checklist should flag on any diff touching `plugins/angelone*.py` going forward — noted here so it isn't a silent expectation.
- **Where it fits:** single-key platforms where the "don't do X" boundary is a software policy, not infrastructure.
- **Where it doesn't fit:** platforms offering scoped/restricted keys — there, scope the key, don't rely on code discipline alone.

## Design Decision 6 — Rate limiting at the session, not the plugin

3 req/s is a hard external constraint (verified above), and a single `AngelOnePlugin` instance is shared across 4 market keys (Decision 2) — meaning a caller looping `fetch()` across NFO+BFO+CDS+MCX symbols shares one limiter, correctly.

- **Decision:** `AngelOneSession` owns a simple monotonic-clock token-bucket/sleep gate (`time.monotonic()`-based, no new dependency) wrapping every outbound HTTP call it makes (`generateSession`, `generateToken`, `getCandleData`). Not per-plugin-instance, not per-call-site — one gate, one shared instance, because that's the actual shape of the external constraint.
- **Pros:** correct by construction — impossible for two `fetch()` calls in the same process to jointly exceed 3 req/s, since they share the same session object.
- **Cons:** adds a small synchronization surface if this code is ever called from concurrent tasks/threads (not the case today — `fetch()` is called synchronously per the existing `MarketPlugin` contract; flagging as a future constraint, not building thread-safety now that nothing exercises it — YAGNI, per `/ponytail`).
- **Where it fits:** any single-process caller respecting a shared external rate limit.
- **Where it doesn't fit:** multi-process/distributed callers — would need a shared external limiter (Redis token bucket, etc.), explicitly out of scope (no Redis infra exists yet, same reasoning the M1 spec used to defer Redis caching).

## Structure

```
src/forecasting_agent/data_server/
  plugins.yaml                    + NFO/BFO/CDS/MCX -> forecasting_agent.data_server.plugins.angelone
  plugins/
    angelone.py                  AngelOnePlugin(MarketPlugin) — supports(), symbol_pattern, fetch()
    angelone_session.py          AngelOneCredentials, AngelOneSession (login/refresh/rate-limit)
    angelone_instruments.py      AngelOneInstrumentMaster (download/cache/resolve symboltoken)
tests/data_server/
  test_angelone_plugin.py        fetch() mapping, supports(), mirrors test_nse_plugin.py's mock-boundary pattern
  test_angelone_session.py       login, midnight-expiry-forces-relogin, jwtToken-refresh-reuses-refreshToken, rate-limit gate
  test_angelone_instruments.py   resolve() hit/miss, cache-not-re-fetched-on-second-call
.env.example                     (new, root-level, Python side) ANGELONE_API_KEY / _CLIENT_CODE / _MPIN / _TOTP_SECRET (names only)
pyproject.toml                   [project.dependencies] + smartapi-python>=1.5.5, pyotp>=2.10.0, logzero, websocket-client
                                  (logzero/websocket-client: undeclared-but-required transitive imports of
                                  smartapi-python — see evidence table; pin explicitly, don't rely on it resolving them)
                                  ALSO move httpx>=0.28.0 from [dependency-groups].dev to [project.dependencies]
                                  (angelone_instruments.py uses it at runtime, not just in tests — see Decision 3)
```

`.importlinter`'s existing `plugins-isolation` contract (`plugins` forbidden from importing `registry`/`server`/`cleaner`/`normalizer`/`point_in_time`/`cache`) is satisfied unchanged — `angelone.py`/`angelone_session.py`/`angelone_instruments.py` only import `contracts.py`, `plugins/base.py`, and third-party libs (`smartapi-python`, `pyotp`, `httpx`), same as `nse.py` does for `yfinance`. No new contract needed; verified by reading `.importlinter` directly (shown above in context).

## Open questions for the user (frontier — not decided here)

1. **Has the separate TOTP-enablement step (`smartapi.angelbroking.com/enable-totp`) already been done, and is the TOTP seed saved?** This is independent of the "Trading and API key" already obtained. Recommendation: confirm before implementation starts — if not done, that's a 5-minute manual step to do first, not a code problem. This is the only remaining open item — it's an operational precondition, not something this spec can resolve by more research.

~~2. Market-key naming (`NFO`/`BFO`/`CDS`/`MCX`)~~ — **resolved during review, no longer open.** Originally flagged as a judgment call; downgraded to a verified fact after downloading and parsing the live `OpenAPIScripMaster.json` directly and confirming these four strings are Angel One's own `exch_seg` values, verbatim, in their own data (see evidence table). Not a naming choice this spec is making — it's copying Angel One's canonical codes.

---
**Review history (inline `reviewing-specs`, per this repo's Token-efficiency mode):**
- Round 1: Blocker (SDK's default `logzero` logger leaks plaintext MPIN on any failed-login response — fixed, tested) + Highs (under-declared transitive deps `logzero`/`websocket-client`; incorrect `feedToken` claim from a README summary vs. actual source) — all fixed.
- Round 2: Medium (`httpx` only in the `dev` dependency-group, not runtime) — fixed.
- Round 3: Medium (exception messages must use the SDK's own message, never interpolate credentials) + resolved an open question (market-key naming, via downloading and parsing the live instrument master) — fixed.
- Round 4: Low (stale `requests` reference after the `httpx` switch) + **Blocker-class scope error, caught by reading #20's actual acceptance criteria instead of trusting the vault's own paraphrase of it** — this spec had mis-attributed itself to GitHub #20, which asks for FII/DII flows, delivery %, and RBI macro data sourced from the observation archive, not live OHLCV from a broker API. Fixed: re-attributed to new issue #30, `Not #20` note added to the header, "closes #20" language removed throughout.
- Round 5: fresh full re-read, zero new findings — **first `APPROVED`.**
- Round 6 (this pass): fresh full re-read, zero new findings — **second consecutive `APPROVED`.**

**Verdict: APPROVED. Converged — ready for `writing-plans`.**

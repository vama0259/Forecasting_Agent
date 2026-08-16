# Angel One SmartAPI Connector (#30) Implementation Plan

> **For agentic workers:** implementation goes to Gemini via `agy` (`gemini-delegated-implementation`), one task at a time, verified **inline, cold** after each task — Gemini's own "tests pass" self-report is never accepted on its own (CLAUDE.md's documented Gemini quality-gap history). Do not run tests yourself while building this plan; each task carries the exact test that must go red before Gemini touches it, and green after.

**Goal:** Add `AngelOnePlugin`, a second `MarketPlugin`, sourcing daily historical OHLCV for NFO/BFO/CDS/MCX from Angel One SmartAPI — the segments yfinance/`NsePlugin` cannot serve. `NsePlugin` and NSE/BSE are untouched.

**Spec:** `docs/superpowers/specs/2026-08-17-angelone-historical-plugin-design.md` (two consecutive `APPROVED` via inline `reviewing-specs`) — read Decisions 1–6 and the Credential-leak Mitigation section before touching any task; this plan cites them by number, does not restate them.

**Tech Stack:** Python 3.12, `smartapi-python`, `pyotp`, `httpx`, `pytest`/`unittest.mock`, existing `data_server` plugin architecture.

## Global Constraints

- Every new file gets a one-line top-of-file abstract comment; every function/class gets a one-line input/output comment. No multi-line docstrings (CLAUDE.md hard rule).
- `uv run ruff check . && uv run ruff format --check . && uv run mypy src/ tests/` and `uv run bandit -r src/ -c pyproject.toml` must pass after every task.
- `uv run import-linter` must pass after every task — `plugins-isolation` contract forbids `plugins/` importing `registry.py`/`server.py`/`cleaner.py`/`normalizer.py`/`point_in_time.py`/`cache.py` (spec Structure section).
- No task pushes, opens a PR, or touches the Obsidian vault — happens after Task 5's real-system verification, on explicit go-ahead.
- All tests mock the SDK boundary (`SmartConnect`, `httpx.get`) — never call the real Angel One API from a `pytest` run. The one and only real-API call in this whole plan is Task 5's manual, one-off smoke test, run by the plan's executor directly, not as part of `pytest`.
- `.env` already exists at repo root with real `ANGELONE_*` values (confirmed set, 2026-08-17) — no task pastes or logs these values anywhere.

---

## Task 1: Dependencies — `pyproject.toml`

**Files:**
- Modify: `pyproject.toml`

**Interfaces:**
- Produces: `smartapi-python`, `pyotp`, `logzero`, `websocket-client`, `httpx` all importable from the main (non-dev) environment — everything Task 2–4 import by name.

- [ ] **Step 1: Edit `[project].dependencies`**

Add to the existing list (spec Structure section, evidence table rows on undeclared transitive deps):

```toml
dependencies = [
    "mcp[cli]>=1.24.0,<2.0.0",
    "numpy>=2.5.2",
    "pandas",
    "pyarrow",
    "pydantic>=2.13",
    "scikit-learn>=1.7",
    "yfinance>=1.6.0",
    "smartapi-python>=1.5.5",
    "pyotp>=2.10.0",
    "logzero",
    "websocket-client",
    "httpx>=0.28.0",
]
```

- [ ] **Step 2: Remove `httpx` from `[dependency-groups].dev`** (now in main deps, don't declare it twice)

- [ ] **Step 3: Sync and verify real import**

```bash
uv sync
uv run python -c "from SmartApi import SmartConnect; import pyotp, httpx; print('OK')"
```

Expected: `OK`, zero `ModuleNotFoundError`. This is the same check that caught the undeclared `logzero`/`websocket-client` deps during spec review — confirming it holds in the real repo venv, not just the scratch one used for verification.

- [ ] **Step 4: Full check gate**

```bash
make check
```

Expected: clean (lint, mypy, bandit, import-linter all pass — no source files changed yet, this just confirms the dependency bump alone doesn't break anything).

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "chore: add smartapi-python, pyotp, logzero, websocket-client deps; move httpx to main (#30)"
```

---

## Task 2: `AngelOneCredentials` + `AngelOneInstrumentMaster`

**Files:**
- Create: `src/forecasting_agent/data_server/plugins/angelone_credentials.py`
- Create: `src/forecasting_agent/data_server/plugins/angelone_instruments.py`
- Test: `tests/data_server/test_angelone_credentials.py`
- Test: `tests/data_server/test_angelone_instruments.py`

**Interfaces:**
- Consumes: `contracts.py` — none directly (no Pydantic model needed for these two; plain dataclass + plain lookup table).
- Produces: `AngelOneCredentials(api_key, client_code, mpin, totp_secret)` frozen dataclass, `.from_env()` classmethod (spec Decision 4). `AngelOneInstrumentMaster` — `resolve(tradingsymbol: str, exchange: str) -> str`, raises `SymbolNotFoundError` (spec Decision 3). Both consumed by Task 3/4.

- [ ] **Step 1: Write the failing tests**

```python
# tests/data_server/test_angelone_credentials.py
import pytest


def test_from_env_reads_all_four_vars(monkeypatch):
    from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials

    monkeypatch.setenv("ANGELONE_API_KEY", "k")
    monkeypatch.setenv("ANGELONE_CLIENT_CODE", "c")
    monkeypatch.setenv("ANGELONE_MPIN", "1234")
    monkeypatch.setenv("ANGELONE_TOTP_SECRET", "s")

    creds = AngelOneCredentials.from_env()
    assert creds.api_key == "k"
    assert creds.client_code == "c"
    assert creds.mpin == "1234"
    assert creds.totp_secret == "s"


def test_from_env_raises_on_missing_var(monkeypatch):
    from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials

    monkeypatch.delenv("ANGELONE_API_KEY", raising=False)
    with pytest.raises(KeyError):
        AngelOneCredentials.from_env()


def test_credentials_is_frozen():
    from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials

    creds = AngelOneCredentials(api_key="k", client_code="c", mpin="1234", totp_secret="s")
    with pytest.raises(AttributeError):
        creds.api_key = "changed"  # type: ignore[misc]
```

```python
# tests/data_server/test_angelone_instruments.py
from unittest.mock import MagicMock, patch

import pytest


def _fake_response(rows):
    resp = MagicMock()
    resp.json.return_value = rows
    resp.raise_for_status.return_value = None
    return resp


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_resolve_hit_returns_token(mock_get):
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response(
        [{"token": "58072", "symbol": "NIFTY25AUG26FUT", "exch_seg": "NFO", "name": "NIFTY"}]
    )
    master = AngelOneInstrumentMaster()
    assert master.resolve("NIFTY25AUG26FUT", "NFO") == "58072"


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_resolve_miss_raises_symbol_not_found(mock_get):
    from forecasting_agent.data_server.plugins.angelone_instruments import (
        AngelOneInstrumentMaster,
        SymbolNotFoundError,
    )

    mock_get.return_value = _fake_response([{"token": "1", "symbol": "OTHER", "exch_seg": "NFO", "name": "X"}])
    master = AngelOneInstrumentMaster()
    with pytest.raises(SymbolNotFoundError):
        master.resolve("NIFTY25AUG26FUT", "NFO")


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_second_resolve_call_does_not_refetch(mock_get):
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response(
        [{"token": "58072", "symbol": "NIFTY25AUG26FUT", "exch_seg": "NFO", "name": "NIFTY"}]
    )
    master = AngelOneInstrumentMaster()
    master.resolve("NIFTY25AUG26FUT", "NFO")
    master.resolve("NIFTY25AUG26FUT", "NFO")
    assert mock_get.call_count == 1


@patch("forecasting_agent.data_server.plugins.angelone_instruments.httpx.get")
def test_get_called_with_explicit_timeout(mock_get):
    from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster

    mock_get.return_value = _fake_response([])
    AngelOneInstrumentMaster().resolve("X", "NFO")  # triggers lazy fetch, raises SymbolNotFoundError — ignore
    assert mock_get.call_args.kwargs.get("timeout") == 30
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/data_server/test_angelone_credentials.py tests/data_server/test_angelone_instruments.py -v
```

Expected: `FAIL` — `ModuleNotFoundError` for both new modules.

- [ ] **Step 3: Gemini delegation prompt**

```
Implement two files in this repo per docs/superpowers/specs/2026-08-17-angelone-historical-plugin-design.md, Decisions 3 and 4. Do not touch any other files. Tests already exist and are red — make them pass, do not weaken or delete them.

1. src/forecasting_agent/data_server/plugins/angelone_credentials.py
   - One-line file abstract comment at the top.
   - `AngelOneCredentials`: a frozen dataclass (@dataclass(frozen=True)) with fields api_key, client_code, mpin, totp_secret (all str).
   - Classmethod `from_env(cls) -> AngelOneCredentials`: reads os.environ["ANGELONE_API_KEY"], ["ANGELONE_CLIENT_CODE"], ["ANGELONE_MPIN"], ["ANGELONE_TOTP_SECRET"] via plain __getitem__ (not .get()) so a missing var raises KeyError naturally — do not catch and re-raise, do not add a custom exception, the test expects a plain KeyError.
   - One-line comment on the class and on from_env stating input/output.

2. src/forecasting_agent/data_server/plugins/angelone_instruments.py
   - One-line file abstract comment.
   - Module-level constant: INSTRUMENT_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"
   - `SymbolNotFoundError(Exception)`: plain, no custom __init__ needed.
   - `AngelOneInstrumentMaster` class:
     - `__init__(self)`: initializes an internal cache attribute to None (not fetched yet). Do not fetch in __init__ — lazy on first resolve() call.
     - `resolve(self, tradingsymbol: str, exchange: str) -> str`: on first call, do `httpx.get(INSTRUMENT_MASTER_URL, timeout=30)`, call `.raise_for_status()`, then `.json()` to get the list of instrument dicts, and cache that parsed list on self for the instance's lifetime — a later resolve() call must NOT call httpx.get again (verified by test_second_resolve_call_does_not_refetch). Each row is a dict with keys "token", "symbol", "exch_seg", "name" (do not assume other keys exist). Search the cached list for a row where row["symbol"] == tradingsymbol and row["exch_seg"] == exchange; return row["token"] if found. If no row matches, raise SymbolNotFoundError with a message naming the tradingsymbol and exchange (not a secret — this is fine to include, it's not a credential).
     - One-line comment on the class and on resolve() stating input/output.
   - Import `httpx` at module level (`import httpx`) so the test's `@patch("...angelone_instruments.httpx.get")` patches the right reference.

Run `uv run pytest tests/data_server/test_angelone_credentials.py tests/data_server/test_angelone_instruments.py -v` yourself and confirm all tests pass before finishing. Then run `uv run ruff check --fix src/forecasting_agent/data_server/plugins/angelone_credentials.py src/forecasting_agent/data_server/plugins/angelone_instruments.py && uv run ruff format src/forecasting_agent/data_server/plugins/angelone_credentials.py src/forecasting_agent/data_server/plugins/angelone_instruments.py && uv run mypy src/forecasting_agent/data_server/plugins/angelone_credentials.py src/forecasting_agent/data_server/plugins/angelone_instruments.py`.
```

- [ ] **Step 4: Validator brief (run cold, inline — do not accept Gemini's self-report)**

1. `git status` — confirm exactly the two source files + no stray edits elsewhere (CLAUDE.md's documented Gemini scope-violation history — check every time).
2. `uv run pytest tests/data_server/test_angelone_credentials.py tests/data_server/test_angelone_instruments.py -v` — re-run cold yourself; confirm 7/7 pass, not "should pass."
3. Read both new files — confirm `from_env` uses `os.environ[...]` (raises `KeyError` naturally) and not `.get(...)` with a manufactured error (a common Gemini substitution that changes the exception type silently).
4. Confirm `resolve()` really does not re-fetch on a second call — re-read the caching logic, don't just trust the passing test (a test can pass for the wrong reason if the mock always returns the same thing regardless of call count).
5. `make check` — full lint/mypy/bandit/import-linter gate, clean.

- [ ] **Step 5: Commit**

```bash
git add src/forecasting_agent/data_server/plugins/angelone_credentials.py src/forecasting_agent/data_server/plugins/angelone_instruments.py tests/data_server/test_angelone_credentials.py tests/data_server/test_angelone_instruments.py
git commit -m "feat(data_server): add AngelOneCredentials and AngelOneInstrumentMaster (#30)"
```

---

## Task 3: `AngelOneSession`

**Files:**
- Create: `src/forecasting_agent/data_server/plugins/angelone_session.py`
- Test: `tests/data_server/test_angelone_session.py`

**Interfaces:**
- Consumes: `AngelOneCredentials` (Task 2), `SmartApi.SmartConnect` (third-party).
- Produces: `AngelOneSession(credentials: AngelOneCredentials)`, `get_valid_token() -> str` — consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```python
# tests/data_server/test_angelone_session.py
import time
from unittest.mock import MagicMock, patch

import pytest

from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials

CREDS = AngelOneCredentials(api_key="k", client_code="c", mpin="1234", totp_secret="JBSWY3DPEHPK3PXP")


def _login_response(jwt="jwt1", refresh="ref1"):
    return {"status": True, "data": {"jwtToken": jwt, "refreshToken": refresh, "feedToken": "feed1"}}


@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_get_valid_token_logs_in_on_first_call(mock_sc_cls, mock_totp_cls):
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = _login_response()
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    session = AngelOneSession(CREDS)
    token = session.get_valid_token()

    assert token == "jwt1"
    mock_sc.generateSession.assert_called_once_with("c", "1234", "123456")


@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_get_valid_token_reuses_cached_token_within_validity(mock_sc_cls, mock_totp_cls):
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = _login_response()
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    session = AngelOneSession(CREDS)
    session.get_valid_token()
    session.get_valid_token()

    mock_sc.generateSession.assert_called_once()


@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_refresh_failure_falls_back_to_full_relogin(mock_sc_cls, mock_totp_cls):
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = _login_response(jwt="jwt1")
    mock_sc.generateToken.side_effect = KeyError("data")  # SDK's real undocumented failure mode
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    session = AngelOneSession(CREDS)
    session.get_valid_token()
    session._force_expire()  # test-only hook forcing the refresh path, see prompt below
    token = session.get_valid_token()

    assert token == "jwt1"  # fell back to a fresh generateSession, not a crash
    assert mock_sc.generateSession.call_count == 2


@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_login_failure_raises_with_sdk_message_not_credentials(mock_sc_cls, mock_totp_cls):
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = {"status": False, "message": "Invalid credentials"}
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneAuthError, AngelOneSession

    session = AngelOneSession(CREDS)
    with pytest.raises(AngelOneAuthError) as exc_info:
        session.get_valid_token()

    assert "Invalid credentials" == str(exc_info.value)
    assert CREDS.mpin not in str(exc_info.value)
    assert CREDS.totp_secret not in str(exc_info.value)


@patch("forecasting_agent.data_server.plugins.angelone_session.logzero")
@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_init_suppresses_logzero_default_logger(mock_sc_cls, mock_totp_cls, mock_logzero):
    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    AngelOneSession(CREDS)

    mock_logzero.loglevel.assert_called_once()


@patch("forecasting_agent.data_server.plugins.angelone_session.time.monotonic")
@patch("forecasting_agent.data_server.plugins.angelone_session.time.sleep")
@patch("forecasting_agent.data_server.plugins.angelone_session.pyotp.TOTP")
@patch("forecasting_agent.data_server.plugins.angelone_session.SmartConnect")
def test_rate_limit_gate_sleeps_when_calls_too_close(mock_sc_cls, mock_totp_cls, mock_sleep, mock_monotonic):
    mock_sc = MagicMock()
    mock_sc.generateSession.return_value = _login_response()
    mock_sc_cls.return_value = mock_sc
    mock_totp_cls.return_value.now.return_value = "123456"
    mock_monotonic.side_effect = [0.0, 0.0, 0.1, 0.1]  # two calls 0.1s apart, under the 1/3s=0.333s floor

    from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession

    session = AngelOneSession(CREDS)
    session.get_valid_token()
    session._force_expire()
    session.get_valid_token()

    assert mock_sleep.called
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/data_server/test_angelone_session.py -v
```

Expected: `FAIL` — `ModuleNotFoundError`.

- [ ] **Step 3: Gemini delegation prompt**

```
Implement src/forecasting_agent/data_server/plugins/angelone_session.py per docs/superpowers/specs/2026-08-17-angelone-historical-plugin-design.md, Design Decision 2 ("Auth/session as a composed helper"), Design Decision 6 ("Rate limiting"), and the "Credential-leak mitigation" section. Do not touch any other files. tests/data_server/test_angelone_session.py already exists and is red — make it pass, do not weaken or delete any test or assertion in it.

Requirements, all verified facts from the spec (do not deviate):

- Imports at module level (exact names, since the test patches these paths): `from SmartApi import SmartConnect`, `import pyotp`, `import logzero`, `import logging`, `import time`.
- `AngelOneAuthError(Exception)`: plain exception class for hard auth failures.
- `AngelOneSession` class:
  - `__init__(self, credentials: AngelOneCredentials)`: first call `logzero.loglevel(logging.CRITICAL + 1)` (silences the SDK's shared default logger, which otherwise prints plaintext MPIN/TOTP on any failed request — this is a required security fix, not optional). Then construct `self._client = SmartConnect(api_key=credentials.api_key)`. Store credentials. Initialize `self._jwt_token = None`, `self._refresh_token = None`, `self._token_expiry = None` (or equivalent — some internal way to know the cached token is stale), and `self._last_call_time = None` for the rate limiter.
  - `get_valid_token(self) -> str`: the core method.
    - If no token cached yet, or the cached token is expired (see `_force_expire` below for how "expired" is triggered in tests — implement expiry as a simple monotonic-time comparison against a stored expiry timestamp, e.g. login sets `self._token_expiry = time.monotonic() + <some number of seconds < 2.5 hours, e.g. 9000>`), do a full login:
      - `totp = pyotp.TOTP(self._credentials.totp_secret).now()`
      - `self._rate_limit_gate()` (call before every outbound SDK call, see below)
      - `response = self._client.generateSession(self._credentials.client_code, self._credentials.mpin, totp)`
      - If `response.get("status")` is falsy: raise `AngelOneAuthError(response.get("message", "Angel One login failed"))` — use the SDK's own message field verbatim, never include `self._credentials.mpin` or `.totp_secret` or `.api_key` in the exception message or in any log call, anywhere in this file.
      - Else: `self._jwt_token = response["data"]["jwtToken"]`, `self._refresh_token = response["data"]["refreshToken"]`, set `self._token_expiry`.
    - Else if the cached token is still valid but past some earlier "needs refresh" point — for simplicity, whenever `_force_expire()` (see below) has been called, or the stored expiry has passed, try `generateToken` first before falling back to full login:
      - `self._rate_limit_gate()`
      - `try: response = self._client.generateToken(self._refresh_token)` — this call can raise a raw `KeyError` per the SDK's real (undocumented) behavior when the refresh token itself is invalid/expired. Catch `KeyError` specifically and fall through to the full login path above (retry from the top with a fresh `generateSession` call) rather than letting it propagate.
      - On success, update `self._jwt_token`/`self._token_expiry` from the response the same way as login.
    - Otherwise (cached token still fresh, no forced expiry): return the cached `self._jwt_token` directly with no network call at all.
    - Return `self._jwt_token`.
  - `_force_expire(self) -> None`: a test-only hook — simply sets `self._token_expiry` to a value in the past (e.g. `time.monotonic() - 1`) so the next `get_valid_token()` call takes the refresh-or-relogin path. This method exists purely so tests can deterministically trigger the refresh path without sleeping for hours; keep it, it is intentional test infrastructure, not dead code.
  - `_rate_limit_gate(self) -> None`: before returning, ensure at least `1/3` seconds (0.334, to stay safely under Angel One's 3 req/s limit) have elapsed since `self._last_call_time` (call `time.monotonic()` for "now"); if not, `time.sleep(...)` the remaining difference. Then set `self._last_call_time = time.monotonic()`. Must call `time.sleep` and `time.monotonic` as module-level references (`time.sleep(...)`, `time.monotonic()`) — not `from time import sleep` — so the test's `@patch("...angelone_session.time.sleep")` / `.time.monotonic` patches work.
- One-line file abstract comment at top; one-line input/output comment on every method.

Run `uv run pytest tests/data_server/test_angelone_session.py -v` yourself and confirm all 7 tests pass — actually run it, don't assume. Then `uv run ruff check --fix src/forecasting_agent/data_server/plugins/angelone_session.py && uv run ruff format src/forecasting_agent/data_server/plugins/angelone_session.py && uv run mypy src/forecasting_agent/data_server/plugins/angelone_session.py`.
```

- [ ] **Step 4: Validator brief (run cold, inline)**

1. `git status` — only `angelone_session.py` changed/created.
2. `uv run pytest tests/data_server/test_angelone_session.py -v` — re-run cold, confirm 7/7, read the actual output rather than trusting a claim.
3. **Read the file directly** and confirm, by eye, all three of these — they are exactly the class of bug Gemini has shipped before per CLAUDE.md's documented quality-gap history:
   - `logzero.loglevel(...)` is genuinely called in `__init__`, unconditionally, before any `SmartConnect` call.
   - The `AngelOneAuthError` message construction never string-interpolates `credentials.mpin`/`.totp_secret`/`.api_key` — grep for `credentials.mpin`, `credentials.totp_secret`, `credentials.api_key` in the file; the only places those should appear are the `generateSession(...)` call itself and the `pyotp.TOTP(...)` call, nowhere inside an f-string, log call, or exception message.
   - The `except KeyError` around `generateToken` is scoped tightly (wraps only that call), not a broad `except Exception` that would also swallow real bugs.
4. `uv run bandit -r src/forecasting_agent/data_server/plugins/angelone_session.py -c pyproject.toml` — specifically re-check for hardcoded-secret / logging findings on this file, given the credential-leak history this task exists to fix.
5. `make check` — full gate clean.

- [ ] **Step 5: Commit**

```bash
git add src/forecasting_agent/data_server/plugins/angelone_session.py tests/data_server/test_angelone_session.py
git commit -m "feat(data_server): add AngelOneSession — TOTP login, refresh, rate limit, logzero suppression (#30)"
```

---

## Task 4: `AngelOnePlugin` + registration

**Files:**
- Create: `src/forecasting_agent/data_server/plugins/angelone.py`
- Modify: `src/forecasting_agent/data_server/plugins.yaml`
- Test: `tests/data_server/test_angelone_plugin.py`

**Interfaces:**
- Consumes: `AngelOneSession` (Task 3), `AngelOneInstrumentMaster` (Task 2), `AngelOneCredentials.from_env()` (Task 2), `MarketPlugin` ABC (`plugins/base.py`), `OHLCVBar` (`contracts.py`).
- Produces: `AngelOnePlugin(MarketPlugin)` registered under `NFO`/`BFO`/`CDS`/`MCX` in `plugins.yaml` — consumed by `PluginRegistry.resolve()`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/data_server/test_angelone_plugin.py
from datetime import date
from unittest.mock import MagicMock, patch


def _candle_response(rows):
    # SmartAPI getCandleData shape: {"status": True, "data": [[ts, o, h, l, c, v], ...]}
    return {"status": True, "data": rows}


@patch("forecasting_agent.data_server.plugins.angelone.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneSession")
def test_supports_nfo_bfo_cds_mcx_suffix_patterns(mock_session_cls, mock_instruments_cls, mock_from_env):
    from forecasting_agent.data_server.plugins.angelone import AngelOnePlugin

    plugin = AngelOnePlugin()
    assert plugin.supports("NIFTY25AUG26FUT")
    assert plugin.supports("SENSEX27MAR74000PE")
    assert plugin.supports("SENSEX26SEP85000CE")
    assert not plugin.supports("RELIANCE.NS")


@patch("forecasting_agent.data_server.plugins.angelone.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneSession")
def test_fetch_maps_candle_rows_to_ohlcv_bars(mock_session_cls, mock_instruments_cls, mock_from_env):
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_instruments_cls.return_value.resolve.return_value = "58072"

    from forecasting_agent.data_server.plugins.angelone import AngelOnePlugin

    plugin = AngelOnePlugin()
    with patch.object(plugin, "_client") as mock_client:
        mock_client.getCandleData.return_value = _candle_response(
            [["2026-08-01T00:00:00+05:30", 100.0, 105.0, 99.0, 103.0, 1000]]
        )
        bars = plugin.fetch("NIFTY25AUG26FUT", date(2026, 8, 1), date(2026, 8, 1))

    assert len(bars) == 1
    assert bars[0].close == 103.0
    assert bars[0].volume == 1000


@patch("forecasting_agent.data_server.plugins.angelone.AngelOneCredentials.from_env")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneInstrumentMaster")
@patch("forecasting_agent.data_server.plugins.angelone.AngelOneSession")
def test_fetch_returns_empty_list_on_empty_candle_response(mock_session_cls, mock_instruments_cls, mock_from_env):
    mock_session_cls.return_value.get_valid_token.return_value = "jwt1"
    mock_instruments_cls.return_value.resolve.return_value = "58072"

    from forecasting_agent.data_server.plugins.angelone import AngelOnePlugin

    plugin = AngelOnePlugin()
    with patch.object(plugin, "_client") as mock_client:
        mock_client.getCandleData.return_value = _candle_response([])
        bars = plugin.fetch("NIFTY25AUG26FUT", date(2026, 8, 1), date(2026, 8, 1))

    assert bars == []


def test_no_order_management_methods_referenced_in_module():
    import inspect

    from forecasting_agent.data_server.plugins import angelone

    source = inspect.getsource(angelone)
    forbidden = ["placeOrder", "modifyOrder", "cancelOrder", "getOrderBook", "getPosition"]
    for name in forbidden:
        assert name not in source, f"{name} must never appear in angelone.py (spec Design Decision 5)"
```

```python
# tests/data_server/test_plugins_yaml_angelone.py
def test_angelone_registered_under_four_derivative_markets():
    from forecasting_agent.data_server.registry import PluginRegistry

    registry = PluginRegistry()
    assert "NFO" in registry.list_markets()
    assert "BFO" in registry.list_markets()
    assert "CDS" in registry.list_markets()
    assert "MCX" in registry.list_markets()


def test_nse_bse_still_resolve_to_nse_plugin():
    from forecasting_agent.data_server.plugins.nse import NsePlugin
    from forecasting_agent.data_server.registry import PluginRegistry

    registry = PluginRegistry()
    assert isinstance(registry.resolve("NSE"), NsePlugin)
    assert isinstance(registry.resolve("BSE"), NsePlugin)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/data_server/test_angelone_plugin.py tests/data_server/test_plugins_yaml_angelone.py -v
```

Expected: `test_angelone_plugin.py` → `ModuleNotFoundError`; `test_plugins_yaml_angelone.py`'s first test → `AssertionError` (NFO not yet in `list_markets()`), second test passes already (baseline, not a regression check yet).

- [ ] **Step 3: Gemini delegation prompt**

```
Implement src/forecasting_agent/data_server/plugins/angelone.py and add four lines to src/forecasting_agent/data_server/plugins.yaml, per docs/superpowers/specs/2026-08-17-angelone-historical-plugin-design.md Design Decisions 1, 3, and 5. Do not touch any other files, especially not angelone_session.py, angelone_credentials.py, or angelone_instruments.py (already implemented and tested — treat them as a fixed, working interface). tests/data_server/test_angelone_plugin.py and tests/data_server/test_plugins_yaml_angelone.py already exist and are red where noted — make them pass without weakening any assertion.

1. src/forecasting_agent/data_server/plugins.yaml — add these four lines (existing NSE/BSE lines stay exactly as-is, do not reorder or touch them):
NFO: forecasting_agent.data_server.plugins.angelone
BFO: forecasting_agent.data_server.plugins.angelone
CDS: forecasting_agent.data_server.plugins.angelone
MCX: forecasting_agent.data_server.plugins.angelone

2. src/forecasting_agent/data_server/plugins/angelone.py:
   - One-line file abstract comment.
   - Imports: `from datetime import date`, `from SmartApi import SmartConnect`, `from forecasting_agent.data_server.contracts import OHLCVBar`, `from forecasting_agent.data_server.plugins.base import MarketPlugin`, `from forecasting_agent.data_server.plugins.angelone_credentials import AngelOneCredentials`, `from forecasting_agent.data_server.plugins.angelone_session import AngelOneSession`, `from forecasting_agent.data_server.plugins.angelone_instruments import AngelOneInstrumentMaster`. Do NOT import or reference placeOrder, modifyOrder, cancelOrder, getOrderBook, getPosition, or any other order-management SmartConnect method anywhere in this file — this is a hard requirement checked by test_no_order_management_methods_referenced_in_module, and by the spec's Design Decision 5.
   - `AngelOnePlugin(MarketPlugin)` class:
     - `__init__(self)`: `credentials = AngelOneCredentials.from_env()`; `self._session = AngelOneSession(credentials)`; `self._instruments = AngelOneInstrumentMaster()`; `self._client = SmartConnect(api_key=credentials.api_key)` (a second, separate SmartConnect instance from the one inside AngelOneSession is fine and expected — AngelOneSession owns login/token state, this plugin's own client is what actually calls getCandleData once it has a valid token from the session).
     - `symbol_pattern` property: return a regex matching Angel One-style F&O/currency/commodity trading symbols, e.g. r"^[A-Z0-9]+\d{2}[A-Z]{3}\d{2}(\d+(CE|PE))?FUT?$" is a reasonable starting point — DO NOT over-engineer this into a fully exhaustive Angel One symbol grammar; it only needs to be a fast pre-filter before the instrument-master lookup does the real validation (spec Decision 3, point 3). Make sure it matches all three symbol_pattern test cases: "NIFTY25AUG26FUT", "SENSEX27MAR74000PE", "SENSEX26SEP85000CE", and does NOT match "RELIANCE.NS".
     - `supports(self, symbol: str) -> bool`: return whether `symbol` matches `symbol_pattern`.
     - `fetch(self, symbol: str, start: date, end: date) -> list[OHLCVBar]`:
       - Get a valid token: `token = self._session.get_valid_token()`.
       - Set it on the client: `self._client.setAccessToken(token)` (SmartConnect's real method for injecting an externally-obtained jwtToken — confirm this method exists on the installed SmartConnect class before relying on it; if it doesn't, set `self._client.access_token = token` directly instead, whichever actually works — verify by reading the installed SmartApi.smartConnect source in this repo's venv the same way the spec's evidence table did).
       - Resolve the symbol token: figure out the exchange from context — since this plugin is registered under NFO/BFO/CDS/MCX and supports() already narrowed by symbol shape, you'll need SOME way to know which of the four exchanges a given symbol belongs to for the instrument-master lookup. Simplest correct approach: try instrument_token = self._instruments.resolve(symbol, exchange) for each of "NFO", "BFO", "CDS", "MCX" in turn, catching SymbolNotFoundError, and using the first exchange that resolves; if none resolve, let the last SymbolNotFoundError propagate. Store which exchange matched — you need it again for the getCandleData call's "exchange" parameter.
       - Call `response = self._client.getCandleData({"exchange": exchange, "symboltoken": instrument_token, "interval": "ONE_DAY", "fromdate": f"{start} 00:00", "todate": f"{end} 00:00"})` (this is a raw dict call, not routed through AngelOneSession's rate limiter — that's fine for now, spec Decision 6 scopes the rate limiter to AngelOneSession's own login/refresh calls only, not this plugin's own getCandleData call; note this as a known gap in a code comment, do not silently fix it by adding a second rate limiter here — that would be scope creep beyond this task).
       - If `response.get("status")` is falsy, or `response.get("data")` is empty/missing, return `[]` (spec Scope section, "Empty/missing data").
       - Otherwise, map each row in `response["data"]` — a list like `[timestamp_str, open, high, low, close, volume]` — into an `OHLCVBar`. Parse the timestamp (format like "2026-08-01T00:00:00+05:30") down to just the date portion for `OHLCVBar.date` (use `date.fromisoformat(timestamp_str[:10])` or equivalent — don't add a new datetime-parsing dependency). Map open/high/low/close/volume by position. Set `is_outlier=False, is_circuit_locked=False` (same as NsePlugin does — no cleaning logic in this plugin, matches the existing pattern).
       - Return the list of bars.
   - One-line input/output comment on every method.

Run `uv run pytest tests/data_server/test_angelone_plugin.py tests/data_server/test_plugins_yaml_angelone.py -v` yourself and confirm all pass — actually run it. Then `uv run ruff check --fix src/forecasting_agent/data_server/plugins/angelone.py && uv run ruff format src/forecasting_agent/data_server/plugins/angelone.py && uv run mypy src/forecasting_agent/data_server/plugins/angelone.py && uv run import-linter`.
```

- [ ] **Step 4: Validator brief (run cold, inline)**

1. `git status` — only `angelone.py` + the four-line `plugins.yaml` diff changed.
2. `uv run pytest tests/data_server/ -v` — the **full** `data_server` test suite, not just the new files — confirm nothing pre-existing broke (`NsePlugin`'s tests, `test_pipeline_integration.py`, `test_plugins_yaml_angelone.py`'s NSE/BSE-unchanged check) alongside the new ones.
3. **Grep, don't trust the test alone**, for order-management method names across the whole `plugins/` directory: `grep -rniE "placeOrder|modifyOrder|cancelOrder|getOrderBook|getPosition" src/forecasting_agent/data_server/plugins/` — expect zero matches. The test checks this too, but grep it yourself as an independent check (spec Design Decision 5's whole point is this being code-review-verifiable).
4. Read `fetch()`'s exchange-resolution loop — confirm it actually tries all four exchanges and doesn't silently default to just one (a plausible corner Gemini might cut).
5. `uv run import-linter` — confirm `plugins-isolation` still passes with the new file.
6. `make check` — full gate clean.

- [ ] **Step 5: Commit**

```bash
git add src/forecasting_agent/data_server/plugins/angelone.py src/forecasting_agent/data_server/plugins.yaml tests/data_server/test_angelone_plugin.py tests/data_server/test_plugins_yaml_angelone.py
git commit -m "feat(data_server): add AngelOnePlugin, register NFO/BFO/CDS/MCX (#30)"
```

---

## Task 5: Real-system verification (mandatory, not delegated to Gemini, not skippable)

This is the step CLAUDE.md's Gemini quality-gap history exists to force: every prior task's tests mock the SDK boundary. None of them prove the real Angel One login flow, the real TOTP secret, or the real `getCandleData` response shape actually work. This task is a single, small, manual, one-off real-API call — run by whoever executes this plan directly, using the `.env` file already filled in, never by Gemini, never committed as a test.

- [ ] **Step 1: One-off real smoke test script**

```python
# scratch: run directly, not committed, not a pytest test
import os
from datetime import date, timedelta

from dotenv import load_dotenv

load_dotenv()  # repo-root .env

from forecasting_agent.data_server.plugins.angelone import AngelOnePlugin

plugin = AngelOnePlugin()
end = date.today() - timedelta(days=1)
start = end - timedelta(days=7)
bars = plugin.fetch("NIFTY25AUG26FUT", start, end)  # use a real, currently-live NFO contract symbol —
# check the current front-month NIFTY future's exact
# trading symbol first, this exact string will be stale
print(f"Fetched {len(bars)} bars")
for b in bars[:3]:
    print(b)
```

(`python-dotenv` may need `uv add --dev python-dotenv` for this one-off script only — do not add it to `[project.dependencies]`, it's not used by any shipped code, only this manual verification step. Alternatively just `export $(grep -v '^#' .env | xargs)` in the shell before running, no new dependency needed.)

- [ ] **Step 2: Run it, read the real output**

```bash
uv run python scratch_angelone_smoke_test.py
```

Confirm, by reading actual output, not assuming:
- Login succeeds (no `AngelOneAuthError`) — this is the first real proof the TOTP secret was entered correctly.
- `getCandleData` returns real bars, not an empty list (confirms the symbol-token resolution and the `exchange`/`symboltoken`/date-format request shape are all actually correct against the live API, not just against a mock that was told what to return).
- Bar values look like plausible NIFTY futures prices, not zeros or nulls.

If login fails: check the exact `AngelOneAuthError` message (it's the SDK's own message, safe to read) — most likely causes are TOTP secret typo, MPIN wrong, or the separate enable-TOTP step not actually completed. Fix `.env`, rerun — do not touch any source file to "fix" a credentials problem.

- [ ] **Step 3: Delete the scratch script**

```bash
rm scratch_angelone_smoke_test.py
```

- [ ] **Step 4: Update tracking**

```bash
gh issue comment 30 --body "Implementation complete, verified against the real Angel One API (Task 5 smoke test — real login, real getCandleData response for a live NFO contract)."
```

Update Obsidian per this session's HARD RULE: `Daily/2026-08-17.md`, `Kanban.md` (move #30's line to Done), `Forecasting Agent.md` checklist.

# M4 FinBERT Sentiment FastMCP Server & AnySearch Domain Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and integrate a GPU-accelerated local FinBERT sentiment FastMCP server with automatic CPU and LLM-sentiment fallback, and expand the AnySearch domain allowlist with premier financial publications and social channels (Twitter/X, Reddit).

**Architecture:** A standalone Python FastMCP server (`forecasting_agent/sentiment_server/`) wrapping HuggingFace `ProsusAI/finbert` on CUDA (RTX 3050) with exponential recency decay scoring, registered over stdio in the TypeScript harness with defensive fallback to in-context LLM sentiment reasoning on tool failure.

**Tech Stack:** Python 3.12, PyTorch 2.x (CUDA 13.3 + CPU), HuggingFace Transformers, FastMCP (mcp SDK), TypeScript, Zod, Vitest, Pytest.

**Spec:** `docs/superpowers/specs/2026-08-20-finbert-sentiment-and-search-expansion-design.md`

## Global Constraints
- `model.config.id2label` MUST be used for all softmax probability extractions (`{0: "positive", 1: "negative", 2: "neutral"}`); positional indexing is strictly forbidden.
- Device resolution: Auto-detect `cuda` if available, fallback to `cpu` with 6 threads.
- PyTorch forward pass in FastMCP server must run inside `asyncio.to_thread` to protect the asyncio event loop.
- Recency decay half-life is fixed to $\tau = 24.0$ hours ($w_i = 2^{-\Delta t_i / 24}$).
- 100% strict mypy, ruff, eslint, and prettier compliance.

---

### Task 1: Python Dependencies & AnySearch Domain Expansion

**Files:**
- Modify: `pyproject.toml`
- Modify: `harness/harness_config.yaml:46-51`
- Modify: `harness/src/search/allowlist.ts:1-30`
- Test: `harness/tests/search/allowlist.test.ts`

**Interfaces:**
- Produces: Updated `DomainAllowlist` supporting financial media and social platforms (`x.com`, `twitter.com`, `reddit.com`, `business-standard.com`, etc.).

- [ ] **Step 1: Write test for new financial and social domains in Vitest**
Add test cases asserting `reddit.com`, `x.com`, `twitter.com`, `business-standard.com`, `reuters.com`, `bloomberg.com` pass allowlist partition.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --prefix harness test harness/tests/search/allowlist.test.ts`

- [ ] **Step 3: Update `pyproject.toml` and `harness_config.yaml`**
Add `torch>=2.2.0` and `transformers>=4.40.0` to `pyproject.toml` dependencies and run `uv sync`.
Add new domains to `harness/harness_config.yaml` under `search.allowed_domains`.

- [ ] **Step 4: Run tests to verify they pass**
Run: `pnpm --prefix harness test harness/tests/search/allowlist.test.ts`

- [ ] **Step 5: Commit**
```bash
git add pyproject.toml uv.lock harness/harness_config.yaml harness/src/search/allowlist.ts harness/tests/search/allowlist.test.ts
git commit -m "feat(search): add torch/transformers dependencies and expand search domain allowlist"
```

---

### Task 2: FinBERT Core Inference & Recency Decay Aggregator

**Files:**
- Create: `forecasting_agent/sentiment_server/__init__.py`
- Create: `forecasting_agent/sentiment_server/aggregator.py`
- Create: `forecasting_agent/sentiment_server/scorer.py`
- Test: `tests/sentiment/test_scorer_aggregator.py`

**Interfaces:**
- Produces: `FinBERTScorer.score_batch(texts: list[str]) -> list[dict[str, float]]`
- Produces: `aggregate_sentiment(headlines: list[HeadlineInput], scores: list[dict[str, float]], as_of: datetime | None, half_life_hours: float = 24.0) -> SentimentResult`

- [ ] **Step 1: Write unit tests for scorer and decay math**
Test `id2label` mapping, exponential decay weighting ($w=1.0$ at $\Delta t=0$, $w=0.5$ at $24$h, $w=0.25$ at $48$h), empty input handling, and device resolution.

- [ ] **Step 2: Run test to verify failure**
Run: `uv run pytest tests/sentiment/test_scorer_aggregator.py -v`

- [ ] **Step 3: Implement `aggregator.py` and `scorer.py`**
Implement mathematical aggregation in `aggregator.py` and PyTorch model loading with CUDA/CPU fallback in `scorer.py`.

- [ ] **Step 4: Run tests to verify they pass**
Run: `uv run pytest tests/sentiment/test_scorer_aggregator.py -v`

- [ ] **Step 5: Commit**
```bash
git add forecasting_agent/sentiment_server/ tests/sentiment/test_scorer_aggregator.py
git commit -m "feat(sentiment): implement FinBERT scorer and recency-weighted decay aggregator"
```

---

### Task 3: FastMCP Sentiment Server Implementation

**Files:**
- Create: `forecasting_agent/sentiment_server/server.py`
- Test: `tests/sentiment/test_server_mcp.py`

**Interfaces:**
- Produces: FastMCP tools `score_sentiment` and `health`.

- [ ] **Step 1: Write FastMCP tool integration tests**
Test `score_sentiment` tool and `health` tool over in-memory FastMCP transport.

- [ ] **Step 2: Run test to verify failure**
Run: `uv run pytest tests/sentiment/test_server_mcp.py -v`

- [ ] **Step 3: Implement `server.py` with `asyncio.to_thread`**
Implement `FastMCP("sentiment")` server wrapping `FinBERTScorer` and `aggregate_sentiment` in `asyncio.to_thread`.

- [ ] **Step 4: Run tests to verify they pass**
Run: `uv run pytest tests/sentiment/test_server_mcp.py -v`

- [ ] **Step 5: Commit**
```bash
git add forecasting_agent/sentiment_server/server.py tests/sentiment/test_server_mcp.py
git commit -m "feat(sentiment): implement FastMCP sentiment server with asyncio event loop protection"
```

---

### Task 4: TypeScript Harness Integration & Two-Layer Fallback

**Files:**
- Modify: `harness/harness_config.yaml:12-25`
- Modify: `harness/src/agents/types.ts`
- Modify: `harness/src/agents/factory.ts`
- Test: `harness/tests/sentiment-tool.test.ts`

**Interfaces:**
- Consumes: `score_sentiment` tool from FastMCP sentiment server.
- Produces: Defensive agent tool execution with graceful `{ degraded: true }` neutral fallback on failure.

- [ ] **Step 1: Write harness unit test for sentiment tool binding & fallback**
Test agent tool registration and verify exception catch returns degraded neutral signal without crashing debate turn.

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm --prefix harness test harness/tests/sentiment-tool.test.ts`

- [ ] **Step 3: Register `sentiment` MCP server and implement defensive wrapper**
Update `harness_config.yaml` with `sentiment` MCP server command.
Update `AGENT_CONFIGS` in `factory.ts` granting `score_sentiment` to `retail`, `fii`, and `dii`.

- [ ] **Step 4: Run tests to verify they pass**
Run: `pnpm --prefix harness test harness/tests/sentiment-tool.test.ts`

- [ ] **Step 5: Commit**
```bash
git add harness/harness_config.yaml harness/src/agents/ harness/tests/sentiment-tool.test.ts
git commit -m "feat(harness): register sentiment MCP server and wire defensive agent fallback"
```

---

### Task 5: End-to-End Quality Gates & Smoke Verification

**Files:**
- Test: All unit, integration, and e2e test suites.

- [ ] **Step 1: Run full Python test suite**
Run: `uv run pytest` (verify 280+ tests pass).

- [ ] **Step 2: Run full TypeScript test suite**
Run: `pnpm --prefix harness test` (verify 275+ tests pass).

- [ ] **Step 3: Run Linters and Typecheckers**
Run: `uv run ruff check .`
Run: `uv run mypy src/`
Run: `pnpm --prefix harness typecheck`
Run: `pnpm --prefix harness lint`

- [ ] **Step 4: Live Stdio Smoke Test**
Execute real Python sentiment server over stdio with synthetic test headlines to confirm <10ms CUDA execution and complete JSON output.

- [ ] **Step 5: Commit & Push**
```bash
git commit --allow-empty -m "chore(sentiment): complete full end-to-end verification of FinBERT FastMCP server"
```

---
type: adr
date: 2026-08-20
status: proposed
parent: "[[Forecasting Agent]]"
---

# M4 FinBERT Sentiment FastMCP Server & AnySearch Domain Expansion — Design Spec

**Issue:** #22 (FinBERT Sentiment MCP) · **ADRs:** ADR-018 (FinBERT as MCP capability), ADR-015 (Config-driven capability binding), ADR-010/017 (AnySearch capability), ADR-012 (Read-only evaluation parameters) · **Depends on:** #4 (Capability Layer) · **Blocks:** #10 (Retail & FII/DII News Deliberation)

---

## 0. Measured Environment & Hardware Facts

Measured on this machine (Linux / NVIDIA GeForce RTX 3050 Laptop GPU, 4096 MiB VRAM, CUDA 13.3, Python 3.12):
1. **Model:** `ProsusAI/finbert` (109.5M params, BERT-base architecture, 3-class financial sentiment).
   - Label map: `model.config.id2label = {0: "positive", 1: "negative", 2: "neutral"}`.
   - **Crucial Invariant:** Positional softmax indexing is forbidden; label extraction must always use `id2label`.
2. **VRAM Footprint:** ~440 MB on-disk weights, **~600 MB VRAM steady-state** on CUDA. Fits comfortably in 4GB VRAM.
3. **Inference Latency:**
   - On **CUDA (RTX 3050)**: **<10 ms** for batch size 8 (median 8.2ms).
   - On **CPU (6 threads fallback)**: **~210 ms** for batch size 8.
4. **AnySearch Domain Filter:** Current allowlist in `harness/src/search/allowlist.ts` contains 5 domains (`moneycontrol.com`, `economictimes.indiatimes.com`, `livemint.com`, `bseindia.com`, `nseindia.com`). 7 top financial publications are missing, causing 60-80% of relevant news search results to be rejected by hostname filtering.

---

## 1. Architectural Decisions

### 1.1 Server Architecture & Transport
- **FastMCP Stdio Subprocess:** The sentiment server is a standalone Python package (`forecasting_agent/sentiment_server/`) executed over `stdio` via `uv run python -m forecasting_agent.sentiment_server.server`.
- **Zero Port Management:** No Docker GPU passthrough or open HTTP ports required. The harness supervises the subprocess identically to the `market` FastMCP server (`ADR-013`).

### 1.2 Two-Layer Resilience & Fallback
1. **Hardware-Level Fallback (GPU -> CPU):**
   - Model loader attempts `device="cuda"` on `torch.cuda.is_available()`.
   - On `torch.cuda.OutOfMemoryError` or CUDA failure, gracefully re-initializes on `device="cpu"` with `torch.set_num_threads(6)`.
2. **Architectural-Level Fallback (FinBERT MCP -> LLM Sentiment):**
   - If the sentiment FastMCP tool throws, times out, or fails to spawn, the TypeScript harness catches the error and returns a graceful degraded result:
     `{ score: 0.0, label: "neutral", confidence: 0.0, degraded: true, reason: "FinBERT service unavailable" }`
   - The participant agent prompt seamlessly falls back to reasoning over raw news headlines directly in-context.

### 1.3 Recency-Weighted Exponential Decay Scoring
- Financial news value decays rapidly over time. For a list of headlines $i = 1 ... N$ with timestamps $t_i$ relative to anchor time $t_{ref}$:
  $$\Delta t_i = \max(0.0, (t_{ref} - t_i)_{hours})$$
  $$w_i = 2^{-\Delta t_i / \tau} = \exp(-\frac{\ln 2}{\tau} \Delta t_i)$$
  where $\tau = 24.0$ hours (1 trading day half-life, immutable by agents per ADR-012).
- If no timestamp is provided for a headline, it defaults to $w_i = 1.0$ (current).
- Individual polarity score per headline: $s_i = p_{positive, i} - p_{negative, i} \in [-1.0, 1.0]$.
- Aggregated Polarity Score:
  $$S = \frac{\sum_{i=1}^N w_i s_i}{\sum_{i=1}^N w_i} \in [-1.0, 1.0]$$
- Weighted Confidence (non-neutral conviction):
  $$C = \frac{\sum_{i=1}^N w_i (1.0 - p_{neutral, i})}{\sum_{i=1}^N w_i} \in [0.0, 1.0]$$
- Overall Label:
  $$\text{label} = \begin{cases} \text{"positive"} & \text{if } S \ge +0.15 \\ \text{"negative"} & \text{if } S \le -0.15 \\ \text{"neutral"} & \text{otherwise} \end{cases}$$

### 1.4 Expanded AnySearch Domain Allowlist (Financial Media + Social Sentiment)
Extend `harness/src/search/allowlist.ts` and `harness_config.yaml` to include:
**1. Premier Financial Press & Wire Services:**
- `business-standard.com`
- `financialexpress.com`
- `cnbctv18.com`
- `ndtvprofit.com`
- `thehindubusinessline.com`
- `reuters.com`
- `bloomberg.com`
- `mint.com`

**2. Social & Retail Sentiment Channels (ADR-023 Retail Lane):**
- `x.com`
- `twitter.com`
- `reddit.com` (r/IndianStreetBets, r/IndiaInvestments)

---

## 2. Component Specifications & Interfaces

### 2.1 Python Sentiment Server (`forecasting_agent/sentiment_server/`)

```
forecasting_agent/sentiment_server/
├── __init__.py
├── server.py        # FastMCP server definition & tool entry points
├── scorer.py        # PyTorch model loader, CUDA/CPU device placement, batch inference
└── aggregator.py    # Recency decay weights & polarity math
```

#### Async Responsiveness & Thread Offloading (Event Loop Protection)
Because PyTorch forward passes are CPU/GPU-blocking, tool handlers in `server.py` execute scoring via `asyncio.to_thread(scorer.score, ...)` ensuring the FastMCP event loop remains responsive to health probes and concurrent requests.

#### FastMCP Tool: `score_sentiment`
```python
class HeadlineInput(BaseModel):
    text: str = Field(..., max_length=512, description="Headline or snippet text")
    timestamp: str | None = Field(None, description="ISO-8601 timestamp of publication")


class HeadlineScore(BaseModel):
    text: str
    positive: float
    negative: float
    neutral: float
    score: float
    weight: float


class SentimentResponse(BaseModel):
    score: float = Field(..., description="Aggregated polarity in [-1.0, 1.0]")
    label: Literal["positive", "negative", "neutral"]
    confidence: float = Field(..., description="Weighted non-neutral conviction in [0.0, 1.0]")
    headline_count: int
    headlines: list[HeadlineScore]
    device: str
    degraded: bool = False
```

#### FastMCP Tool: `health`
```python
def health() -> dict[str, Any]:
    return {
        "status": "healthy",
        "model": "ProsusAI/finbert",
        "device": scorer.device_name,
        "vram_allocated_mb": scorer.vram_mb,
    }
```

### 2.2 TypeScript Harness Integration

1. `harness/harness_config.yaml`:
```yaml
mcp_servers:
  sentiment:
    command: bash
    args: ["-c", "cd ${REPO_ROOT} && exec uv run python -m forecasting_agent.sentiment_server.server"]
```

2. `harness/src/agents/types.ts` & `harness/src/agents/factory.ts`:
- Grant `score_sentiment` tool access to `retail`, `fii`, and `dii` agents.
- Wrap sentiment tool execution with defensive try/catch to guarantee zero unhandled tool crashes.

---

## 3. Edge Cases & Defensive Invariants

1. **Empty Headline List:** If `headlines=[]`, `score_sentiment` immediately returns `{ score: 0.0, label: "neutral", confidence: 0.0, headline_count: 0 }` without invoking PyTorch forward pass.
2. **Invalid / Future Timestamps:** If timestamp parsing fails or timestamp is in the future relative to `as_of`, timestamp is ignored and clamped to $\Delta t = 0$ ($w=1.0$).
3. **Text Truncation:** Headlines $> 512$ characters are clipped to 512 characters before tokenization to bound maximum sequence length and guarantee $<10\text{ms}$ batch latency.
4. **All Neutral Probabilities:** If all headlines are 100% neutral ($p_{neutral}=1.0$), $C = 0.0$ and $S = 0.0$.
5. **No Model Download in Cold Tests:** Test suite provides a lightweight mock / injectable pipeline fixture so CI tests run in $<0.5\text{s}$ without downloading HuggingFace weights.

---

## 4. Verification Plan

1. **Unit Tests (`tests/test_sentiment_server.py`)**:
   - Test label mapping fidelity (`id2label` mapping check).
   - Test recency decay math against known numerical fixtures ($w_0 = 1.0, w_{24h} = 0.5, w_{48h} = 0.25$).
   - Test empty headlines and malformed input handling.
   - Test CPU / CUDA device selection logic.
2. **FastMCP Integration Tests (`tests/test_sentiment_mcp.py`)**:
   - Test tool calling over FastMCP in-memory transport.
   - Verify `health()` tool returns in $<50\text{ms}$.
3. **TypeScript Harness Tests (`harness/tests/sentiment-tool.test.ts`)**:
   - Verify agent tool binding and schema parsing.
   - Verify graceful fallback on tool failure.
   - Verify updated 12-domain AnySearch allowlist.
4. **Full Suite Quality Gates**:
   - `uv run pytest` (all 277+ tests passing).
   - `pnpm --prefix harness test` (all 272+ tests passing).
   - Strict Mypy, Ruff, ESLint, Prettier 100% green.

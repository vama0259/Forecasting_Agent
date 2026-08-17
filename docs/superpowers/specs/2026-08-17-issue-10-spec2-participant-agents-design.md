# Story #10 Spec 2: Participant Intent Sub-Agents (FII, DII, Retail) — Architecture & Prompt Specification

> **Milestone**: MVP 1 (Story #10 / Story 7)
> **ADR References**: ADR-023 (Participant Intent Asymmetry), ADR-024 (Adversarial Dissent), ADR-025 (Feature Engineering), ADR-033 (Harness Specialist Architecture)
> **Pre-requisite**: Story #10 Spec 1 (`deepagents` Multi-Agent Harness & Price Parity) — **Merged & Verified**

---

## 1. Executive Summary

Spec 1 generalized the harness and established parity with the `price` anchor agent. Spec 2 delivers the core information moat of the forecasting system: the **3 remaining participant-intent sub-agents** (**FII**, **DII**, and **Retail**).

Each agent models a distinct Indian market participant class, operates under strict data asymmetry with capability-fenced MCP tools, writes autonomous Python feature-engineering code in its designated workspace subpath, and emits a structured `AgentSignal` compliant with ADR-023.

---

## 2. Participant Roster & Strict Data Asymmetry Architecture

```
                               ┌────────────────────────┐
                               │  Multi-Agent Dispatch  │
                               └───────────┬────────────┘
                                           │
         ┌──────────────────┬──────────────┴───────────────┬──────────────────┐
         │                  │                              │                  │
         ▼                  ▼                              ▼                  ▼
┌─────────────────┐┌─────────────────┐            ┌─────────────────┐┌─────────────────┐
│   Price Agent   ││    FII Agent    │            │    DII Agent    ││  Retail Agent   │
├─────────────────┤├─────────────────┤            ├─────────────────┤├─────────────────┤
│ Tools:          ││ Tools:          │            │ Tools:          ││ Tools:          │
│ • fetch_ohlcv   ││ • fetch_flows   │            │ • fetch_flows   ││ • fetch_micro.. │
│                 ││ • fetch_ohlcv   │            │ • fetch_ohlcv   ││ • fetch_option..│
│                 ││                 │            │                 ││ • fetch_ohlcv   │
│ Capabilities:   ││ Capabilities:   │            │ Capabilities:   ││ Capabilities:   │
│ • market_data   ││ • flows         │            │ • flows         ││ • microstructure│
│ • macro         ││ • market_data   │            │ • market_data   ││ • sentiment     │
│                 ││ • macro         │            │ • macro         ││ • market_data   │
│ Workspace:      ││ Workspace:      │            │ Workspace:      ││ Workspace:      │
│ /features/price ││ /features/fii   │            │ /features/dii   ││ /features/retail│
│ Output:         ││ Output:         │            │ Output:         ││ Output:         │
│ model.py        ││ fii_features.py │            │ dii_features.py ││ retail_feat.py  │
└─────────────────┘└─────────────────┘            └─────────────────┘└─────────────────┘
```

---

## 3. Strict Schema Contracts & Type Safety

### 3.1 `harness/src/agents/schema.ts`
```typescript
import { z } from 'zod';

export const CapabilitySchema = z.enum([
  'market_data',
  'flows',
  'macro',
  'microstructure',
  'sentiment',
]);

export type Capability = z.infer<typeof CapabilitySchema>;

export const EvidenceItemSchema = z.object({
  claim: z.string().min(1),
  source_capability: CapabilitySchema,
  value: z.union([z.string(), z.number(), z.boolean()]),
  explicit_absence: z.boolean().default(false),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const AgentSignalSchema = z.object({
  agent_name: z.enum(['price', 'fii', 'dii', 'retail']),
  direction: z.enum(['up', 'down']),
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  horizon_days: z.literal(1),
  evidence: z.array(EvidenceItemSchema).min(1),
  dissent: z.string().optional(),
  degraded: z.boolean().default(false),
});

export type AgentSignal = z.infer<typeof AgentSignalSchema>;
```

### 3.2 `harness/src/agents/types.ts`
```typescript
import { z } from 'zod';
import { CapabilitySchema } from './schema.js';

export const ParticipantAgentConfigSchema = z.object({
  name: z.enum(['price', 'fii', 'dii', 'retail']),
  roleTitle: z.string(),
  description: z.string(),
  promptTemplate: z.string(),
  allowedCapabilities: z.array(CapabilitySchema),
  dataLaneDescription: z.string(),
  workspaceSubpath: z.string(),
  allowedWritePaths: z.array(z.string()),
  tools: z.array(z.string()),
  skills: z.array(z.string()).default([]),
  maxTokenBudget: z.number().int().positive().default(400_000),
  horizon_days: z.literal(1),
  generatedBy: z.enum(['human', 'agent']).default('human'),
});

export type ParticipantAgentConfig = z.infer<typeof ParticipantAgentConfigSchema>;

export const AGENT_CONFIGS: ParticipantAgentConfig[] = [
  {
    name: 'price',
    roleTitle: 'Price Action & Macro Anchor',
    description: 'Analyzes target OHLCV, momentum indicators, moving averages, and sovereign macro drivers.',
    promptTemplate: 'price.j2',
    allowedCapabilities: ['market_data', 'macro'],
    dataLaneDescription: 'OHLCV bars + technical indicators + macro drivers (USDINR, Brent, US10Y)',
    workspaceSubpath: 'price',
    allowedWritePaths: [
      '/workspace/code/features/price/**',
      '/workspace/bars.json',
      '/workspace/model.py',
      '/memories/**',
    ],
    tools: ['fetch_ohlcv'],
    skills: [],
    maxTokenBudget: 400_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
  {
    name: 'fii',
    roleTitle: 'Foreign Institutional Investor (FII) Intent',
    description: 'Analyzes foreign institutional positioning, Index Futures Long/Short ratios, and cross-border risk-off momentum.',
    promptTemplate: 'fii.j2',
    allowedCapabilities: ['market_data', 'flows', 'macro'],
    dataLaneDescription: 'Participant-wise F&O open interest (FII Long/Short ratios) + market-wide flows + OHLCV',
    workspaceSubpath: 'fii',
    allowedWritePaths: [
      '/workspace/code/features/fii/**',
      '/workspace/flows.json',
      '/workspace/bars.json',
      '/memories/**',
    ],
    tools: ['fetch_flows', 'fetch_ohlcv'],
    skills: [],
    maxTokenBudget: 400_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
  {
    name: 'dii',
    roleTitle: 'Domestic Institutional Investor (DII) Intent',
    description: 'Analyzes domestic mutual fund absorption, SIP structural liquidity support, and counter-cyclical accumulation.',
    promptTemplate: 'dii.j2',
    allowedCapabilities: ['market_data', 'flows', 'macro'],
    dataLaneDescription: 'Participant-wise F&O open interest (DII Long/Short ratios) + domestic cash flow resilience + OHLCV',
    workspaceSubpath: 'dii',
    allowedWritePaths: [
      '/workspace/code/features/dii/**',
      '/workspace/flows.json',
      '/workspace/bars.json',
      '/memories/**',
    ],
    tools: ['fetch_flows', 'fetch_ohlcv'],
    skills: [],
    maxTokenBudget: 400_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
  {
    name: 'retail',
    roleTitle: 'Retail & Microstructure Intent',
    description: 'Analyzes security-wise Bhavcopy delivery percentages, option chain Put-Call ratios (PCR), and retail sentiment froth.',
    promptTemplate: 'retail.j2',
    allowedCapabilities: ['market_data', 'microstructure', 'sentiment'],
    dataLaneDescription: 'Security delivery % + Bulk/Block deals + Option Chain Strike OI + OHLCV',
    workspaceSubpath: 'retail',
    allowedWritePaths: [
      '/workspace/code/features/retail/**',
      '/workspace/microstructure.json',
      '/workspace/option_chain.json',
      '/workspace/bars.json',
      '/memories/**',
    ],
    tools: ['fetch_microstructure', 'fetch_option_chain', 'fetch_ohlcv'],
    skills: [],
    maxTokenBudget: 400_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
];
```

### 3.3 `harness/src/middleware/evidence-validation.ts`
```typescript
import type { AgentMiddleware } from 'langchain';
import type { AgentSignal, Capability } from '../agents/schema.js';

export function buildEvidenceValidationMiddleware(
  agentName: string,
  allowedCapabilities: Capability[],
): AgentMiddleware {
  return {
    name: 'evidence-validation',
    afterModel: (state) => {
      const resp = state.structuredResponse as Partial<AgentSignal> | undefined;
      if (!resp || !resp.evidence) return;
      for (const item of resp.evidence) {
        if (!item || !allowedCapabilities.includes(item.source_capability)) {
          console.warn(
            `[${agentName}] Evidence source_capability '${item?.source_capability}' is outside allowed set: ${allowedCapabilities.join(', ')}. Marking signal degraded.`
          );
          resp.degraded = true;
          break;
        }
      }
    },
  };
}
```

---

## 4. Python FastMCP Tool Signature Alignment

### `src/forecasting_agent/data_server/server.py`
Update `fetch_option_chain` signature to accept optional `expiry` with automatic fallback to nearest available cycle:
```python
@app.tool()
def fetch_option_chain(
    underlying: str,
    expiry: str | None = None,
    as_of: str | None = None,
) -> FnOChainResponse:
    """Fetch option chain for an underlying.

    If expiry is omitted/None, automatically resolves to the nearest available expiration date from ticker.options.
    """
    if as_of is not None:
        as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else as_of
        today = date.today()  # noqa: DTZ011
        if as_of_date > today:
            raise LeakageError(f"as_of date {as_of_date} is in the future relative to today ({today})")

    ticker_symbol = underlying
    if not ticker_symbol.endswith((".NS", ".BO")) and not ticker_symbol.startswith("^"):
        ticker_symbol = f"{underlying}.NS"

    strikes_map: dict[float, dict[str, Any]] = {}
    resolved_expiry_date = None
    try:
        ticker = yf.Ticker(ticker_symbol)
        options = getattr(ticker, "options", [])
        if expiry:
            target_expiry = expiry
        elif options:
            target_expiry = options[0]
        else:
            target_expiry = str(as_of or date.today())

        resolved_expiry_date = date.fromisoformat(target_expiry)
        chain = ticker.option_chain(target_expiry) if target_expiry in options else ticker.option_chain()
        calls_df = chain.calls
        puts_df = chain.puts

        if calls_df is not None and not calls_df.empty:
            for _, row in calls_df.iterrows():
                strike = float(row.get("strike", 0.0))
                if strike <= 0:
                    continue
                strikes_map.setdefault(strike, {})["call_ltp"] = float(row.get("lastPrice", 0.0) or 0.0)
                strikes_map[strike]["call_oi"] = int(row.get("openInterest", 0) or 0)

        if puts_df is not None and not puts_df.empty:
            for _, row in puts_df.iterrows():
                strike = float(row.get("strike", 0.0))
                if strike <= 0:
                    continue
                strikes_map.setdefault(strike, {})["put_ltp"] = float(row.get("lastPrice", 0.0) or 0.0)
                strikes_map[strike]["put_oi"] = int(row.get("openInterest", 0) or 0)
    except Exception as exc:
        logger.debug("Failed to fetch option chain for %s (%s): %s", ticker_symbol, expiry, exc)

    strikes: list[StrikeData] = []
    for strike_price in sorted(strikes_map.keys()):
        info = strikes_map[strike_price]
        strikes.append(
            StrikeData(
                strike_price=strike_price,
                call_oi=max(0, info.get("call_oi", 0)),
                put_oi=max(0, info.get("put_oi", 0)),
                call_ltp=max(0.0, info.get("call_ltp", 0.0)),
                put_ltp=max(0.0, info.get("put_ltp", 0.0)),
            )
        )

    return FnOChainResponse(
        underlying=underlying,
        expiry=resolved_expiry_date or (date.fromisoformat(as_of) if as_of else date.today()),
        strikes=strikes,
        data_stale=False,
    )
```

---

## 5. Verbatim Prompt Templates (`harness/prompts/`)

### 5.1 `harness/prompts/fii.j2`

```jinja2
Produce a Foreign Institutional Investor (FII) intent forecast for {{ symbol }} (NSE) as of {{ as_of }}.

1. Call the market tools:
   a. fetch_flows(observed_on="{{ as_of }}", as_of="{{ as_of }}")
      Returns participant-wise derivative flow records: [{observed_on, participant, future_index_long, future_index_short, future_stock_long, future_stock_short, ...}, ...].
      Immediately save the exact result using write_file to /workspace/flows.json.
   b. fetch_ohlcv(symbol="{{ symbol }}", market="NSE", start="{{ start_date }}", end="{{ as_of }}", as_of="{{ as_of }}")
      Immediately save the exact result using write_file to /workspace/bars.json.

2. In Python (under /workspace/code/features/fii/), write an analysis script (e.g. `fii_features.py`) to inspect the flow data:
   - Calculate FII Index Futures Long/Short ratio:
     fii_long = FII record's future_index_long
     fii_short = FII record's future_index_short
     long_short_ratio = fii_long / max(1, fii_short)
   - Calculate FII Net Stock Futures vs Index Futures stance.
   - Note: NSE FII flow data is market-wide, not stock-specific (ADR-023). Analyze {{ symbol }} price action in the context of institutional risk-on or risk-off positioning.
   - If flows data is empty (e.g. holiday or weekend), handle gracefully with explicit_absence: true.
   - Run the script in the sandbox via execute to verify the indicators.

3. Separately, as your structured final response, give your overall FII intent forecast for {{ symbol }} over the next {{ horizon_days }} day:
   - `agent_name`: "fii"
   - `direction`: "up" or "down" (binary only)
   - `probability`: 0.0 to 1.0 (calibrated probability that {{ symbol }} advances)
   - `confidence`: 0.0 to 1.0
   - `horizon_days`: 1
   - `evidence`: list of observations citing `source_capability: "flows"` or `"market_data"`.
   - `dissent`: optional counter-argument or institutional positioning nuance.
```

---

### 5.2 `harness/prompts/dii.j2`

```jinja2
Produce a Domestic Institutional Investor (DII) intent forecast for {{ symbol }} (NSE) as of {{ as_of }}.

1. Call the market tools:
   a. fetch_flows(observed_on="{{ as_of }}", as_of="{{ as_of }}")
      Immediately save the exact result using write_file to /workspace/flows.json.
   b. fetch_ohlcv(symbol="{{ symbol }}", market="NSE", start="{{ start_date }}", end="{{ as_of }}", as_of="{{ as_of }}")
      Immediately save the exact result using write_file to /workspace/bars.json.

2. In Python (under /workspace/code/features/dii/), write an analysis script (e.g. `dii_features.py`):
   - Calculate DII Index Futures Long/Short ratio:
     dii_long = DII record's future_index_long
     dii_short = DII record's future_index_short
     dii_ratio = dii_long / max(1, dii_short)
   - Evaluate DII absorption capacity: is domestic liquidity providing a price floor on {{ symbol }} against foreign selling?
   - If flows data is empty (e.g. holiday or weekend), handle gracefully with explicit_absence: true.
   - Run the script in the sandbox via execute to verify the indicators.

3. Separately, as your structured final response, give your overall DII intent forecast for {{ symbol }} over the next {{ horizon_days }} day:
   - `agent_name`: "dii"
   - `direction`: "up" or "down" (binary only)
   - `probability`: 0.0 to 1.0
   - `confidence`: 0.0 to 1.0
   - `horizon_days`: 1
   - `evidence`: list of observations citing `source_capability: "flows"` or `"market_data"`.
   - `dissent`: optional domestic liquidity caveat or macro constraint.
```

---

### 5.3 `harness/prompts/retail.j2`

```jinja2
Produce a Retail & Microstructure intent forecast for {{ symbol }} (NSE) as of {{ as_of }}.

1. Call the microstructure & derivatives tools:
   a. fetch_microstructure(observed_on="{{ as_of }}", as_of="{{ as_of }}")
      Returns {observed_on, delivery: [{symbol, series, quantity_traded, deliverable_quantity, delivery_pct}, ...], bulk_deals: [...], block_deals: [...]}.
      Immediately save to /workspace/microstructure.json.
   b. fetch_option_chain(underlying="{{ symbol }}", as_of="{{ as_of }}")
      Immediately save to /workspace/option_chain.json.
   c. fetch_ohlcv(symbol="{{ symbol }}", market="NSE", start="{{ start_date }}", end="{{ as_of }}", as_of="{{ as_of }}")
      Immediately save to /workspace/bars.json.

2. In Python (under /workspace/code/features/retail/), write an analysis script (e.g. `retail_features.py`):
   - Extract delivery percentage for {{ symbol }}:
     delivery_pct = deliverable_quantity / max(1, quantity_traded) * 100
     High delivery (>50%) on price increases signals genuine accumulation; low delivery (<25%) indicates retail churn.
   - Calculate Put-Call Ratio (PCR) from option chain:
     total_put_oi = sum(s.put_oi for s in strikes)
     total_call_oi = sum(s.call_oi for s in strikes)
     pcr = total_put_oi / max(1, total_call_oi)
   - Inspect Bulk/Block deals for institutional footprint.
   - If microstructure or option chain data is empty (e.g. holiday, weekend, or illiquid strikes), handle gracefully with explicit_absence: true.
   - Run the script in the sandbox via execute to verify the indicators.

3. Separately, as your structured final response, give your overall Retail & Microstructure forecast for {{ symbol }} over the next {{ horizon_days }} day:
   - `agent_name`: "retail"
   - `direction`: "up" or "down" (binary only)
   - `probability`: 0.0 to 1.0
   - `confidence`: 0.0 to 1.0
   - `horizon_days`: 1
   - `evidence`: list of observations citing `source_capability: "microstructure"`, `"sentiment"`, or `"market_data"`.
   - `dissent`: optional contrarian retail sentiment warning.
```

---

## 6. Implementation Deliverables & Testing Matrix

| Deliverable File | Type | Purpose |
|---|---|---|
| `src/forecasting_agent/data_server/server.py` | Python | Update `fetch_option_chain` to support optional `expiry` with nearest resolution. |
| `harness/src/agents/schema.ts` | TypeScript | Add `CapabilitySchema` and enforce on `EvidenceItemSchema.source_capability`. |
| `harness/src/agents/types.ts` | TypeScript | Add `CapabilitySchema` to `ParticipantAgentConfigSchema` and populate all 4 agents in `AGENT_CONFIGS`. |
| `harness/src/middleware/evidence-validation.ts` | TypeScript | Update `buildEvidenceValidationMiddleware` signature to use `Capability[]`. |
| `harness/prompts/fii.j2` | Nunjucks | FII Institutional Intent prompt template. |
| `harness/prompts/dii.j2` | Nunjucks | DII Domestic Institutional Intent prompt template. |
| `harness/prompts/retail.j2` | Nunjucks | Retail & Microstructure Intent prompt template. |
| `harness/tests/participant-prompts.test.ts` | TypeScript (Vitest) | Render tests for all 4 templates asserting key output markers. |
| `harness/tests/participant-schema.test.ts` | TypeScript (Vitest) | Strict Zod validation tests for all 4 agent configs and capability enums. |
| `harness/tests/multi-agent-roster.test.ts` | TypeScript (Vitest) | 4-agent parallel dispatch mock test asserting 4 distinct signals. |
| `harness/tests/evidence-fencing.test.ts` | TypeScript (Vitest) | Cross-agent data fence test asserting degradation on unapproved capabilities. |

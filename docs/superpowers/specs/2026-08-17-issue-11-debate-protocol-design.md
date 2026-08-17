# Story #11: 4-Round Adversarial Debate Protocol & Deterministic Arithmetic Consensus — Architecture Specification

> **Milestone**: MVP 1 (Story #11 / Story 8)
> **ADR References**: ADR-007 (Multi-Scenario on Deadlock), ADR-022 (4-Round Debate Protocol), ADR-023 (Participant Intent Asymmetry), ADR-024 (Adversarial Dissent & Deterministic Consensus)
> **Pre-requisite**: Story #10 (Participant Intent Sub-Agents: Price, FII, DII, Retail) — **Merged & Verified**
> **Academic Foundation**: "Improving Factuality through Multiagent Debate" (Du et al., 2023), "Only the Devil's Advocate Works" (OpenReview, 2026), "Diverse Evidence, Better Forecasts" (arXiv, 2026).

---

## 1. Executive Summary

Story #10 established the 4 specialized participant sub-agents (`price`, `fii`, `dii`, `retail`) operating under strict data asymmetry. Story #11 implements the structured **4-Round Adversarial Debate Protocol** that transforms these isolated signals into a battle-tested, calibrated market forecast.

To prevent the well-documented failure modes of multi-agent LLM systems (**sycophantic conformity** and **premature consensus collapse**), this architecture enforces:
1. **Targeted Cross-Examination** with cited evidence rebuttal (Round 2).
2. **Weighted Hard Devil's Advocate Selection** challenging the emerging majority (Round 3).
3. **Deterministic Arithmetic Consensus** (Round 4) where directional probabilities, health-discounted confidences, and dispersion metrics are computed mathematically without LLM hallucination.
4. **Deterministic Multi-Scenario Extraction on Deadlock** (ADR-007) mapped directly from Round 3 structured signals when dispersion exceeds threshold.

---

## 2. 4-Round Debate Architecture & Flow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 DEBATE ORCHESTRATOR                                    │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ROUND 1: Independent Participant Signals (Parallel Dispatch - Story #10)               │
│ • price (OHLCV/Momentum)                                                               │
│ • fii (Institutional F&O Flows)                                                        │
│ • dii (Domestic Liquidity & Cash Absorption)                                           │
│ • retail (Microstructure Delivery % & Option Chain PCR)                                │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ Emits 4 initial AgentSignal records
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ROUND 2: Targeted Cross-Examination & Peer Critique                                    │
│ • Every agent receives the full roster of Round 1 signals and evidence claims.         │
│ • Prompt mandate: Cross-examine peer assumptions, identify conflicting data lanes.     │
│ • Output: Revised probability, confidence, and explicit peer critique array.           │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ Emits 4 Round 2 revised Round2Signal records
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ROUND 3: Hard-Assigned Devil's Advocate Stress-Test                                    │
│ • Orchestrator computes weighted provisional majority P(up)^(R2) using normalized      │
│   weights w_hat_i.                                                                     │
│ • Selects DA: DA = argmax_i |P(up)_i - P(up)_majority| (agent most opposed to majority).│
│ • DA is explicitly mandated: "You MUST argue why the majority thesis will fail."       │
│ • Full Round 2 critiques and signal deltas are injected into prompt.                   │
│ • Output: Final stress-tested Round3Signal records.                                    │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │ Emits 4 Round 3 final Round3Signal records
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ROUND 4: Deterministic Arithmetic Consensus & Deadlock Extraction                      │
│ • Canonical normalization: P(up)_i = P_i if dir=='up' else 1 - P_i                     │
│ • Weighted consensus: P(up)_consensus = Σ (w_hat_i * P(up)_i)                          │
│ • Health-discounted confidence: C_consensus = (Σ w_hat_i * C_i) * (Σ w_i / Σ b_i)      │
│ • Weighted dispersion: σ_debate = sqrt(Σ w_hat_i * (P(up)_i - P(up)_consensus)^2)      │
│ • If σ_debate >= 0.18 OR 0.46 <= P(up)_consensus <= 0.54:                              │
│   → is_deadlocked = true; extracts top Bull Case & top Bear Case from R3 signals.      │
│ • Persist debate rounds and consensus forecast to PostgreSQL table debate_rounds       │
│   (with agent_name='consensus' for Round 4) and Langfuse.                              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Wire Format & Strict Schema Contracts (`harness/src/debate/types.ts`)

```typescript
import { z } from 'zod';
import { AgentSignalSchema, CapabilitySchema } from '../agents/schema.js';

export const AgentCritiqueItemSchema = z.object({
  target_agent: z.enum(['price', 'fii', 'dii', 'retail']),
  agreement_level: z.enum(['agree', 'partially_agree', 'disagree', 'strongly_oppose']),
  critique_point: z.string().min(1),
  counter_evidence_capability: CapabilitySchema.optional(),
}).strict();

export type AgentCritiqueItem = z.infer<typeof AgentCritiqueItemSchema>;

export const Round2SignalSchema = AgentSignalSchema.extend({
  round: z.literal(2),
  critiques: z.array(AgentCritiqueItemSchema).min(1),
  probability_delta: z.number().min(-1).max(1),
}).strict();

export type Round2Signal = z.infer<typeof Round2SignalSchema>;

export const Round3SignalSchema = AgentSignalSchema.extend({
  round: z.literal(3),
  is_devils_advocate: z.boolean(),
  catastrophic_risks: z.array(z.string()).min(1),
  invalidation_triggers: z.array(z.string()).min(1),
}).strict();

export type Round3Signal = z.infer<typeof Round3SignalSchema>;

export const ScenarioDetailSchema = z.object({
  primary_advocate: z.enum(['price', 'fii', 'dii', 'retail']),
  direction: z.enum(['up', 'down']),
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  primary_evidence_claims: z.array(z.string()).min(1),
  catastrophic_risks: z.array(z.string()).min(1),
  invalidation_triggers: z.array(z.string()).min(1),
  dissent: z.string().optional(),
}).strict();

export type ScenarioDetail = z.infer<typeof ScenarioDetailSchema>;

export const ScenarioSynthesisSchema = z.object({
  bull_case: ScenarioDetailSchema,
  bear_case: ScenarioDetailSchema,
}).strict();

export type ScenarioSynthesis = z.infer<typeof ScenarioSynthesisSchema>;

export const ParticipantWeightsSchema = z.object({
  price: z.number().min(0).max(1),
  fii: z.number().min(0).max(1),
  dii: z.number().min(0).max(1),
  retail: z.number().min(0).max(1),
}).strict().refine(
  (w) => Math.abs(w.price + w.fii + w.dii + w.retail - 1.0) < 0.001,
  { message: 'Normalized participant weights must sum to 1.0' }
);

export const SignalsByRoundSchema = z.object({
  round1: z.object({
    price: AgentSignalSchema,
    fii: AgentSignalSchema,
    dii: AgentSignalSchema,
    retail: AgentSignalSchema,
  }).strict(),
  round2: z.object({
    price: Round2SignalSchema,
    fii: Round2SignalSchema,
    dii: Round2SignalSchema,
    retail: Round2SignalSchema,
  }).strict(),
  round3: z.object({
    price: Round3SignalSchema,
    fii: Round3SignalSchema,
    dii: Round3SignalSchema,
    retail: Round3SignalSchema,
  }).strict(),
}).strict();

export const DebateConsensusSchema = z.object({
  symbol: z.string(),
  as_of: z.string().datetime(),
  direction: z.enum(['up', 'down']),
  consensus_probability: z.number().min(0).max(1),
  consensus_confidence: z.number().min(0).max(1),
  dispersion: z.number().min(0),
  is_deadlocked: z.boolean(),
  weights: ParticipantWeightsSchema,
  signals_by_round: SignalsByRoundSchema,
  scenarios: ScenarioSynthesisSchema.optional(),
}).strict();

export type DebateConsensus = z.infer<typeof DebateConsensusSchema>;
```

---

## 4. Deterministic Consensus Mathematical Algorithm (`harness/src/debate/consensus.ts`)

To uphold the core principle ("Numbers are code-calculated, narratives are LLM-assisted"), the consensus engine is a purely deterministic mathematical module with **zero LLM execution**.

### 4.1 Canonical Directional Normalization
Agents output directional predictions (`direction: 'up' | 'down'`, `probability: P_i \in [0, 1]`). Before computing any arithmetic mean or dispersion, all probabilities are normalized to a uniform directional baseline $P(\text{up})_i$:

$$P(\text{up})_i = \begin{cases} P_i & \text{if } \text{direction}_i = \text{"up"} \\ 1.0 - P_i & \text{if } \text{direction}_i = \text{"down"} \end{cases}$$

### 4.2 Weight Assignment & Degradation Penalties
1. **Base Calibration Weight ($b_i$)**:
   - Default equal weighting: $b_i = 0.25$ for all $i \in \{\text{price, fii, dii, retail}\}$.
   - When historical Brier accuracy scores exist in DB:
     $$\text{raw\_weight}_i = \max(0.001, 1.0 - \text{Brier}_i)$$
     $$\text{denom} = \sum_{j} \text{raw\_weight}_j$$
     $$b_i = \begin{cases} \frac{\text{raw\_weight}_i}{\text{denom}} & \text{if } \text{denom} > 10^{-6} \\ 0.25 & \text{if } \text{denom} \le 10^{-6} \end{cases}$$
2. **Degradation Penalty ($d_i$)**:
   - If an agent's signal was marked `degraded: true` (e.g. data absence on holidays, unapproved capability citation), its weight is penalized:
     $$w_i = \begin{cases} b_i \times 0.5 & \text{if degraded} \\ b_i & \text{if healthy} \end{cases}$$
3. **Normalized Weight ($\hat{w}_i$)**:
   $$\hat{w}_i = \frac{w_i}{\sum_{j} w_j}$$
4. **Global Health Factor ($H$)**:
   $$H = \frac{\sum_{i} w_i}{\sum_{i} b_i} \in [0.5, 1.0]$$

### 4.3 Probability & Confidence Aggregation
1. **Consensus Direction Probability**:
   $$P(\text{up})_{\text{consensus}} = \sum_{i} \hat{w}_i \cdot P(\text{up})_i$$
2. **Consensus Direction Classification**:
   $$\text{Direction} = \begin{cases} \text{"up"} & \text{if } P(\text{up})_{\text{consensus}} \ge 0.50 \\ \text{"down"} & \text{if } P(\text{up})_{\text{consensus}} < 0.50 \end{cases}$$
3. **Calibrated Output Probability**:
   $$P_{\text{consensus}} = \begin{cases} P(\text{up})_{\text{consensus}} & \text{if Direction} = \text{"up"} \\ 1.0 - P(\text{up})_{\text{consensus}} & \text{if Direction} = \text{"down"} \end{cases}$$
4. **Health-Discounted Confidence**:
   $$C_{\text{consensus}} = \left( \sum_{i} \hat{w}_i \cdot C_i^{(R3)} \right) \times H$$

### 4.4 Disagreement Dispersion Metric ($\sigma_{\text{debate}}$) & Deadlock Rule
Weighted standard deviation of Round 3 participant canonical probabilities:
$$\sigma_{\text{debate}} = \sqrt{\sum_{i} \hat{w}_i \cdot \left(P(\text{up})_i - P(\text{up})_{\text{consensus}}\right)^2}$$

* **Deadlock Condition (ADR-007)**:
  `is_deadlocked = true` if:
  $$\sigma_{\text{debate}} \ge 0.18 \quad \text{OR} \quad 0.46 \le P(\text{up})_{\text{consensus}} \le 0.54$$
* **Deterministic Dual-Scenario Extraction**:
  When deadlocked, the orchestrator deterministically extracts:
  1. **Bull Case**: Top advocate where $\text{direction} = \text{'up'}$ with highest $P(\text{up})_i$ (or highest $P_i$ if all are down).
  2. **Bear Case**: Top advocate where $\text{direction} = \text{'down'}$ with lowest $P(\text{up})_i$ (or lowest $P_i$ if all are up).
  The extracted `ScenarioDetail` is constructed directly from the advocate's Round 3 structured output without any LLM narrative synthesis.

---

## 5. Devil's Advocate Selection Algorithm

In Round 3, the orchestrator algorithmically determines the Devil's Advocate assignment:
1. Compute weighted Round 2 provisional consensus:
   $$P(\text{up})^{(R2)} = \sum_{i} \hat{w}_i \cdot P(\text{up})_i^{(R2)}$$
2. Provisional majority direction:
   $$\text{Majority} = \begin{cases} \text{"up"} & \text{if } P(\text{up})^{(R2)} \ge 0.50 \\ \text{"down"} & \text{if } P(\text{up})^{(R2)} < 0.50 \end{cases}$$
3. Distance metric from majority:
   $$D_i = \begin{cases} 1.0 - P(\text{up})_i^{(R2)} & \text{if Majority == 'up'} \\ P(\text{up})_i^{(R2)} & \text{if Majority == 'down'} \end{cases}$$
4. **Selection Rule**:
   $$\text{DA} = \arg\max_{i \in \{\text{price, fii, dii, retail}\}} D_i$$
   *(Ties broken deterministically by priority order: `retail` $\rightarrow$ `fii` $\rightarrow$ `dii` $\rightarrow$ `price`).*

---

## 6. Prompt Templates (`harness/prompts/debate/`)

### 6.1 `harness/prompts/debate/round2_critique.j2`

```jinja2
You are the {{ config.roleTitle }} (agent_name: "{{ config.name }}") for {{ symbol }} as of {{ as_of }}.

In Round 1, you gave an initial forecast of {{ round1_signal.direction | upper }} (probability: {{ round1_signal.probability }}, confidence: {{ round1_signal.confidence }}).

Here are the Round 1 initial forecasts and evidence claims from all 4 participant agents:
{% for peer_name, peer_signal in peer_signals %}
- [{{ peer_name | upper }}]: Direction={{ peer_signal.direction | upper }}, Prob={{ peer_signal.probability }}, Conf={{ peer_signal.confidence }}
  Evidence:
  {% for ev in peer_signal.evidence %}
  • "{{ ev.claim }}" (Source: {{ ev.source_capability }}, Value: {{ ev.value | string }})
  {% endfor %}
  Dissent note: {{ peer_signal.dissent | default("None") }}
{% endfor %}

YOUR ROUND 2 CROSS-EXAMINATION MANDATE:
1. Cross-examine the other agents' claims against your domain data and knowledge.
   - For example: Are technical momentum signals ignoring institutional flow exhaustion? Is retail PCR overly optimistic? Is domestic absorption sufficient to offset foreign selling?
2. You may execute Python code under /workspace/code/features/{{ config.workspaceSubpath }}/ to cross-check figures.
3. Conclude by calling the Round2Signal tool with your revised assessment:
   - `agent_name`: "{{ config.name }}"
   - `round`: 2
   - `direction`: "up" or "down" (binary only)
   - `probability`: updated calibrated probability (0.0 to 1.0)
   - `confidence`: updated confidence (0.0 to 1.0)
   - `probability_delta`: change from your Round 1 probability (e.g. +0.05 or -0.10)
   - `critiques`: list of targeted critique items for the other agents (target_agent, agreement_level, critique_point).
   - `evidence`: updated or reaffirmed evidence citations.
```

---

### 6.2 `harness/prompts/debate/round3_devils_advocate.j2`

```jinja2
You are the {{ config.roleTitle }} (agent_name: "{{ config.name }}") in Round 3 (Devil's Advocate Stress-Test) for {{ symbol }} as of {{ as_of }}.

PROVISIONAL ROUND 2 SUMMARY:
The provisional consensus across Round 2 is leaning {{ majority_direction | upper }} (P(up) = {{ avg_p_up | round(2) }}).

ROUND 2 PEER CRITIQUES AND DELTAS:
{% for peer_name, peer_signal in peer_r2_signals %}
- [{{ peer_name | upper }}]: Direction={{ peer_signal.direction | upper }}, Prob={{ peer_signal.probability }}, Delta={{ peer_signal.probability_delta }}
  Critiques:
  {% for c in peer_signal.critiques %}
  • Target: {{ c.target_agent | upper }} ({{ c.agreement_level }}): {{ c.critique_point }}
  {% endfor %}
{% endfor %}

{% if is_devils_advocate %}
CRITICAL MANDATE — HARD DEVIL'S ADVOCATE ASSIGNMENT:
You have been designated as the primary Devil's Advocate because your domain evidence is most opposed to the provisional {{ majority_direction | upper }} majority.
You MUST aggressively challenge and stress-test the {{ majority_direction | upper }} thesis:
- Identify unmodeled tail risks, regime shifts, liquidity traps, short-squeezes, or macro shocks that will cause the majority thesis to catastrophically fail.
{% else %}
ROUND 3 MANDATE:
Stress-test your position against the Round 2 critiques and identify key invalidation triggers before final consensus.
{% endif %}

Conclude by calling the Round3Signal tool with your final positions:
- `agent_name`: "{{ config.name }}"
- `round`: 3
- `direction`: "up" or "down"
- `probability`: final calibrated probability (0.0 to 1.0)
- `confidence`: final confidence (0.0 to 1.0)
- `is_devils_advocate`: {{ "true" if is_devils_advocate else "false" }}
- `catastrophic_risks`: list of structural tail risks that threaten your thesis or market stability.
- `invalidation_triggers`: explicit market price or flow levels that would completely invalidate this forecast.
- `evidence`: final evidence items.
```

---

## 7. PostgreSQL Database Migration (`006_debate_rounds.sql`)

```sql
CREATE TABLE IF NOT EXISTS debate_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forecast_id UUID REFERENCES forecasts(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    round_number INT NOT NULL CHECK (round_number BETWEEN 1 AND 4),
    agent_name TEXT NOT NULL CHECK (agent_name IN ('price', 'fii', 'dii', 'retail', 'consensus')),
    direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
    probability DOUBLE PRECISION NOT NULL CHECK (probability BETWEEN 0.0 AND 1.0),
    confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    degraded BOOLEAN NOT NULL DEFAULT FALSE,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_debate_rounds_forecast_round_agent UNIQUE (forecast_id, round_number, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_debate_rounds_forecast_id ON debate_rounds(forecast_id);
CREATE INDEX IF NOT EXISTS idx_debate_rounds_symbol_as_of ON debate_rounds(symbol, as_of);
```

*Note on Round 4 Record*: In Round 4, the synthesized `DebateConsensus` is serialized and inserted into `debate_rounds` using `round_number = 4` and `agent_name = 'consensus'`.

---

## 8. Deliverables & Testing Matrix

| Deliverable File | Type | Purpose |
|---|---|---|
| `harness/src/storage/migrations/006_debate_rounds.sql` | SQL | Database schema with unique constraint for storing full round-by-round debate transcripts. |
| `harness/src/debate/types.ts` | TypeScript | Strict Zod schemas (`.strict()`) for Round 2, Round 3, and Consensus with weight sum refinement. |
| `harness/src/debate/consensus.ts` | TypeScript | Deterministic mathematical aggregation engine with canonical $P(\text{up})$ normalization, health factor, and deterministic dual scenario extraction. |
| `harness/src/debate/orchestrator.ts` | TypeScript | 4-Round orchestrator coordinating R1 $\rightarrow$ R2 $\rightarrow$ R3 $\rightarrow$ R4 with weighted DA selection. |
| `harness/prompts/debate/round2_critique.j2` | Nunjucks | Cross-examination prompt template. |
| `harness/prompts/debate/round3_devils_advocate.j2` | Nunjucks | Hard Devil's Advocate prompt template with full R2 critique state injection and neutral risk prompt. |
| `harness/tests/debate-consensus.test.ts` | TypeScript (Vitest) | Tests for mathematical normalization, dispersion, degradation penalties, and zero-math certainty. |
| `harness/tests/debate-orchestrator.test.ts` | TypeScript (Vitest) | 4-round state machine transitions, peer injection, and mock execution. |
| `harness/tests/debate-deadlock.test.ts` | TypeScript (Vitest) | Deterministic dual-scenario generation when dispersion threshold is breached. |
| `harness/scripts/run-real-debate.ts` | TypeScript (Node) | Real end-to-end multi-agent debate execution against live DeepSeek on `TCS.NS`. |

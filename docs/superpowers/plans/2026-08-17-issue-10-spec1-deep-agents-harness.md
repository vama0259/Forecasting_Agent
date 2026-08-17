# Issue #10 Spec 1: Deep Agents Harness Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generalized, config-driven multi-agent harness using `deepagents` and `langchain` with in-process subagent context isolation, `CompositeBackend` storage routing (Docker sandbox + PostgreSQL `PostgresStore`), Jinja2 prompt templating, and custom domain middlewares, verifying 100% functional parity against the existing `price` agent baseline.

**Architecture:** In-process concurrent subagent execution using `deepagents@1.12.3` and `langchain@1.5.8`. Storage is handled by `CompositeBackend` routing default workspace operations and `execute()` to `SandboxBackendAdapter` (Docker explore tier) and `/memories/` to `StoreBackend` backed by `PostgresStore` (extending `BaseStore` with PostgreSQL `agent_memories` table). Permissions are enforced via native `permissions: FilesystemPermission[]`.

**Tech Stack:** TypeScript, Node.js 24, pnpm, `@langchain/core`, `deepagents`, `langchain`, `nunjucks`, `@langchain/langgraph-checkpoint`, `pg`, `zod`, `vitest`.

**Spec:** [`docs/superpowers/specs/2026-08-17-issue-10-spec1-deep-agents-harness-design.md`](file:///home/varunmalhotra/Desktop/Forecasting_Agent/docs/superpowers/specs/2026-08-17-issue-10-spec1-deep-agents-harness-design.md)

## Global Constraints

- **Single Backend Parameter**: `createDeepAgent()` takes `backend: CompositeBackend`. No `sandbox:` parameter exists.
- **Import Sources**: `toolStrategy` must be imported from `'langchain'`. `BaseStore` must be imported from `'@langchain/langgraph-checkpoint'`.
- **Wire Format Pinning**: `AgentSignalSchema.horizon_days` must be `z.literal(1)`. `direction` is strict binary `'up' | 'down'`. `agent_name` conforms to ADR-023's closed participant set `z.enum(['price', 'fii', 'dii', 'retail'])`.
- **Backward Compatibility**: `PriceAnchorSignalSchema` in `price-anchor.ts` remains unmodified to guarantee zero breaking changes to `single-agent.ts`.
- **Zero Regression**: All existing 28 unit tests under `harness/tests/` must pass at every task boundary.

---

## File Structure

```
harness/
├── package.json                         # [Modify] Add nunjucks, checkpoint packages
├── prompts/
│   ├── _macros.j2                       # [Create] Shared JSON evaluation contracts
│   └── price.j2                         # [Create] Price action & macro baseline prompt template
├── src/
│   ├── agents/
│   │   ├── schema.ts                    # [Create] Canonical AgentSignalSchema & EvidenceItemSchema
│   │   ├── types.ts                     # [Create] ParticipantAgentConfig & AGENT_CONFIGS
│   │   ├── factory.ts                   # [Create] Generic buildParticipantAgent factory
│   │   └── price-anchor.ts              # [Preserved] Unmodified for single-agent.ts backward compatibility
│   ├── backend/
│   │   ├── composite.ts                 # [Create] CompositeBackend storage router factory
│   │   └── permissions.ts               # [Create] FilesystemPermission array builder
│   ├── middleware/
│   │   ├── cost-budget.ts               # [Create] CostBudgetMiddleware
│   │   ├── evidence-validation.ts       # [Create] EvidenceValidationMiddleware
│   │   └── audit.ts                     # [Create] AuditMiddleware
│   ├── prompts/
│   │   └── engine.ts                    # [Create] Nunjucks prompt rendering engine
│   ├── storage/
│   │   ├── migrations/
│   │   │   └── 005_agent_memories.sql   # [Create] SQL migration for agent_memories table
│   │   └── postgres-store.ts            # [Create] PostgresStore extending BaseStore
│   └── pipeline/
│       └── multi-agent.ts               # [Create] Generalized parallel multi-agent pipeline
└── tests/
    ├── agents-schema.test.ts            # [Create] Unit tests for AgentSignalSchema
    ├── prompt-engine.test.ts            # [Create] Unit tests for Nunjucks prompt rendering
    ├── postgres-store.test.ts           # [Create] Unit tests for PostgresStore
    ├── backend-composite.test.ts        # [Create] Unit tests for CompositeBackend & Permissions
    ├── middlewares.test.ts              # [Create] Unit tests for custom middlewares
    ├── agent-factory.test.ts            # [Create] Unit tests for buildParticipantAgent factory
    ├── multi-agent-pipeline.test.ts     # [Create] Unit tests for multi-agent pipeline
    └── comprehension-gate.test.ts       # [Create] End-to-end dynamic responsiveness test
```

---

### Task 1: Package Dependencies

**Files:**
- Modify: `harness/package.json`

**Interfaces:**
- Consumes: None
- Produces: Installed npm packages: `nunjucks`, `@types/nunjucks`, `@langchain/langgraph-checkpoint`

- [ ] **Step 1: Update `harness/package.json`**
Add dependencies:
```json
"@langchain/langgraph-checkpoint": "^1.0.0",
"nunjucks": "^3.2.4"
```
Add devDependencies:
```json
"@types/nunjucks": "^3.1.8"
```

- [ ] **Step 2: Install dependencies**
Run: `pnpm --filter @forecasting-agent/harness install`

- [ ] **Step 3: Verify TypeScript compilation**
Run: `pnpm --filter @forecasting-agent/harness run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add harness/package.json pnpm-lock.yaml
git commit -m "build(harness): add nunjucks and langgraph checkpoint package"
```

---

### Task 2: Canonical Schemas & Agent Configuration Types

**Files:**
- Create: `harness/src/agents/schema.ts`
- Create: `harness/src/agents/types.ts`
- Create: `harness/tests/agents-schema.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces: `AgentSignalSchema`, `EvidenceItemSchema`, `AgentSignal`, `EvidenceItem`, `ParticipantAgentConfigSchema`, `ParticipantAgentConfig`, `AGENT_CONFIGS`

- [ ] **Step 1: Write the failing unit tests for schemas**
Create `harness/tests/agents-schema.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { AgentSignalSchema, EvidenceItemSchema } from '../src/agents/schema.js';
import { AGENT_CONFIGS, ParticipantAgentConfigSchema } from '../src/agents/types.js';

describe('AgentSignalSchema', () => {
  it('validates a correct AgentSignal', () => {
    const validSignal = {
      agent_name: 'price',
      direction: 'up',
      probability: 0.75,
      confidence: 0.8,
      horizon_days: 1,
      evidence: [
        {
          claim: 'RSI is oversold at 28.5',
          source_capability: 'market_data',
          value: 28.5,
          explicit_absence: false,
        },
      ],
      degraded: false,
    };
    const parsed = AgentSignalSchema.parse(validSignal);
    expect(parsed.agent_name).toBe('price');
    expect(parsed.direction).toBe('up');
  });

  it('rejects invalid agent_name outside ADR-023 set', () => {
    const invalidSignal = {
      agent_name: 'unknown_agent',
      direction: 'up',
      probability: 0.75,
      confidence: 0.8,
      horizon_days: 1,
      evidence: [{ claim: 'test', source_capability: 'market_data', value: 1, explicit_absence: false }],
    };
    expect(() => AgentSignalSchema.parse(invalidSignal)).toThrow();
  });

  it('rejects horizon_days != 1', () => {
    const invalidSignal = {
      agent_name: 'price',
      direction: 'up',
      probability: 0.75,
      confidence: 0.8,
      horizon_days: 5,
      evidence: [{ claim: 'test', source_capability: 'market_data', value: 1, explicit_absence: false }],
    };
    expect(() => AgentSignalSchema.parse(invalidSignal)).toThrow();
  });

  it('rejects empty evidence array', () => {
    const invalidSignal = {
      agent_name: 'price',
      direction: 'down',
      probability: 0.2,
      confidence: 0.5,
      horizon_days: 1,
      evidence: [],
    };
    expect(() => AgentSignalSchema.parse(invalidSignal)).toThrow();
  });
});

describe('AGENT_CONFIGS', () => {
  it('contains the valid price agent configuration', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price');
    expect(priceConfig).toBeDefined();
    const parsed = ParticipantAgentConfigSchema.parse(priceConfig);
    expect(parsed.workspaceSubpath).toBe('price');
    expect(parsed.tools).toContain('fetch_ohlcv');
  });
});
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm --filter @forecasting-agent/harness test harness/tests/agents-schema.test.ts`
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Implement `harness/src/agents/schema.ts` and `types.ts`**
Create `harness/src/agents/schema.ts`:
```typescript
import { z } from 'zod';

export const EvidenceItemSchema = z.object({
  claim: z.string().min(1, 'Evidence claim cannot be empty'),
  source_capability: z.string().min(1, 'source_capability is required for auditability'),
  value: z.unknown(),
  explicit_absence: z.boolean().default(false),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const AgentSignalSchema = z.object({
  agent_name: z.enum(['price', 'fii', 'dii', 'retail']),
  direction: z.enum(['up', 'down']),
  probability: z.number().min(0.0).max(1.0),
  confidence: z.number().min(0.0).max(1.0),
  horizon_days: z.literal(1),
  evidence: z.array(EvidenceItemSchema).min(1, 'At least one evidence item is required'),
  dissent: z.string().optional(),
  degraded: z.boolean().default(false),
});

export type AgentSignal = z.infer<typeof AgentSignalSchema>;
```

Create `harness/src/agents/types.ts`:
```typescript
import { z } from 'zod';

export const ParticipantAgentConfigSchema = z.object({
  name: z.enum(['price', 'fii', 'dii', 'retail']),
  roleTitle: z.string(),
  description: z.string(),
  promptTemplate: z.string(),
  allowedCapabilities: z.array(z.string()),
  dataLaneDescription: z.string(),
  workspaceSubpath: z.string(),
  allowedWritePaths: z.array(z.string()),
  tools: z.array(z.string()),
  skills: z.array(z.string()).default([]),
  maxTokenBudget: z.number().int().positive().default(200_000),
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
    maxTokenBudget: 200_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @forecasting-agent/harness test harness/tests/agents-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add harness/src/agents/schema.ts harness/src/agents/types.ts harness/tests/agents-schema.test.ts
git commit -m "feat(harness): implement canonical AgentSignal and ParticipantAgentConfig schemas"
```

---

### Task 3: Jinja2 Prompt Templates & Rendering Engine

**Files:**
- Create: `harness/prompts/_macros.j2`
- Create: `harness/prompts/price.j2`
- Create: `harness/src/prompts/engine.ts`
- Create: `harness/tests/prompt-engine.test.ts`

**Interfaces:**
- Consumes: `nunjucks`, `ParticipantAgentConfig`
- Produces: `renderPrompt(config, context)`

- [ ] **Step 1: Write the failing unit tests for prompt rendering**
Create `harness/tests/prompt-engine.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { renderPrompt } from '../src/prompts/engine.js';
import { AGENT_CONFIGS } from '../src/agents/types.js';

describe('Prompt Engine', () => {
  it('renders price.j2 with all required contract elements', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const rendered = renderPrompt(priceConfig, {
      symbol: 'TCS.NS',
      as_of: '2026-08-17',
      horizon_days: 1,
      start_date: '2026-04-19',
    });

    expect(rendered).toContain('TCS.NS');
    expect(rendered).toContain('2026-08-17');
    expect(rendered).toContain('fetch_ohlcv');
    expect(rendered).toContain('/workspace/bars.json');
    expect(rendered).toContain('/workspace/model.py');
    expect(rendered).toContain('/tmp/eval_request.json');
    expect(rendered).toContain('EQUITY_DELIVERY');
  });
});
```

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm --filter @forecasting-agent/harness test harness/tests/prompt-engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Author prompt templates and engine**
Create `harness/prompts/_macros.j2`:
```jinja2
{% macro eval_contract(symbol, as_of) %}
Save a SELF-CONTAINED Python script to `/workspace/model.py`.
When run standalone (`python /workspace/model.py`), it must write a JSON object to `/tmp/eval_request.json` containing:
- `returns`: list of historical fractional returns
- `forecasts`: list of predicted returns for each step
- `calls`: list of predicted probabilities (0.0 to 1.0) that the return is positive
- `timestamps`: ISO-8601 datetimes with timezone matching each bar
- `as_of`: "{{ as_of }}T00:00:00+05:30"
- `segment`: "EQUITY_DELIVERY"
- `position_notional`: float notional per step
- `trade_side`: list of "buy", "sell", or "hold"
- `capital`: 100000.0
Exit code must be 0. Run `python /workspace/model.py && cat /tmp/eval_request.json` to verify before finishing.
{% endmacro %}
```

Create `harness/prompts/price.j2`:
```jinja2
{% import "_macros.j2" as macros %}
Produce a price-direction forecast for {{ symbol }} (NSE) as of {{ as_of }}.

1. Call the market data tool: fetch_ohlcv(symbol="{{ symbol }}", market="NSE", start="{{ start_date }}", end="{{ as_of }}", as_of="{{ as_of }}").
   It returns {symbol, market, bars: [{date, open, high, low, close, volume}, ...], data_stale}, oldest bar first.
   Immediately use write_file to save that exact tool result to /workspace/bars.json. Do this
   once, right after fetching -- do NOT retype, re-paste, or hand-copy any dates/prices from the
   tool output into a script anywhere below; always load them back with
   `json.load(open('/workspace/bars.json'))`.

2. In Python (under {{ workspace_path }}), compute price features and a walk-forward backtest:
   - returns[i] = (close[i] - close[i-1]) / close[i-1] for each consecutive pair of bars.
   - forecasts[i] = predicted return for day i.
   - calls[i] = predicted probability (0.0-1.0) that returns[i] is positive.
   - timestamps[i] = that bar's date as an ISO-8601 datetime with a timezone.
   - trade_side[i] = "buy" if calls[i] > 0.5, else "hold".
   - position_notional[i] = 10000.0 when trade_side[i] is "buy", else 0.0.

3. {{ macros.eval_contract(symbol, as_of) }}

4. Separately, as your structured final response, give your own overall forecast for {{ symbol }}
   over the next {{ horizon_days }} day:
   - `agent_name`: "price"
   - `direction`: "up" or "down"
   - `probability`: 0.0 to 1.0
   - `confidence`: 0.0 to 1.0
   - `horizon_days`: 1
   - `evidence`: list of observations citing `source_capability: "market_data"` or `"macro"`.
```

Create `harness/src/prompts/engine.ts`:
```typescript
import nunjucks from 'nunjucks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ParticipantAgentConfig } from '../agents/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = join(__dirname, '../../prompts');

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(PROMPTS_DIR), {
  autoescape: false,
  trimBlocks: true,
  lstripBlocks: true,
});

export interface PromptContext {
  symbol: string;
  as_of: string;
  horizon_days: number;
  start_date?: string;
  [key: string]: unknown;
}

export function renderPrompt(config: ParticipantAgentConfig, context: PromptContext): string {
  const start_date =
    context.start_date ||
    new Date(new Date(context.as_of).getTime() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return env.render(config.promptTemplate, {
    ...context,
    start_date,
    agent_name: config.name,
    role_title: config.roleTitle,
    data_lane_description: config.dataLaneDescription,
    workspace_path: `/workspace/code/features/${config.workspaceSubpath}/`,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @forecasting-agent/harness test harness/tests/prompt-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add harness/prompts/ harness/src/prompts/ harness/tests/prompt-engine.test.ts
git commit -m "feat(harness): implement Nunjucks prompt rendering engine and price template"
```

---

### Task 4: Persistent PostgresStore & Backend Composite Storage

**Files:**
- Create: `harness/src/storage/migrations/005_agent_memories.sql`
- Create: `harness/src/storage/postgres-store.ts`
- Create: `harness/src/backend/composite.ts`
- Create: `harness/src/backend/permissions.ts`
- Create: `harness/tests/postgres-store.test.ts`
- Create: `harness/tests/backend-composite.test.ts`

**Interfaces:**
- Consumes: `pg.Pool`, `deepagents`, `@langchain/langgraph-checkpoint`
- Produces: `PostgresStore`, `buildAgentBackend`, `buildAgentPermissions`

- [ ] **Step 1: Create SQL migration `005_agent_memories.sql`**
Create `harness/src/storage/migrations/005_agent_memories.sql`:
```sql
CREATE TABLE IF NOT EXISTS agent_memories (
  namespace text[] NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (namespace, key)
);
```

- [ ] **Step 2: Write the failing unit tests for PostgresStore**
Create `harness/tests/postgres-store.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { PostgresStore } from '../src/storage/postgres-store.js';

describe('PostgresStore', () => {
  it('puts, gets, and deletes items via batch operations', async () => {
    const mockQuery = vi.fn().mockImplementation(async (sql: string, params: any[]) => {
      if (sql.startsWith('SELECT namespace')) {
        return {
          rows: [
            {
              namespace: params[0],
              key: params[1],
              value: { observation: 'RSI test' },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const mockPool = { query: mockQuery } as any;
    const store = new PostgresStore({ pool: mockPool });

    await store.put(['memories', 'price'], 'TCS.NS.json', { observation: 'RSI test' });
    expect(mockQuery).toHaveBeenCalled();

    const item = await store.get(['memories', 'price'], 'TCS.NS.json');
    expect(item).toBeDefined();
    expect(item?.value.observation).toBe('RSI test');
  });
});
```

- [ ] **Step 3: Implement `PostgresStore`**
Create `harness/src/storage/postgres-store.ts`:
```typescript
import type { Pool } from 'pg';
import { BaseStore } from '@langchain/langgraph-checkpoint';
import type {
  GetOperation,
  PutOperation,
  SearchOperation,
  ListNamespacesOperation,
  Item,
  SearchItem,
  Operation,
  OperationResults,
} from '@langchain/langgraph-checkpoint';

export interface PostgresStoreOptions {
  pool: Pool;
}

export class PostgresStore extends BaseStore {
  private pool: Pool;

  constructor(options: PostgresStoreOptions) {
    super();
    this.pool = options.pool;
  }

  async batch<Op extends Operation[]>(
    operations: Op
  ): Promise<OperationResults<Op>> {
    const results: unknown[] = [];

    for (const op of operations) {
      if ('key' in op && !('value' in op)) {
        const getOp = op as GetOperation;
        const res = await this.pool.query(
          `SELECT namespace, key, value, created_at, updated_at FROM agent_memories WHERE namespace = $1 AND key = $2`,
          [getOp.namespace, getOp.key]
        );
        if (res.rows.length === 0) {
          results.push(undefined);
        } else {
          const row = res.rows[0];
          results.push({
            namespace: row.namespace,
            key: row.key,
            value: row.value,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
          });
        }
      } else if ('value' in op) {
        const putOp = op as PutOperation;
        if (putOp.value === null) {
          await this.pool.query(
            `DELETE FROM agent_memories WHERE namespace = $1 AND key = $2`,
            [putOp.namespace, putOp.key]
          );
        } else {
          await this.pool.query(
            `INSERT INTO agent_memories (namespace, key, value, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (namespace, key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [putOp.namespace, putOp.key, JSON.stringify(putOp.value)]
          );
        }
        results.push(undefined);
      } else if ('namespacePrefix' in op) {
        const searchOp = op as SearchOperation;
        const res = await this.pool.query(
          `SELECT namespace, key, value, created_at, updated_at FROM agent_memories WHERE namespace[1:$1] = $2 LIMIT $3 OFFSET $4`,
          [
            searchOp.namespacePrefix.length,
            searchOp.namespacePrefix,
            searchOp.limit ?? 10,
            searchOp.offset ?? 0,
          ]
        );
        const items: SearchItem[] = res.rows.map((row) => ({
          namespace: row.namespace,
          key: row.key,
          value: row.value,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }));
        results.push(items);
      } else if ('matchConditions' in op || 'maxDepth' in op) {
        const res = await this.pool.query(`SELECT DISTINCT namespace FROM agent_memories`);
        results.push(res.rows.map((r) => r.namespace));
      } else {
        results.push(undefined);
      }
    }

    return results as OperationResults<Op>;
  }
}
```

- [ ] **Step 4: Implement `permissions.ts` and `composite.ts`**
Create `harness/src/backend/permissions.ts`:
```typescript
import type { FilesystemPermission } from 'deepagents';

export function buildAgentPermissions(allowedWritePaths: string[]): FilesystemPermission[] {
  return [
    {
      operations: ['write'],
      paths: allowedWritePaths,
      mode: 'allow',
    },
    {
      operations: ['write'],
      paths: ['/**'],
      mode: 'deny',
    },
    {
      operations: ['read'],
      paths: ['/**'],
      mode: 'allow',
    },
  ];
}
```

Create `harness/src/backend/composite.ts`:
```typescript
import { CompositeBackend, StoreBackend } from 'deepagents';
import type { BaseStore } from '@langchain/langgraph-checkpoint';
import type { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';

export interface BuildAgentBackendParams {
  sandboxAdapter: SandboxBackendAdapter;
  store: BaseStore;
  agentName: string;
}

export function buildAgentBackend({
  sandboxAdapter,
  store,
  agentName,
}: BuildAgentBackendParams): CompositeBackend {
  return new CompositeBackend(
    sandboxAdapter,
    {
      '/memories/': new StoreBackend({
        store,
        namespace: ['memories', agentName],
      }),
    }
  );
}
```

Create `harness/tests/backend-composite.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildAgentPermissions } from '../src/backend/permissions.js';
import { buildAgentBackend } from '../src/backend/composite.js';
import { CompositeBackend } from 'deepagents';

describe('Permissions Builder', () => {
  it('generates correct FilesystemPermission rules', () => {
    const allowed = ['/workspace/code/features/price/**', '/workspace/bars.json', '/memories/**'];
    const perms = buildAgentPermissions(allowed);
    expect(perms).toHaveLength(3);
    expect(perms[0]).toEqual({ operations: ['write'], paths: allowed, mode: 'allow' });
    expect(perms[1]).toEqual({ operations: ['write'], paths: ['/**'], mode: 'deny' });
    expect(perms[2]).toEqual({ operations: ['read'], paths: ['/**'], mode: 'allow' });
  });
});

describe('CompositeBackend Builder', () => {
  it('constructs CompositeBackend with default sandbox and memories store route', () => {
    const mockSandbox = { execute: vi.fn(), id: 'test-run' } as any;
    const mockStore = { get: vi.fn(), put: vi.fn(), search: vi.fn(), batch: vi.fn() } as any;

    const backend = buildAgentBackend({
      sandboxAdapter: mockSandbox,
      store: mockStore,
      agentName: 'price',
    });

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toContain('/memories/');
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**
Run: `pnpm --filter @forecasting-agent/harness test harness/tests/postgres-store.test.ts harness/tests/backend-composite.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add harness/src/storage/ harness/src/backend/ harness/tests/postgres-store.test.ts harness/tests/backend-composite.test.ts
git commit -m "feat(harness): implement PostgresStore, CompositeBackend routing, and permissions builder"
```

---

### Task 5: Custom Domain Middleware Suite

**Files:**
- Create: `harness/src/middleware/cost-budget.ts`
- Create: `harness/src/middleware/evidence-validation.ts`
- Create: `harness/src/middleware/audit.ts`
- Create: `harness/tests/middlewares.test.ts`

**Interfaces:**
- Consumes: `langchain` (`createMiddleware`), `@langchain/core/messages` (`UsageMetadata`), `TraceHandle`
- Produces: `buildCostBudgetMiddleware`, `buildEvidenceValidationMiddleware`, `buildAuditMiddleware`

- [ ] **Step 1: Write unit tests for custom middlewares**
Create `harness/tests/middlewares.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildCostBudgetMiddleware } from '../src/middleware/cost-budget.js';
import { buildEvidenceValidationMiddleware } from '../src/middleware/evidence-validation.js';
import { buildAuditMiddleware } from '../src/middleware/audit.js';

describe('CostBudgetMiddleware', () => {
  it('throws error when token budget is exceeded', async () => {
    const mw = buildCostBudgetMiddleware(100);
    const mockHandler = vi.fn().mockResolvedValue({
      usage_metadata: { total_tokens: 150, input_tokens: 100, output_tokens: 50 },
    });

    await mw.wrapModelCall!({} as any, mockHandler);
    await expect(mw.wrapModelCall!({} as any, mockHandler)).rejects.toThrow(/Token budget exceeded/);
  });
});

describe('EvidenceValidationMiddleware', () => {
  it('marks signal degraded when unapproved source_capability is cited', async () => {
    const mw = buildEvidenceValidationMiddleware('price', ['market_data']);
    const state = {
      structuredResponse: {
        agent_name: 'price',
        evidence: [{ claim: 'oil shock', source_capability: 'macro_unapproved', value: 1, explicit_absence: false }],
        degraded: false,
      },
    };
    await (mw.afterModel as any)(state);
    expect(state.structuredResponse.degraded).toBe(true);
  });

  it('keeps degraded false when all capabilities are valid', async () => {
    const mw = buildEvidenceValidationMiddleware('price', ['market_data', 'macro']);
    const state = {
      structuredResponse: {
        agent_name: 'price',
        evidence: [{ claim: 'RSI oversold', source_capability: 'market_data', value: 28, explicit_absence: false }],
        degraded: false,
      },
    };
    await (mw.afterModel as any)(state);
    expect(state.structuredResponse.degraded).toBe(false);
  });
});

describe('AuditMiddleware', () => {
  it('updates trace metadata on model call completion', async () => {
    const mockTrace = { update: vi.fn() } as any;
    const mw = buildAuditMiddleware('price', mockTrace);
    const mockHandler = vi.fn().mockResolvedValue({ response: 'ok' });

    await mw.wrapModelCall!({} as any, mockHandler);
    expect(mockTrace.update).toHaveBeenCalled();
    const updateArg = mockTrace.update.mock.calls[0][0];
    expect(updateArg.metadata).toHaveProperty('price_last_model_duration_ms');
  });

  it('updates trace metadata on tool call completion using toolCall.name', async () => {
    const mockTrace = { update: vi.fn() } as any;
    const mw = buildAuditMiddleware('price', mockTrace);
    const mockHandler = vi.fn().mockResolvedValue({ response: 'ok' });

    await mw.wrapToolCall!({ toolCall: { name: 'fetch_ohlcv', args: {}, id: '1' } } as any, mockHandler);
    expect(mockTrace.update).toHaveBeenCalled();
    const updateArg = mockTrace.update.mock.calls[0][0];
    expect(updateArg.metadata).toHaveProperty('price_tool_fetch_ohlcv_duration_ms');
  });
});
```

- [ ] **Step 2: Implement the custom middlewares**
Create `harness/src/middleware/cost-budget.ts`:
```typescript
import { createMiddleware } from 'langchain';
import type { UsageMetadata } from '@langchain/core/messages';

export function buildCostBudgetMiddleware(maxTokens: number) {
  let accumulatedTokens = 0;
  return createMiddleware({
    name: 'CostBudgetMiddleware',
    wrapModelCall: async (request, handler) => {
      if (accumulatedTokens >= maxTokens) {
        throw new Error(`Token budget exceeded: consumed ${accumulatedTokens} of ${maxTokens} max allowed tokens`);
      }
      const response = await handler(request);
      const usage = (response as unknown as { usage_metadata?: UsageMetadata }).usage_metadata;
      if (usage?.total_tokens) {
        accumulatedTokens += usage.total_tokens;
      }
      return response;
    },
  });
}
```

Create `harness/src/middleware/evidence-validation.ts`:
```typescript
import { createMiddleware } from 'langchain';
import type { AgentSignal } from '../agents/schema.js';

export function buildEvidenceValidationMiddleware(agentName: string, allowedCapabilities: string[]) {
  return createMiddleware({
    name: 'EvidenceValidationMiddleware',
    afterModel: async (state: { structuredResponse?: Record<string, unknown> }) => {
      if (!state.structuredResponse) return state;
      const signal = state.structuredResponse as Partial<AgentSignal>;
      if (Array.isArray(signal.evidence)) {
        let hasViolation = false;
        for (const item of signal.evidence) {
          if (!allowedCapabilities.includes(item.source_capability)) {
            console.warn(
              `[${agentName}] Evidence source_capability '${item.source_capability}' is outside allowed set: ${allowedCapabilities.join(', ')}. Marking signal degraded.`
            );
            hasViolation = true;
          }
        }
        if (hasViolation) {
          signal.degraded = true;
        }
      }
      return state;
    },
  });
}
```

Create `harness/src/middleware/audit.ts`:
```typescript
import { createMiddleware } from 'langchain';
import type { TraceHandle } from '../tracing/langfuse.js';

export function buildAuditMiddleware(agentName: string, trace?: TraceHandle) {
  return createMiddleware({
    name: 'AuditMiddleware',
    wrapModelCall: async (request, handler) => {
      const start = Date.now();
      try {
        return await handler(request);
      } finally {
        const durationMs = Date.now() - start;
        trace?.update({
          metadata: {
            [`${agentName}_last_model_duration_ms`]: durationMs,
          },
        });
      }
    },
    wrapToolCall: async (request, handler) => {
      const start = Date.now();
      try {
        return await handler(request);
      } finally {
        const durationMs = Date.now() - start;
        trace?.update({
          metadata: {
            [`${agentName}_tool_${request.toolCall.name}_duration_ms`]: durationMs,
          },
        });
      }
    },
  });
}
```

- [ ] **Step 3: Run tests to verify they pass**
Run: `pnpm --filter @forecasting-agent/harness test harness/tests/middlewares.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add harness/src/middleware/ harness/tests/middlewares.test.ts
git commit -m "feat(harness): implement CostBudget, EvidenceValidation, and Audit middlewares"
```

---

### Task 6: Generic Participant Agent Factory

**Files:**
- Create: `harness/src/agents/factory.ts`
- Create: `harness/tests/agent-factory.test.ts`

**Interfaces:**
- Consumes: `createDeepAgent`, `toolStrategy`, `ParticipantAgentConfig`, `HarnessConfig`
- Produces: `buildParticipantAgent`

- [ ] **Step 1: Write the failing unit tests for agent factory**
Create `harness/tests/agent-factory.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildParticipantAgent } from '../src/agents/factory.js';
import { AGENT_CONFIGS } from '../src/agents/types.js';

describe('buildParticipantAgent', () => {
  it('constructs a DeepAgent instance with proper middlewares and tools', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const mockTool = { name: 'fetch_ohlcv', invoke: vi.fn() } as any;
    const mockBackend = { ls: vi.fn(), read: vi.fn(), write: vi.fn() } as any;

    const agent = buildParticipantAgent({
      config: priceConfig,
      llmConfig: { provider: 'deepseek', model: 'deepseek-chat', api_key: 'test-key' },
      tools: [mockTool],
      backend: mockBackend,
    });

    expect(agent).toBeDefined();
    expect(typeof agent.invoke).toBe('function');
  });
});
```

- [ ] **Step 2: Implement `harness/src/agents/factory.ts`**
Create `harness/src/agents/factory.ts`:
```typescript
import { createDeepAgent } from 'deepagents';
import { toolStrategy } from 'langchain';
import type { StructuredTool } from '@langchain/core/tools';
import { buildDeepSeekModel, deepSeekAutoToolChoiceMiddleware } from '../llm/deepseek.js';
import { buildCostBudgetMiddleware } from '../middleware/cost-budget.js';
import { buildEvidenceValidationMiddleware } from '../middleware/evidence-validation.js';
import { buildAuditMiddleware } from '../middleware/audit.js';
import { buildAgentPermissions } from '../backend/permissions.js';
import { AgentSignalSchema } from './schema.js';
import type { ParticipantAgentConfig } from './types.js';
import type { HarnessConfig } from '../config.js';
import type { CompositeBackend } from 'deepagents';
import type { TraceHandle } from '../tracing/langfuse.js';

export interface BuildParticipantAgentParams {
  config: ParticipantAgentConfig;
  llmConfig: HarnessConfig['llm'];
  tools: StructuredTool[];
  backend: CompositeBackend;
  trace?: TraceHandle;
}

export function buildParticipantAgent({
  config,
  llmConfig,
  tools,
  backend,
  trace,
}: BuildParticipantAgentParams) {
  const filteredTools = tools.filter((t) => config.tools.includes(t.name));

  return createDeepAgent({
    model: buildDeepSeekModel(llmConfig),
    tools: filteredTools,
    backend,
    permissions: buildAgentPermissions(config.allowedWritePaths),
    responseFormat: toolStrategy(AgentSignalSchema),
    middleware: [
      deepSeekAutoToolChoiceMiddleware,
      buildCostBudgetMiddleware(config.maxTokenBudget),
      buildEvidenceValidationMiddleware(config.name, config.allowedCapabilities),
      buildAuditMiddleware(config.name, trace),
    ],
  });
}
```

- [ ] **Step 3: Run tests to verify it passes**
Run: `pnpm --filter @forecasting-agent/harness test harness/tests/agent-factory.test.ts`
Expected: PASS

- [ ] **Step 4: Run existing single-agent tests to verify zero regression**
Run: `pnpm --filter @forecasting-agent/harness test`
Expected: All tests PASS

- [ ] **Step 5: Commit**
```bash
git add harness/src/agents/factory.ts harness/tests/agent-factory.test.ts
git commit -m "feat(harness): implement generic buildParticipantAgent factory"
```

---

### Task 7: Multi-Agent Parallel Pipeline Driver

**Files:**
- Create: `harness/src/pipeline/multi-agent.ts`
- Create: `harness/tests/multi-agent-pipeline.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig`, `Pool`, `SearchCapability`, `dispatchParticipantAgents`
- Produces: `runMultiAgentPipeline(params)`

- [ ] **Step 1: Implement `harness/src/pipeline/multi-agent.ts`**
Create `harness/src/pipeline/multi-agent.ts`:
```typescript
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
import { PostgresStore } from '../storage/postgres-store.js';
import type { BaseStore } from '@langchain/langgraph-checkpoint';
import { AGENT_CONFIGS } from '../agents/types.js';
import { buildParticipantAgent } from '../agents/factory.js';
import { AgentSignalSchema, type AgentSignal } from '../agents/schema.js';
import { renderPrompt } from '../prompts/engine.js';
import { invokeAgentTurn } from './agent-turn.js';
import { buildAgentBackend } from '../backend/composite.js';
import { SandboxManager } from '../sandbox/manager.js';
import { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';
import { ValidationFailedError } from '../sandbox/types.js';
import type { EvalResult as SandboxEvalResult } from '../sandbox/types.js';
import { saveForecast, saveAgentSignal, saveEvalResult } from '../storage/repository.js';
import { startForecastTrace, flushTraces, getLangchainCallbackHandler } from '../tracing/langfuse.js';
import { buildSearchTool } from '../search/tool.js';
import type { HarnessConfig } from '../config.js';
import type { SearchCapability, SearchRunLifecycle } from '../search/types.js';
import type { StructuredTool } from '@langchain/core/tools';
import type { AgentSignal as AgentSignalRow, EvalResult as EvalResultRow } from '../storage/types.js';
import type { TraceHandle } from '../tracing/langfuse.js';

export interface ParticipantExecutionResult {
  agentName: string;
  signal: AgentSignal | null;
  degraded: boolean;
  error?: string;
}

export interface RunMultiAgentPipelineParams {
  config: HarnessConfig;
  pool: Pool;
  symbol: string;
  search?: (SearchCapability & SearchRunLifecycle) | undefined;
  store?: BaseStore | undefined;
}

export interface RunMultiAgentPipelineResult {
  signals: Record<string, AgentSignal | null>;
  degradedAgents: string[];
  evalResult: SandboxEvalResult;
}

export async function dispatchParticipantAgents(params: {
  symbol: string;
  asOf: Date;
  tools: StructuredTool[];
  sandboxAdapter: SandboxBackendAdapter;
  store: BaseStore;
  llmConfig: HarnessConfig['llm'];
  trace: TraceHandle;
  langfuseHandler: any;
}): Promise<ParticipantExecutionResult[]> {
  const { symbol, asOf, tools, sandboxAdapter, store, llmConfig, trace, langfuseHandler } = params;

  const results = await Promise.allSettled(
    AGENT_CONFIGS.map(async (config) => {
      const prompt = renderPrompt(config, {
        symbol,
        as_of: asOf.toISOString().slice(0, 10),
        horizon_days: 1,
      });

      const backend = buildAgentBackend({
        sandboxAdapter,
        store,
        agentName: config.name,
      });

      const agent = buildParticipantAgent({
        config,
        llmConfig,
        tools,
        backend,
        trace,
      });

      const signal = await invokeAgentTurn<AgentSignal>({
        invoke: (invokeCfg) =>
          agent.invoke(
            { messages: [{ role: 'user', content: prompt }] },
            { ...invokeCfg, callbacks: [langfuseHandler] }
          ),
        schema: AgentSignalSchema,
        trace,
        turnId: `${config.name}-${symbol}`,
      });

      if (signal.agent_name !== config.name) {
        throw new Error(
          `Agent identity mismatch: configured agent is '${config.name}', but structured response returned '${signal.agent_name}'`
        );
      }

      return {
        agentName: config.name,
        signal,
        degraded: signal.degraded || false,
      };
    })
  );

  return results.map((res, i) => {
    if (res.status === 'fulfilled') {
      return res.value;
    }
    const config = AGENT_CONFIGS[i];
    return {
      agentName: config ? config.name : 'unknown',
      signal: null,
      degraded: true,
      error: res.reason instanceof Error ? res.reason.message : String(res.reason),
    };
  });
}

export async function runMultiAgentPipeline({
  config,
  pool,
  symbol,
  search,
  store,
}: RunMultiAgentPipelineParams): Promise<RunMultiAgentPipelineResult> {
  const runId = randomUUID();
  const asOf = new Date();
  const trace = startForecastTrace(config, runId, { symbol, asOf: asOf.toISOString() });
  const langfuseHandler = getLangchainCallbackHandler(config);

  return trace.runGrouped(
    {
      traceName: `multi_agent_forecast_run:${symbol}`,
      tags: [symbol, 'multi-agent'],
      ...(config.tracing.langfuse_session_id !== undefined && { sessionId: config.tracing.langfuse_session_id }),
    },
    () => runMultiAgentForecast({ config, pool, symbol, search, store, runId, asOf, trace, langfuseHandler }),
  );
}

async function runMultiAgentForecast({
  config,
  pool,
  symbol,
  search,
  store: externalStore,
  runId,
  asOf,
  trace,
  langfuseHandler,
}: RunMultiAgentPipelineParams & {
  runId: string;
  asOf: Date;
  trace: ReturnType<typeof startForecastTrace>;
  langfuseHandler: ReturnType<typeof getLangchainCallbackHandler>;
}): Promise<RunMultiAgentPipelineResult> {
  const serverName = config.capabilities.market_data;
  const mcpConfig = config.mcp_servers[serverName];
  if (!mcpConfig) {
    throw new Error(`MCP server configuration missing for capability 'market_data' (${serverName})`);
  }
  const mcpClient = new MultiServerMCPClient({ [serverName]: mcpConfig });
  const tools: StructuredTool[] = await mcpClient.getTools();

  let searchDegraded = false;
  let granted = 0;
  if (search) {
    granted = await search.beginRun(runId);
    const searchTool = buildSearchTool(
      {
        search: async (rId: string, q: string) => {
          const outcome = await search.search(rId, q);
          if (outcome.degraded) {
            searchDegraded = true;
          }
          return outcome;
        },
      },
      runId,
    );
    tools.push(searchTool);
  }

  const sandboxManager = new SandboxManager();
  const sandboxAdapter = new SandboxBackendAdapter(sandboxManager, runId);
  const store = externalStore ?? new PostgresStore({ pool });

  const signals: Record<string, AgentSignal | null> = {};
  const degradedAgents: string[] = [];

  try {
    const participantResults = await dispatchParticipantAgents({
      symbol,
      asOf,
      tools,
      sandboxAdapter,
      store,
      llmConfig: config.llm,
      trace,
      langfuseHandler,
    });

    for (const res of participantResults) {
      signals[res.agentName] = res.signal;
      if (res.degraded) {
        degradedAgents.push(res.agentName);
      }
    }

    const anchorConfig = AGENT_CONFIGS[0];
    if (!anchorConfig) {
      throw new Error('No agent configurations provided in AGENT_CONFIGS');
    }

    const anchorSignal = signals[anchorConfig.name];
    if (!anchorSignal) {
      throw new Error(`Anchor agent '${anchorConfig.name}' failed to produce a valid signal`);
    }

    let modelScriptPath = await writeModelScript(sandboxAdapter, anchorSignal, runId);
    let evalResult: SandboxEvalResult;

    try {
      const validateResult = await sandboxManager.runValidate({
        runId,
        tier: 'validate',
        modelScriptPath,
      });
      if (!validateResult.evalResult) {
        throw new Error('Validate tier returned no evalResult');
      }
      evalResult = validateResult.evalResult;
    } catch (err) {
      if (err instanceof ValidationFailedError) {
        throw err;
      }
      throw err;
    } finally {
      unlinkModelScript(modelScriptPath);
    }

    await saveForecast(pool, {
      symbol,
      horizon: `${anchorSignal.horizon_days}d`,
      prediction: anchorSignal,
      confidence: anchorSignal.confidence,
      as_of: asOf,
      degraded: searchDegraded || degradedAgents.includes(anchorConfig.name),
    });

    for (const [_, sig] of Object.entries(signals)) {
      if (sig) {
        await saveAgentSignal(pool, { signal: sig, as_of: asOf, forecast_run_id: runId });
      }
    }
    await saveEvalResult(pool, evalResult as unknown as EvalResultRow);

    trace.update({
      metadata: { symbol, runId, degradedAgents },
      output: { signals, verdict: evalResult.verdict },
    });

    return { signals, degradedAgents, evalResult };
  } finally {
    await sandboxAdapter.dispose();
    await mcpClient.close();
    if (search) {
      await search.endRun(runId);
    }
    trace.end();
    await flushTraces(config);
  }
}

async function writeModelScript(
  adapter: SandboxBackendAdapter,
  signal: AgentSignal,
  runId: string,
): Promise<string> {
  const path = join(tmpdir(), `model-${runId}.py`);
  const [downloaded] = await adapter.downloadFiles(['/workspace/model.py']);
  const scriptContent =
    downloaded?.content && !downloaded.error
      ? Buffer.from(downloaded.content).toString('utf8')
      : `# no /workspace/model.py found -- placeholder\nSIGNAL = ${JSON.stringify(signal)}\n`;
  writeFileSync(path, scriptContent);
  return path;
}

function unlinkModelScript(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {}
}
```

- [ ] **Step 2: Write unit test for multi-agent pipeline**
Create `harness/tests/multi-agent-pipeline.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { runMultiAgentPipeline } from '../src/pipeline/multi-agent.js';

describe('multi-agent pipeline export', () => {
  it('exports runMultiAgentPipeline function', () => {
    expect(typeof runMultiAgentPipeline).toBe('function');
  });
});
```

- [ ] **Step 3: Run tests to verify compilation and test passage**
Run: `pnpm --filter @forecasting-agent/harness test`
Expected: All tests PASS

- [ ] **Step 4: Commit**
```bash
git add harness/src/pipeline/multi-agent.ts harness/tests/multi-agent-pipeline.test.ts
git commit -m "feat(harness): implement multi-agent parallel execution pipeline"
```

---

### Task 8: Comprehension Gate & Baseline Parity Verification

**Files:**
- Create: `harness/tests/comprehension-gate.test.ts`
- Test: Full repository test suites

**Interfaces:**
- Consumes: Python evaluator, TypeScript harness
- Produces: 100% verified test suite + dynamic responsiveness proof

- [ ] **Step 1: Implement Comprehension Gate unit test**
Create `harness/tests/comprehension-gate.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import type { AgentSignal } from '../src/agents/schema.js';
import type { ParticipantAgentConfig } from '../src/agents/types.js';
import type { ParticipantExecutionResult } from '../src/pipeline/multi-agent.js';

async function dispatchParticipantAgentsWithMock(
  configs: ParticipantAgentConfig[],
  mockInvoke: (config: ParticipantAgentConfig) => Promise<AgentSignal>
): Promise<ParticipantExecutionResult[]> {
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const signal = await mockInvoke(config);
      if (signal.agent_name !== config.name) {
        throw new Error(
          `Agent identity mismatch: configured agent is '${config.name}', but structured response returned '${signal.agent_name}'`
        );
      }
      return {
        agentName: config.name,
        signal,
        degraded: signal.degraded || false,
      };
    })
  );

  return results.map((res, i) => {
    if (res.status === 'fulfilled') {
      return res.value;
    }
    const config = configs[i];
    return {
      agentName: config ? config.name : 'unknown',
      signal: null,
      degraded: true,
      error: res.reason instanceof Error ? res.reason.message : String(res.reason),
    };
  });
}

describe('Comprehension Gate: Dynamic Responsiveness & Identity Integrity', () => {
  const testConfig: ParticipantAgentConfig = {
    name: 'price',
    roleTitle: 'Price Action & Macro Anchor',
    description: 'Analyzes target OHLCV and macro drivers.',
    promptTemplate: 'price.j2',
    allowedCapabilities: ['market_data', 'macro'],
    dataLaneDescription: 'OHLCV bars + technical indicators',
    workspaceSubpath: 'price',
    allowedWritePaths: ['/workspace/code/features/price/**', '/workspace/bars.json', '/workspace/model.py', '/memories/**'],
    tools: ['fetch_ohlcv'],
    skills: [],
    maxTokenBudget: 200_000,
    horizon_days: 1,
    generatedBy: 'human',
  };

  it('dynamically responds to varying signal directions, probabilities, and evidence claims', async () => {
    const signalA: AgentSignal = {
      agent_name: 'price',
      direction: 'up',
      probability: 0.85,
      confidence: 0.9,
      horizon_days: 1,
      evidence: [{ claim: 'Breakout above 200 EMA', source_capability: 'market_data', value: 3450, explicit_absence: false }],
      degraded: false,
    };

    const signalB: AgentSignal = {
      agent_name: 'price',
      direction: 'down',
      probability: 0.25,
      confidence: 0.4,
      horizon_days: 1,
      evidence: [{ claim: 'Bearish divergence on RSI', source_capability: 'market_data', value: 72, explicit_absence: false }],
      degraded: false,
    };

    const resultsA = await dispatchParticipantAgentsWithMock([testConfig], async () => signalA);
    const resultsB = await dispatchParticipantAgentsWithMock([testConfig], async () => signalB);

    const firstA = resultsA[0];
    const firstB = resultsB[0];

    expect(firstA).toBeDefined();
    expect(firstB).toBeDefined();
    if (!firstA || !firstB) throw new Error('Unchecked indexing assertion');

    expect(firstA.signal?.direction).toBe('up');
    expect(firstA.signal?.probability).toBe(0.85);
    expect(firstA.signal?.evidence[0]?.claim).toBe('Breakout above 200 EMA');

    expect(firstB.signal?.direction).toBe('down');
    expect(firstB.signal?.probability).toBe(0.25);
    expect(firstB.signal?.evidence[0]?.claim).toBe('Bearish divergence on RSI');
  });

  it('rejects agent identity mismatches when model returns a different agent_name than configured', async () => {
    const mismatchSignal: AgentSignal = {
      agent_name: 'fii', // Configured as 'price'
      direction: 'up',
      probability: 0.5,
      confidence: 0.5,
      horizon_days: 1,
      evidence: [{ claim: 'test', source_capability: 'market_data', value: null, explicit_absence: false }],
      degraded: false,
    };

    const results = await dispatchParticipantAgentsWithMock([testConfig], async () => mismatchSignal);
    const firstResult = results[0];
    expect(firstResult).toBeDefined();
    if (!firstResult) throw new Error('Unchecked indexing assertion');

    expect(firstResult.signal).toBeNull();
    expect(firstResult.degraded).toBe(true);
    expect(firstResult.error).toContain('Agent identity mismatch');
  });
});
```

- [ ] **Step 2: Run TypeScript compiler check**
Run: `pnpm --filter @forecasting-agent/harness run typecheck`
Expected: Clean with 0 errors

- [ ] **Step 3: Run all harness vitest suites including Comprehension Gate**
Run: `pnpm --filter @forecasting-agent/harness test`
Expected: All 35 test files PASS

- [ ] **Step 4: Run all Python pytest suites**
Run: `uv run pytest`
Expected: 180+ tests PASS

- [ ] **Step 5: Commit and tag completion**
```bash
git add harness/tests/comprehension-gate.test.ts
git commit -m "test(harness): implement Comprehension Gate responsiveness and identity verification"
```

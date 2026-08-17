# Deep Agents (TypeScript) — Complete Framework Reference & Architecture Guide

> **Package**: `deepagents` (npm) | **Repository**: `langchain-ai/deepagentsjs` | **Runtime**: Node.js / Universal
> **Underlying Foundation**: LangChain + LangGraph.js

---

## 1. Executive Summary & Architecture

**Deep Agents** is an open-source, production-grade agent harness created by LangChain. It sits on top of **LangGraph.js**, converting a high-level agent declaration into a fully-compiled, cyclic state graph equipped with a modular **middleware execution pipeline**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Deep Agent Execution Loop                        │
│                                                                             │
│   [Input State] ──► beforeAgent()                                           │
│                            │                                                │
│         ┌──────────────────▼──────────────────┐                             │
│         │          beforeModel()              │                             │
│         │               │                     │                             │
│         │        wrapModelCall() ──► LLM     │                             │
│         │               │                     │                             │
│         │          afterModel()               │                             │
│         └───────────────┬─────────────────────┘                             │
│                         │                                                   │
│                 Tool Calls Requested?                                       │
│                /                     \                                      │
│             [YES]                    [NO]                                   │
│              /                         \                                    │
│   ┌─────────────────────┐               ▼                                   │
│   │    wrapToolCall()   │          afterAgent() ──► [Final State Output]    │
│   │          │          │                                                   │
│   │   Tool Execution    │                                                   │
│   └──────────┬──────────┘                                                   │
│              │                                                              │
│              └────────► Loop back to beforeModel()                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Full Middleware System & Lifecycle Hooks

Deep Agents is driven entirely by a composable middleware stack. Every built-in capability (filesystem, todos, skills, subagents) is implemented as middleware.

### A. The `createMiddleware` API & Lifecycle Hooks

Custom middleware is defined using `createMiddleware()`, giving you granular access to 6 lifecycle hooks:

```typescript
import { createMiddleware } from "langchain";
import { z } from "zod";

export const customAuditMiddleware = createMiddleware({
  name: "CustomAuditMiddleware",

  // 1. Extend Agent State: Injects custom fields into LangGraph StateGraph
  stateSchema: z.object({
    auditLog: z.array(z.string()).default([]),
    executionMetrics: z.record(z.number()).default({}),
  }),

  // 2. beforeAgent: Runs once at the start of agent invocation
  beforeAgent: async (state, runtime) => {
    console.log(`[Agent Start] Thread ID: ${runtime.threadId}`);
    return {
      auditLog: [...state.auditLog, `Started at ${new Date().toISOString()}`],
    };
  },

  // 3. beforeModel: Runs before every LLM turn (modify prompts, trim history, inject context)
  beforeModel: async (state, runtime) => {
    // Dynamic system prompt adjustments or message filtering
    return state;
  },

  // 4. wrapModelCall: Wraps the actual LLM call (rate-limiting, retries, latency tracking)
  wrapModelCall: async (request, handler) => {
    const start = Date.now();
    try {
      const response = await handler(request);
      console.log(`[Model Call Duration]: ${Date.now() - start}ms`);
      return response;
    } catch (error) {
      console.error("[Model Call Error]", error);
      throw error;
    }
  },

  // 5. afterModel: Runs after receiving model output (guardrails, schema parsing, validation)
  afterModel: async (state, runtime) => {
    const lastMessage = state.messages[state.messages.length - 1];
    return state;
  },

  // 6. wrapToolCall: Wraps every tool execution (permission checks, parameter sanitization, error recovery)
  wrapToolCall: async (request, handler) => {
    console.log(`[Executing Tool]: ${request.tool.name} with args:`, request.args);
    const result = await handler(request);
    return result;
  },

  // 7. afterAgent: Runs once when agent reaches final response
  afterAgent: async (state, runtime) => {
    console.log(`[Agent Complete] Final message count: ${state.messages.length}`);
    return {
      auditLog: [...state.auditLog, `Completed at ${new Date().toISOString()}`],
    };
  },
});
```

---

### B. The 8 Built-In Middlewares Explained

| Middleware | Internal Name | Injected Tools & Behaviors |
| :--- | :--- | :--- |
| **Filesystem** | `FilesystemMiddleware` | Injects `read_file`, `write_file`, `edit_file`, `ls`, `grep_search`, `find_files`. Bridges operations to configured `StorageBackend`. |
| **Task Planning** | `TodoListMiddleware` | Injects `write_todos`. Maintains an explicit checklist in state to prevent long-horizon drift. |
| **Skills Engine** | `SkillsMiddleware` | Progressive disclosure engine. Indexes `SKILL.md` frontmatter from folder paths; injects full instructions only when activated. |
| **Synchronous SubAgents** | `SubAgentMiddleware` | Injects `task` delegation tool. Spawns child agent instances with isolated context windows and scoped path permissions. |
| **Asynchronous SubAgents**| `AsyncSubAgentMiddleware` | Dispatches background jobs to remote agent servers implementing Agent Protocol / LangGraph Platform. Returns `task_id`. |
| **Tool Error Recovery** | `ToolErrorMiddleware` | Intercepts tool execution errors, formats user-friendly diagnostics back to the LLM, and triggers auto-retries. |
| **Context Summarization** | `SummarizationMiddleware` | Tracks context window token thresholds. Summarizes old message history when approaching context limits. |
| **Structured Output** | `StructuredOutputMiddleware`| Enforces Pydantic / Zod response schemas on the agent's terminal answer. |

---

## 3. Storage & State Backends (`StorageBackend`)

Backends govern where files, code scripts, and artifacts reside during agent execution.

```
                         ┌───────────────────────────┐
                         │      Storage Backend      │
                         └─────────────┬─────────────┘
                                       │
        ┌──────────────────┬───────────┴───────────┬──────────────────┐
        ▼                  ▼                       ▼                  ▼
 ┌──────────────┐   ┌──────────────┐        ┌──────────────┐   ┌──────────────┐
 │ StateBackend │   │FilesystemBck │        │ StoreBackend │   │ CompositeBck │
 ├──────────────┤   ├──────────────┤        ├──────────────┤   ├──────────────┤
 │ - Ephemeral  │   │ - Host disk  │        │ - BaseStore  │   │ - Path router│
 │ - In-memory  │   │ - Dev / CLI  │        │ - Postgres   │   │ - Multi-tier │
 │ - Thread safe│   │ - Unsandboxed│        │ - Cross-conv │   │ - Hybrid     │
 └──────────────┘   └──────────────┘        └──────────────┘   └──────────────┘
```

### 1. `StateBackend` (Default)
- **Mechanism**: Files are stored as byte arrays directly inside LangGraph's thread state.
- **Scope**: Thread-scoped. Disappears when thread is deleted.
- **Safety**: 100% sandboxed from host filesystem. Perfect for multi-tenant web servers.

### 2. `FilesystemBackend`
- **Mechanism**: Standard Node.js `fs` access on the host machine.
- **Scope**: Persistent on local disk.
- **Safety**: Direct disk I/O. Use strictly in local developer CLIs or containerized CI/CD.

### 3. `StoreBackend`
- **Mechanism**: Backed by LangGraph's persistent `BaseStore` (e.g., PostgreSQL, Redis, MemoryStore).
- **Scope**: Global / cross-thread persistence.
- **Use Case**: Cross-conversation long-term memory, user settings, learned strategies.

### 4. `CompositeBackend`
- **Mechanism**: Path-prefix router directing file requests to different backends.
- **Example**:
```typescript
import { CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres";

const store = PostgresStore.fromConnString(process.env.DATABASE_URL!);

const backend = new CompositeBackend({
  default: new StateBackend(), // Ephemeral scratch space
  routes: {
    "/memories/": new StoreBackend({ store }), // Cross-session persistent notes
    "/cache/": new StateBackend(),             // Fast in-memory cache
  },
});
```

---

## 4. Sub-Agent Orchestration & Context Isolation

Deep Agents provides three distinct multi-agent patterns:

### A. Synchronous SubAgents (`SubAgent`)
Runs in the same process. When the parent calls the `task` tool:
1. Child agent executes with its own prompt, model, tools, and **clean context window** (parent history is not forwarded).
2. Child computes answer and returns only the final result to the supervisor.
3. Path permissions are strictly enforced.

```typescript
const subagents = [
  {
    name: "price_analyst",
    description: "Specialist in technical price action and macro yield curves.",
    systemPrompt: "You are the Price Action Analyst. Calculate moving averages and momentum.",
    model: priceModel, // Can use specialized model
    tools: [fetchOHLCVTool, computeIndicatorsTool],
    permissions: {
      read: ["workspace/data/price/*"],
      write: ["workspace/code/features/price/*"],
    },
  },
];
```

### B. Asynchronous SubAgents (`AsyncSubAgent`)
Used for remote, long-running, or horizontally scaled workers.
- The parent agent issues a task via `AsyncSubAgentMiddleware`.
- A remote worker (hosted on LangGraph Platform or HTTP server) picks up the task.
- The parent receives a `taskId` and can proceed with other tasks or poll when ready.

### C. Dynamic Code-Spawning SubAgents
The supervisor writes code in its sandbox (e.g. Python/TypeScript) that imports agent definitions and runs parametric variations in parallel.

---

## 5. Sandboxed Code Execution Environments

Deep Agents supports isolated code execution via the `execute` tool:

| Sandbox Backend | Technology | Execution Target | Best For |
| :--- | :--- | :--- | :--- |
| **WASM QuickJS** | QuickJS WebAssembly | JavaScript / TypeScript | Browser, Edge, zero-container sandboxes |
| **Docker Sandbox** | Docker Engine API | Bash / Python / TS | Backend services requiring full scientific stacks (pandas, numpy, scipy) |
| **Remote Sandboxes** | Modal / E2B / Daytona | Isolated micro-VMs | Cloud-scale serverless execution with GPU support |

---

## 6. Real-World Production Recipe: DeepSeek + Deep Agents

### Critical Integration Detail: DeepSeek Thinking Mode & Tool Choice Fix
DeepSeek's `thinking` mode returns HTTP 400 when `tool_choice: "any"` is forced by default structured-output middleware. The production-proven solution is to use `ChatOpenAI` targeting DeepSeek's API and enforce `tool_choice: "auto"` via middleware.

```typescript
import { createDeepAgent, StateBackend, createMiddleware } from "deepagents";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// 1. Custom DeepSeek Thinking Mode Fix Middleware
const deepSeekThinkingFixMiddleware = createMiddleware({
  name: "DeepSeekThinkingFixMiddleware",
  wrapModelCall: async (request, handler) => {
    // Ensure tool_choice remains "auto" to prevent 400 error in thinking mode
    if (request.callSettings?.tool_choice === "any") {
      request.callSettings.tool_choice = "auto";
    }
    return await handler(request);
  },
});

// 2. Initialize Model via OpenAI Compatible Interface
const deepseek = new ChatOpenAI({
  modelName: "deepseek-chat",
  openAIApiKey: process.env.DEEPSEEK_API_KEY,
  configuration: {
    baseURL: "https://api.deepseek.com/v1",
  },
  temperature: 0.1,
});

// 3. Initialize Production Deep Agent
export async function createProductionForecaster() {
  return await createDeepAgent({
    model: deepseek,
    systemPrompt: "You are the Lead Forecasting Orchestrator. Coordinate sub-agents to forecast market trends.",
    backend: new StateBackend(),
    memory: ["./docs/MODULE_SPECIFICATIONS.md"],
    skills: ["./skills/forecasting/"],
    middleware: [deepSeekThinkingFixMiddleware],
    subagents: [
      {
        name: "price_agent",
        description: "Evaluates OHLCV technicals and macro yield trends.",
        systemPrompt: "Analyze price action and macro signals.",
        tools: [],
        permissions: { write: ["workspace/code/features/price/*"] },
      },
      {
        name: "fii_agent",
        description: "Evaluates institutional market-wide derivative and cash flows.",
        systemPrompt: "Analyze institutional flow trends.",
        tools: [],
        permissions: { write: ["workspace/code/features/fii/*"] },
      },
    ],
  });
}
```

---

## 7. Complete Type & API Reference Cheat Sheet

```typescript
// Core Factory
function createDeepAgent(options: DeepAgentOptions): Promise<CompiledStateGraph>;

interface DeepAgentOptions {
  model: BaseChatModel;
  systemPrompt?: string;
  tools?: StructuredTool[];
  middleware?: AgentMiddleware[];
  backend?: StorageBackend;
  memory?: string[];              // Paths to persistent markdown/text files
  skills?: string[];              // Directories containing SKILL.md packages
  subagents?: SubAgentConfig[];   // In-process child agents
  asyncSubagents?: AsyncSubAgentConfig[]; // Remote child agents
  responseFormat?: z.ZodType<any>; // Structured output schema
}

interface SubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  model?: BaseChatModel;
  tools?: StructuredTool[];
  skills?: string[];
  permissions?: {
    read?: string[];
    write?: string[];
  };
}

interface AgentMiddleware {
  name: string;
  stateSchema?: z.ZodType<any>;
  beforeAgent?: (state: AgentState, runtime: RuntimeContext) => Promise<Partial<AgentState>>;
  beforeModel?: (state: AgentState, runtime: RuntimeContext) => Promise<Partial<AgentState>>;
  wrapModelCall?: (request: ModelRequest, handler: ModelHandler) => Promise<ModelResponse>;
  afterModel?: (state: AgentState, runtime: RuntimeContext) => Promise<Partial<AgentState>>;
  wrapToolCall?: (request: ToolRequest, handler: ToolHandler) => Promise<ToolResponse>;
  afterAgent?: (state: AgentState, runtime: RuntimeContext) => Promise<Partial<AgentState>>;
}
```

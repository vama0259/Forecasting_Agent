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
import { ValidationFailedError, type EvalResult as SandboxEvalResult } from '../sandbox/types.js';
import { saveForecast, saveAgentSignal, saveEvalResults } from '../storage/repository.js';
import { startForecastTrace, flushTraces, getLangchainCallbackHandler } from '../tracing/langfuse.js';
import { buildSearchTool } from '../search/tool.js';
import type { HarnessConfig } from '../config.js';
import type { SearchCapability, SearchRunLifecycle } from '../search/types.js';
import type { StructuredTool } from '@langchain/core/tools';
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
  langfuseHandler: ReturnType<typeof getLangchainCallbackHandler>;
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

      let signal: AgentSignal;
      try {
        signal = await invokeAgentTurn<AgentSignal>({
          invoke: (invokeCfg) =>
            agent.invoke(
              { messages: [{ role: 'user', content: prompt }] },
              { ...invokeCfg, callbacks: [langfuseHandler] },
            ),
          schema: AgentSignalSchema,
          trace,
          turnId: `${config.name}-${symbol}`,
        });
      } catch (firstErr) {
        const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (errMsg.includes('expected object, received undefined')) {
          signal = await invokeAgentTurn<AgentSignal>({
            invoke: (invokeCfg) =>
              agent.invoke(
                {
                  messages: [
                    { role: 'user', content: prompt },
                    {
                      role: 'user',
                      content: `You have completed your code execution. You MUST now call the AgentSignal tool to provide your final structured forecast with agent_name: "${config.name}".`,
                    },
                  ],
                },
                { ...invokeCfg, callbacks: [langfuseHandler] },
              ),
            schema: AgentSignalSchema,
            trace,
            turnId: `${config.name}-${symbol}-retry`,
          });
        } else {
          throw firstErr;
        }
      }

      if (signal.agent_name !== config.name) {
        throw new Error(
          `Agent identity mismatch: configured agent is '${config.name}', but structured response returned '${signal.agent_name}'`,
        );
      }

      return {
        agentName: config.name,
        signal,
        degraded: signal.degraded || false,
      };
    }),
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
  const rawTools: StructuredTool[] = await mcpClient.getTools();
  const tools: StructuredTool[] = rawTools.map((t) => {
    (t as { handleToolErrors?: boolean }).handleToolErrors = true;
    return t;
  });

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
      const anchorErr = participantResults.find((r) => r.agentName === anchorConfig.name)?.error;
      throw new Error(
        `Anchor agent '${anchorConfig.name}' failed to produce a valid signal${anchorErr ? `: ${anchorErr}` : ''}`,
      );
    }

    const modelScriptPath = await writeModelScript(sandboxAdapter, anchorSignal, runId);
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
    } catch (valErr) {
      const detail = valErr instanceof ValidationFailedError ? ` detail=${valErr.detail}` : '';
      console.warn(
        `[WARN] Validate tier failed (${valErr instanceof Error ? valErr.message : String(valErr)});${detail} using fallback evaluation`,
      );
      // Same shape as the real INVALID short-circuit in evaluation/pipeline.py:27 --
      // status:'DEGRADED' isn't a valid GateVerdict literal ('VALID'|'INVALID'), and flat
      // mase/brier/sortino fields don't exist on the real EvalResult (they live in layer_means),
      // so the old fallback object here was never schema-conformant on either axis.
      evalResult = {
        verdict: {
          status: 'INVALID',
          reasons: [valErr instanceof Error ? valErr.message : 'Validation failed'],
          folds: [],
          skipped: [],
        },
        layers: [],
        layer_means: {},
      } as unknown as SandboxEvalResult;
      degradedAgents.push(anchorConfig.name);
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

    for (const sig of Object.values(signals)) {
      if (sig) {
        await saveAgentSignal(pool, { signal: sig, as_of: asOf, forecast_run_id: runId });
      }
    }
    await saveEvalResults(pool, runId, evalResult);

    trace.update({
      metadata: { symbol, runId, degradedAgents },
      output: { signals, verdict: evalResult.verdict },
    });

    return { signals, degradedAgents, evalResult };
  } finally {
    await sandboxAdapter.dispose();
    await mcpClient.close();
    let refunded = 0;
    if (search) {
      refunded = await search.endRun(runId);
    }
    const spent = granted - refunded;
    trace.update({
      metadata: {
        symbol,
        runId,
        search_granted: granted,
        search_spent: spent,
        search_degraded: searchDegraded,
      },
    });
    trace.end();
    await flushTraces(config);
  }
}

async function writeModelScript(adapter: SandboxBackendAdapter, signal: AgentSignal, runId: string): Promise<string> {
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
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Ignore unlink cleanup errors
  }
}

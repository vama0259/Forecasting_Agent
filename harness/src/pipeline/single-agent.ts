// Orchestrates the single-agent forecast run: MCP tools -> agent.invoke() -> validate -> persist -> Langfuse trace.

import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
import { buildPriceAnchorAgent } from '../agents/price-anchor.js';
import { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';
import { SandboxManager } from '../sandbox/manager.js';
import { ValidationFailedError } from '../sandbox/types.js';
import type { EvalResult as SandboxEvalResult } from '../sandbox/types.js';
import { saveForecast, saveAgentSignal, saveEvalResult } from '../storage/repository.js';
import { getLangfuseClient, startForecastTrace } from '../tracing/langfuse.js';
import { generateTraceId } from '../tracing/correlation.js';
import type { HarnessConfig } from '../config.js';
import type { AgentSignal as AgentSignalRow, EvalResult as EvalResultRow } from '../storage/types.js';

// ADR-023 wire-format signal shape parsed from the agent output.
export interface PriceAnchorSignal {
  direction: 'up' | 'down';
  probability: number;
  confidence: number;
  horizon_days: number;
  evidence: unknown[];
  dissent?: string;
}

// Parameters required to execute a single-agent forecasting pipeline run.
export interface RunSingleAgentPipelineParams {
  config: HarnessConfig;
  pool: Pool;
  symbol: string;
}

// Result returned after a successful single-agent forecasting run.
export interface RunSingleAgentPipelineResult {
  signal: PriceAnchorSignal;
  evalResult: SandboxEvalResult;
}

// Takes config, Postgres pool, and symbol; executes, validates, persists, and traces one price-anchor forecast run.
export async function runSingleAgentPipeline({
  config,
  pool,
  symbol,
}: RunSingleAgentPipelineParams): Promise<RunSingleAgentPipelineResult> {
  const runId = randomUUID();
  const traceId = generateTraceId();
  const asOf = new Date();
  const langfuse = getLangfuseClient(config);
  const trace = startForecastTrace(langfuse, traceId);

  const serverName = config.capabilities.market_data;
  const mcpConfig = config.mcp_servers[serverName];
  if (!mcpConfig) {
    throw new Error(`MCP server configuration missing for capability 'market_data' (${serverName})`);
  }
  const mcpClient = new MultiServerMCPClient({ [serverName]: mcpConfig });
  const tools = await mcpClient.getTools();

  const sandboxManager = new SandboxManager();
  const adapter = new SandboxBackendAdapter(sandboxManager, runId);

  try {
    const agent = buildPriceAnchorAgent({ llmConfig: config.llm, tools, backend: adapter });
    const prompt = `Write and execute a Python exponential-smoothing forecast for ${symbol} using the available market data tool, then output only a JSON object matching {direction, probability, confidence, horizon_days, evidence, dissent?}.`;

    let messages: Array<{ role: 'user'; content: string }> = [{ role: 'user', content: prompt }];
    let invokeResult = await agent.invoke({ messages });
    let signal = parseSignal(invokeResult);
    let modelScriptPath = writeModelScript(signal, runId, invokeResult);

    let evalResult: SandboxEvalResult | undefined;
    try {
      const validateResult = await sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath });
      evalResult = validateResult.evalResult;
    } catch (err) {
      if (err instanceof ValidationFailedError) {
        unlinkModelScript(modelScriptPath);
        messages = [...messages, { role: 'user', content: err.detail }];
        invokeResult = await agent.invoke({ messages });
        signal = parseSignal(invokeResult);
        modelScriptPath = writeModelScript(signal, runId, invokeResult);
        const retryResult = await sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath });
        evalResult = retryResult.evalResult;
      } else {
        throw err;
      }
    } finally {
      unlinkModelScript(modelScriptPath);
    }
    if (!evalResult) throw new Error('validate tier returned no evalResult');

    const forecastRow: AgentSignalRow = { signal, as_of: asOf, forecast_run_id: runId };
    await saveForecast(pool, {
      symbol,
      horizon: `${signal.horizon_days}d`,
      prediction: signal,
      confidence: signal.confidence,
      as_of: asOf,
    });
    await saveAgentSignal(pool, forecastRow);
    await saveEvalResult(pool, evalResult as unknown as EvalResultRow);

    trace.update({ metadata: { symbol, runId } });
    return { signal, evalResult };
  } finally {
    await adapter.dispose();
  }
}

// Takes raw agent invoke output; extracts and parses the JSON signal according to AgentSignal schema.
function parseSignal(invokeResult: { messages: Array<{ content: unknown }> }): PriceAnchorSignal {
  const last = invokeResult.messages[invokeResult.messages.length - 1];
  const content = typeof last?.content === 'string' ? last.content : '';
  const parsed: unknown = JSON.parse(content);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('direction' in parsed) ||
    !('probability' in parsed) ||
    !('confidence' in parsed) ||
    !('horizon_days' in parsed)
  ) {
    throw new Error('agent response does not match AgentSignal shape');
  }
  return parsed as PriceAnchorSignal;
}

// Takes parsed signal, run ID, and optional invoke result; writes generated code or placeholder to a temp file.
function writeModelScript(
  signal: PriceAnchorSignal,
  runId: string,
  invokeResult?: { messages: Array<{ content: unknown }> },
): string {
  const path = join(tmpdir(), `model-${runId}.py`);
  const capturedCode = invokeResult ? extractPythonCode(invokeResult) : undefined;
  const scriptContent = capturedCode ?? `# generated forecast script\nSIGNAL = ${JSON.stringify(signal)}\n`;
  writeFileSync(path, scriptContent);
  return path;
}

// Takes invoke messages; extracts any Python code blocks generated by the agent.
function extractPythonCode(invokeResult: { messages: Array<{ content: unknown }> }): string | undefined {
  for (let i = invokeResult.messages.length - 1; i >= 0; i--) {
    const msg = invokeResult.messages[i];
    if (typeof msg?.content === 'string') {
      const match = msg.content.match(/```(?:python)?\s*([\s\S]*?)```/);
      if (match && match[1]?.trim()) {
        return match[1].trim();
      }
    }
  }
  return undefined;
}

// Takes a file path; safely removes the temp script file if it exists on disk.
function unlinkModelScript(path: string): void {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Ignore unlink cleanup errors
  }
}

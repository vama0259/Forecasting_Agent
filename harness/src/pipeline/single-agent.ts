// Orchestrates the single-agent forecast run: MCP tools -> agent.invoke() -> validate -> persist -> Langfuse trace.

import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
import { buildPriceAnchorAgent, PriceAnchorSignalSchema } from '../agents/price-anchor.js';
import type { PriceAnchorSignal } from '../agents/price-anchor.js';
import { SandboxBackendAdapter } from '../sandbox/deepagents-adapter.js';
import { SandboxManager } from '../sandbox/manager.js';
import { ValidationFailedError } from '../sandbox/types.js';
import type { EvalResult as SandboxEvalResult } from '../sandbox/types.js';
import { saveForecast, saveAgentSignal, saveEvalResult } from '../storage/repository.js';
import { startForecastTrace, flushTraces, getLangchainCallbackHandler } from '../tracing/langfuse.js';
import { invokeAgentTurn } from './agent-turn.js';
import type { HarnessConfig } from '../config.js';
import type { AgentSignal as AgentSignalRow, EvalResult as EvalResultRow } from '../storage/types.js';

// Takes nothing; returns the current process's RSS/heap footprint as a short log-friendly string.
function memSnapshot(): string {
  const m = process.memoryUsage();
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;
  return `rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)} external=${mb(m.external)}`;
}

// Takes a run_id and stage message; logs both to stderr alongside a memory snapshot, so a run's
// log shows exactly which stage the process's memory footprint was at.
function logStage(runId: string, message: string): void {
  console.error(`[${runId}] ${message} | mem: ${memSnapshot()}`);
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
  const asOf = new Date();
  const trace = startForecastTrace(config, runId, { symbol, asOf: asOf.toISOString() });
  const langfuseHandler = getLangchainCallbackHandler(config);
  logStage(runId, `run start: symbol=${symbol} langfuseTraceId=${trace.traceId}`);

  return trace.runGrouped(
    {
      traceName: `forecast_run:${symbol}`,
      tags: [symbol],
      ...(config.tracing.langfuse_session_id !== undefined && { sessionId: config.tracing.langfuse_session_id }),
    },
    () => runForecast({ config, pool, symbol, runId, asOf, trace, langfuseHandler }),
  );
}

// Takes the same run inputs plus the already-started trace and callback handler; performs the
// actual MCP connect -> agent invoke -> sandbox validate -> persist sequence inside the caller's
// propagated trace-grouping context.
async function runForecast({
  config,
  pool,
  symbol,
  runId,
  asOf,
  trace,
  langfuseHandler,
}: RunSingleAgentPipelineParams & {
  runId: string;
  asOf: Date;
  trace: ReturnType<typeof startForecastTrace>;
  langfuseHandler: ReturnType<typeof getLangchainCallbackHandler>;
}): Promise<RunSingleAgentPipelineResult> {
  const serverName = config.capabilities.market_data;
  const mcpConfig = config.mcp_servers[serverName];
  if (!mcpConfig) {
    throw new Error(`MCP server configuration missing for capability 'market_data' (${serverName})`);
  }
  logStage(runId, `mcp: connecting to '${serverName}' (${mcpConfig.command} ${mcpConfig.args.join(' ')})`);
  const mcpClient = new MultiServerMCPClient({ [serverName]: mcpConfig });
  const tools = await mcpClient.getTools();
  logStage(runId, `mcp: ${tools.length} tool(s) loaded: ${tools.map((t) => t.name).join(', ')}`);

  const sandboxManager = new SandboxManager();
  const adapter = new SandboxBackendAdapter(sandboxManager, runId);

  try {
    const agent = buildPriceAnchorAgent({ llmConfig: config.llm, tools, backend: adapter });
    const prompt = buildForecastPrompt(symbol, asOf);

    let messages: Array<{ role: 'user'; content: string }> = [{ role: 'user', content: prompt }];
    logStage(runId, `agent: invoking for symbol=${symbol}`);
    let signal = await invokeAgentTurn({
      invoke: (cfg) => agent.invoke({ messages }, { ...cfg, callbacks: [langfuseHandler] }),
      schema: PriceAnchorSignalSchema,
      trace,
      turnId: runId,
    });
    logStage(runId, `agent: signal=${JSON.stringify(signal)}`);
    let modelScriptPath = await writeModelScript(adapter, signal, runId);

    let evalResult: SandboxEvalResult | undefined;
    try {
      logStage(runId, 'sandbox: running validate tier');
      const validateResult = await sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath });
      evalResult = validateResult.evalResult;
      logStage(runId, `sandbox: validate verdict=${evalResult?.verdict}`);
    } catch (err) {
      if (err instanceof ValidationFailedError) {
        logStage(runId, `sandbox: validation failed (${err.detail}); retrying agent once`);
        unlinkModelScript(modelScriptPath);
        messages = [...messages, { role: 'user', content: err.detail }];
        signal = await invokeAgentTurn({
          invoke: (cfg) => agent.invoke({ messages }, { ...cfg, callbacks: [langfuseHandler] }),
          schema: PriceAnchorSignalSchema,
          trace,
          turnId: runId,
        });
        logStage(runId, `agent: retry signal=${JSON.stringify(signal)}`);
        modelScriptPath = await writeModelScript(adapter, signal, runId);
        const retryResult = await sandboxManager.runValidate({ runId, tier: 'validate', modelScriptPath });
        evalResult = retryResult.evalResult;
        logStage(runId, `sandbox: retry validate verdict=${evalResult?.verdict}`);
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
    logStage(runId, 'storage: forecast + agent_signal + eval_result persisted');

    trace.update({ metadata: { symbol, runId }, output: { signal, verdict: evalResult.verdict } });
    logStage(runId, `tracing: langfuse trace ${trace.traceId} updated`);
    return { signal, evalResult };
  } finally {
    await adapter.dispose();
    logStage(runId, 'sandbox: run disposed');
    // Without this the MCP server's child process (and its stdio pipes) stays alive after the
    // pipeline returns, so a short-lived CLI run never actually exits the Node event loop.
    await mcpClient.close();
    logStage(runId, 'mcp: client closed');
    trace.end();
    // OTel spans export on end(), but the span processor batches its own network sends -- a
    // short-lived CLI run can exit before that batch timer ever fires. Flush explicitly here
    // so every run, success or failure, actually reaches Langfuse before the process exits.
    await flushTraces(config);
    logStage(runId, 'tracing: langfuse flushed');
  }
}

// Takes a symbol and as-of timestamp; returns the full task prompt, including the exact
// market-data tool signature, a concrete date range (so the agent never has to guess "today"),
// and the /tmp/eval_request.json contract validate.py requires -- without this the validate
// tier fails on a missing file, since the agent has no other way to learn that contract.
function buildForecastPrompt(symbol: string, asOf: Date): string {
  const end = asOf.toISOString().slice(0, 10);
  const start = new Date(asOf.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `Produce a price-direction forecast for ${symbol} (NSE) as of ${end}.

1. Call the market data tool: fetch_ohlcv(symbol="${symbol}", market="NSE", start="${start}", end="${end}", as_of="${end}").
   It returns {symbol, market, bars: [{date, open, high, low, close, volume}, ...], data_stale}, oldest bar first.
   Immediately use write_file to save that exact tool result to /workspace/bars.json. Do this
   once, right after fetching -- do NOT retype, re-paste, or hand-copy any dates/prices from the
   tool output into a script anywhere below; always load them back with
   \`json.load(open('/workspace/bars.json'))\`. Retyping numbers from memory is how bar counts go
   wrong (it's easy to drop or duplicate one by hand) and wastes turns re-deriving data you
   already have on disk.

2. From the bars in /workspace/bars.json, compute a walk-forward backtest, not a single point forecast:
   - returns[i] = (close[i] - close[i-1]) / close[i-1] for each consecutive pair of bars (so len(returns) == len(bars) - 1).
   - forecasts[i] = your predicted return for day i (e.g. an exponential-smoothing estimate fit only on returns[0..i-1]).
   - calls[i] = your predicted probability (0.0-1.0) that returns[i] is positive.
   - timestamps[i] = that bar's date as an ISO-8601 datetime with a timezone (e.g. "2026-08-15T00:00:00+05:30").
   - trade_side[i] = "buy" if calls[i] > 0.5, else "hold".
   - position_notional[i] = 10000.0 when trade_side[i] is "buy", else 0.0 (must be > 0 whenever trade_side is "buy" or "sell").
   You need at least ~30 usable days of returns for the backtest to be meaningful. If you need to
   double check the bar count or inspect the data, read /workspace/bars.json directly (e.g.
   \`python3 -c "import json; print(len(json.load(open('/workspace/bars.json'))['bars']))"\`) --
   never grep or search outside /workspace, and never grep the filesystem root.

3. Use the write_file tool to save a SELF-CONTAINED Python script to exactly this path:
   /workspace/model.py -- this exact file is what gets graded, nothing else you write or say
   counts. It will be re-executed later with NO network access, so it must NOT call fetch_ohlcv
   or any other tool again -- embed the returns/forecasts/calls/timestamps you already computed
   directly as literal Python lists in the script. When run standalone (\`python /workspace/model.py\`),
   the script must:
   - Write a JSON object to /tmp/eval_request.json with exactly these keys: returns, forecasts,
     calls, timestamps, as_of (ISO datetime with timezone, e.g. "${end}T00:00:00+05:30"),
     segment ("EQUITY_DELIVERY"), position_notional, trade_side, capital (a positive number,
     e.g. 100000.0). returns/forecasts/calls/timestamps/position_notional/trade_side must all be
     the same length.
   - Exit with code 0 on success.
   Before finishing, run \`python /workspace/model.py && cat /tmp/eval_request.json\` yourself via
   execute to confirm the file is actually produced -- do not finish until that succeeds.

4. Separately, as your structured final response, give your own overall forecast for ${symbol}
   over the next horizon_days: direction ("up"/"down"), probability, confidence, horizon_days,
   evidence (list of short strings citing what you observed in the data), and an optional dissent.`;
}

// Takes the sandbox adapter, parsed signal, and run ID; reads back the agent's own
// /workspace/model.py (written via the write_file tool during explore) and copies it to a host
// temp path for the validate tier to bind-mount -- no transcript scraping, the file the agent
// actually wrote and tested is the one that gets validated.
async function writeModelScript(
  adapter: SandboxBackendAdapter,
  signal: PriceAnchorSignal,
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

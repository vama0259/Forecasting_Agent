// Manual driver: runs full 4-Round Adversarial Debate Protocol against real DeepSeek,
// real market-data MCP server, real Docker sandboxes, and real Postgres for one symbol.
// Run with: pnpm exec tsx --env-file=../.env scripts/run-real-debate.ts <SYMBOL>

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
import { loadConfig } from '../src/config-loader.js';
import { runMigrations } from '../src/storage/migrator.js';
import { runMultiAgentPipeline } from '../src/pipeline/multi-agent.js';
import { CapabilityRegistry } from '../src/capabilities/registry.js';
import { createRedisClient } from '../src/search/redis.js';
import { SearchBudgetLedger } from '../src/search/budget.js';
import { RunScopedSearchCache } from '../src/search/cache.js';
import { DomainAllowlist } from '../src/search/allowlist.js';
import { AnySearchResultParser } from '../src/search/parser.js';
import { AnySearchProvider } from '../src/search/provider.js';
import { AnySearchCapability } from '../src/search/capability.js';
import { saveSearchObservations } from '../src/storage/repository.js';
import { PostgresStore } from '../src/storage/postgres-store.js';
import { DebateOrchestrator } from '../src/debate/orchestrator.js';
import { SandboxManager } from '../src/sandbox/manager.js';
import { SandboxBackendAdapter } from '../src/sandbox/deepagents-adapter.js';
import { startForecastTrace, flushTraces, getLangchainCallbackHandler } from '../src/tracing/langfuse.js';
import { buildSearchTool } from '../src/search/tool.js';
import type { AgentSignal } from '../agents/schema.js';
import type { ParticipantAgentName } from '../agents/types.js';

const REPO_ROOT = process.env.REPO_ROOT ?? '/home/varunmalhotra/Desktop/Forecasting_Agent';
process.env.REPO_ROOT = REPO_ROOT;
const symbol = process.argv[2] ?? 'TCS.NS';

const config = loadConfig(join(import.meta.dirname, '..', 'harness_config.yaml'));
const pool = new Pool({ connectionString: config.storage.connection_string });
const store = new PostgresStore({ pool });

// Search setup
const searchServerName = config.capabilities.search;
const searchMcpConfig = config.mcp_servers[searchServerName];
if (!searchMcpConfig) {
  throw new Error(`MCP server configuration missing for capability 'search' (${searchServerName})`);
}
const searchMcpClient = new MultiServerMCPClient({ [searchServerName]: searchMcpConfig });
const redisClient = createRedisClient(config.redis.url);

const ledger = new SearchBudgetLedger(redisClient, {
  dailyCap: config.search.daily_cap,
  runTtlSeconds: config.search.run_ttl_seconds,
});
const cache = new RunScopedSearchCache(redisClient, {
  runTtlSeconds: config.search.run_ttl_seconds,
});
const allowlist = new DomainAllowlist(config.search.allowed_domains);
const parser = new AnySearchResultParser();
const provider = new AnySearchProvider({
  getTools: () => searchMcpClient.getTools(),
  parser,
  maxResults: config.search.max_results,
  timeoutMs: config.search.provider_timeout_ms,
});
const searchCapability = new AnySearchCapability({
  provider,
  allowlist,
  ledger,
  cache,
  saveObservations: (rows) => saveSearchObservations(pool, rows),
  initialBudget: config.search.initial_run_budget,
});

const registry = new CapabilityRegistry();
registry.register('search', searchCapability);
await registry.validateAll();

// Market data MCP server setup
const marketServerName = config.capabilities.market_data;
const marketMcpConfig = config.mcp_servers[marketServerName];
if (!marketMcpConfig) {
  throw new Error(`MCP server configuration missing for capability 'market_data' (${marketServerName})`);
}
const marketMcpClient = new MultiServerMCPClient({ [marketServerName]: marketMcpConfig });

const sandboxManager = new SandboxManager(config.sandbox);

function memSnapshot(): string {
  const m = process.memoryUsage();
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;
  return `rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)} external=${mb(m.external)}`;
}

console.error(`--- run-real-debate: symbol=${symbol} started ${new Date().toISOString()} | mem: ${memSnapshot()} ---`);

try {
  await runMigrations(pool, `${REPO_ROOT}/harness/src/storage/migrations`);
  console.error(`migrations: up to date | mem: ${memSnapshot()}`);

  console.error(`\n[DEBATE] === ROUND 1: Independent Participant Execution ===`);
  const r1PipelineResult = await runMultiAgentPipeline({ config, pool, symbol, search: searchCapability });
  console.error(
    `[DEBATE] Round 1 complete. M8 Backtest Verdict: ${r1PipelineResult.evalResult?.verdict.status ?? 'N/A'}`,
  );

  const asOf = new Date().toISOString();
  const runId = `debate-${symbol}-${Date.now()}`;
  const trace = startForecastTrace(symbol, asOf, runId);
  const langfuseHandler = getLangchainCallbackHandler(trace);

  const rawMarketTools = await marketMcpClient.getTools();
  const marketTools = rawMarketTools.map((t) => {
    (t as { handleToolErrors?: boolean }).handleToolErrors = true;
    return t;
  });
  const searchTool = buildSearchTool(searchCapability);
  const tools = [...marketTools, searchTool];

  const sandboxAdapter = new SandboxBackendAdapter(sandboxManager, runId);

  const orchestrator = new DebateOrchestrator({ store });

  console.error(`\n[DEBATE] === ROUND 2 & 3: Adversarial Debate & Devil's Advocate Stress-Test ===`);
  const forecastRes = await pool.query('SELECT id FROM forecasts WHERE symbol = $1 ORDER BY created_at DESC LIMIT 1', [
    symbol,
  ]);
  let forecastId = forecastRes.rows[0]?.id;
  if (!forecastId) {
    forecastId = randomUUID();
    const anchorSignal = r1PipelineResult.signals.price;
    await pool.query(
      `INSERT INTO forecasts (id, symbol, horizon, prediction, confidence, created_at, as_of, degraded)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), false)`,
      [forecastId, symbol, '1d', JSON.stringify(anchorSignal), anchorSignal?.confidence ?? 0.5],
    );
  }

  const consensus = await orchestrator.runDebate({
    forecastId,
    symbol,
    asOf,
    round1Signals: r1PipelineResult.signals as Record<ParticipantAgentName, AgentSignal>,
    config,
    sandboxAdapter,
    tools,
    store,
    trace,
    langfuseHandler: langfuseHandler ?? undefined,
  });

  console.error(`\n[DEBATE] === ROUND 4: Deterministic Arithmetic Consensus ===`);
  console.log(JSON.stringify(consensus, null, 2));

  console.error(`\n=================== EXECUTIVE DEBATE DIGEST ===================`);
  console.error(`Symbol:                 ${consensus.symbol}`);
  console.error(`Consensus Direction:    ${consensus.direction.toUpperCase()}`);
  console.error(`Consensus Probability:  ${(consensus.consensus_probability * 100).toFixed(1)}%`);
  console.error(`Consensus Confidence:   ${(consensus.consensus_confidence * 100).toFixed(1)}%`);
  console.error(`Disagreement Dispersion: ${consensus.dispersion.toFixed(4)}`);
  console.error(
    `Deadlock Status:        ${consensus.is_deadlocked ? 'DEADLOCKED (Dual Scenarios Active)' : 'RESOLVED'}`,
  );
  console.error(`================================================================`);

  await flushTraces();
} finally {
  redisClient.disconnect();
  await searchMcpClient.close();
  await marketMcpClient.close();
  await pool.end();
  console.error(`--- run-real-debate: finished ${new Date().toISOString()} | mem: ${memSnapshot()} ---`);
}
process.exit(0);

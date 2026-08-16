// Manual driver: runs runSingleAgentPipeline against real DeepSeek, real market-data MCP server,
// real Docker sandbox, and real Postgres for one symbol. Not part of `pnpm test` (lives outside
// tests/, vitest's glob never sees it). Run with: pnpm exec tsx --env-file=.env scripts/run-real-pipeline.ts <SYMBOL>
// (plain `node --experimental-strip-types` can't resolve the .js-suffixed imports back to their
// .ts sources -- Node's type-stripping doesn't do that remapping, only tsx/ts-node do.)

import { join } from 'node:path';
import { Pool } from 'pg';
import { MultiServerMCPClient } from 'langchain-mcp-adapters';
import { loadConfig } from '../src/config-loader.js';
import { runMigrations } from '../src/storage/migrator.js';
import { runSingleAgentPipeline } from '../src/pipeline/single-agent.js';
import { CapabilityRegistry } from '../src/capabilities/registry.js';
import { createRedisClient } from '../src/search/redis.js';
import { SearchBudgetLedger } from '../src/search/budget.js';
import { RunScopedSearchCache } from '../src/search/cache.js';
import { DomainAllowlist } from '../src/search/allowlist.js';
import { AnySearchResultParser } from '../src/search/parser.js';
import { AnySearchProvider } from '../src/search/provider.js';
import { AnySearchCapability } from '../src/search/capability.js';
import { saveSearchObservations } from '../src/storage/repository.js';

const REPO_ROOT = process.env.REPO_ROOT ?? '/home/varunmalhotra/Desktop/Forecasting_Agent';
process.env.REPO_ROOT = REPO_ROOT;
const symbol = process.argv[2] ?? 'RELIANCE.NS';

const config = loadConfig(join(import.meta.dirname, '..', 'harness_config.yaml'));

const pool = new Pool({ connectionString: config.storage.connection_string });

const searchServerName = config.capabilities.search;
const searchMcpConfig = config.mcp_servers[searchServerName];
if (!searchMcpConfig) {
  throw new Error(`MCP server configuration missing for capability 'search' (${searchServerName})`);
}
const searchMcpClient = new MultiServerMCPClient({ [searchServerName]: searchMcpConfig });
const redisClient = createRedisClient(config.redis.url);

const ledger = new SearchBudgetLedger(redisClient, {
  dailyCap: config.search.daily_quota_cap,
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

// Takes nothing; returns this process's RSS/heap footprint as a short log-friendly string.
function memSnapshot(): string {
  const m = process.memoryUsage();
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;
  return `rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)} external=${mb(m.external)}`;
}

console.error(
  `--- run-real-pipeline: symbol=${symbol} started ${new Date().toISOString()} | mem: ${memSnapshot()} ---`,
);
try {
  await runMigrations(pool, `${REPO_ROOT}/harness/src/storage/migrations`);
  console.error(`migrations: up to date | mem: ${memSnapshot()}`);

  const result = await runSingleAgentPipeline({ config, pool, symbol, search: searchCapability });
  console.error(`--- RESULT --- | mem: ${memSnapshot()}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  redisClient.disconnect();
  await searchMcpClient.close();
  await pool.end();
  console.error(`--- run-real-pipeline: finished ${new Date().toISOString()} | mem: ${memSnapshot()} ---`);
}
// The OTel NodeSDK's exporter keeps an unref'd-never keep-alive HTTP connection to Langfuse open
// by design (so a long-running server keeps tracing across many pipeline runs) -- this script is
// a one-shot CLI driver, not that server, so force-exit once its own work is actually done.
process.exit(0);

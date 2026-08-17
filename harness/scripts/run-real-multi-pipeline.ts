// Manual driver: runs runMultiAgentPipeline against real DeepSeek, real market-data MCP server,
// real Docker sandbox, and real Postgres for one symbol.
// Run with: pnpm exec tsx --env-file=../.env scripts/run-real-multi-pipeline.ts <SYMBOL>

import { join } from 'node:path';
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

const REPO_ROOT = process.env.REPO_ROOT ?? '/home/varunmalhotra/Desktop/Forecasting_Agent';
process.env.REPO_ROOT = REPO_ROOT;
const symbol = process.argv[2] ?? 'TCS.NS';

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

function memSnapshot(): string {
  const m = process.memoryUsage();
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;
  return `rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)} external=${mb(m.external)}`;
}

console.error(
  `--- run-real-multi-pipeline: symbol=${symbol} started ${new Date().toISOString()} | mem: ${memSnapshot()} ---`,
);
try {
  await runMigrations(pool, `${REPO_ROOT}/harness/src/storage/migrations`);
  console.error(`migrations: up to date | mem: ${memSnapshot()}`);

  const result = await runMultiAgentPipeline({ config, pool, symbol, search: searchCapability });
  console.error(`--- RESULT --- | mem: ${memSnapshot()}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  redisClient.disconnect();
  await searchMcpClient.close();
  await pool.end();
  console.error(`--- run-real-multi-pipeline: finished ${new Date().toISOString()} | mem: ${memSnapshot()} ---`);
}
process.exit(0);

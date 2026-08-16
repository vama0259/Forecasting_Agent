// Manual driver: runs runSingleAgentPipeline against real DeepSeek, real market-data MCP server,
// real Docker sandbox, and real Postgres for one symbol. Not part of `pnpm test` (lives outside
// tests/, vitest's glob never sees it). Run with: pnpm exec tsx --env-file=.env scripts/run-real-pipeline.ts <SYMBOL>
// (plain `node --experimental-strip-types` can't resolve the .js-suffixed imports back to their
// .ts sources -- Node's type-stripping doesn't do that remapping, only tsx/ts-node do.)

import { Pool } from 'pg';
import { runMigrations } from '../src/storage/migrator.js';
import { runSingleAgentPipeline } from '../src/pipeline/single-agent.js';
import type { HarnessConfig } from '../src/config.js';

const REPO_ROOT = '/home/varunmalhotra/Desktop/Forecasting_Agent';
const symbol = process.argv[2] ?? 'RELIANCE.NS';

const config: HarnessConfig = {
  llm: { provider: 'deepseek', model: process.env.LLM_MODEL ?? 'deepseek-chat', api_key: process.env.LLM_API_KEY! },
  mcp_servers: {
    market: {
      command: 'bash',
      args: ['-c', `cd ${REPO_ROOT} && exec uv run python -m forecasting_agent.data_server.server`],
    },
  },
  capabilities: { chat: 'llm', search: 'llm', sentiment: 'llm', market_data: 'market' },
  storage: { connection_string: process.env.STORAGE_CONNECTION_STRING! },
  tracing: {
    langfuse_public_key: process.env.LANGFUSE_PUBLIC_KEY!,
    langfuse_secret_key: process.env.LANGFUSE_SECRET_KEY!,
    langfuse_base_url: process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3000',
    langfuse_session_id: process.env.LANGFUSE_SESSION_ID || undefined,
  },
  sandbox: {},
  eval: {},
};

const pool = new Pool({ connectionString: config.storage.connection_string });

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

  const result = await runSingleAgentPipeline({ config, pool, symbol });
  console.error(`--- RESULT --- | mem: ${memSnapshot()}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
  console.error(`--- run-real-pipeline: finished ${new Date().toISOString()} | mem: ${memSnapshot()} ---`);
}
// The OTel NodeSDK's exporter keeps an unref'd-never keep-alive HTTP connection to Langfuse open
// by design (so a long-running server keeps tracing across many pipeline runs) -- this script is
// a one-shot CLI driver, not that server, so force-exit once its own work is actually done.
process.exit(0);

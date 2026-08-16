// Manual driver: runs runSingleAgentPipeline against real DeepSeek, real market-data MCP server,
// real Docker sandbox, and real Postgres for one symbol. Not part of `pnpm test` (lives outside
// tests/, vitest's glob never sees it). Run with: node --experimental-strip-types scripts/run-real-pipeline.ts <SYMBOL>

import { join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../src/config-loader.js';
import { runMigrations } from '../src/storage/migrator.js';
import { runSingleAgentPipeline } from '../src/pipeline/single-agent.js';

const REPO_ROOT = process.env.REPO_ROOT ?? '/home/varunmalhotra/Desktop/Forecasting_Agent';
process.env.REPO_ROOT = REPO_ROOT;
const symbol = process.argv[2] ?? 'RELIANCE.NS';

const config = loadConfig(join(import.meta.dirname, '..', 'harness_config.yaml'));

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

import { join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../src/config-loader.js';

process.env.REPO_ROOT = process.env.REPO_ROOT ?? '/home/varunmalhotra/Desktop/Forecasting_Agent';
const config = loadConfig(join(import.meta.dirname, '..', 'harness_config.yaml'));
const pool = new Pool({ connectionString: config.storage.connection_string });

const res = await pool.query(
  'SELECT namespace, key, value, created_at FROM agent_memories ORDER BY created_at DESC LIMIT 10'
);

console.log(`\n=== AGENT GENERATED FILES IN DATABASE (${res.rows.length} records) ===`);
for (const row of res.rows) {
  console.log(`\n-------------------------------------------------------------`);
  console.log(`Namespace: ${JSON.stringify(row.namespace)} | Key: ${row.key}`);
  console.log(`Time: ${new Date(row.created_at).toLocaleTimeString()}`);
  console.log(`Content Preview:`);
  const val = typeof row.value === 'string' ? row.value : JSON.stringify(row.value, null, 2);
  console.log(val.slice(0, 300) + (val.length > 300 ? '\n... [truncated]' : ''));
}

await pool.end();

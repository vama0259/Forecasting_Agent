import { join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../src/config-loader.js';

process.env.REPO_ROOT = process.env.REPO_ROOT ?? '/home/varunmalhotra/Desktop/Forecasting_Agent';
const config = loadConfig(join(import.meta.dirname, '..', 'harness_config.yaml'));
const pool = new Pool({ connectionString: config.storage.connection_string });

const res = await pool.query(
  'SELECT round_number, agent_name, direction, probability, confidence, degraded, created_at FROM debate_rounds ORDER BY round_number ASC, created_at ASC;',
);

console.log(`\nTotal debate_rounds persisted: ${res.rows.length}`);
console.table(
  res.rows.map((r) => ({
    round: r.round_number,
    agent: r.agent_name,
    dir: r.direction,
    prob: Number(r.probability).toFixed(2),
    conf: Number(r.confidence).toFixed(2),
    degraded: r.degraded,
    time: new Date(r.created_at).toLocaleTimeString(),
  })),
);

await pool.end();

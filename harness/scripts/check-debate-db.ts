import { join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../src/config-loader.js';

process.env.REPO_ROOT = process.env.REPO_ROOT ?? '/home/varunmalhotra/Desktop/Forecasting_Agent';
const config = loadConfig(join(import.meta.dirname, '..', 'harness_config.yaml'));
const pool = new Pool({ connectionString: config.storage.connection_string });

const res = await pool.query(
  'SELECT forecast_id, symbol, as_of, round_number, agent_name, direction, probability, confidence, degraded, payload, created_at FROM debate_rounds ORDER BY round_number ASC, created_at ASC;',
);

console.log(`\nTotal debate_rounds persisted: ${res.rows.length}`);
console.log('Sample payload round 1:', JSON.stringify(res.rows[0]?.payload, null, 2));
console.log('Sample payload round 2:', JSON.stringify(res.rows.find(r => r.round_number === 2)?.payload, null, 2));
console.log('Sample payload round 3:', JSON.stringify(res.rows.find(r => r.round_number === 3)?.payload, null, 2));
console.log('Sample payload round 4 (consensus):', JSON.stringify(res.rows.find(r => r.round_number === 4)?.payload, null, 2));


await pool.end();

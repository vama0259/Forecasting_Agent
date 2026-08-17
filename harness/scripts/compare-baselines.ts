import { join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../src/config-loader.js';

process.env.REPO_ROOT = process.env.REPO_ROOT ?? '/home/varunmalhotra/Desktop/Forecasting_Agent';
const config = loadConfig(join(import.meta.dirname, '..', 'harness_config.yaml'));
const pool = new Pool({ connectionString: config.storage.connection_string });

const forecasts = await pool.query(
  'SELECT id, symbol, horizon, prediction, confidence, degraded, created_at FROM forecasts WHERE symbol = $1 ORDER BY created_at ASC',
  ['TCS.NS']
);

const evalResults = await pool.query(
  'SELECT id, metric_name, metric_value, created_at FROM evaluation_results ORDER BY created_at ASC'
);

const debateRounds = await pool.query(
  'SELECT round_number, agent_name, direction, probability, confidence, degraded, created_at FROM debate_rounds ORDER BY created_at ASC'
);

console.log(`\n=== FORECASTS (${forecasts.rows.length} total) ===`);
console.table(forecasts.rows.map(r => ({
  id: r.id.slice(0, 8),
  symbol: r.symbol,
  pred: typeof r.prediction === 'string' ? JSON.parse(r.prediction).direction + ' ' + JSON.parse(r.prediction).probability : r.prediction.direction + ' ' + r.prediction.probability,
  conf: Number(r.confidence).toFixed(2),
  degraded: r.degraded,
  time: new Date(r.created_at).toLocaleTimeString()
})));

console.log(`\n=== EVALUATION RESULTS (${evalResults.rows.length} total) ===`);
console.table(evalResults.rows.map(r => ({
  metric: r.metric_name,
  value: Number(r.metric_value).toFixed(4),
  time: new Date(r.created_at).toLocaleTimeString()
})));

console.log(`\n=== DEBATE ROUND EVOLUTION (${debateRounds.rows.length} records) ===`);
console.table(debateRounds.rows.map(r => ({
  round: r.round_number,
  agent: r.agent_name,
  dir: r.direction,
  prob: Number(r.probability).toFixed(2),
  conf: Number(r.confidence).toFixed(2),
  degraded: r.degraded,
  time: new Date(r.created_at).toLocaleTimeString()
})));

await pool.end();

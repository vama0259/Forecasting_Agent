import { describe, it, expect, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '../src/storage/migrator.js';
import { saveForecast, queryMemory } from '../src/storage/repository.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/harness_test';

describe('full storage integration', () => {
  beforeEach(async () => {
    // Isolation: this suite asserts an exact row count, so leftover rows from a
    // prior run (this DB is not recreated per run) would silently break it —
    // reproduced for real: two consecutive runs left 4 TCS rows instead of 2.
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    await pool.query(
      'TRUNCATE forecasts, debate_traces, evaluation_results, agent_signals, debate_checkpoints, semantic_memory',
    );
    await pool.end();
  });

  it('write -> read -> as_of filter cycle end to end', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    await saveForecast(pool, {
      symbol: 'TCS',
      horizon: '5d',
      prediction: { direction: 'up' },
      confidence: 0.7,
      asOf: new Date('2024-05-01'),
    });
    await saveForecast(pool, {
      symbol: 'TCS',
      horizon: '5d',
      prediction: { direction: 'down' },
      confidence: 0.6,
      asOf: new Date('2024-08-01'),
    });
    const asOfJune = await queryMemory(pool, new Date('2024-06-01'));
    const tcsResults = asOfJune.filter((r) => 'symbol' in r && r.symbol === 'TCS');
    expect(tcsResults.length).toBe(1);
    await pool.end();
  });
});

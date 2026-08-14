import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '../src/storage/migrator.js';
import { saveForecast, queryMemory } from '../src/storage/repository.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/harness_test';

describe('full storage integration', () => {
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

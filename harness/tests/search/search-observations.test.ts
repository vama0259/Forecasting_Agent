// Tests for search observation database migration and repository persistence.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../../src/storage/migrator.js';
import { saveSearchObservations, saveForecast } from '../../src/storage/repository.js';

const pool = new Pool({
  connectionString: process.env.STORAGE_CONNECTION_STRING ?? 'postgresql://harness:harness@127.0.0.1:5432/harness',
});
const runId = randomUUID();

beforeAll(async () => {
  await runMigrations(pool, 'src/storage/migrations');
});

afterAll(async () => {
  await pool.query('DELETE FROM search_observations WHERE forecast_run_id = $1', [runId]);
  await pool.query("DELETE FROM forecasts WHERE symbol = 'TEST21'");
  await pool.end();
});

describe('search_observations', () => {
  it('persists allowed and rejected results together, in one call', async () => {
    await saveSearchObservations(pool, [
      {
        forecast_run_id: runId,
        query: 'RELIANCE news',
        normalized_query: 'reliance news',
        provider: 'anysearch',
        result_rank: 1,
        title: 'A',
        url: 'https://www.moneycontrol.com/a',
        hostname: 'www.moneycontrol.com',
        allowed: true,
        content: 'body',
        retrieved_at: new Date(),
      },
      {
        forecast_run_id: runId,
        query: 'RELIANCE news',
        normalized_query: 'reliance news',
        provider: 'anysearch',
        result_rank: 2,
        title: 'B',
        url: 'https://www.google.com/b',
        hostname: 'www.google.com',
        allowed: false,
        content: 'body',
        retrieved_at: new Date(),
      },
    ]);
    const rows = await pool.query(
      'SELECT allowed, hostname FROM search_observations WHERE forecast_run_id = $1 ORDER BY result_rank',
      [runId],
    );
    expect(rows.rows).toEqual([
      { allowed: true, hostname: 'www.moneycontrol.com' },
      { allowed: false, hostname: 'www.google.com' },
    ]);
  });

  it('two runs may archive the same article on the same day', async () => {
    const other = randomUUID();
    await saveSearchObservations(pool, [
      {
        forecast_run_id: other,
        query: 'q',
        normalized_query: 'q',
        provider: 'anysearch',
        result_rank: 1,
        title: 'A',
        url: 'https://www.moneycontrol.com/a',
        hostname: 'www.moneycontrol.com',
        allowed: true,
        content: 'body',
        retrieved_at: new Date(),
      },
    ]);
    const rows = await pool.query('SELECT count(*) FROM search_observations WHERE url = $1', [
      'https://www.moneycontrol.com/a',
    ]);
    expect(Number(rows.rows[0].count)).toBeGreaterThanOrEqual(2);
    await pool.query('DELETE FROM search_observations WHERE forecast_run_id = $1', [other]);
  });

  it('persists a degraded forecast', async () => {
    await saveForecast(pool, {
      symbol: 'TEST21',
      horizon: '5d',
      prediction: {},
      confidence: 0.5,
      as_of: new Date(),
      degraded: true,
    });
    const rows = await pool.query("SELECT degraded FROM forecasts WHERE symbol = 'TEST21'");
    expect(rows.rows[0].degraded).toBe(true);
  });

  it('defaults degraded to false when not supplied', async () => {
    await saveForecast(pool, {
      symbol: 'TEST21',
      horizon: '5d',
      prediction: {},
      confidence: 0.5,
      as_of: new Date(),
    });
    const rows = await pool.query(
      "SELECT degraded FROM forecasts WHERE symbol = 'TEST21' ORDER BY created_at DESC LIMIT 1",
    );
    expect(rows.rows[0].degraded).toBe(false);
  });
});

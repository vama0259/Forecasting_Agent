import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PostgresStore, type DebateRoundRecord } from '../src/storage/postgres-store.js';
import { runMigrations } from '../src/storage/migrator.js';
import { randomUUID } from 'node:crypto';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.STORAGE_CONNECTION_STRING ??
  'postgresql://harness:harness@localhost:5432/harness';

describe('DebateRounds Storage & Migration (006_debate_rounds.sql)', () => {
  let pool: Pool;
  let store: PostgresStore;

  beforeEach(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    store = new PostgresStore({ pool });
    await runMigrations(pool, 'src/storage/migrations');
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('verifies 006_debate_rounds.sql migration creates table and indexes', async () => {
    const applied = await pool.query('SELECT name FROM schema_migrations WHERE name = $1', ['006_debate_rounds.sql']);
    expect(applied.rows.length).toBe(1);

    const tableCheck = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'debate_rounds'
       ORDER BY ordinal_position`,
    );
    const columns = tableCheck.rows.map((r) => r.column_name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'forecast_id',
        'symbol',
        'as_of',
        'round_number',
        'agent_name',
        'direction',
        'probability',
        'confidence',
        'degraded',
        'payload',
        'created_at',
      ]),
    );

    const indexCheck = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'debate_rounds'`);
    const indexNames = indexCheck.rows.map((r) => r.indexname);
    expect(indexNames).toContain('idx_debate_rounds_forecast_id');
    expect(indexNames).toContain('idx_debate_rounds_symbol_as_of');
  });

  it('saves and retrieves debate rounds across all 4 rounds in order', async () => {
    const forecastId = randomUUID();
    const asOf = new Date('2026-08-17T10:00:00Z').toISOString();

    // Insert dummy parent forecast record
    await pool.query(
      `INSERT INTO forecasts (id, symbol, horizon, prediction, confidence, created_at, as_of)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [forecastId, 'TCS.NS', '1d', JSON.stringify({ direction: 'up' }), 0.8, asOf],
    );

    const roundsToInsert: DebateRoundRecord[] = [
      {
        forecastId,
        symbol: 'TCS.NS',
        asOf,
        roundNumber: 1,
        agentName: 'price',
        direction: 'up',
        probability: 0.75,
        confidence: 0.8,
        degraded: false,
        payload: { thesis: 'Price breakout above 20 EMA' },
      },
      {
        forecastId,
        symbol: 'TCS.NS',
        asOf,
        roundNumber: 1,
        agentName: 'fii',
        direction: 'down',
        probability: 0.65,
        confidence: 0.7,
        degraded: false,
        payload: { thesis: 'Net FII selling in IT sector' },
      },
      {
        forecastId,
        symbol: 'TCS.NS',
        asOf,
        roundNumber: 2,
        agentName: 'dii',
        direction: 'up',
        probability: 0.6,
        confidence: 0.65,
        degraded: false,
        payload: { thesis: 'DII absorption of supply' },
      },
      {
        forecastId,
        symbol: 'TCS.NS',
        asOf,
        roundNumber: 3,
        agentName: 'retail',
        direction: 'up',
        probability: 0.55,
        confidence: 0.5,
        degraded: true,
        payload: { thesis: 'Bullish retail option positioning' },
      },
      {
        forecastId,
        symbol: 'TCS.NS',
        asOf,
        roundNumber: 4,
        agentName: 'consensus',
        direction: 'up',
        probability: 0.7,
        confidence: 0.85,
        degraded: false,
        payload: {
          synthesis: 'Price action and DII absorption outweigh FII selling',
          final_weights: { price: 0.35, fii: 0.25, dii: 0.25, retail: 0.15 },
        },
      },
    ];

    for (const record of roundsToInsert) {
      await store.saveDebateRound(record);
    }

    const fetched = await store.getDebateRounds(forecastId);
    expect(fetched).toHaveLength(5);

    // Verify ordering by round_number ASC
    expect(fetched[0]?.roundNumber).toBe(1);
    expect(fetched[1]?.roundNumber).toBe(1);
    expect(fetched[2]?.roundNumber).toBe(2);
    expect(fetched[3]?.roundNumber).toBe(3);
    expect(fetched[4]?.roundNumber).toBe(4);

    expect(fetched[4]?.agentName).toBe('consensus');
    expect(fetched[4]?.direction).toBe('up');
    expect(fetched[4]?.probability).toBe(0.7);
    expect(fetched[4]?.confidence).toBe(0.85);
    expect(fetched[4]?.degraded).toBe(false);
    expect(fetched[4]?.payload).toEqual({
      synthesis: 'Price action and DII absorption outweigh FII selling',
      final_weights: { price: 0.35, fii: 0.25, dii: 0.25, retail: 0.15 },
    });
  });

  it('updates existing round record on conflict without throwing unique constraint error', async () => {
    const forecastId = randomUUID();
    const asOf = new Date('2026-08-17T12:00:00Z').toISOString();

    await pool.query(
      `INSERT INTO forecasts (id, symbol, horizon, prediction, confidence, created_at, as_of)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [forecastId, 'INFY.NS', '1d', JSON.stringify({ direction: 'down' }), 0.7, asOf],
    );

    const initialRecord: DebateRoundRecord = {
      forecastId,
      symbol: 'INFY.NS',
      asOf,
      roundNumber: 2,
      agentName: 'price',
      direction: 'up',
      probability: 0.55,
      confidence: 0.6,
      degraded: false,
      payload: { iteration: 1 },
    };

    await store.saveDebateRound(initialRecord);

    const updatedRecord: DebateRoundRecord = {
      forecastId,
      symbol: 'INFY.NS',
      asOf,
      roundNumber: 2,
      agentName: 'price',
      direction: 'down',
      probability: 0.8,
      confidence: 0.9,
      degraded: true,
      payload: { iteration: 2, revised: true },
    };

    await store.saveDebateRound(updatedRecord);

    const fetched = await store.getDebateRounds(forecastId);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toEqual({
      forecastId,
      symbol: 'INFY.NS',
      asOf: new Date(asOf).toISOString(),
      roundNumber: 2,
      agentName: 'price',
      direction: 'down',
      probability: 0.8,
      confidence: 0.9,
      degraded: true,
      payload: { iteration: 2, revised: true },
    });
  });

  it('cascades deletion when parent forecast is deleted', async () => {
    const forecastId = randomUUID();
    const asOf = new Date('2026-08-17T14:00:00Z').toISOString();

    await pool.query(
      `INSERT INTO forecasts (id, symbol, horizon, prediction, confidence, created_at, as_of)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [forecastId, 'RELIANCE.NS', '1d', JSON.stringify({ direction: 'up' }), 0.75, asOf],
    );

    await store.saveDebateRound({
      forecastId,
      symbol: 'RELIANCE.NS',
      asOf,
      roundNumber: 1,
      agentName: 'fii',
      direction: 'up',
      probability: 0.7,
      confidence: 0.8,
      degraded: false,
      payload: { note: 'test cascade' },
    });

    const beforeDelete = await store.getDebateRounds(forecastId);
    expect(beforeDelete).toHaveLength(1);

    await pool.query('DELETE FROM forecasts WHERE id = $1', [forecastId]);

    const afterDelete = await store.getDebateRounds(forecastId);
    expect(afterDelete).toHaveLength(0);
  });
});

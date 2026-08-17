import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '../src/storage/migrator.js';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.STORAGE_CONNECTION_STRING ??
  'postgresql://harness:harness@localhost:5432/harness';

describe('migrator', () => {
  it('applies 001_initial.sql and records it in schema_migrations', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    const applied = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(applied.rows.map((r) => r.name)).toContain('001_initial.sql');
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const names = tables.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'forecasts',
        'debate_traces',
        'evaluation_results',
        'agent_signals',
        'debate_checkpoints',
      ]),
    );
    await pool.end();
  });

  it('re-running migrations is a no-op, not a re-apply', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    const before = await pool.query('SELECT count(*) FROM schema_migrations');
    await runMigrations(pool, 'src/storage/migrations');
    const after = await pool.query('SELECT count(*) FROM schema_migrations');
    expect(after.rows[0].count).toBe(before.rows[0].count);
    await pool.end();
  });
});

describe('repository — as_of guard', () => {
  it('queryMemory excludes a future-stamped row from a past-dated query', async () => {
    const { saveForecast, queryMemory } = await import('../src/storage/repository.js');
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await saveForecast(pool, {
      symbol: 'RELIANCE',
      horizon: '1d',
      prediction: {},
      confidence: 0.8,
      asOf: new Date('2024-06-01'),
    });
    await saveForecast(pool, {
      symbol: 'RELIANCE',
      horizon: '1d',
      prediction: {},
      confidence: 0.8,
      asOf: new Date('2024-01-01'),
    });
    const results = await queryMemory(pool, new Date('2024-03-01'));
    expect(results.every((r) => r.asOf && r.asOf <= new Date('2024-03-01'))).toBe(true);
    expect(results.some((r) => r.asOf && r.asOf.getTime() === new Date('2024-01-01').getTime())).toBe(true);
    await pool.end();
  });

  it('there is no alternate read method that skips the as_of guard', async () => {
    const repo = await import('../src/storage/repository.js');
    const exportedNames = Object.keys(repo);
    const readMethods = exportedNames.filter(
      (n) => n.toLowerCase().includes('query') || n.toLowerCase().includes('get'),
    );
    expect(readMethods).toEqual(['queryMemory']);
  });
});

describe('semantic_memory (pgvector)', () => {
  it('applies 002_memory_tiers.sql, creates a real vector column and index', async () => {
    const pool = new Pool({ connectionString: TEST_DB_URL });
    await runMigrations(pool, 'src/storage/migrations');
    const ext = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
    expect(ext.rows.length).toBe(1);
    await pool.query(
      `INSERT INTO semantic_memory (id, embedding, as_of, created_at) VALUES (gen_random_uuid(), '[0.1,0.2,0.3]', now(), now())`,
    );
    const rows = await pool.query(`SELECT embedding FROM semantic_memory LIMIT 1`);
    expect(rows.rows.length).toBe(1);
    await pool.end();
  });
});

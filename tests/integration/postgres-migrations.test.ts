/**
 * Purpose: Integration tests for PostgresMigrator and schema execution.
 * Responsibility: Verify database tables, functions, and triggers are created.
 * Inputs/outputs: Active PostgreSQL connection pool; assertions on system catalog.
 * Excludes: Runtime container executions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresPool } from '../../src/adapters/postgres/postgres-pool.js';
import { PostgresMigrator } from '../../src/adapters/postgres/postgres-migrator.js';

describe('Postgres Migrations Integration', () => {
  let pool: PostgresPool;
  let migrator: PostgresMigrator;

  beforeAll(async () => {
    pool = new PostgresPool();
    migrator = new PostgresMigrator(pool);
    await migrator.runMigrations();
  });

  afterAll(async () => {
    await pool.close();
  });

  it('creates all required application tables and migration tracking', async () => {
    const res = await pool.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const tables = new Set(res.rows.map((r) => r.table_name));

    expect(tables.has('schema_migrations')).toBe(true);
    expect(tables.has('organizations')).toBe(true);
    expect(tables.has('projects')).toBe(true);
    expect(tables.has('contracts')).toBe(true);
    expect(tables.has('execution_contracts')).toBe(true);
    expect(tables.has('runs')).toBe(true);
    expect(tables.has('run_attempts')).toBe(true);
    expect(tables.has('executions')).toBe(true);
    expect(tables.has('execution_authorizations')).toBe(true);
    expect(tables.has('execution_commands')).toBe(true);
    expect(tables.has('execution_events')).toBe(true);
    expect(tables.has('artifacts')).toBe(true);
    expect(tables.has('artifact_versions')).toBe(true);
    expect(tables.has('publications')).toBe(true);
    expect(tables.has('outcome_versions')).toBe(true);
    expect(tables.has('evaluation_runs')).toBe(true);
  });

  it('runs migrations idempotently without re-executing', async () => {
    const newlyApplied = await migrator.runMigrations();
    expect(newlyApplied).toHaveLength(0);
  });
});

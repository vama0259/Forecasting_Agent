/**
 * Purpose: PostgreSQL connection pool manager and transactional client provider.
 * Responsibility: Manage pg.Pool lifecycle, execute queries, and wrap transactions.
 * Inputs/outputs: Connection config / queries; returns query results and leases.
 * Excludes: Domain entity mapping and business logic validation.
 */

import pg from 'pg';

const { Pool } = pg;

/** Configuration parameters for initializing a Postgres connection pool. */
export interface PostgresPoolConfig {
  readonly connectionString?: string;
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
}

/**
 * Manages PostgreSQL connection lifecycle and transaction execution.
 */
export class PostgresPool {
  readonly pool: pg.Pool;

  /**
   * Initializes PostgreSQL pool with provided configuration or defaults.
   * Sets default pool bounds and timeout handlers.
   */
  constructor(config: PostgresPoolConfig = {}) {
    this.pool = new Pool({
      host: config.host ?? process.env['PGHOST'] ?? 'localhost',
      port: config.port ?? Number(process.env['PGPORT'] ?? 5432),
      user: config.user ?? process.env['PGUSER'] ?? 'postgres',
      password: config.password ?? process.env['PGPASSWORD'] ?? 'postgres',
      database: config.database ?? process.env['PGDATABASE'] ?? 'forecasting_test',
      max: config.max ?? 10,
      idleTimeoutMillis: config.idleTimeoutMillis ?? 10000,
      connectionString: config.connectionString,
    });
  }

  /**
   * Executes a parameterized SQL query against the pool.
   * Returns pg.QueryResult containing rows and command metadata.
   */
  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(sql, params as unknown[]);
  }

  /**
   * Acquires a client and executes the callback within an atomic transaction.
   * Commits on success or automatically rolls back and rethrows on error.
   */
  async withTransaction<T>(
    callback: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Closes all active pool connections gracefully.
   * Resolves when pool has drained.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

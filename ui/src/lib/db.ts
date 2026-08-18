import { Pool } from 'pg';

const connectionString =
  process.env.STORAGE_CONNECTION_STRING ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/forecasting_agent';

let poolInstance: Pool | null = null;

export function getDbPool(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return poolInstance;
}

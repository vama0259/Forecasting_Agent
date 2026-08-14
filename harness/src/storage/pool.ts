import { Pool } from 'pg';
import type { HarnessConfig } from '../config.js';

let poolInstance: Pool | null = null;

export function getPool(config: HarnessConfig): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: config.storage.connection_string,
      max: 10,
    });
  }
  return poolInstance;
}

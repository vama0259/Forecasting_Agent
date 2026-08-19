// Vitest setup: loads the repo-root .env before any test file's top-level code runs, so
// TEST_DATABASE_URL is actually set. Without this, `pnpm test` never loads .env at all --
// TEST_DATABASE_URL silently stays undefined and storage-integration.test.ts's fallback chain
// (TEST_DATABASE_URL ?? STORAGE_CONNECTION_STRING ?? 'postgresql://harness:harness@localhost:5432/harness')
// resolves straight to the production database. Reproduced for real: rounds/evals went 13/1 -> 0/0
// across a `pnpm test` run even with TEST_DATABASE_URL correctly set in .env, because nothing
// loaded that file into process.env.
import { resolve } from 'node:path';

process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set after loading .env -- refusing to run tests that could ' +
      'fall through to the production database (STORAGE_CONNECTION_STRING).',
  );
}

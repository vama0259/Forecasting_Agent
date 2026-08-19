// Vitest configuration for the harness test suite: loads .env before any test file's top-level
// code runs, so TEST_DATABASE_URL is set before storage-integration.test.ts's fallback chain
// (which would otherwise resolve to the production database) ever gets evaluated.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup/load-env.ts'],
  },
});

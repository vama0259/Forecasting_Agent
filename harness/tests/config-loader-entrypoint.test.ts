// Tests verifying that harness_config.yaml and real entrypoints load configuration correctly.

import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config-loader.js';
import { ConfigValidationError } from '../src/errors.js';

const env = {
  ANYSEARCH_API_KEY: 'k',
  REDIS_URL: 'redis://127.0.0.1:6379',
  REPO_ROOT: '/repo',
  LLM_MODEL: 'm',
  LLM_API_KEY: 'k',
  STORAGE_CONNECTION_STRING: 'postgres://x',
  LANGFUSE_PUBLIC_KEY: 'a',
  LANGFUSE_SECRET_KEY: 'b',
  LANGFUSE_BASE_URL: 'http://x',
};

describe('harness_config.yaml is loadable by the real entrypoint', () => {
  it('loads and binds every capability to a defined server', () => {
    const config = loadConfig('harness_config.yaml', env);
    expect(config.capabilities.search).toBe('anysearch');
    expect(config.mcp_servers.anysearch).toBeDefined();
    expect(config.mcp_servers.market).toBeDefined();
  });

  it('fails loudly when a capability points at an undefined server', () => {
    expect(() => loadConfig('tests/fixtures/harness_config.dangling.yaml', env)).toThrow(ConfigValidationError);
  });

  it('redacts the interpolated api key from validation errors', () => {
    try {
      loadConfig('tests/fixtures/harness_config.dangling.yaml', { ...env, ANYSEARCH_API_KEY: 'super-secret-value' });
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-value');
    }
  });
});

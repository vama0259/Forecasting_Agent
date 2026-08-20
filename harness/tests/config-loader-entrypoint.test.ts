// Tests verifying that harness_config.yaml and real entrypoints load configuration correctly.

import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config-loader.js';
import { ConfigValidationError } from '../src/errors.js';

const env = {
  ANYSEARCH_API_KEY: 'k',
  REDIS_URL: 'redis://127.0.0.1:6379',
  REPO_ROOT: '/repo',
  LLM_PROVIDER: 'deepseek',
  LLM_MODEL: 'm',
  LLM_CODE_MODEL: 'm-pro',
  LLM_API_KEY: 'k',
  STORAGE_CONNECTION_STRING: 'postgres://x',
  LANGFUSE_PUBLIC_KEY: 'a',
  LANGFUSE_SECRET_KEY: 'b',
  LANGFUSE_BASE_URL: 'http://x',
  ANGELONE_API_KEY: 'angelone-api-key',
  ANGELONE_CLIENT_CODE: 'angelone-client-code',
  ANGELONE_MPIN: 'angelone-mpin',
  ANGELONE_TOTP_SECRET: 'angelone-totp-secret',
};

describe('harness_config.yaml is loadable by the real entrypoint', () => {
  it('loads and binds every capability to a defined server', () => {
    const config = loadConfig('harness_config.yaml', env);
    expect(config.capabilities.search).toBe('anysearch');
    expect(config.mcp_servers.anysearch).toBeDefined();
    expect(config.mcp_servers.market).toBeDefined();
  });

  // The MCP stdio client only inherits a fixed allowlist, so credentials reach the market-data
  // server solely through this env block. Without it the server starts credential-less and
  // silently serves stale fallback data instead of failing -- assert the values actually land.
  it('hands the market-data server its broker credentials', () => {
    const market = loadConfig('harness_config.yaml', env).mcp_servers.market;
    expect(market).toBeDefined();
    expect('env' in market! ? market.env : undefined).toMatchObject({
      ANGELONE_API_KEY: 'angelone-api-key',
      ANGELONE_CLIENT_CODE: 'angelone-client-code',
      ANGELONE_MPIN: 'angelone-mpin',
      ANGELONE_TOTP_SECRET: 'angelone-totp-secret',
    });
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

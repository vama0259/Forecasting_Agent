import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config-loader.js';
import { ConfigValidationError } from '../src/errors.js';

let dir: string;

function writeConfig(body: string): string {
  const path = join(dir, 'harness_config.yaml');
  writeFileSync(path, body, 'utf8');
  return path;
}

const VALID = `
llm:
  provider: anthropic
  model: claude-sonnet-4
  api_key: \${LLM_API_KEY}
mcp_servers:
  market:
    command: node
    args: ["server.js"]
  web:
    command: node
    args: []
capabilities:
  chat: llm
  search: web
  sentiment: llm
  market_data: market
storage:
  connection_string: postgres://localhost:5432/harness_test
tracing:
  langfuse_public_key: pk-test
  langfuse_secret_key: sk-test
  langfuse_base_url: http://localhost:3000
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'harness-cfg-'));
  vi.stubEnv('LLM_API_KEY', 'sk-live-123');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadConfig', () => {
  it('accepts a valid config and interpolates ${VAR} from the environment', () => {
    const config = loadConfig(writeConfig(VALID));
    expect(config.llm.api_key).toBe('sk-live-123');
    expect(config.capabilities.market_data).toBe('market');
    expect(config.mcp_servers['market']?.command).toBe('node');
  });

  it('defaults the placeholder sandbox and eval sections to empty records', () => {
    const config = loadConfig(writeConfig(VALID));
    expect(config.sandbox).toEqual({});
    expect(config.eval).toEqual({});
  });

  it('rejects a wrong-typed field with a ConfigValidationError naming the Zod path', () => {
    const bad = VALID.replace('model: claude-sonnet-4', 'model: 42');
    expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
    expect(() => loadConfig(writeConfig(bad))).toThrow(/llm\.model/);
  });

  it('rejects a missing capability binding', () => {
    const bad = VALID.replace('  sentiment: llm\n', '');
    expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
    expect(() => loadConfig(writeConfig(bad))).toThrow(/capabilities\.sentiment/);
  });

  it('throws when a referenced environment variable is unset', () => {
    vi.stubEnv('LLM_API_KEY', undefined);
    expect(() => loadConfig(writeConfig(VALID))).toThrow(ConfigValidationError);
    expect(() => loadConfig(writeConfig(VALID))).toThrow(/LLM_API_KEY/);
  });

  it('rejects a capability pointing at a provider that does not exist', () => {
    const bad = VALID.replace('market_data: market', 'market_data: ghost');
    expect(() => loadConfig(writeConfig(bad))).toThrow(ConfigValidationError);
    expect(() => loadConfig(writeConfig(bad))).toThrow(/market_data.*ghost/);
  });

  it('accepts "llm" as a capability target without an mcp_servers entry', () => {
    expect(() => loadConfig(writeConfig(VALID))).not.toThrow();
  });

  it('treats a secret containing a newline as inert text, not config structure', () => {
    vi.stubEnv('LLM_API_KEY', 'sk-live\nmcp_servers:\n  evil:\n    command: /bin/sh');
    const config = loadConfig(writeConfig(VALID));
    expect(config.llm.api_key).toBe('sk-live\nmcp_servers:\n  evil:\n    command: /bin/sh');
    expect(Object.keys(config.mcp_servers).sort()).toEqual(['market', 'web']);
  });

  it('treats a secret containing ": " as inert text, not a mapping key', () => {
    vi.stubEnv('LLM_API_KEY', 'injected: value');
    const config = loadConfig(writeConfig(VALID));
    expect(config.llm.api_key).toBe('injected: value');
    expect(config.llm.provider).toBe('anthropic');
  });

  it('redacts a secret value that would otherwise be echoed in an error message', () => {
    vi.stubEnv('LLM_API_KEY', 'sk-live-supersecret');
    const bad = VALID.replace('market_data: market', 'market_data: ${LLM_API_KEY}');
    let message = '';
    try {
      loadConfig(writeConfig(bad));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('sk-live-supersecret');
    expect(message).toContain('[REDACTED]');
  });

  it('never leaks a secret value on the schema-failure path', () => {
    vi.stubEnv('LLM_API_KEY', 'sk-live-supersecret');
    const bad = VALID.replace('provider: anthropic', 'provider: 42');
    let message = '';
    try {
      loadConfig(writeConfig(bad));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('llm.provider');
    expect(message).not.toContain('sk-live-supersecret');
  });

  it('interpolates only inside string values, leaving non-string leaves untouched', () => {
    vi.stubEnv('ARG_ONE', 'server.js');
    const withArg = VALID.replace('args: ["server.js"]', 'args: ["${ARG_ONE}"]');
    const config = loadConfig(writeConfig(withArg));
    expect(config.mcp_servers['market']?.args).toEqual(['server.js']);
  });
});

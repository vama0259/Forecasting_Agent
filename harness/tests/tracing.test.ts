import { describe, it, expect } from 'vitest';
import { generateTraceId } from '../src/tracing/correlation.js';
import { getLangfuseClient, startForecastTrace } from '../src/tracing/langfuse.js';
import type { HarnessConfig } from '../src/config.js';

describe('correlation', () => {
  it('generateTraceId produces monotonically increasing UUIDv7 ids', () => {
    const ids = Array.from({ length: 5 }, () => generateTraceId());
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('langfuse tracing', () => {
  const config: HarnessConfig = {
    llm: { provider: 'deepseek', model: 'deepseek-v4-flash', api_key: 'test' },
    mcp_servers: {},
    capabilities: { chat: 'deepseek', search: 'x', sentiment: 'x', market_data: 'x' },
    sandbox: {},
    eval: {},
    storage: { connection_string: 'postgres://localhost/harness_test' },
    tracing: {
      langfuse_public_key: 'pk-test',
      langfuse_secret_key: 'sk-test',
      langfuse_base_url: 'http://localhost:1',
    },
  };

  it('client initializes from HarnessConfig-supplied keys', () => {
    const client = getLangfuseClient(config);
    expect(client).toBeDefined();
  });

  it('supports a 4-level forecast_run -> debate_round -> agent_turn -> tool_call span chain', () => {
    const client = getLangfuseClient(config);
    const trace = startForecastTrace(client, generateTraceId());
    const round = trace.span({ name: 'debate_round' });
    const agentTurn = round.span({ name: 'agent_turn' });
    const toolCall = agentTurn.span({ name: 'tool_call' });
    expect(typeof toolCall.end).toBe('function');
  });
});

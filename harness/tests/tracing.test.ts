import { describe, it, expect } from 'vitest';
import { generateTraceId } from '../src/tracing/correlation.js';
import { startForecastTrace, flushTraces } from '../src/tracing/langfuse.js';
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

  it('startForecastTrace returns a handle with a real OTel-generated trace ID', () => {
    const trace = startForecastTrace(config, generateTraceId(), { test: true });
    expect(typeof trace.traceId).toBe('string');
    expect(trace.traceId.length).toBeGreaterThan(0);
    trace.end();
  });

  it('supports a 4-level forecast_run -> debate_round -> agent_turn -> tool_call span chain', () => {
    const trace = startForecastTrace(config, generateTraceId(), { test: true });
    const round = trace.span({ name: 'debate_round' });
    const agentTurn = round.span({ name: 'agent_turn' });
    const toolCall = agentTurn.span({ name: 'tool_call' });
    expect(typeof toolCall.end).toBe('function');
    toolCall.end();
    agentTurn.end();
    round.end();
    trace.end();
  });

  it('flushTraces resolves without throwing', async () => {
    await expect(flushTraces(config)).resolves.toBeUndefined();
  });

  it('runGrouped propagates traceName/tags/sessionId onto the root span', async () => {
    const trace = startForecastTrace(config, generateTraceId(), { test: true });
    await trace.runGrouped(
      { traceName: 'forecast_run:TEST.NS', tags: ['TEST.NS'], sessionId: 'session-1', metadata: { symbol: 'TEST.NS' } },
      async () => {
        const child = trace.span({ name: 'debate_round' });
        child.end();
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rootAttributes = (trace as any).current.otelSpan.attributes as Record<string, unknown>;
    trace.end();

    expect(rootAttributes['langfuse.trace.name']).toBe('forecast_run:TEST.NS');
    expect(rootAttributes['langfuse.trace.tags']).toEqual(['TEST.NS']);
    expect(rootAttributes['session.id']).toBe('session-1');
  });
});

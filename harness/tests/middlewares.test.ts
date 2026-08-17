import { describe, it, expect, vi } from 'vitest';
import { buildCostBudgetMiddleware } from '../src/middleware/cost-budget.js';
import { buildEvidenceValidationMiddleware } from '../src/middleware/evidence-validation.js';
import { buildAuditMiddleware } from '../src/middleware/audit.js';
import type { TraceHandle } from '../src/tracing/langfuse.js';

describe('CostBudgetMiddleware', () => {
  it('throws error when token budget is exceeded', async () => {
    const mw = buildCostBudgetMiddleware(100);
    const mockHandler = vi.fn().mockResolvedValue({
      usage_metadata: { total_tokens: 150, input_tokens: 100, output_tokens: 50 },
    });

    const dummyRequest = {} as Parameters<NonNullable<typeof mw.wrapModelCall>>[0];
    await mw.wrapModelCall!(dummyRequest, mockHandler);
    await expect(mw.wrapModelCall!(dummyRequest, mockHandler)).rejects.toThrow(/Token budget exceeded/);
  });
});

describe('EvidenceValidationMiddleware', () => {
  it('marks signal degraded when unapproved source_capability is cited', async () => {
    const mw = buildEvidenceValidationMiddleware('price', ['market_data']);
    const state = {
      structuredResponse: {
        agent_name: 'price',
        evidence: [{ claim: 'oil shock', source_capability: 'macro_unapproved', value: 1, explicit_absence: false }],
        degraded: false,
      },
    };
    await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
    expect(state.structuredResponse.degraded).toBe(true);
  });

  it('keeps degraded false when all capabilities are valid', async () => {
    const mw = buildEvidenceValidationMiddleware('price', ['market_data', 'macro']);
    const state = {
      structuredResponse: {
        agent_name: 'price',
        evidence: [{ claim: 'RSI oversold', source_capability: 'market_data', value: 28, explicit_absence: false }],
        degraded: false,
      },
    };
    await (mw.afterModel as (s: unknown) => Promise<unknown>)(state);
    expect(state.structuredResponse.degraded).toBe(false);
  });
});

describe('AuditMiddleware', () => {
  it('updates trace metadata on model call completion', async () => {
    const mockTrace = { update: vi.fn() } as unknown as TraceHandle;
    const mw = buildAuditMiddleware('price', mockTrace);
    const mockHandler = vi.fn().mockResolvedValue({ response: 'ok' });

    const dummyRequest = {} as Parameters<NonNullable<typeof mw.wrapModelCall>>[0];
    await mw.wrapModelCall!(dummyRequest, mockHandler);
    expect(mockTrace.update).toHaveBeenCalled();
    const updateArg = (
      mockTrace.update as unknown as { mock: { calls: Array<[{ metadata?: Record<string, unknown> }]> } }
    ).mock.calls[0]![0];
    expect(updateArg.metadata).toHaveProperty('price_last_model_duration_ms');
  });

  it('updates trace metadata on tool call completion using toolCall.name', async () => {
    const mockTrace = { update: vi.fn() } as unknown as TraceHandle;
    const mw = buildAuditMiddleware('price', mockTrace);
    const mockHandler = vi.fn().mockResolvedValue({ response: 'ok' });

    const dummyToolRequest = {
      toolCall: { name: 'fetch_ohlcv', args: {}, id: '1' },
    } as Parameters<NonNullable<typeof mw.wrapToolCall>>[0];
    await mw.wrapToolCall!(dummyToolRequest, mockHandler);
    expect(mockTrace.update).toHaveBeenCalled();
    const updateArg = (
      mockTrace.update as unknown as { mock: { calls: Array<[{ metadata?: Record<string, unknown> }]> } }
    ).mock.calls[0]![0];
    expect(updateArg.metadata).toHaveProperty('price_tool_fetch_ohlcv_duration_ms');
  });
});

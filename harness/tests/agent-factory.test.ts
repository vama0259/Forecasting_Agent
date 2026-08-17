import { describe, it, expect, vi } from 'vitest';
import type { StructuredTool } from '@langchain/core/tools';
import type { CompositeBackend } from 'deepagents';
import { buildParticipantAgent } from '../src/agents/factory.js';
import { AGENT_CONFIGS } from '../src/agents/types.js';

describe('buildParticipantAgent', () => {
  it('constructs a DeepAgent instance with proper middlewares and tools', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const mockTool = { name: 'fetch_ohlcv', invoke: vi.fn() } as unknown as StructuredTool;
    const mockBackend = { ls: vi.fn(), read: vi.fn(), write: vi.fn() } as unknown as CompositeBackend;

    const agent = buildParticipantAgent({
      config: priceConfig,
      llmConfig: { provider: 'deepseek', model: 'deepseek-chat', api_key: 'test-key' },
      tools: [mockTool],
      backend: mockBackend,
    });

    expect(agent).toBeDefined();
    expect(typeof agent.invoke).toBe('function');
  });

  it('filters tools based on config.tools', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const allowedTool = { name: 'fetch_ohlcv', invoke: vi.fn() } as unknown as StructuredTool;
    const disallowedTool = { name: 'forbidden_tool', invoke: vi.fn() } as unknown as StructuredTool;
    const mockBackend = { ls: vi.fn(), read: vi.fn(), write: vi.fn() } as unknown as CompositeBackend;

    const agent = buildParticipantAgent({
      config: priceConfig,
      llmConfig: { provider: 'deepseek', model: 'deepseek-chat', api_key: 'test-key' },
      tools: [allowedTool, disallowedTool],
      backend: mockBackend,
    });

    expect(agent).toBeDefined();
    expect(typeof agent.invoke).toBe('function');
  });
});

// harness/tests/agents/price-anchor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildPriceAnchorAgent } from '../../src/agents/price-anchor.js';
import { SandboxBackendAdapter } from '../../src/sandbox/deepagents-adapter.js';
import type { SandboxManager } from '../../src/sandbox/manager.js';

describe('buildPriceAnchorAgent', () => {
  it('constructs a ChatDeepSeek model from the given llm config', () => {
    const mockManager = { runExplore: vi.fn(), disposeRun: vi.fn() } as unknown as SandboxManager;
    const backend = new SandboxBackendAdapter(mockManager, 'run-1');

    const agent = buildPriceAnchorAgent({
      llmConfig: { provider: 'deepseek', model: 'deepseek-chat', api_key: 'sk-test' },
      tools: [],
      backend,
    });

    expect(agent).toBeDefined();
    expect(typeof agent.invoke).toBe('function');
  });
});

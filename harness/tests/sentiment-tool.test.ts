import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { StructuredTool } from '@langchain/core/tools';
import { AGENT_CONFIGS } from '../src/agents/types.js';
import { CapabilitySchema } from '../src/agents/schema.js';
import { buildParticipantAgent, wrapSentimentTool } from '../src/agents/factory.js';
import type { CompositeBackend } from 'deepagents';

const { mockCreateDeepAgent } = vi.hoisted(() => ({
  mockCreateDeepAgent: vi.fn(),
}));

vi.mock('deepagents', async () => {
  const actual = await vi.importActual<typeof import('deepagents')>('deepagents');
  return {
    ...actual,
    createDeepAgent: (opts: unknown) => {
      mockCreateDeepAgent(opts);
      return {
        invoke: vi.fn(),
      };
    },
  };
});

describe('Sentiment Tool & Roster Integration', () => {
  describe('AGENT_CONFIGS Tool Rosters', () => {
    it('grants score_sentiment tool to retail, fii, and dii agents', () => {
      const fii = AGENT_CONFIGS.find((c) => c.name === 'fii');
      const dii = AGENT_CONFIGS.find((c) => c.name === 'dii');
      const retail = AGENT_CONFIGS.find((c) => c.name === 'retail');

      expect(fii).toBeDefined();
      expect(fii!.tools).toContain('score_sentiment');

      expect(dii).toBeDefined();
      expect(dii!.tools).toContain('score_sentiment');

      expect(retail).toBeDefined();
      expect(retail!.tools).toContain('score_sentiment');
    });

    it('does not grant score_sentiment tool to price anchor agent', () => {
      const price = AGENT_CONFIGS.find((c) => c.name === 'price');
      expect(price).toBeDefined();
      expect(price!.tools).not.toContain('score_sentiment');
    });
  });

  describe('CapabilitySchema', () => {
    it('supports sentiment capability in schema enum', () => {
      const parsed = CapabilitySchema.parse('sentiment');
      expect(parsed).toBe('sentiment');
      expect(CapabilitySchema.options).toContain('sentiment');
    });
  });

  describe('wrapSentimentTool Defensive Fallback Handling', () => {
    it('returns regular response on successful scoring', async () => {
      const mockSuccessResult = {
        score: 0.75,
        label: 'positive',
        confidence: 0.85,
        headline_count: 2,
        headlines: [
          { text: 'Profit jumps 20%', score: 0.8, label: 'positive', weight: 1.0 },
          { text: 'Revenue beats estimates', score: 0.7, label: 'positive', weight: 0.9 },
        ],
        device: 'cuda:0',
        degraded: false,
      };

      const baseTool = {
        name: 'score_sentiment',
        description: 'FinBERT sentiment scoring tool',
        schema: z.object({ headlines: z.array(z.record(z.string(), z.unknown())) }),
        invoke: vi.fn().mockResolvedValue(mockSuccessResult),
      } as unknown as StructuredTool;

      const wrapped = wrapSentimentTool(baseTool);
      const res = await wrapped.invoke({ headlines: [{ text: 'Profit jumps 20%' }] });

      expect(res).toEqual(mockSuccessResult);
      expect(baseTool.invoke).toHaveBeenCalledTimes(1);
    });

    it('catches tool Error and returns degraded neutral response without throwing', async () => {
      const baseTool = {
        name: 'score_sentiment',
        description: 'FinBERT sentiment scoring tool',
        schema: z.object({ headlines: z.array(z.record(z.string(), z.unknown())) }),
        invoke: vi.fn().mockRejectedValue(new Error('FastMCP subprocess connection lost')),
      } as unknown as StructuredTool;

      const wrapped = wrapSentimentTool(baseTool);
      const res = await wrapped.invoke({ headlines: [{ text: 'Market crash imminent' }] });

      expect(res).toEqual({
        score: 0.0,
        label: 'neutral',
        confidence: 0.0,
        degraded: true,
        reason: 'FastMCP subprocess connection lost',
      });
    });

    it('catches non-Error throwables and returns degraded neutral response', async () => {
      const baseTool = {
        name: 'score_sentiment',
        description: 'FinBERT sentiment scoring tool',
        schema: z.object({ headlines: z.array(z.record(z.string(), z.unknown())) }),
        invoke: vi.fn().mockRejectedValue('Fatal stdio pipe broken'),
      } as unknown as StructuredTool;

      const wrapped = wrapSentimentTool(baseTool);
      const res = await wrapped.invoke({ headlines: [{ text: 'Headline' }] });

      expect(res).toEqual({
        score: 0.0,
        label: 'neutral',
        confidence: 0.0,
        degraded: true,
        reason: 'Fatal stdio pipe broken',
      });
    });
  });

  describe('buildParticipantAgent Tool Wrapping Integration', () => {
    it('automatically wraps score_sentiment tool defensively when building agent', async () => {
      const failingSentimentTool = {
        name: 'score_sentiment',
        description: 'FinBERT sentiment scoring tool',
        schema: z.object({ headlines: z.array(z.record(z.string(), z.unknown())) }),
        invoke: vi.fn().mockRejectedValue(new Error('CUDA Out of Memory')),
      } as unknown as StructuredTool;

      const otherTool = {
        name: 'fetch_flows',
        description: 'Flows tool',
        schema: z.object({}),
        invoke: vi.fn().mockResolvedValue({ status: 'ok' }),
      } as unknown as StructuredTool;

      const fiiConfig = AGENT_CONFIGS.find((c) => c.name === 'fii')!;
      const mockBackend = {} as CompositeBackend;

      mockCreateDeepAgent.mockClear();
      buildParticipantAgent({
        config: fiiConfig,
        llmConfig: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          api_key: 'test',
        },
        tools: [failingSentimentTool, otherTool],
        backend: mockBackend,
      });

      expect(mockCreateDeepAgent).toHaveBeenCalledTimes(1);
      const firstCall = mockCreateDeepAgent.mock.calls[0];
      expect(firstCall).toBeDefined();
      const passedOpts = firstCall![0] as { tools: StructuredTool[] };
      expect(passedOpts.tools).toHaveLength(2);

      const attachedSentimentTool = passedOpts.tools.find((t) => t.name === 'score_sentiment');
      expect(attachedSentimentTool).toBeDefined();

      // Invoking attached sentiment tool does not crash even though underlying tool threw
      const fallbackResult = await attachedSentimentTool!.invoke({ headlines: [] });
      expect(fallbackResult).toEqual({
        score: 0.0,
        label: 'neutral',
        confidence: 0.0,
        degraded: true,
        reason: 'CUDA Out of Memory',
      });
    });
  });
});

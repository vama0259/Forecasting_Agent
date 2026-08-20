import { describe, it, expect, vi } from 'vitest';
import { buildModel, GEMINI_BASE_URL, DEEPSEEK_BASE_URL, GROK_BASE_URL } from '../src/llm/index.js';
import { buildParticipantAgent } from '../src/agents/factory.js';
import { AGENT_CONFIGS } from '../src/agents/types.js';
import type { StructuredTool } from '@langchain/core/tools';
import type { CompositeBackend } from 'deepagents';

describe('LLM Model Factory', () => {
  it('builds Gemini model with default Google OpenAI endpoint and empty middleware', () => {
    const { model, middlewares } = buildModel({
      provider: 'gemini',
      model: 'gemini-3.7-flash',
      api_key: 'test-gemini-key',
    });

    expect(model).toBeDefined();
    expect(middlewares).toEqual([]);
    expect((model as unknown as { apiKey: string }).apiKey).toBe('test-gemini-key');
    expect((model as unknown as { model: string }).model).toBe('gemini-3.7-flash');
    expect((model as unknown as { clientConfig: { baseURL: string } }).clientConfig.baseURL).toBe(GEMINI_BASE_URL);
  });

  it('supports google alias for Gemini provider', () => {
    const { model, middlewares } = buildModel({
      provider: 'google',
      model: 'gemini-2.5-flash',
      api_key: 'test-google-key',
    });

    expect(model).toBeDefined();
    expect(middlewares).toEqual([]);
    expect((model as unknown as { model: string }).model).toBe('gemini-2.5-flash');
  });

  it('builds DeepSeek model with auto tool choice middleware', () => {
    const { model, middlewares } = buildModel({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      api_key: 'test-deepseek-key',
    });

    expect(model).toBeDefined();
    expect(middlewares.length).toBe(1);
    expect(middlewares[0]?.name).toBe('DeepSeekThinkingAutoToolChoice');
    expect((model as unknown as { clientConfig: { baseURL: string } }).clientConfig.baseURL).toBe(DEEPSEEK_BASE_URL);
  });

  it('builds Grok / xAI model with xAI endpoint', () => {
    const { model, middlewares } = buildModel({
      provider: 'grok',
      model: 'grok-4.6',
      api_key: 'test-xai-key',
    });

    expect(model).toBeDefined();
    expect(middlewares).toEqual([]);
    expect((model as unknown as { clientConfig: { baseURL: string } }).clientConfig.baseURL).toBe(GROK_BASE_URL);
  });

  it('builds OpenAI model and respects custom base_url', () => {
    const { model, middlewares } = buildModel({
      provider: 'openai',
      model: 'gpt-4o',
      api_key: 'test-openai-key',
      base_url: 'https://custom-proxy.internal/v1',
    });

    expect(model).toBeDefined();
    expect(middlewares).toEqual([]);
    expect((model as unknown as { clientConfig: { baseURL: string } }).clientConfig.baseURL).toBe(
      'https://custom-proxy.internal/v1',
    );
  });

  it('throws descriptive error on unsupported provider without base_url', () => {
    expect(() =>
      buildModel({
        provider: 'unsupported_vendor',
        model: 'some-model',
        api_key: 'test-key',
      }),
    ).toThrow(/Unsupported LLM provider/);
  });

  it('buildParticipantAgent creates a valid DeepAgent with Gemini configuration', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const mockTool = { name: 'fetch_ohlcv', invoke: vi.fn() } as unknown as StructuredTool;
    const mockBackend = { ls: vi.fn(), read: vi.fn(), write: vi.fn() } as unknown as CompositeBackend;

    const agent = buildParticipantAgent({
      config: priceConfig,
      llmConfig: {
        provider: 'gemini',
        model: 'gemini-3.7-flash',
        api_key: 'test-gemini-key',
      },
      tools: [mockTool],
      backend: mockBackend,
    });

    expect(agent).toBeDefined();
    expect(typeof agent.invoke).toBe('function');
  });
});

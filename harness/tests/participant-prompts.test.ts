import { describe, it, expect } from 'vitest';
import { renderPrompt } from '../src/prompts/engine.js';
import type { ParticipantAgentConfig } from '../src/agents/types.js';

describe('Participant Prompt Templates', () => {
  const baseConfig: Omit<
    ParticipantAgentConfig,
    | 'name'
    | 'promptTemplate'
    | 'roleTitle'
    | 'description'
    | 'allowedCapabilities'
    | 'dataLaneDescription'
    | 'workspaceSubpath'
    | 'allowedWritePaths'
    | 'tools'
  > = {
    skills: [],
    maxTokenBudget: 400_000,
    horizon_days: 1,
    generatedBy: 'human',
  };

  it('renders fii.j2 with fetch_flows tool and long/short ratio guidance', () => {
    const config: ParticipantAgentConfig = {
      ...baseConfig,
      name: 'fii',
      roleTitle: 'FII Intent',
      description: 'FII intent',
      promptTemplate: 'fii.j2',
      allowedCapabilities: ['market_data', 'flows', 'macro'],
      dataLaneDescription: 'flows',
      workspaceSubpath: 'fii',
      allowedWritePaths: ['/workspace/code/features/fii/**'],
      tools: ['fetch_flows', 'fetch_ohlcv'],
    };
    const rendered = renderPrompt(config, { symbol: 'TCS.NS', as_of: '2026-08-17' });
    expect(rendered).toContain('Foreign Institutional Investor (FII)');
    expect(rendered).toContain('fetch_flows(observed_on="2026-08-17"');
    expect(rendered).toContain('/workspace/code/features/fii/');
    expect(rendered).toContain('fii_long / max(1, fii_short)');
    expect(rendered).toContain('explicit_absence: true');
  });

  it('renders dii.j2 with absorption ratio and domestic floor guidance', () => {
    const config: ParticipantAgentConfig = {
      ...baseConfig,
      name: 'dii',
      roleTitle: 'DII Intent',
      description: 'DII intent',
      promptTemplate: 'dii.j2',
      allowedCapabilities: ['market_data', 'flows', 'macro'],
      dataLaneDescription: 'flows',
      workspaceSubpath: 'dii',
      allowedWritePaths: ['/workspace/code/features/dii/**'],
      tools: ['fetch_flows', 'fetch_ohlcv'],
    };
    const rendered = renderPrompt(config, { symbol: 'TCS.NS', as_of: '2026-08-17' });
    expect(rendered).toContain('Domestic Institutional Investor (DII)');
    expect(rendered).toContain('dii_long / max(1, dii_short)');
    expect(rendered).toContain('absorption capacity');
  });

  it('renders retail.j2 with delivery pct and PCR guidance', () => {
    const config: ParticipantAgentConfig = {
      ...baseConfig,
      name: 'retail',
      roleTitle: 'Retail Intent',
      description: 'Retail intent',
      promptTemplate: 'retail.j2',
      allowedCapabilities: ['market_data', 'microstructure', 'sentiment'],
      dataLaneDescription: 'microstructure',
      workspaceSubpath: 'retail',
      allowedWritePaths: ['/workspace/code/features/retail/**'],
      tools: ['fetch_microstructure', 'fetch_option_chain', 'fetch_ohlcv'],
    };
    const rendered = renderPrompt(config, { symbol: 'TCS.NS', as_of: '2026-08-17' });
    expect(rendered).toContain('Retail & Microstructure intent');
    expect(rendered).toContain('fetch_microstructure(observed_on="2026-08-17"');
    expect(rendered).toContain('fetch_option_chain(underlying="TCS.NS"');
    expect(rendered).toContain('deliverable_quantity / max(1, quantity_traded)');
    expect(rendered).toContain('Put-Call Ratio (PCR)');
  });
});

import { describe, it, expect } from 'vitest';
import { renderPrompt } from '../src/prompts/engine.js';
import { AGENT_CONFIGS } from '../src/agents/types.js';

describe('Prompt Engine', () => {
  it('renders price.j2 with all required contract elements', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const rendered = renderPrompt(priceConfig, {
      symbol: 'TCS.NS',
      as_of: '2026-08-17',
      horizon_days: 1,
      start_date: '2026-04-19',
    });

    expect(rendered).toContain('TCS.NS');
    expect(rendered).toContain('2026-08-17');
    expect(rendered).toContain('fetch_ohlcv');
    expect(rendered).toContain('/workspace/bars.json');
    expect(rendered).toContain('/workspace/model.py');
    expect(rendered).toContain('/tmp/eval_request.json');
    expect(rendered).toContain('EQUITY_DELIVERY');
  });

  it('computes default start_date (120 days prior) when start_date is not provided', () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const rendered = renderPrompt(priceConfig, {
      symbol: 'INFY.NS',
      as_of: '2026-08-17',
      horizon_days: 1,
    });

    // 120 days before 2026-08-17 is 2026-04-19
    expect(rendered).toContain('INFY.NS');
    expect(rendered).toContain('start="2026-04-19"');
  });
});

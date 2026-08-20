// Unit tests for SkillInjector XML rendering, budget enforcement, sorting determinism, and template integration.

import { describe, it, expect } from 'vitest';
import { renderSkillsBlock, SkillInjector } from '../../src/skills/injector.js';
import type { SkillPackage } from '../../src/skills/types.js';
import { renderPrompt } from '../../src/prompts/engine.js';
import { AGENT_CONFIGS } from '../../src/agents/types.js';

// Helper to construct a mock SkillPackage fixture.
function makeSkill(
  name: string,
  instructions = 'Standard skill instructions for analysis.',
  options: Partial<SkillPackage> = {},
): SkillPackage {
  return {
    manifest: {
      name,
      description: `Description for ${name} skill`,
      version: '1.0.0',
      available_from: '2026-01-01',
      target_agents: ['price'],
      tags: ['test'],
      status: 'draft',
      ...(options.manifest ?? {}),
    },
    instructions,
    examples: options.examples ?? [],
    moduleName: name.replaceAll('-', '_'),
    lintWarnings: options.lintWarnings ?? [],
    contentHash: 'mock-hash-12345',
    scriptPath: options.scriptPath,
  };
}

describe('SkillInjector XML formatting and structure', () => {
  it('returns empty block and empty dropped list when no skills provided', () => {
    const res = renderSkillsBlock([]);
    expect(res.block).toBe('');
    expect(res.dropped).toEqual([]);
  });

  it('renders valid XML tags for single skill', () => {
    const skill = makeSkill('wyckoff-volume-spread', 'Effort versus Result analysis methodology.');
    const res = renderSkillsBlock([skill]);

    expect(res.block).toContain('<skills>');
    expect(res.block).toContain('</skills>');
    expect(res.block).toContain('<skill name="wyckoff-volume-spread" version="1.0.0">');
    expect(res.block).toContain('<description>Description for wyckoff-volume-spread skill</description>');
    expect(res.block).toContain('<instructions>');
    expect(res.block).toContain('Effort versus Result analysis methodology.');
    expect(res.block).toContain('</instructions>');
    expect(res.block).toContain('</skill>');
    expect(res.dropped).toEqual([]);
  });

  it('includes examples and python_module when present', () => {
    const skill = makeSkill('fii-positioning', 'FII analysis', {
      examples: ['Example observation 1', 'Example observation 2'],
      scriptPath: '/workspace/skills/fii_positioning.py',
    });
    const res = renderSkillsBlock([skill]);

    expect(res.block).toContain('<examples>');
    expect(res.block).toContain('<example>Example observation 1</example>');
    expect(res.block).toContain('<example>Example observation 2</example>');
    expect(res.block).toContain('</examples>');
    expect(res.block).toContain('<python_module>skills.fii_positioning</python_module>');
  });
});

describe('SkillInjector cache stability & determinism (ADR-028)', () => {
  it('is byte-identical regardless of input order', () => {
    const skillA = makeSkill('alpha-skill', 'Alpha instructions');
    const skillB = makeSkill('beta-skill', 'Beta instructions');
    const skillC = makeSkill('gamma-skill', 'Gamma instructions');

    const a = renderSkillsBlock([skillC, skillA, skillB]).block;
    const b = renderSkillsBlock([skillA, skillB, skillC]).block;
    const c = renderSkillsBlock([skillB, skillC, skillA]).block;

    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('SkillInjector token bounding & budget overflow', () => {
  it('drops whole skills on overflow and never truncates', () => {
    const big = makeSkill('big', 'x'.repeat(5_000));
    const also = makeSkill('also', 'y'.repeat(5_000));
    const { block, dropped } = renderSkillsBlock([big, also]);

    expect(block.length).toBeLessThanOrEqual(6_000);
    expect(dropped).toEqual(['big']); // sorted: 'also' fits first, 'big' is dropped
    expect(block).not.toContain('x'.repeat(4_999)); // no partial body
    expect(block).toContain('y'.repeat(5_000));
  });

  it('respects custom maxTokens parameter', () => {
    const skill1 = makeSkill('a-skill', 'x'.repeat(300));
    const skill2 = makeSkill('b-skill', 'y'.repeat(300));

    // 100 tokens = 400 chars proxy
    const { block, dropped } = renderSkillsBlock([skill1, skill2], 100);

    expect(block.length).toBeLessThanOrEqual(400);
    expect(dropped).toContain('b-skill');
  });
});

describe('SkillInjector class & context injection helper', () => {
  it('SkillInjector static and instance methods mirror renderSkillsBlock', () => {
    const skill = makeSkill('test-skill', 'Test instructions');
    const directRes = renderSkillsBlock([skill]);
    const staticRes = SkillInjector.renderSkillsBlock([skill]);
    const instanceRes = new SkillInjector().renderSkillsBlock([skill]);

    expect(staticRes).toEqual(directRes);
    expect(instanceRes).toEqual(directRes);
  });

  it('injectIntoContext injects skills_block into context object', () => {
    const skill = makeSkill('test-skill', 'Test instructions');
    const baseContext = { symbol: 'TCS.NS', as_of: '2026-08-20' };

    const updated = SkillInjector.injectIntoContext(baseContext, [skill]);
    expect(updated.symbol).toBe('TCS.NS');
    expect(updated.as_of).toBe('2026-08-20');
    expect(typeof updated.skills_block).toBe('string');
    expect(updated.skills_block).toContain('<skills>');
    expect(updated.skills_block).toContain('test-skill');
  });
});

describe('Prompt template integration with skills', () => {
  const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
  const ctx = {
    symbol: 'TCS.NS',
    as_of: '2026-08-20',
    horizon_days: 1,
    start_date: '2024-08-01',
  };

  it('renders the skill body into the price prompt', () => {
    const wyckoff = makeSkill('wyckoff-volume-spread', 'Effort versus Result analysis methodology.');
    const withSkill = renderPrompt(priceConfig, ctx, [wyckoff]);
    const without = renderPrompt(priceConfig, ctx, []);

    expect(withSkill).not.toBe(without);
    expect(withSkill).toContain('Effort versus Result analysis methodology.');
    expect(withSkill).toContain('<skills>');
    expect(without).not.toContain('<skills>');
  });

  it('warns the agent that model.py must inline skills code', () => {
    const wyckoff = makeSkill('wyckoff-volume-spread', 'Effort versus Result analysis methodology.');
    const prompt = renderPrompt(priceConfig, ctx, [wyckoff]);
    expect(prompt).toMatch(/must not import .*skills/i);
  });

  it('places skills_block at the top before market data instruction', () => {
    const wyckoff = makeSkill('wyckoff-volume-spread', 'Effort versus Result analysis methodology.');
    const prompt = renderPrompt(priceConfig, ctx, [wyckoff]);
    const skillsPos = prompt.indexOf('<skills>');
    const fetchPos = prompt.indexOf('fetch_ohlcv');

    expect(skillsPos).toBeGreaterThanOrEqual(0);
    expect(fetchPos).toBeGreaterThan(skillsPos);
  });
});

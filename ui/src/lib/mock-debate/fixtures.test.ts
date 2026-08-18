// Unit test verifying protocol structure and completeness of fullDebateFixture
import { describe, it, expect } from 'vitest';
import { fullDebateFixture } from './fixtures';

describe('fullDebateFixture', () => {
  it('has exactly one round-start per round, in order 1-4', () => {
    const starts = fullDebateFixture.filter(e => e.type === 'round-start');
    expect(starts.map(s => (s as any).roundIndex)).toEqual([1, 2, 3, 4]);
  });

  it('round 3 (devils-advocate) has a devils-advocate-assigned event', () => {
    expect(fullDebateFixture.some(e => e.type === 'devils-advocate-assigned')).toBe(true);
  });

  it('ends with consensus then forecast', () => {
    const last2 = fullDebateFixture.slice(-2).map(e => e.type);
    expect(last2).toEqual(['consensus', 'forecast']);
  });

  it('every agent (technical, sentiment, macro) gets at least one turn', () => {
    const agents = new Set(
      fullDebateFixture.filter(e => 'agent' in e).map(e => (e as any).agent)
    );
    expect(agents).toEqual(new Set(['technical', 'sentiment', 'macro']));
  });
});

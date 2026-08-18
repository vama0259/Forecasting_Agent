// Unit test verifying exhaustive narrowing of DebateEvent type union
import { describe, it, expect } from 'vitest';
import type { DebateEvent } from './types';

// Helper function mapping DebateEvent to string to test discrimination
function describeEvent(e: DebateEvent): string {
  switch (e.type) {
    case 'round-start': return `round-start:${e.round}:${e.roundIndex}`;
    case 'agent-turn-start': return `agent-turn-start:${e.agent}`;
    case 'reasoning-token': return `reasoning-token:${e.token}`;
    case 'tool-call': return `tool-call:${e.tool}`;
    case 'tool-result': return `tool-result:${e.status}`;
    case 'evidence': return `evidence:${e.source}`;
    case 'devils-advocate-assigned': return `devils-advocate-assigned:${e.agent}`;
    case 'consensus': return `consensus:${e.scenarios.length}`;
    case 'forecast': return `forecast:${e.horizon}`;
  }
}

describe('DebateEvent', () => {
  it('exhaustively narrows every variant', () => {
    expect(describeEvent({ type: 'round-start', round: 'debate', roundIndex: 2 }))
      .toBe('round-start:debate:2');
    expect(describeEvent({ type: 'tool-result', agent: 'technical', tool: 'run_backtest', status: 'error', output: undefined }))
      .toBe('tool-result:error');
  });
});

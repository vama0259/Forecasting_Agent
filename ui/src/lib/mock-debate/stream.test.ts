// Unit test verifying pacing and replay of MockDebateStream
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockDebateStream } from './stream';
import type { DebateEvent } from './types';

describe('MockDebateStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays a fixture array in order, one event per tick', async () => {
    const fixture: DebateEvent[] = [
      { type: 'round-start', round: 'independent', roundIndex: 1 },
      { type: 'agent-turn-start', agent: 'technical', round: 'independent' },
    ];
    const stream = new MockDebateStream(fixture, { delayMs: 10 });
    const received: DebateEvent[] = [];
    const iterPromise = (async () => {
      for await (const event of stream) {
        received.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(100);
    await iterPromise;
    expect(received).toEqual(fixture);
  });
});

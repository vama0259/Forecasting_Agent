// Async generator yielding DebateEvent sequence with configurable pacing delay

import type { DebateEvent } from './types';

// Configuration options for the mock debate stream pacing
export interface MockDebateStreamOptions {
  delayMs?: number;
}

// Replays a fixture of DebateEvent items as an AsyncIterable with pacing delays
export class MockDebateStream implements AsyncIterable<DebateEvent> {
  private fixture: DebateEvent[];
  private delayMs: number;

  // Initializes the stream with a fixture array and optional delay in milliseconds
  constructor(fixture: DebateEvent[], options?: MockDebateStreamOptions) {
    this.fixture = fixture;
    this.delayMs = options?.delayMs ?? 150;
  }

  // Yields each event sequentially after the configured pacing delay
  async *[Symbol.asyncIterator](): AsyncIterator<DebateEvent> {
    for (const event of this.fixture) {
      if (this.delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
      }
      yield event;
    }
  }
}

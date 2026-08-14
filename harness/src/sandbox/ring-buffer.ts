// harness/src/sandbox/ring-buffer.ts
// Fixed-capacity circular byte buffer: appends chunks, silently drops the oldest
// bytes on overflow, and flags when any drop has occurred.

export class RingBuffer {
  private readonly capacity: number;
  private buf: Buffer;
  private didTruncate = false;

  // Takes buffer capacity in bytes; returns a RingBuffer starting empty.
  constructor(capacityBytes: number) {
    this.capacity = capacityBytes;
    this.buf = Buffer.alloc(0);
  }

  // Takes a chunk (string or Buffer); appends it, dropping oldest bytes past capacity.
  write(chunk: Buffer | string): void {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    const combined = Buffer.concat([this.buf, incoming]);
    if (combined.length > this.capacity) {
      this.buf = combined.subarray(combined.length - this.capacity);
      this.didTruncate = true;
    } else {
      this.buf = combined;
    }
  }

  // Takes nothing; returns the buffered content decoded as UTF-8.
  toString(): string {
    return this.buf.toString('utf8');
  }

  // Takes nothing; returns whether any write has ever caused a drop.
  get truncated(): boolean {
    return this.didTruncate;
  }

  // Takes nothing; returns current buffered size in bytes.
  get sizeBytes(): number {
    return this.buf.length;
  }
}

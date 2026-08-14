// harness/tests/sandbox/ring-buffer.test.ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/sandbox/ring-buffer.js';

describe('RingBuffer', () => {
  it('returns full content and truncated=false when under capacity', () => {
    const rb = new RingBuffer(1024);
    rb.write('hello ');
    rb.write('world');
    expect(rb.toString()).toBe('hello world');
    expect(rb.truncated).toBe(false);
    expect(rb.sizeBytes).toBe(11);
  });

  it('truncates and drops oldest bytes on overflow, keeping exactly capacity bytes', () => {
    const rb = new RingBuffer(10);
    rb.write('0123456789'); // exactly 10 bytes, fills buffer
    rb.write('ABC'); // 3 more bytes -> must drop oldest 3 ("012")
    expect(rb.toString()).toBe('3456789ABC');
    expect(rb.truncated).toBe(true);
    expect(rb.sizeBytes).toBe(10);
  });

  it('handles a single write larger than capacity by keeping only the tail', () => {
    const rb = new RingBuffer(5);
    rb.write('0123456789'); // 10 bytes in one write, capacity 5
    expect(rb.toString()).toBe('56789');
    expect(rb.truncated).toBe(true);
  });

  it('accepts Buffer chunks as well as strings', () => {
    const rb = new RingBuffer(1024);
    rb.write(Buffer.from('binary-safe'));
    expect(rb.toString()).toBe('binary-safe');
  });
});

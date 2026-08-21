/**
 * Purpose: Unit tests for StreamDemuxer utility functions.
 * Responsibility: Verify 8-byte multiplexed header decoding for stdout and stderr.
 * Inputs/outputs: Multiplexed byte buffers; decoded stream payload assertions.
 * Excludes: Live process sockets.
 */

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { demuxBuffer, demuxStream } from '../../src/execution/stream-demuxer.js';

describe('StreamDemuxer Unit Tests', () => {
  function makeFrame(streamType: number, payload: string): Buffer {
    const payloadBuf = Buffer.from(payload);
    const header = Buffer.alloc(8);
    header.writeUInt8(streamType, 0);
    header.writeUInt32BE(payloadBuf.length, 4);
    return Buffer.concat([header, payloadBuf]);
  }

  it('demuxes static buffer containing both stdout and stderr frames', () => {
    const frame1 = makeFrame(1, 'stdout-line-1\n');
    const frame2 = makeFrame(2, 'stderr-line-1\n');
    const frame3 = makeFrame(1, 'stdout-line-2\n');
    const input = Buffer.concat([frame1, frame2, frame3]);

    const result = demuxBuffer(input);
    expect(result.stdout.toString()).toBe('stdout-line-1\nstdout-line-2\n');
    expect(result.stderr.toString()).toBe('stderr-line-1\n');
  });

  it('demuxes progressive stream chunks with stream callbacks', async () => {
    const frame1 = makeFrame(1, 'chunk-1');
    const frame2 = makeFrame(2, 'error-chunk');
    const frame3 = makeFrame(1, 'chunk-2');

    const stream = new Readable({
      read() {
        this.push(frame1);
        this.push(frame2);
        this.push(frame3);
        this.push(null);
      },
    });

    const stdoutList: string[] = [];
    const stderrList: string[] = [];

    const result = await demuxStream(stream, {
      onStdout: (c) => stdoutList.push(c.toString()),
      onStderr: (c) => stderrList.push(c.toString()),
    });

    expect(result.stdout.toString()).toBe('chunk-1chunk-2');
    expect(result.stderr.toString()).toBe('error-chunk');
    expect(stdoutList.join('')).toBe('chunk-1chunk-2');
    expect(stderrList.join('')).toBe('error-chunk');
  });
});

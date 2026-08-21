/**
 * Purpose: Stream demultiplexer for OCI container attach and exec streams.
 * Responsibility: Parse 8-byte multiplexed headers and route stdout/stderr chunks.
 * Inputs/outputs: Multiplexed binary streams or buffers; emits routed payloads.
 * Excludes: Network socket creation and container lifecycle supervision.
 */

import { Readable } from 'node:stream';

/** Stream channel kind identifying standard output or error stream. */
export type StreamKind = 'stdout' | 'stderr';

/** Callbacks invoked on progressive stream chunk demultiplexing. */
export interface DemuxCallbacks {
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
}

/** Result containing accumulated stdout and stderr buffers. */
export interface DemuxResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

/**
 * Demultiplexes a static Buffer containing 8-byte multiplexed headers.
 * Returns decoded stdout and stderr buffers.
 */
export function demuxBuffer(buffer: Buffer): DemuxResult {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const streamType = buffer.readUInt8(offset);
    const frameSize = buffer.readUInt32BE(offset + 4);
    offset += 8;

    const frameEnd = Math.min(offset + frameSize, buffer.length);
    const chunk = buffer.subarray(offset, frameEnd);
    offset = frameEnd;

    if (streamType === 1 || streamType === 0) {
      stdoutChunks.push(chunk);
    } else if (streamType === 2) {
      stderrChunks.push(chunk);
    }
  }

  if (stdoutChunks.length === 0 && stderrChunks.length === 0 && buffer.length > 0) {
    stdoutChunks.push(buffer);
  }

  return {
    stdout: Buffer.concat(stdoutChunks),
    stderr: Buffer.concat(stderrChunks),
  };
}

/**
 * Demultiplexes a Node.js Readable stream with 8-byte multiplexed headers.
 * Resolves with combined stdout and stderr buffers when stream ends.
 */
export async function demuxStream(
  stream: Readable,
  callbacks?: DemuxCallbacks,
): Promise<DemuxResult> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let pending = Buffer.alloc(0);

  return new Promise<DemuxResult>((resolve, reject) => {
    stream.on('data', (data: Buffer | string) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      pending = Buffer.concat([pending, buf]);

      while (pending.length >= 8) {
        const streamType = pending.readUInt8(0);
        const frameSize = pending.readUInt32BE(4);

        if (pending.length < 8 + frameSize) {
          break;
        }

        const chunk = pending.subarray(8, 8 + frameSize);
        pending = pending.subarray(8 + frameSize);

        if (streamType === 1 || streamType === 0) {
          stdoutChunks.push(chunk);
          callbacks?.onStdout?.(chunk);
        } else if (streamType === 2) {
          stderrChunks.push(chunk);
          callbacks?.onStderr?.(chunk);
        }
      }
    });

    stream.on('end', () => {
      if (pending.length > 0) {
        stdoutChunks.push(pending);
        callbacks?.onStdout?.(pending);
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

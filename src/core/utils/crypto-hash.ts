/**
 * Purpose: Cryptographic hash calculation and incremental streaming SHA-256.
 * Responsibility: Provide deterministic SHA-256 digests over strings, bytes, streams.
 * Inputs/outputs: Uint8Array or string inputs; returns branded Sha256Hash hex strings.
 * Excludes: Asymmetric signing, key derivation, and random salt generation.
 */

import { createHash } from 'node:crypto';
import type { Sha256Hash } from '../types/identifiers.js';

/**
 * Interface representing an incremental SHA-256 streaming digester.
 */
export interface Sha256StreamDigester {
  readonly write: (chunk: Uint8Array) => void;
  readonly digestHex: () => Sha256Hash;
  readonly byteCount: () => number;
}

/**
 * Computes a SHA-256 hexadecimal hash over a string or byte array.
 * Returns lowercase 64-character hex string branded as Sha256Hash.
 */
export function sha256Hex(data: Uint8Array | string): Sha256Hash {
  const hash = createHash('sha256');
  if (typeof data === 'string') {
    hash.update(data, 'utf8');
  } else {
    hash.update(data);
  }
  return hash.digest('hex') as Sha256Hash;
}

/**
 * Creates an incremental SHA-256 stream digester for tracking bytes and hash.
 * Returns an object with write(), digestHex(), and byteCount() methods.
 */
export function createSha256Stream(): Sha256StreamDigester {
  const hash = createHash('sha256');
  let totalBytes = 0;

  return {
    write(chunk: Uint8Array): void {
      totalBytes += chunk.byteLength;
      hash.update(chunk);
    },
    digestHex(): Sha256Hash {
      return hash.digest('hex') as Sha256Hash;
    },
    byteCount(): number {
      return totalBytes;
    },
  };
}

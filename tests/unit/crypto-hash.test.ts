/**
 * Purpose: Unit tests for cryptographic hash computation and digester.
 * Responsibility: Verify SHA-256 calculation over buffers, strings, streams.
 * Inputs/outputs: Plain bytes/strings; verify hexadecimal digest matching NIST.
 * Excludes: Asymmetric crypto and key generation.
 */

import { describe, it, expect } from 'vitest';
import { sha256Hex, createSha256Stream } from '../../src/core/utils/crypto-hash.js';

describe('Crypto Hash Utilities', () => {
  it('computes exact SHA-256 hex digest for string input', () => {
    const emptyDigest = sha256Hex('');
    expect(emptyDigest).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const helloDigest = sha256Hex('hello world');
    expect(helloDigest).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('calculates streaming digest and byte count incrementally', () => {
    const digester = createSha256Stream();
    const encoder = new TextEncoder();
    digester.write(encoder.encode('hello '));
    digester.write(encoder.encode('world'));

    expect(digester.byteCount()).toBe(11);
    expect(digester.digestHex()).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });
});

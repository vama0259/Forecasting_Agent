/**
 * Purpose: Unit tests for RFC 8785 canonical JSON serializer.
 * Responsibility: Verify deterministic key sorting, normalization, and failure modes.
 * Inputs/outputs: Plain JavaScript structures; string output assertions.
 * Excludes: Network serialization and file storage.
 */

import { describe, it, expect } from 'vitest';
import { canonicalize } from '../../src/core/utils/canonical-json.js';
import { SerializationError } from '../../src/core/errors/serialization.error.js';

describe('Canonical JSON (RFC 8785)', () => {
  it('sorts object keys lexicographically in UTF-16 code unit order', () => {
    const input = { b: 1, a: { d: 2, c: 3 } };
    const output = canonicalize(input);
    expect(output).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('handles primitive types and arrays accurately', () => {
    const input = {
      str: 'hello',
      num: 42,
      bool: true,
      nil: null,
      arr: [3, 2, 1],
    };
    const output = canonicalize(input);
    expect(output).toBe(
      '{"arr":[3,2,1],"bool":true,"nil":null,"num":42,"str":"hello"}',
    );
  });

  it('rejects NaN and Infinity with SerializationError', () => {
    expect(() => canonicalize({ invalid: Number.NaN })).toThrow(SerializationError);
    expect(() => canonicalize({ invalid: Number.POSITIVE_INFINITY })).toThrow(
      SerializationError,
    );
    expect(() => canonicalize({ invalid: Number.NEGATIVE_INFINITY })).toThrow(
      SerializationError,
    );
  });

  it('rejects cyclic object references with SerializationError', () => {
    const cyclic: Record<string, unknown> = { key: 'value' };
    cyclic['self'] = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(SerializationError);
  });
});

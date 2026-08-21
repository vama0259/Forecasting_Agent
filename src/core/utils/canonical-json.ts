/**
 * Purpose: Deterministic JSON serialization according to RFC 8785 (JCS).
 * Responsibility: Sort object keys by UTF-16 code units and normalize Unicode/numbers.
 * Inputs/outputs: Plain JavaScript value; returns canonical deterministic JSON string.
 * Excludes: Parsing, deserialization, and schema validation.
 */

import { SerializationError } from '../errors/serialization.error.js';

/**
 * Serializes a JavaScript value to canonical JSON conforming to RFC 8785.
 * Returns deterministic string or throws SerializationError on invalid/cyclic data.
 */
export function canonicalize(value: unknown): string {
  const seen = new Set<object>();

  function serialize(val: unknown): string {
    if (val === null) {
      return 'null';
    }
    if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    }
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) {
        throw new SerializationError(`Cannot canonicalize non-finite number: ${val}`, {
          value: String(val),
          reason: 'NON_FINITE_NUMBER',
        });
      }
      if (Object.is(val, -0)) {
        return '0';
      }
      return JSON.stringify(val);
    }
    if (typeof val === 'string') {
      return JSON.stringify(val.normalize('NFC'));
    }
    if (
      typeof val === 'bigint' ||
      typeof val === 'symbol' ||
      typeof val === 'function'
    ) {
      throw new SerializationError(
        `Cannot canonicalize unsupported type: ${typeof val}`,
        { valueType: typeof val, reason: 'UNSUPPORTED_TYPE' },
      );
    }
    if (typeof val === 'object') {
      if (seen.has(val)) {
        throw new SerializationError('Cyclic object structure detected', {
          reason: 'CYCLIC_REFERENCE',
        });
      }
      seen.add(val);

      try {
        if (Array.isArray(val)) {
          const elements = val.map((item) =>
            item === undefined ? 'null' : serialize(item),
          );
          return `[${elements.join(',')}]`;
        }

        if (
          'toJSON' in val &&
          typeof (val as { toJSON: unknown }).toJSON === 'function'
        ) {
          const jsonVal: unknown = (val as { toJSON(): unknown }).toJSON();
          return serialize(jsonVal);
        }

        const keys = Object.keys(val).sort();
        const entries: string[] = [];
        for (const key of keys) {
          const propVal = (val as Record<string, unknown>)[key];
          if (propVal !== undefined && typeof propVal !== 'function') {
            const canonicalKey = JSON.stringify(key.normalize('NFC'));
            entries.push(`${canonicalKey}:${serialize(propVal)}`);
          }
        }
        return `{${entries.join(',')}}`;
      } finally {
        seen.delete(val);
      }
    }

    return 'null';
  }

  return serialize(value);
}

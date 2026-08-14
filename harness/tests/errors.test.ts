import { describe, expect, it } from 'vitest';
import { CapabilityHealthError, ConfigValidationError, redact } from '../src/errors.js';

describe('redact', () => {
  it('replaces every occurrence of each secret', () => {
    expect(redact('key=sk-live-123 and again sk-live-123', ['sk-live-123'])).toBe(
      'key=[REDACTED] and again [REDACTED]',
    );
  });

  it('is a no-op when there are no secrets', () => {
    expect(redact('plain message', [])).toBe('plain message');
  });

  it('ignores empty-string secrets so the message is not shredded', () => {
    expect(redact('plain message', [''])).toBe('plain message');
  });
});

describe('error types', () => {
  it('ConfigValidationError and CapabilityHealthError are distinct types', () => {
    const cfg = new ConfigValidationError(['llm.model: expected string'], []);
    const health = new CapabilityHealthError(['chat: ECONNREFUSED']);
    expect(cfg).toBeInstanceOf(ConfigValidationError);
    expect(cfg).not.toBeInstanceOf(CapabilityHealthError);
    expect(health).toBeInstanceOf(CapabilityHealthError);
    expect(health).not.toBeInstanceOf(ConfigValidationError);
    expect(cfg.name).toBe('ConfigValidationError');
    expect(health.name).toBe('CapabilityHealthError');
  });

  it('ConfigValidationError joins issues and redacts secret values', () => {
    const err = new ConfigValidationError(['llm.api_key: invalid value "sk-live-123"'], ['sk-live-123']);
    expect(err.message).toContain('llm.api_key');
    expect(err.message).not.toContain('sk-live-123');
    expect(err.issues).toEqual(['llm.api_key: invalid value "sk-live-123"'.replace('sk-live-123', '[REDACTED]')]);
  });

  it('CapabilityHealthError joins failures with "; "', () => {
    const err = new CapabilityHealthError(['chat: ECONNREFUSED', 'market_data: probe timeout']);
    expect(err.message).toBe('chat: ECONNREFUSED; market_data: probe timeout');
  });
});

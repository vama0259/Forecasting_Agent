/**
 * Purpose: Unit tests for ImageAdmission policy verification.
 * Responsibility: Assert allowed prefixes and digest pinning enforcement.
 * Inputs/outputs: Image strings and policies; pass/fail assertions.
 * Excludes: Network image pulling.
 */

import { describe, it, expect } from 'vitest';
import { assertImageAdmitted } from '../../src/execution/image-admission.js';
import { AuthorizationError } from '../../src/core/errors/authorization.error.js';

describe('ImageAdmission Unit Tests', () => {
  it('allows standard default image references', () => {
    expect(() => assertImageAdmitted('alpine')).not.toThrow();
    expect(() => assertImageAdmitted('alpine:latest')).not.toThrow();
    expect(() => assertImageAdmitted('docker.io/library/alpine:latest')).not.toThrow();
    expect(() => assertImageAdmitted('python:3.11-slim')).not.toThrow();
  });

  it('rejects disallowed image registries or malicious names', () => {
    expect(() =>
      assertImageAdmitted('malicious-registry.com/bad-image:latest'),
    ).toThrow(AuthorizationError);
    expect(() => assertImageAdmitted('')).toThrow(AuthorizationError);
  });

  it('enforces mandatory digest pinning when policy requires it', () => {
    const validDigest = 'docker.io/library/alpine@sha256:' + 'a'.repeat(64);
    const unpinnedTag = 'docker.io/library/alpine:latest';

    expect(() =>
      assertImageAdmitted(validDigest, { requireDigestPinning: true }),
    ).not.toThrow();

    expect(() =>
      assertImageAdmitted(unpinnedTag, { requireDigestPinning: true }),
    ).toThrow(AuthorizationError);
  });
});

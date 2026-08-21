/**
 * Purpose: Unit tests for point-in-time cutoff eligibility policy.
 * Responsibility: Verify temporal boundaries, state gating, and strict inequality.
 * Inputs/outputs: Dates and artifact states; boolean or exception assertions.
 * Excludes: Database queries and physical file verification.
 */

import { describe, it, expect } from 'vitest';
import {
  isEvidenceEligible,
  assertEvidenceEligible,
} from '../../src/core/policies/cutoff-policy.js';
import {
  PointInTimeViolationError,
  // typed domain error
} from '../../src/core/errors/point-in-time.error.js';

describe('Cutoff Policy', () => {
  const cutoff = new Date('2026-08-21T00:00:00.000Z');

  it('approves evidence available before or exactly at cutoff timestamp', () => {
    const exactlyAtCutoff = new Date('2026-08-21T00:00:00.000Z');
    const beforeCutoff = new Date('2026-08-20T23:59:59.999Z');

    expect(isEvidenceEligible(exactlyAtCutoff, cutoff, 'AVAILABLE')).toBe(true);
    expect(isEvidenceEligible(beforeCutoff, cutoff, 'AVAILABLE')).toBe(true);
    expect(() =>
      assertEvidenceEligible(exactlyAtCutoff, cutoff, 'AVAILABLE'),
    ).not.toThrow();
  });

  it('rejects evidence available 1ms after cutoff timestamp', () => {
    const afterCutoff = new Date('2026-08-21T00:00:00.001Z');

    expect(isEvidenceEligible(afterCutoff, cutoff, 'AVAILABLE')).toBe(false);
    expect(() => assertEvidenceEligible(afterCutoff, cutoff, 'AVAILABLE')).toThrow(
      PointInTimeViolationError,
    );
  });

  it('rejects evidence that is not in AVAILABLE state regardless of timestamp', () => {
    const beforeCutoff = new Date('2026-08-20T12:00:00.000Z');

    expect(isEvidenceEligible(beforeCutoff, cutoff, 'STAGED')).toBe(false);
    expect(isEvidenceEligible(beforeCutoff, cutoff, 'REJECTED')).toBe(false);
    expect(() => assertEvidenceEligible(beforeCutoff, cutoff, 'STAGED')).toThrow(
      PointInTimeViolationError,
    );
  });
});

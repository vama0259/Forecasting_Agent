/**
 * Purpose: Enforce point-in-time cutoff eligibility on evidence artifacts.
 * Responsibility: Verify that inputs were available on or before the run cutoff.
 * Inputs/outputs: Available timestamp, cutoff timestamp, state; boolean or throws.
 * Excludes: Authorization decisions and container mount enforcement.
 */

import { PointInTimeViolationError } from '../errors/point-in-time.error.js';
import type { ArtifactVersionState } from '../types/lifecycle.js';

/**
 * Checks whether an artifact version satisfies temporal point-in-time cutoff.
 * Returns true if state is AVAILABLE and availableFrom <= runCutoffAt, else false.
 */
export function isEvidenceEligible(
  artifactAvailableFrom: Date | string,
  runCutoffAt: Date | string,
  artifactState: ArtifactVersionState,
): boolean {
  if (artifactState !== 'AVAILABLE') {
    return false;
  }
  const availableMs =
    artifactAvailableFrom instanceof Date
      ? artifactAvailableFrom.getTime()
      : new Date(artifactAvailableFrom).getTime();
  const cutoffMs =
    runCutoffAt instanceof Date
      ? runCutoffAt.getTime()
      : new Date(runCutoffAt).getTime();

  return availableMs <= cutoffMs;
}

/**
 * Asserts that an artifact version satisfies point-in-time cutoff policy.
 * Throws PointInTimeViolationError if the artifact is ineligible or not AVAILABLE.
 */
export function assertEvidenceEligible(
  artifactAvailableFrom: Date | string,
  runCutoffAt: Date | string,
  artifactState: ArtifactVersionState,
): void {
  const eligible = isEvidenceEligible(
    artifactAvailableFrom,
    runCutoffAt,
    artifactState,
  );
  if (!eligible) {
    const availableIso =
      artifactAvailableFrom instanceof Date
        ? artifactAvailableFrom.toISOString()
        : String(artifactAvailableFrom);
    const cutoffIso =
      runCutoffAt instanceof Date ? runCutoffAt.toISOString() : String(runCutoffAt);

    throw new PointInTimeViolationError(
      `Evidence ineligible: available_from (${availableIso}) > cutoff_at ` +
        `(${cutoffIso}) or state (${artifactState}) is not AVAILABLE`,
      {
        artifactAvailableFrom: availableIso,
        runCutoffAt: cutoffIso,
        artifactState,
      },
    );
  }
}

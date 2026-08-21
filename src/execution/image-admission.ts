/**
 * Purpose: Image admission controller verifying OCI image references against policy.
 * Responsibility: Validate immutable digest pinning and allowed registry prefixes.
 * Inputs/outputs: Image name string and admission policy; passes or throws error.
 * Excludes: Registry network authentication and image layer pulling.
 */

import { AuthorizationError } from '../core/errors/authorization.error.js';

/** Policy options for governing permissible sandbox container images. */
export interface ImageAdmissionPolicy {
  readonly allowedPrefixes?: readonly string[];
  readonly requireDigestPinning?: boolean;
}

const DEFAULT_ALLOWED_PREFIXES: readonly string[] = [
  'docker.io/library/alpine',
  'docker.io/library/python',
  'docker.io/library/node',
  'docker.io/library/postgres',
  'alpine',
  'python',
  'node',
  'postgres',
];

/**
 * Validates that an image reference conforms to admission rules.
 * Throws AuthorizationError if the image reference is disallowed.
 */
export function assertImageAdmitted(
  image: string,
  policy: ImageAdmissionPolicy = {},
): void {
  if (!image || image.trim().length === 0) {
    throw new AuthorizationError('Container image reference cannot be empty', {
      image,
    });
  }

  const allowedPrefixes = policy.allowedPrefixes ?? DEFAULT_ALLOWED_PREFIXES;
  const matchesPrefix = allowedPrefixes.some(
    (prefix) =>
      image === prefix ||
      image.startsWith(`${prefix}:`) ||
      image.startsWith(`${prefix}@`),
  );

  if (!matchesPrefix) {
    throw new AuthorizationError(`Image "${image}" does not match any allowed prefix`, {
      image,
      allowedPrefixes,
    });
  }

  if (policy.requireDigestPinning) {
    const hasDigest = /@sha256:[a-f0-9]{64}$/i.test(image);
    if (!hasDigest) {
      throw new AuthorizationError(
        `Image "${image}" is missing mandatory sha256 digest pinning`,
        { image },
      );
    }
  }
}

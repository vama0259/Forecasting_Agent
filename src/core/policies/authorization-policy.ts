/**
 * Purpose: Compute cryptographic hashes over plans, commands, and authorizations.
 * Responsibility: Generate deterministic canonical SHA-256 hashes for execution audit.
 * Inputs/outputs: Plans, command lists, authorization payloads; returns Sha256Hash.
 * Excludes: Authorization database persistence and token signature validation.
 */

import type {
  AuthorizationPayload,
  CanonicalPlan,
  ExecutionCommandDeclaration,
} from '../types/execution.js';
import type { Sha256Hash } from '../types/identifiers.js';
import { canonicalize } from '../utils/canonical-json.js';
import { sha256Hex } from '../utils/crypto-hash.js';

/**
 * Computes canonical RFC 8785 SHA-256 hash over an execution plan.
 * Returns deterministic 64-character hex Sha256Hash string.
 */
export function computePlanHash(plan: CanonicalPlan): Sha256Hash {
  const canonical = canonicalize(plan);
  return sha256Hex(canonical);
}

/**
 * Computes canonical RFC 8785 SHA-256 hash over ordered execution commands.
 * Returns deterministic 64-character hex Sha256Hash string.
 */
export function computeCommandSetHash(
  commands: readonly ExecutionCommandDeclaration[],
): Sha256Hash {
  const sorted = [...commands].sort((a, b) => a.command_sequence - b.command_sequence);
  const canonical = canonicalize(sorted);
  return sha256Hex(canonical);
}

/**
 * Computes canonical RFC 8785 SHA-256 hash over an authorization payload.
 * Returns deterministic 64-character hex Sha256Hash string.
 */
export function computeAuthorizationHash(payload: AuthorizationPayload): Sha256Hash {
  const canonical = canonicalize(payload);
  return sha256Hex(canonical);
}

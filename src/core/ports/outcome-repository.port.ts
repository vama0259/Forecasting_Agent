/**
 * Purpose: Consumer-owned port interface for outcome settlement and versioning.
 * Responsibility: Define operations for appending and querying outcome versions.
 * Inputs/outputs: Outcome payloads, resolver versions, publication IDs; records.
 * Excludes: Domain-specific outcome resolution algorithms and dispute protocols.
 */

import type {
  ArtifactVersionId,
  OrganizationId,
  OutcomeVersionId,
  PublicationId,
} from '../types/identifiers.js';
import type { OutcomeState } from '../types/lifecycle.js';

/** Representation of an outcome version record. */
export interface OutcomeVersionRecord {
  readonly id: OutcomeVersionId;
  readonly organization_id: OrganizationId;
  readonly publication_id: PublicationId;
  readonly version: number;
  readonly state: OutcomeState;
  readonly payload: Record<string, unknown>;
  readonly source_artifact_version_id: ArtifactVersionId;
  readonly resolver_version: string;
  readonly created_at: string;
}

/**
 * Interface defining persistence operations for publication outcome versions.
 */
export interface OutcomeRepository {
  /**
   * Appends a new outcome version under an exclusive publication row lock.
   * Returns created OutcomeVersionRecord with incremented version number.
   */
  appendOutcomeVersion(params: {
    readonly organization_id: OrganizationId;
    readonly publication_id: PublicationId;
    readonly state: OutcomeState;
    readonly payload: Record<string, unknown>;
    readonly source_artifact_version_id: ArtifactVersionId;
    readonly resolver_version: string;
  }): Promise<OutcomeVersionRecord>;

  /**
   * Retrieves the latest outcome version for a given publication.
   * Returns greatest version OutcomeVersionRecord or null if no outcome exists.
   */
  getLatestOutcomeVersion(
    publicationId: PublicationId,
  ): Promise<OutcomeVersionRecord | null>;
}

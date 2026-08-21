/**
 * Purpose: Define types and metadata for immutable artifacts and lineage.
 * Responsibility: Provide interfaces for artifact store keys, staging, and commits.
 * Inputs/outputs: Plain interface declarations for artifact representations.
 * Excludes: Filesystem I/O and POSIX file handle management.
 */

import type {
  ArtifactId,
  ArtifactVersionId,
  ExecutionId,
  OrganizationId,
  ProjectId,
  Sha256Hash,
} from './identifiers.js';
import type { ArtifactSensitivity, ArtifactVersionState } from './lifecycle.js';

/** Expected content descriptors for verification prior to commit or read. */
export interface ExpectedContent {
  readonly sha256?: Sha256Hash;
  readonly byteLength?: number;
}

/** Content-addressed key locating an artifact within storage. */
export interface ArtifactKey {
  readonly organization_id: OrganizationId;
  readonly content_sha256: Sha256Hash;
}

/** Ephemeral handle representing an object currently staged on disk. */
export interface StagedObject {
  readonly stagingPath: string;
  readonly organization_id: OrganizationId;
  readonly content_sha256: Sha256Hash;
  readonly content_bytes: number;
}

/** Durable record of a committed, content-addressed artifact in storage. */
export interface CommittedObject {
  readonly key: ArtifactKey;
  readonly content_sha256: Sha256Hash;
  readonly content_bytes: number;
  readonly storage_key: string;
}

/** Verified file materialized to caller destination. */
export interface VerifiedFile {
  readonly destinationPath: string;
  readonly content_sha256: Sha256Hash;
  readonly content_bytes: number;
}

/** Disposition of an output artifact produced by an execution. */
export type ArtifactDisposition = 'DECLARED' | 'DIAGNOSTIC';

/** Lineage edge relation between parent and child artifact versions. */
export type ArtifactEdgeRelation =
  'DERIVED_FROM' | 'COMPILED_FROM' | 'TRANSFORMED_FROM' | 'EXTRACTED_FROM';

/** Provenance rule for determining when an artifact was available. */
export type AvailabilityDerivationRule =
  'VERIFIED_PUBLICATION' | 'RETRIEVAL_COMPLETION';

/** Metadata stored alongside an artifact version. */
export interface ArtifactVersionMetadata {
  readonly availability_derivation?: {
    readonly rule: AvailabilityDerivationRule;
    readonly source_timestamp?: string;
    readonly connector_version?: string;
    readonly source_artifact_version_id?: ArtifactVersionId;
  };
  readonly [key: string]: unknown;
}

/** Representation of an artifact entity. */
export interface ArtifactRecord {
  readonly id: ArtifactId;
  readonly organization_id: OrganizationId;
  readonly project_id: ProjectId;
  readonly kind: string;
  readonly logical_name: string;
  readonly sensitivity: ArtifactSensitivity;
  readonly created_at: string;
}

/** Representation of an immutable artifact version. */
export interface ArtifactVersionRecord {
  readonly id: ArtifactVersionId;
  readonly organization_id: OrganizationId;
  readonly artifact_id: ArtifactId;
  readonly version: number;
  readonly state: ArtifactVersionState;
  readonly content_sha256: Sha256Hash;
  readonly content_bytes: number;
  readonly media_type: string;
  readonly storage_key: string;
  readonly available_from: string;
  readonly observed_at: string | null;
  readonly source_published_at: string | null;
  readonly retrieved_at: string;
  readonly produced_by_execution_id: ExecutionId | null;
  readonly metadata: ArtifactVersionMetadata;
  readonly created_at: string;
}

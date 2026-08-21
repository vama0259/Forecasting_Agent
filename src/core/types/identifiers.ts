/**
 * Purpose: Define branded nominal types for domain entity identifiers.
 * Responsibility: Prevent accidental primitive confusion between different IDs.
 * Inputs/outputs: Plain branded string types.
 * Excludes: ID generation and UUID validation algorithms.
 */

/** Branded identifier for an organization entity. */
export type OrganizationId = string & { readonly __brand: unique symbol };

/** Branded identifier for a project entity. */
export type ProjectId = string & { readonly __brand: unique symbol };

/** Branded identifier for a principal user or service account. */
export type PrincipalId = string & { readonly __brand: unique symbol };

/** Branded identifier for a forecast contract specification. */
export type ContractId = string & { readonly __brand: unique symbol };

/** Branded identifier for an execution contract specification. */
export type ExecutionContractId = string & { readonly __brand: unique symbol };

/** Branded identifier for a forecasting run instance. */
export type RunId = string & { readonly __brand: unique symbol };

/** Branded identifier for an attempt within a forecasting run. */
export type RunAttemptId = string & { readonly __brand: unique symbol };

/** Branded identifier for a discrete execution unit in a container. */
export type ExecutionId = string & { readonly __brand: unique symbol };

/** Branded identifier for a logical artifact entity. */
export type ArtifactId = string & { readonly __brand: unique symbol };

/** Branded identifier for an immutable version of an artifact. */
export type ArtifactVersionId = string & { readonly __brand: unique symbol };

/** Branded identifier for a publication record. */
export type PublicationId = string & { readonly __brand: unique symbol };

/** Branded identifier for an outcome version. */
export type OutcomeVersionId = string & { readonly __brand: unique symbol };

/** Branded identifier for an evaluation run record. */
export type EvaluationRunId = string & { readonly __brand: unique symbol };

/** Hexadecimal representation of a 256-bit SHA-256 digest. */
export type Sha256Hash = string & { readonly __brand: unique symbol };

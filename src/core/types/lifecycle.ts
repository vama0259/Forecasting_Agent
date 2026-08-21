/**
 * Purpose: Define lifecycle states and terminal status enums across the domain.
 * Responsibility: Provide exhaustive discriminated union types for entity states.
 * Inputs/outputs: Plain union type definitions.
 * Excludes: State machine transition logic and mutation methods.
 */

/** Lifecycle state for a forecast contract or execution contract. */
export type ContractStatus = 'DRAFT' | 'FROZEN' | 'RETIRED';

/** Lifecycle state for a top-level forecasting run. */
export type RunState = 'OPEN' | 'PUBLISHED' | 'ABANDONED';

/** Lifecycle state for an individual attempt of a forecasting run. */
export type RunAttemptState =
  'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABANDONED';

/** Lifecycle state for a containerized execution unit. */
export type ExecutionState =
  | 'AUTHORIZED'
  | 'PROVISIONING'
  | 'READY'
  | 'RUNNING'
  | 'COLLECTING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'COLLECTION_FAILED'
  | 'QUARANTINED';

/** Lifecycle state for filesystem and runtime resource cleanup. */
export type CleanupState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** State of an observed outcome version. */
export type OutcomeState = 'PROVISIONAL' | 'SETTLED' | 'DISPUTED' | 'VOID';

/** Availability state for an artifact version. */
export type ArtifactVersionState = 'STAGED' | 'AVAILABLE' | 'REJECTED';

/** Sensitivity classification for stored artifacts. */
export type ArtifactSensitivity = 'STANDARD' | 'RESTRICTED' | 'CONFIDENTIAL';

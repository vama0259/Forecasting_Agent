/**
 * Purpose: Define interfaces for plans, commands, authorization, and sandbox.
 * Responsibility: Supply types for runtime execution requests, handles, and limits.
 * Inputs/outputs: Plain interface declarations for execution scheduling.
 * Excludes: Container runtime socket communication and process manipulation.
 */

import type {
  ArtifactVersionId,
  ContractId,
  ExecutionContractId,
  ExecutionId,
  OrganizationId,
  ProjectId,
  RunAttemptId,
  RunId,
  Sha256Hash,
} from './identifiers.js';
import type { ResourcePolicyDeclaration } from './contracts.js';
import type { ExecutionState } from './lifecycle.js';

/** Declaration of an immutable command to execute inside the sandbox. */
export interface ExecutionCommandDeclaration {
  readonly command_sequence: number;
  readonly argv: readonly string[];
  readonly working_directory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin_artifact_version_id: ArtifactVersionId | null;
  readonly timeout_ms: number;
}

/** Node within a canonical run execution plan. */
export interface CanonicalPlanExecutionNode {
  readonly execution_id: ExecutionId;
  readonly execution_kind: string;
  readonly execution_contract_hash: Sha256Hash;
  readonly dependencies: readonly ExecutionId[];
  readonly required_inputs: readonly string[];
  readonly required_outputs: readonly string[];
}

/** Canonical execution plan governing a run attempt. */
export interface CanonicalPlan {
  readonly schema_version: number;
  readonly contract_hash: Sha256Hash;
  readonly executions: readonly CanonicalPlanExecutionNode[];
}

/** One-time authorization payload for executing a container. */
export interface AuthorizationPayload {
  readonly authorization_id: string;
  readonly organization_id: OrganizationId;
  readonly project_id: ProjectId;
  readonly run_id: RunId;
  readonly run_attempt_id: RunAttemptId;
  readonly execution_id: ExecutionId;
  readonly contract_id: ContractId;
  readonly execution_contract_id: ExecutionContractId;
  readonly plan_hash: Sha256Hash;
  readonly command_set_hash: Sha256Hash;
  readonly runtime_digest: string;
  readonly platform_digest: string;
  readonly expires_at: string;
}

/** Input mount declaration for provisioning a sandbox container. */
export interface SandboxInputMount {
  readonly host_source_path: string;
  readonly container_destination_path: string;
}

/** Request payload for provisioning a sandbox runtime container. */
export interface ProvisionRequest {
  readonly execution_id: ExecutionId;
  readonly run_attempt_id: RunAttemptId;
  readonly runtime_digest: string;
  readonly platform_digest: string;
  readonly resource_policy: ResourcePolicyDeclaration;
  readonly input_mounts: readonly SandboxInputMount[];
  readonly labels: Readonly<Record<string, string>>;
}

/** Handle referencing an active or stopped sandbox container. */
export interface RuntimeHandle {
  readonly container_id: string;
  readonly execution_id: ExecutionId;
}

/** Command request submitted to a provisioned runtime. */
export interface CommandRequest {
  readonly argv: readonly string[];
  readonly working_directory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeout_ms: number;
}

/** Result of a command executed within the sandbox. */
export interface CommandResult {
  readonly exit_code: number;
  readonly stdout_bytes: number;
  readonly stderr_bytes: number;
  readonly stdout_head_tail: { readonly head: Uint8Array; readonly tail: Uint8Array };
  readonly stderr_head_tail: { readonly head: Uint8Array; readonly tail: Uint8Array };
}

/** Output file declaration declared in execution contracts. */
export interface OutputDeclaration {
  readonly declaration_name: string;
  readonly relative_path: string;
  readonly media_type: string;
  readonly required: boolean;
  readonly max_bytes: number;
}

/** Inspection state returned by runtime adapter. */
export interface RuntimeState {
  readonly state: ExecutionState;
  readonly exit_code: number | null;
  readonly started_at: string | null;
  readonly finished_at: string | null;
}

/** Reason provided when terminating a running sandbox container. */
export type TerminationReason =
  'TIMEOUT' | 'CANCELLED' | 'OOM' | 'STORAGE_LIMIT' | 'USER_REQUEST';

/** Result returned after container and staging destruction. */
export interface CleanupResult {
  readonly destroyed: boolean;
  readonly error?: string;
}

/** Information about a managed container discovered during runtime inspection. */
export interface ManagedContainerInfo {
  readonly containerId: string;
  readonly executionId?: ExecutionId;
  readonly runAttemptId?: RunAttemptId;
  readonly labels: Readonly<Record<string, string>>;
}

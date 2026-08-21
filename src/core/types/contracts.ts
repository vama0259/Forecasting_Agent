/**
 * Purpose: Define contract schemas and policies governing runs and executions.
 * Responsibility: Provide interfaces for forecast contracts and execution bounds.
 * Inputs/outputs: Plain contract interface declarations.
 * Excludes: Dynamic JSON Schema validation algorithms.
 */

import type {
  ContractId,
  ExecutionContractId,
  OrganizationId,
  ProjectId,
  Sha256Hash,
} from './identifiers.js';
import type { ContractStatus } from './lifecycle.js';

/** Resource policy configuration for container execution bounds. */
export interface ResourcePolicyDeclaration {
  readonly memory_bytes: number;
  readonly cpu_quota_micros: number;
  readonly pids_limit: number;
  readonly wall_time_limit_ms: number;
  readonly tmpfs_workspace_bytes: number;
  readonly tmpfs_outputs_bytes: number;
  readonly tmpfs_tmp_bytes: number;
  readonly tmpfs_home_bytes: number;
}

/** Declaration for a forecast contract governing inputs and evaluations. */
export interface ContractDeclaration {
  readonly id: ContractId;
  readonly organization_id: OrganizationId;
  readonly project_id: ProjectId;
  readonly version: number;
  readonly input_schema: Record<string, unknown>;
  readonly output_schema: Record<string, unknown>;
  readonly cutoff_policy: Record<string, unknown>;
  readonly resolution_policy: Record<string, unknown>;
  readonly evaluation_policy: Record<string, unknown>;
  readonly status: ContractStatus;
  readonly contract_hash: Sha256Hash;
  readonly frozen_at: string | null;
  readonly created_at: string;
}

/** Declaration for an execution contract governing container inputs/outputs. */
export interface ExecutionContractDeclaration {
  readonly id: ExecutionContractId;
  readonly organization_id: OrganizationId;
  readonly project_id: ProjectId;
  readonly version: number;
  readonly input_declarations: readonly Record<string, unknown>[];
  readonly output_declarations: readonly Record<string, unknown>[];
  readonly resource_policy: ResourcePolicyDeclaration;
  readonly status: ContractStatus;
  readonly contract_hash: Sha256Hash;
  readonly frozen_at: string | null;
  readonly created_at: string;
}

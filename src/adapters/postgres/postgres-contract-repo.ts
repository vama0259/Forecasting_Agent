/**
 * Purpose: PostgreSQL persistence adapter for forecast and execution contracts.
 * Responsibility: Execute SQL statements creating and querying immutable contracts.
 * Inputs/outputs: Contract declarations; returns persisted contract records.
 * Excludes: Dynamic JSON Schema evaluation and outcome resolution.
 */

import type {
  ContractDeclaration,
  ExecutionContractDeclaration,
} from '../../core/types/contracts.js';
import type { PostgresPool } from './postgres-pool.js';

/**
 * PostgreSQL repository for forecast and execution contracts.
 */
export class PostgresContractRepository {
  private readonly pool: PostgresPool;

  /**
   * Initializes contract repository with PostgreSQL pool instance.
   * Sets local pool reference.
   */
  constructor(pool: PostgresPool) {
    this.pool = pool;
  }

  /**
   * Inserts or retrieves an immutable forecast contract declaration.
   * Returns persisted ContractDeclaration record.
   */
  async createContract(
    contract: Omit<ContractDeclaration, 'created_at'>,
  ): Promise<ContractDeclaration> {
    const res = await this.pool.query<ContractDeclaration>(
      `INSERT INTO contracts (
         id, organization_id, project_id, version, input_schema, output_schema,
         cutoff_policy, resolution_policy, evaluation_policy, status,
         contract_hash, frozen_at
       ) VALUES (
         COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12
       )
       RETURNING id, organization_id, project_id, version, input_schema,
                 output_schema, cutoff_policy, resolution_policy,
                 evaluation_policy, status, contract_hash, frozen_at,
                 created_at::text`,
      [
        contract.id ?? null,
        contract.organization_id,
        contract.project_id,
        contract.version,
        JSON.stringify(contract.input_schema),
        JSON.stringify(contract.output_schema),
        JSON.stringify(contract.cutoff_policy),
        JSON.stringify(contract.resolution_policy),
        JSON.stringify(contract.evaluation_policy),
        contract.status,
        contract.contract_hash,
        contract.frozen_at,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert contract');
    return row;
  }

  /**
   * Inserts or retrieves an immutable execution contract declaration.
   * Returns persisted ExecutionContractDeclaration record.
   */
  async createExecutionContract(
    contract: Omit<ExecutionContractDeclaration, 'created_at'>,
  ): Promise<ExecutionContractDeclaration> {
    const res = await this.pool.query<ExecutionContractDeclaration>(
      `INSERT INTO execution_contracts (
         id, organization_id, project_id, version, input_declarations,
         output_declarations, resource_policy, status, contract_hash, frozen_at
       ) VALUES (
         COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10
       )
       RETURNING id, organization_id, project_id, version, input_declarations,
                 output_declarations, resource_policy, status, contract_hash,
                 frozen_at, created_at::text`,
      [
        contract.id ?? null,
        contract.organization_id,
        contract.project_id,
        contract.version,
        JSON.stringify(contract.input_declarations),
        JSON.stringify(contract.output_declarations),
        JSON.stringify(contract.resource_policy),
        contract.status,
        contract.contract_hash,
        contract.frozen_at,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to insert execution contract');
    return row;
  }
}

-- PostgreSQL Initial Schema for Generic Forecasting Foundation

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Fixed advisory lock constant for backup write barrier
-- Bigint value: 42424242 (0x02877DE2)
CREATE OR REPLACE FUNCTION check_backup_write_barrier()
RETURNS trigger AS $$
BEGIN
    PERFORM pg_advisory_lock_shared(42424242);
    PERFORM pg_advisory_unlock_shared(42424242);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 1. Organizations & Principals
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE principals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    display_name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Projects & Contracts
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    slug VARCHAR(64) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, slug)
);

CREATE TABLE contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    input_schema JSONB NOT NULL,
    output_schema JSONB NOT NULL,
    cutoff_policy JSONB NOT NULL,
    resolution_policy JSONB NOT NULL,
    evaluation_policy JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    contract_hash CHAR(64) NOT NULL,
    frozen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, version)
);

CREATE TABLE execution_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    input_declarations JSONB NOT NULL,
    output_declarations JSONB NOT NULL,
    resource_policy JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    contract_hash CHAR(64) NOT NULL,
    frozen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, version)
);

-- 3. Runs & Attempts
CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
    cutoff_at TIMESTAMPTZ NOT NULL,
    resolve_after TIMESTAMPTZ NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE run_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    attempt_number INTEGER NOT NULL,
    plan JSONB NOT NULL,
    plan_hash CHAR(64) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    failure_code VARCHAR(64),
    failure_detail TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, attempt_number)
);

-- 4. Executions, Authorizations, Commands & Events
CREATE TABLE executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    run_attempt_id UUID NOT NULL REFERENCES run_attempts(id) ON DELETE RESTRICT,
    execution_kind VARCHAR(64) NOT NULL,
    execution_contract_id UUID NOT NULL REFERENCES execution_contracts(id) ON DELETE RESTRICT,
    authorization_hash CHAR(64) NOT NULL,
    runtime_digest VARCHAR(255) NOT NULL,
    platform_digest VARCHAR(255) NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'AUTHORIZED',
    cleanup_state VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    failure_stage VARCHAR(64),
    failure_code VARCHAR(64),
    failure_detail TEXT,
    exit_code INTEGER,
    cleanup_attempts INTEGER NOT NULL DEFAULT 0,
    provisioning_deadline TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    execution_id UUID UNIQUE NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    authorization_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    redeemed_at TIMESTAMPTZ,
    authorization_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_commands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    command_sequence INTEGER NOT NULL,
    argv JSONB NOT NULL,
    working_directory VARCHAR(255) NOT NULL,
    environment JSONB NOT NULL,
    stdin_artifact_version_id UUID,
    timeout_ms INTEGER NOT NULL,
    command_hash CHAR(64) NOT NULL,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    exit_code INTEGER,
    failure_code VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (execution_id, command_sequence)
);

CREATE TABLE execution_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    run_id UUID REFERENCES runs(id) ON DELETE RESTRICT,
    execution_id UUID REFERENCES executions(id) ON DELETE RESTRICT,
    principal_id UUID REFERENCES principals(id) ON DELETE RESTRICT,
    event_type VARCHAR(64) NOT NULL,
    details JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Artifacts, Lineage, Inputs & Outputs
CREATE TABLE artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    kind VARCHAR(64) NOT NULL,
    logical_name VARCHAR(255) NOT NULL,
    sensitivity VARCHAR(32) NOT NULL DEFAULT 'STANDARD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE artifact_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'STAGED',
    content_sha256 CHAR(64) NOT NULL,
    content_bytes BIGINT NOT NULL,
    media_type VARCHAR(128) NOT NULL,
    storage_key TEXT NOT NULL,
    available_from TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ,
    source_published_at TIMESTAMPTZ,
    retrieved_at TIMESTAMPTZ NOT NULL,
    produced_by_execution_id UUID REFERENCES executions(id) ON DELETE RESTRICT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (artifact_id, version)
);

CREATE TABLE artifact_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    parent_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    child_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    relation VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE execution_inputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    purpose VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (execution_id, artifact_version_id, purpose)
);

CREATE TABLE execution_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
    artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    disposition VARCHAR(32) NOT NULL DEFAULT 'DECLARED',
    declaration_name VARCHAR(64),
    publishable BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_execution_declared_output
ON execution_outputs(execution_id, declaration_name)
WHERE disposition = 'DECLARED';

-- 6. Publications, Outcomes & Evaluations
CREATE TABLE publications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    run_id UUID UNIQUE NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    run_attempt_id UUID NOT NULL REFERENCES run_attempts(id) ON DELETE RESTRICT,
    contract_hash CHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    reconstruction_manifest_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outcome_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    publication_id UUID NOT NULL REFERENCES publications(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'PROVISIONAL',
    payload JSONB NOT NULL,
    source_artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE RESTRICT,
    resolver_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (publication_id, version)
);

CREATE TABLE evaluation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    publication_id UUID NOT NULL REFERENCES publications(id) ON DELETE RESTRICT,
    outcome_version_id UUID NOT NULL REFERENCES outcome_versions(id) ON DELETE RESTRICT,
    definition_hash CHAR(64) NOT NULL,
    implementation_versions JSONB NOT NULL,
    metrics JSONB NOT NULL,
    baseline_metrics JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Triggers for advisory lock write barrier on all 19 mutable application tables
CREATE TRIGGER trg_barrier_organizations
BEFORE INSERT OR UPDATE OR DELETE ON organizations
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_principals
BEFORE INSERT OR UPDATE OR DELETE ON principals
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_projects
BEFORE INSERT OR UPDATE OR DELETE ON projects
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_contracts
BEFORE INSERT OR UPDATE OR DELETE ON contracts
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_execution_contracts
BEFORE INSERT OR UPDATE OR DELETE ON execution_contracts
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_runs
BEFORE INSERT OR UPDATE OR DELETE ON runs
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_run_attempts
BEFORE INSERT OR UPDATE OR DELETE ON run_attempts
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_executions
BEFORE INSERT OR UPDATE OR DELETE ON executions
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_execution_authorizations
BEFORE INSERT OR UPDATE OR DELETE ON execution_authorizations
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_execution_commands
BEFORE INSERT OR UPDATE OR DELETE ON execution_commands
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_execution_events
BEFORE INSERT OR UPDATE OR DELETE ON execution_events
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_artifacts
BEFORE INSERT OR UPDATE OR DELETE ON artifacts
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_artifact_versions
BEFORE INSERT OR UPDATE OR DELETE ON artifact_versions
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_artifact_edges
BEFORE INSERT OR UPDATE OR DELETE ON artifact_edges
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_execution_inputs
BEFORE INSERT OR UPDATE OR DELETE ON execution_inputs
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_execution_outputs
BEFORE INSERT OR UPDATE OR DELETE ON execution_outputs
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_publications
BEFORE INSERT OR UPDATE OR DELETE ON publications
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_outcome_versions
BEFORE INSERT OR UPDATE OR DELETE ON outcome_versions
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

CREATE TRIGGER trg_barrier_evaluation_runs
BEFORE INSERT OR UPDATE OR DELETE ON evaluation_runs
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

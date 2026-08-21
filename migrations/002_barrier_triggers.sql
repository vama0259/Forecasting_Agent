-- Migration 002: Ensure barrier triggers on all mutable application tables
CREATE OR REPLACE FUNCTION check_backup_write_barrier()
RETURNS trigger AS $$
BEGIN
    PERFORM pg_advisory_lock_shared(42424242);
    PERFORM pg_advisory_unlock_shared(42424242);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_barrier_principals ON principals;
CREATE TRIGGER trg_barrier_principals
BEFORE INSERT OR UPDATE OR DELETE ON principals
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_projects ON projects;
CREATE TRIGGER trg_barrier_projects
BEFORE INSERT OR UPDATE OR DELETE ON projects
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_contracts ON contracts;
CREATE TRIGGER trg_barrier_contracts
BEFORE INSERT OR UPDATE OR DELETE ON contracts
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_execution_contracts ON execution_contracts;
CREATE TRIGGER trg_barrier_execution_contracts
BEFORE INSERT OR UPDATE OR DELETE ON execution_contracts
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_execution_authorizations ON execution_authorizations;
CREATE TRIGGER trg_barrier_execution_authorizations
BEFORE INSERT OR UPDATE OR DELETE ON execution_authorizations
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_execution_commands ON execution_commands;
CREATE TRIGGER trg_barrier_execution_commands
BEFORE INSERT OR UPDATE OR DELETE ON execution_commands
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_execution_events ON execution_events;
CREATE TRIGGER trg_barrier_execution_events
BEFORE INSERT OR UPDATE OR DELETE ON execution_events
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_artifact_edges ON artifact_edges;
CREATE TRIGGER trg_barrier_artifact_edges
BEFORE INSERT OR UPDATE OR DELETE ON artifact_edges
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_execution_inputs ON execution_inputs;
CREATE TRIGGER trg_barrier_execution_inputs
BEFORE INSERT OR UPDATE OR DELETE ON execution_inputs
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

DROP TRIGGER IF EXISTS trg_barrier_execution_outputs ON execution_outputs;
CREATE TRIGGER trg_barrier_execution_outputs
BEFORE INSERT OR UPDATE OR DELETE ON execution_outputs
FOR EACH STATEMENT EXECUTE FUNCTION check_backup_write_barrier();

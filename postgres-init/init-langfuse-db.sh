#!/bin/bash
# Runs automatically on first container start (docker-entrypoint-initdb.d, official postgres
# image pattern) -- creates a second role + database for Langfuse in the same server, isolated
# from the harness's own `harness` role/database by ownership and GRANT, not a second process.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_USER" <<-EOSQL
    CREATE USER langfuse WITH PASSWORD 'langfuse';
    CREATE DATABASE langfuse OWNER langfuse;
    GRANT ALL PRIVILEGES ON DATABASE langfuse TO langfuse;
EOSQL

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS semantic_memory (
  id uuid PRIMARY KEY,
  embedding vector(3),
  content jsonb,
  created_at timestamptz NOT NULL,
  as_of timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_memory_embedding ON semantic_memory USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_semantic_memory_content ON semantic_memory USING gin (content);

CREATE TABLE IF NOT EXISTS agent_memories (
  namespace text[] NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (namespace, key)
);

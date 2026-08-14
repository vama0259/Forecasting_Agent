CREATE TABLE IF NOT EXISTS forecasts (
  id uuid PRIMARY KEY,
  symbol text NOT NULL,
  horizon text NOT NULL,
  prediction jsonb NOT NULL,
  confidence real NOT NULL,
  created_at timestamptz NOT NULL,
  as_of timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forecasts_prediction ON forecasts USING gin (prediction);

CREATE TABLE IF NOT EXISTS debate_traces (
  id uuid PRIMARY KEY,
  forecast_run_id uuid NOT NULL,
  round_number int NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debate_traces_content ON debate_traces USING gin (content);

CREATE TABLE IF NOT EXISTS evaluation_results (
  id uuid PRIMARY KEY,
  forecast_run_id uuid NOT NULL,
  metric_name text NOT NULL,
  metric_value real NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_signals (
  id uuid PRIMARY KEY,
  forecast_run_id uuid NOT NULL,
  agent_name text NOT NULL,
  signal jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  as_of timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_signals_signal ON agent_signals USING gin (signal);

CREATE TABLE IF NOT EXISTS debate_checkpoints (
  id uuid PRIMARY KEY,
  forecast_run_id uuid NOT NULL,
  round_number int NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debate_checkpoints_state ON debate_checkpoints USING gin (state);

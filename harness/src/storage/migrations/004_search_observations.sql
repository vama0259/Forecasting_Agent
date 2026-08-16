CREATE TABLE IF NOT EXISTS search_observations (
  id               uuid PRIMARY KEY,
  forecast_run_id  uuid NOT NULL,
  query            text NOT NULL,
  normalized_query text NOT NULL,
  provider         text NOT NULL,
  result_rank      int  NOT NULL,
  title            text,
  url              text,
  hostname         text,
  allowed          boolean NOT NULL,
  content          text,
  retrieved_at     timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_obs_run   ON search_observations (forecast_run_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_obs_query ON search_observations (normalized_query);

ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS degraded boolean NOT NULL DEFAULT false;

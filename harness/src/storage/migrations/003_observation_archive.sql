CREATE TABLE IF NOT EXISTS observation_archive (
  id uuid PRIMARY KEY,
  source text NOT NULL,
  observed_on date NOT NULL,
  retrieved_at timestamptz NOT NULL,
  uri text,
  sha256 text,
  bytes_len int,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'gap')),
  detail text
);
CREATE UNIQUE INDEX idx_obs_archive_ok  ON observation_archive (source, observed_on, sha256) WHERE status = 'ok';
CREATE UNIQUE INDEX idx_obs_archive_gap ON observation_archive (source, observed_on)          WHERE status = 'gap';
CREATE INDEX idx_obs_archive_lookup ON observation_archive (source, observed_on, retrieved_at DESC);

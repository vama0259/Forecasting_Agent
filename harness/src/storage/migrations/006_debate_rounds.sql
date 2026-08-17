CREATE TABLE IF NOT EXISTS debate_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forecast_id UUID REFERENCES forecasts(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    as_of TIMESTAMPTZ NOT NULL,
    round_number INT NOT NULL CHECK (round_number BETWEEN 1 AND 4),
    agent_name TEXT NOT NULL CHECK (agent_name IN ('price', 'fii', 'dii', 'retail', 'consensus')),
    direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
    probability DOUBLE PRECISION NOT NULL CHECK (probability BETWEEN 0.0 AND 1.0),
    confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    degraded BOOLEAN NOT NULL DEFAULT FALSE,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_debate_rounds_forecast_round_agent UNIQUE (forecast_id, round_number, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_debate_rounds_forecast_id ON debate_rounds(forecast_id);
CREATE INDEX IF NOT EXISTS idx_debate_rounds_symbol_as_of ON debate_rounds(symbol, as_of);

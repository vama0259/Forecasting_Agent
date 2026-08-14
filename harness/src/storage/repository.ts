import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Forecast, DebateTrace, EvalResult, AgentSignal, DebateCheckpoint } from './types.js';

export async function saveForecast(pool: Pool, forecast: Forecast): Promise<void> {
  const asOf = forecast.as_of ?? forecast.asOf;
  if (!asOf) {
    throw new Error('as_of timestamp is required to save a forecast');
  }

  const id = forecast.id ?? randomUUID();
  const createdAt = forecast.created_at ?? forecast.createdAt ?? new Date();
  const prediction =
    typeof forecast.prediction === 'string' ? forecast.prediction : JSON.stringify(forecast.prediction);

  await pool.query(
    `INSERT INTO forecasts (id, symbol, horizon, prediction, confidence, created_at, as_of)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, forecast.symbol, forecast.horizon, prediction, forecast.confidence, createdAt, asOf],
  );
}

export async function saveDebateTrace(pool: Pool, trace: DebateTrace): Promise<void> {
  const id = trace.id ?? randomUUID();
  const forecastRunId = trace.forecast_run_id ?? trace.forecastRunId ?? randomUUID();
  const roundNumber = trace.round_number ?? trace.roundNumber ?? 1;
  const createdAt = trace.created_at ?? trace.createdAt ?? new Date();
  const content = typeof trace.content === 'string' ? trace.content : JSON.stringify(trace.content);

  await pool.query(
    `INSERT INTO debate_traces (id, forecast_run_id, round_number, content, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, forecastRunId, roundNumber, content, createdAt],
  );
}

export async function saveEvalResult(pool: Pool, result: EvalResult): Promise<void> {
  const id = result.id ?? randomUUID();
  const forecastRunId = result.forecast_run_id ?? result.forecastRunId ?? randomUUID();
  const metricName = result.metric_name ?? result.metricName ?? '';
  const metricValue = result.metric_value ?? result.metricValue ?? 0;
  const createdAt = result.created_at ?? result.createdAt ?? new Date();

  await pool.query(
    `INSERT INTO evaluation_results (id, forecast_run_id, metric_name, metric_value, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, forecastRunId, metricName, metricValue, createdAt],
  );
}

export async function saveAgentSignal(pool: Pool, signal: AgentSignal): Promise<void> {
  const asOf = signal.as_of ?? signal.asOf;
  if (!asOf) {
    throw new Error('as_of timestamp is required to save an agent signal');
  }

  const id = signal.id ?? randomUUID();
  const forecastRunId = signal.forecast_run_id ?? signal.forecastRunId ?? randomUUID();
  const agentName = signal.agent_name ?? signal.agentName ?? '';
  const signalData = typeof signal.signal === 'string' ? signal.signal : JSON.stringify(signal.signal);
  const createdAt = signal.created_at ?? signal.createdAt ?? new Date();

  await pool.query(
    `INSERT INTO agent_signals (id, forecast_run_id, agent_name, signal, created_at, as_of)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, forecastRunId, agentName, signalData, createdAt, asOf],
  );
}

export async function saveDebateCheckpoint(pool: Pool, checkpoint: DebateCheckpoint): Promise<void> {
  const id = checkpoint.id ?? randomUUID();
  const forecastRunId = checkpoint.forecast_run_id ?? checkpoint.forecastRunId ?? randomUUID();
  const roundNumber = checkpoint.round_number ?? checkpoint.roundNumber ?? 1;
  const state = typeof checkpoint.state === 'string' ? checkpoint.state : JSON.stringify(checkpoint.state);
  const createdAt = checkpoint.created_at ?? checkpoint.createdAt ?? new Date();

  await pool.query(
    `INSERT INTO debate_checkpoints (id, forecast_run_id, round_number, state, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, forecastRunId, roundNumber, state, createdAt],
  );
}

interface StoredForecastRow {
  id: string;
  symbol: string;
  horizon: string;
  prediction: unknown;
  confidence: number;
  created_at: Date;
  as_of: Date;
}

export async function queryMemory(pool: Pool, asOf: Date): Promise<Forecast[]> {
  const result = await pool.query<StoredForecastRow>(
    `SELECT id, symbol, horizon, prediction, confidence, created_at, as_of
     FROM forecasts
     WHERE as_of <= $1
     ORDER BY as_of ASC`,
    [asOf],
  );

  return result.rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    horizon: row.horizon,
    prediction: row.prediction,
    confidence: row.confidence,
    created_at: row.created_at,
    createdAt: row.created_at,
    as_of: row.as_of,
    asOf: row.as_of,
  }));
}

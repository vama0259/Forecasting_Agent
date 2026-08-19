import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Forecast, SearchObservation, DebateTrace, EvalResult, AgentSignal, DebateCheckpoint } from './types.js';

// Saves a generated forecast record with prediction payload and optional degradation status into storage.
export async function saveForecast(pool: Pool, forecast: Forecast): Promise<void> {
  const asOf = forecast.as_of ?? forecast.asOf;
  if (!asOf) {
    throw new Error('as_of timestamp is required to save a forecast');
  }

  const id = forecast.id ?? randomUUID();
  const createdAt = forecast.created_at ?? forecast.createdAt ?? new Date();
  const prediction =
    typeof forecast.prediction === 'string' ? forecast.prediction : JSON.stringify(forecast.prediction);
  const degraded = forecast.degraded ?? false;

  await pool.query(
    `INSERT INTO forecasts (id, symbol, horizon, prediction, confidence, created_at, as_of, degraded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, forecast.symbol, forecast.horizon, prediction, forecast.confidence, createdAt, asOf, degraded],
  );
}

// Persists a batch of search observation records across allowed and rejected results in a single multi-row query.
export async function saveSearchObservations(pool: Pool, observations: SearchObservation[]): Promise<void> {
  if (observations.length === 0) return;

  const valuePlaceholders: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const obs of observations) {
    const id = obs.id ?? randomUUID();
    const title = obs.title ?? null;
    const url = obs.url ?? null;
    const hostname = obs.hostname ?? null;
    const content = obs.content ?? null;
    const retrievedAt = obs.retrieved_at ?? new Date();

    valuePlaceholders.push(
      `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11})`,
    );
    params.push(
      id,
      obs.forecast_run_id,
      obs.query,
      obs.normalized_query,
      obs.provider,
      obs.result_rank,
      title,
      url,
      hostname,
      obs.allowed,
      content,
      retrievedAt,
    );
    paramIdx += 12;
  }

  const query = `
    INSERT INTO search_observations (
      id, forecast_run_id, query, normalized_query, provider, result_rank,
      title, url, hostname, allowed, content, retrieved_at
    ) VALUES ${valuePlaceholders.join(', ')}
  `;

  await pool.query(query, params);
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

// M8's layer_means is keyed "1"/"2"/"3" (JSON-serialized from Python's Literal[1,2,3] dict keys),
// corresponding to MASE/Brier/Sortino per evaluation/pipeline.py's layer assignment.
const LAYER_METRIC_NAMES: Record<string, string> = { '1': 'mase', '2': 'brier', '3': 'sortino' };

// Takes the sandbox's real EvalResult ({verdict, layers, layer_means}, not a flat metric row) and
// the forecast run it belongs to; inserts one evaluation_results row per available layer mean.
// The whole-object cast previously used here (`saveEvalResult(pool, evalResult as unknown as
// EvalResultRow)`) silently discarded every real MASE/Brier/Sortino value into a single blank
// metric_name='' / metric_value=0 row, since EvalResult has no such flat fields.
export async function saveEvalResults(pool: Pool, forecastRunId: string, evalResult: unknown): Promise<void> {
  const layerMeans = (evalResult as { layer_means?: Record<string, { mean?: number }> } | undefined)?.layer_means;
  if (!layerMeans) return;

  for (const [layerId, name] of Object.entries(LAYER_METRIC_NAMES)) {
    const mean = layerMeans[layerId]?.mean;
    if (typeof mean !== 'number') continue;
    await saveEvalResult(pool, { forecast_run_id: forecastRunId, metric_name: name, metric_value: mean });
  }
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

export interface Forecast {
  id?: string;
  symbol: string;
  horizon: string;
  prediction: unknown;
  confidence: number;
  created_at?: Date;
  createdAt?: Date;
  as_of?: Date;
  asOf?: Date;
  degraded?: boolean;
}

// Observation record storing raw and normalised search results along with allowlist verdict.
export interface SearchObservation {
  id?: string;
  forecast_run_id: string;
  query: string;
  normalized_query: string;
  provider: string;
  result_rank: number;
  title?: string | null;
  url?: string | null;
  hostname?: string | null;
  allowed: boolean;
  content?: string | null;
  retrieved_at: Date;
}

export interface DebateTrace {
  id?: string;
  forecast_run_id?: string;
  forecastRunId?: string;
  round_number?: number;
  roundNumber?: number;
  content: unknown;
  created_at?: Date;
  createdAt?: Date;
}

export interface EvalResult {
  id?: string;
  forecast_run_id?: string;
  forecastRunId?: string;
  metric_name?: string;
  metricName?: string;
  metric_value?: number;
  metricValue?: number;
  created_at?: Date;
  createdAt?: Date;
}

export interface AgentSignal {
  id?: string;
  forecast_run_id?: string;
  forecastRunId?: string;
  agent_name?: string;
  agentName?: string;
  signal: unknown;
  created_at?: Date;
  createdAt?: Date;
  as_of?: Date;
  asOf?: Date;
}

export interface DebateCheckpoint {
  id?: string;
  forecast_run_id?: string;
  forecastRunId?: string;
  round_number?: number;
  roundNumber?: number;
  state: unknown;
  created_at?: Date;
  createdAt?: Date;
}

export interface SemanticMemoryEntry {
  id?: string;
  embedding?: number[];
  content?: unknown;
  created_at?: Date;
  createdAt?: Date;
  as_of?: Date;
  asOf?: Date;
}

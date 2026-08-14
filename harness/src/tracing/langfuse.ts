import { Langfuse, type LangfuseTraceClient } from 'langfuse';
import type { HarnessConfig } from '../config.js';

export function getLangfuseClient(config: HarnessConfig): Langfuse {
  return new Langfuse({
    publicKey: config.tracing.langfuse_public_key,
    secretKey: config.tracing.langfuse_secret_key,
    baseUrl: config.tracing.langfuse_base_url,
  });
}

export function startForecastTrace(client: Langfuse, traceId: string): LangfuseTraceClient {
  return client.trace({ name: 'forecast_run', id: traceId });
}

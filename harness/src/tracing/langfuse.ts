// OpenTelemetry-based Langfuse tracing (ADR-030 v2) via the real current SDK
// (@langfuse/tracing + @langfuse/otel), not the legacy v3 `langfuse` npm client. The legacy
// client only speaks self-hosted v4's dual-write compatibility bridge, and those events land
// with several minutes of propagation lag; native OTLP ingestion has none (per Langfuse's own
// migration docs: "observations appear in the unified table without the legacy ingestion delay").

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  startObservation,
  propagateAttributes,
  type LangfuseSpan,
  type PropagateAttributesParams,
} from '@langfuse/tracing';
import { CallbackHandler } from '@langfuse/langchain';
import { trace, context } from '@opentelemetry/api';
import type { HarnessConfig } from '../config.js';

// Wraps a LangfuseSpan with the chainable forecast_run -> debate_round -> agent_turn -> tool_call
// span-nesting contract the pipeline and its tests depend on.
export class TraceHandle {
  readonly traceId: string;
  private readonly current: LangfuseSpan;

  constructor(current: LangfuseSpan) {
    this.current = current;
    this.traceId = current.traceId;
  }

  // Takes a child span name; returns a new TraceHandle nested under this span via OTel context.
  span({ name }: { name: string }): TraceHandle {
    const parentContext = trace.setSpan(context.active(), this.current.otelSpan);
    const child = context.with(parentContext, () => startObservation(name));
    return new TraceHandle(child);
  }

  // Takes span update attributes; merges them onto the underlying span. input/output belong on
  // the root observation per Langfuse v4+'s data model (trace-level input/output is deprecated).
  update({ metadata, input, output }: { metadata?: Record<string, unknown>; input?: unknown; output?: unknown }): void {
    this.current.update({
      ...(metadata !== undefined && { metadata }),
      ...(input !== undefined && { input }),
      ...(output !== undefined && { output }),
    });
  }

  // Takes nothing; ends the underlying span.
  end(): void {
    this.current.end();
  }

  // Takes a function; runs it with this span active in the OTel context, so anything created
  // inside (including LangChain's CallbackHandler-driven spans) nests underneath it as a child,
  // matching Langfuse's documented LangChain interoperability pattern.
  withActive<T>(fn: () => T): T {
    return context.with(trace.setSpan(context.active(), this.current.otelSpan), fn);
  }

  // Takes trace-level grouping attributes (name/tags/sessionId/metadata) and a function; runs fn
  // with this span active AND those attributes propagated onto it and every span fn creates, so
  // the whole run shows up as one named, taggable, session-scoped trace in the Langfuse UI instead
  // of an unlabeled flat list of observations. Must wrap the entire run, not just part of it --
  // propagateAttributes only reaches spans created after this call, per its own docs.
  runGrouped<T>(attributes: PropagateAttributesParams, fn: () => Promise<T>): Promise<T> {
    return this.withActive(() => propagateAttributes(attributes, fn));
  }
}

let spanProcessor: LangfuseSpanProcessor | undefined;

// Takes the harness config; returns the process-wide Langfuse span processor, registering the
// OTel NodeSDK exactly once regardless of how many pipeline runs call this in one process.
function getSpanProcessor(config: HarnessConfig): LangfuseSpanProcessor {
  if (!spanProcessor) {
    spanProcessor = new LangfuseSpanProcessor({
      publicKey: config.tracing.langfuse_public_key,
      secretKey: config.tracing.langfuse_secret_key,
      baseUrl: config.tracing.langfuse_base_url,
    });
    new NodeSDK({ spanProcessors: [spanProcessor] }).start();
  }
  return spanProcessor;
}

// Takes the harness config, correlation ID (logged, not the Langfuse trace ID -- OTel generates
// that on span creation), and the run's input; starts and returns the root forecast_run span.
export function startForecastTrace(config: HarnessConfig, correlationId: string, input: unknown): TraceHandle {
  getSpanProcessor(config);
  const span = startObservation('forecast_run', { input, metadata: { 'correlation.id': correlationId } });
  return new TraceHandle(span);
}

let callbackHandler: CallbackHandler | undefined;

// Takes the harness config; returns a process-wide LangChain CallbackHandler. Pass it as
// `callbacks: [handler]` in agent.invoke() config to auto-capture every LLM call, tool call, and
// LangGraph step as its own nested observation, instead of only the one manually-created root span.
export function getLangchainCallbackHandler(config: HarnessConfig): CallbackHandler {
  getSpanProcessor(config);
  if (!callbackHandler) {
    callbackHandler = new CallbackHandler();
  }
  return callbackHandler;
}

// Takes the harness config; flushes all pending spans to Langfuse. Call once per pipeline run in
// a finally block -- short-lived CLI runs can exit before any background timer would flush.
// Unlike observation creation (which the SDK guarantees never throws), forceFlush() propagates
// real network errors -- caught and logged here so a Langfuse outage never fails the pipeline.
export async function flushTraces(config: HarnessConfig): Promise<void> {
  try {
    await getSpanProcessor(config).forceFlush();
  } catch (err) {
    console.error('tracing: langfuse flush failed (pipeline result is unaffected):', err);
  }
}

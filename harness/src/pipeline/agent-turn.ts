// Bounded, traced agent invocation shared by every agent turn in the harness -- extracted so
// future multi-agent/multi-round callers (#10 participant agents, #11 debate rounds) invoke one
// agent turn the same bounded+traced+validated way single-agent.ts does, instead of each
// re-deriving the timeout/trace/schema-parse sequence.

import type { TraceHandle } from '../tracing/langfuse.js';

// Bounds a single agent.invoke() call two ways: LangGraph's own recursionLimit caps how many
// reasoning/tool-call steps the agent graph can take, and a wall-clock timeout + AbortSignal
// catches anything that loop-count alone wouldn't (e.g. a stuck retry below the graph level) --
// observed in testing: an invoke ran 300+ consecutive tool calls over 9+ minutes with neither bound in place.
const AGENT_RECURSION_LIMIT = 100;
const AGENT_INVOKE_TIMEOUT_MS = 300_000;

export class AgentInvokeTimeoutError extends Error {}

// Takes a function that performs one agent.invoke() call given a {recursionLimit, signal}
// config, and a run/turn ID for the error message; returns its result or throws
// AgentInvokeTimeoutError, aborting the underlying LangGraph run past the timeout.
async function invokeAgentWithBudget<T>(
  invoke: (config: { recursionLimit: number; signal: AbortSignal }) => Promise<T>,
  turnId: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AGENT_INVOKE_TIMEOUT_MS);
  try {
    return await invoke({ recursionLimit: AGENT_RECURSION_LIMIT, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AgentInvokeTimeoutError(`agent.invoke exceeded ${AGENT_INVOKE_TIMEOUT_MS}ms for turn ${turnId}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Parameters for one bounded, traced, schema-validated agent turn.
export interface InvokeAgentTurnParams<TSignal> {
  // Takes a {recursionLimit, signal} config; performs one agent.invoke() call (the caller closes
  // over `agent`, `messages`, and any callbacks it needs to pass through).
  invoke: (config: { recursionLimit: number; signal: AbortSignal }) => Promise<{ structuredResponse?: unknown }>;
  // Validates and returns the turn's model-enforced structuredResponse. No text parsing -- the
  // agent's responseFormat (LangChain structured output) already forces this shape via a tool call.
  schema: { parse(data: unknown): TSignal };
  trace: TraceHandle;
  turnId: string;
}

// Takes a bound invoke call, its output schema, the active trace, and a turn ID; runs the call
// with the trace active in OTel context (so LangChain's CallbackHandler spans nest under it) and
// the timeout/recursion budget applied, then validates the result. Returns the parsed signal.
export async function invokeAgentTurn<TSignal>({
  invoke,
  schema,
  trace,
  turnId,
}: InvokeAgentTurnParams<TSignal>): Promise<TSignal> {
  const invokeResult = await trace.withActive(() => invokeAgentWithBudget(invoke, turnId));
  return schema.parse(invokeResult.structuredResponse);
}

// Domain types for the multi-agent debate event stream

// Round phase identifier across the 4-round debate protocol
export type Round = "independent" | "debate" | "devils-advocate" | "consensus";

// Identity for participating analytical sub-agents
export type AgentId = "technical" | "sentiment" | "macro";

// Discriminated union representing every event emitted during a debate session
export type DebateEvent =
  | { type: "round-start"; round: Round; roundIndex: 1 | 2 | 3 | 4 }
  | { type: "agent-turn-start"; agent: AgentId; round: Round }
  | { type: "reasoning-token"; agent: AgentId; token: string }
  | { type: "tool-call"; agent: AgentId; tool: string; input: unknown }
  | { type: "tool-result"; agent: AgentId; tool: string; status: "success" | "error"; output: unknown; stdout?: string; stderr?: string }
  | { type: "evidence"; agent: AgentId; source: string; url?: string; snippet: string }
  | { type: "devils-advocate-assigned"; agent: AgentId; targetClaim: string }
  | { type: "consensus"; scenarios: Array<{ label: "bull" | "bear"; probability: number; summary: string }> }
  | { type: "forecast"; horizon: string; actual: number[]; forecast: number[]; confidenceBand: [number, number][] };

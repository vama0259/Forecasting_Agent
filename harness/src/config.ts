// Zod schemas and TypeScript types for harness runtime configuration.

import { z } from 'zod';

export const CapabilitiesSchema = z.object({
  chat: z.string().min(1),
  search: z.string().min(1),
  sentiment: z.string().min(1),
  market_data: z.string().min(1),
});

const StdioMcpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

const HttpMcpServerSchema = z.object({
  transport: z.literal('http'),
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
});

export const McpServerSchema = z.union([HttpMcpServerSchema, StdioMcpServerSchema]);

export const HarnessConfigSchema = z.object({
  llm: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    api_key: z.string().min(1),
  }),
  mcp_servers: z.record(z.string(), McpServerSchema).default({}),
  capabilities: CapabilitiesSchema,
  storage: z.object({
    connection_string: z.string().min(1),
  }),
  tracing: z.object({
    langfuse_public_key: z.string().min(1),
    langfuse_secret_key: z.string().min(1),
    langfuse_base_url: z.string().min(1),
    // Groups multiple forecast_run traces (e.g. every symbol in one baseline sweep) into one
    // Langfuse Session. Left unset for a single ad-hoc run -- each trace stays ungrouped.
    langfuse_session_id: z.string().min(1).optional(),
  }),
  redis: z.object({
    url: z.string().min(1),
  }),
  search: z.object({
    initial_run_budget: z.number().int().positive().default(20),
    daily_cap: z.number().int().positive().default(2000),
    run_ttl_seconds: z.number().int().positive().default(21600),
    provider_timeout_ms: z.number().int().positive().default(15000),
    max_results: z.number().int().min(1).max(10).default(10),
    allowed_domains: z.array(z.string().min(1)).min(1),
  }),
  sandbox: z.record(z.string(), z.unknown()).default({}),
  eval: z.record(z.string(), z.unknown()).default({}),
});

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
export type CapabilityName = keyof z.infer<typeof CapabilitiesSchema>;
export const LLM_TARGET = 'llm';

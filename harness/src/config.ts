import { z } from 'zod';

export const CapabilitiesSchema = z.object({
  chat: z.string().min(1),
  search: z.string().min(1),
  sentiment: z.string().min(1),
  market_data: z.string().min(1),
});

export const McpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

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
  }),
  sandbox: z.record(z.string(), z.unknown()).default({}),
  eval: z.record(z.string(), z.unknown()).default({}),
});

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;
export type CapabilityName = keyof z.infer<typeof CapabilitiesSchema>;
export const LLM_TARGET = 'llm';

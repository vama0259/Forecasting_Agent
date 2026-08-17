import { z } from 'zod';

export const ParticipantAgentConfigSchema = z.object({
  name: z.enum(['price', 'fii', 'dii', 'retail']),
  roleTitle: z.string(),
  description: z.string(),
  promptTemplate: z.string(),
  allowedCapabilities: z.array(z.string()),
  dataLaneDescription: z.string(),
  workspaceSubpath: z.string(),
  allowedWritePaths: z.array(z.string()),
  tools: z.array(z.string()),
  skills: z.array(z.string()).default([]),
  maxTokenBudget: z.number().int().positive().default(200_000),
  horizon_days: z.literal(1),
  generatedBy: z.enum(['human', 'agent']).default('human'),
});

export type ParticipantAgentConfig = z.infer<typeof ParticipantAgentConfigSchema>;

export const AGENT_CONFIGS: ParticipantAgentConfig[] = [
  {
    name: 'price',
    roleTitle: 'Price Action & Macro Anchor',
    description: 'Analyzes target OHLCV, momentum indicators, moving averages, and sovereign macro drivers.',
    promptTemplate: 'price.j2',
    allowedCapabilities: ['market_data', 'macro'],
    dataLaneDescription: 'OHLCV bars + technical indicators + macro drivers (USDINR, Brent, US10Y)',
    workspaceSubpath: 'price',
    allowedWritePaths: [
      '/workspace/code/features/price/**',
      '/workspace/bars.json',
      '/workspace/model.py',
      '/memories/**',
    ],
    tools: ['fetch_ohlcv'],
    skills: [],
    maxTokenBudget: 200_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
];

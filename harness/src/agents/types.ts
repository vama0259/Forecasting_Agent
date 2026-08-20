import { z } from 'zod';
import { CapabilitySchema } from './schema.js';

export const ParticipantAgentConfigSchema = z.object({
  name: z.enum(['price', 'fii', 'dii', 'retail']),
  roleTitle: z.string(),
  description: z.string(),
  promptTemplate: z.string(),
  allowedCapabilities: z.array(CapabilitySchema),
  // The capability that makes this agent's role distinct (flows for fii/dii, microstructure for
  // retail, market_data for price) -- explicit_absence on THIS capability's evidence forces
  // degraded=true, since without it the agent is just re-deriving a price opinion under its label.
  primaryCapability: CapabilitySchema,
  dataLaneDescription: z.string(),
  workspaceSubpath: z.string(),
  allowedWritePaths: z.array(z.string()),
  tools: z.array(z.string()),
  skills: z.array(z.string()).default([]),
  maxTokenBudget: z.number().int().positive().default(3_000_000),
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
    primaryCapability: 'market_data',
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
    maxTokenBudget: 3_000_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
  {
    name: 'fii',
    roleTitle: 'Foreign Institutional Investor (FII) Intent',
    description:
      'Analyzes foreign institutional positioning, Index Futures Long/Short ratios, and cross-border risk-off momentum.',
    promptTemplate: 'fii.j2',
    allowedCapabilities: ['market_data', 'flows', 'macro'],
    primaryCapability: 'flows',
    dataLaneDescription: 'Participant-wise F&O open interest (FII Long/Short ratios) + market-wide flows + OHLCV',
    workspaceSubpath: 'fii',
    allowedWritePaths: [
      '/workspace/code/features/fii/**',
      '/workspace/flows.json',
      '/workspace/bars.json',
      '/memories/**',
    ],
    tools: ['fetch_flows', 'fetch_ohlcv', 'search_news', 'score_sentiment'],
    skills: [],
    maxTokenBudget: 3_000_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
  {
    name: 'dii',
    roleTitle: 'Domestic Institutional Investor (DII) Intent',
    description:
      'Analyzes domestic mutual fund absorption, SIP structural liquidity support, and counter-cyclical accumulation.',
    promptTemplate: 'dii.j2',
    allowedCapabilities: ['market_data', 'flows', 'macro'],
    primaryCapability: 'flows',
    dataLaneDescription:
      'Participant-wise F&O open interest (DII Long/Short ratios) + domestic cash flow resilience + OHLCV',
    workspaceSubpath: 'dii',
    allowedWritePaths: [
      '/workspace/code/features/dii/**',
      '/workspace/flows.json',
      '/workspace/bars.json',
      '/memories/**',
    ],
    tools: ['fetch_flows', 'fetch_ohlcv', 'search_news', 'score_sentiment'],
    skills: [],
    maxTokenBudget: 3_000_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
  {
    name: 'retail',
    roleTitle: 'Retail & Microstructure Intent',
    description:
      'Analyzes security-wise Bhavcopy delivery percentages, option chain Put-Call ratios (PCR), and retail sentiment froth.',
    promptTemplate: 'retail.j2',
    allowedCapabilities: ['market_data', 'microstructure', 'sentiment'],
    primaryCapability: 'microstructure',
    dataLaneDescription: 'Security delivery % + Bulk/Block deals + Option Chain Strike OI + OHLCV',
    workspaceSubpath: 'retail',
    allowedWritePaths: [
      '/workspace/code/features/retail/**',
      '/workspace/microstructure.json',
      '/workspace/option_chain.json',
      '/workspace/bars.json',
      '/memories/**',
    ],
    tools: ['fetch_microstructure', 'fetch_option_chain', 'fetch_ohlcv', 'search_news', 'score_sentiment'],
    skills: [],
    maxTokenBudget: 3_000_000,
    horizon_days: 1,
    generatedBy: 'human',
  },
];

import nunjucks from 'nunjucks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ParticipantAgentConfig } from '../agents/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = join(__dirname, '../../prompts');

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(PROMPTS_DIR), {
  autoescape: false,
  trimBlocks: true,
  lstripBlocks: true,
});

env.addFilter('safe_str', (val: unknown) => {
  if (val === null || val === undefined) return 'N/A';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
});

env.addFilter('safe_upper', (val: unknown) => {
  if (val === null || val === undefined) return '';
  return String(val).toUpperCase();
});

export interface PromptContext {
  symbol: string;
  as_of: string;
  horizon_days?: number;
  start_date?: string;
  [key: string]: unknown;
}

export function renderPrompt(config: ParticipantAgentConfig, context: PromptContext): string {
  const start_date =
    context.start_date ||
    new Date(new Date(context.as_of).getTime() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return env.render(config.promptTemplate, {
    horizon_days: context.horizon_days ?? config.horizon_days,
    ...context,
    start_date,
    agent_name: config.name,
    role_title: config.roleTitle,
    data_lane_description: config.dataLaneDescription,
    workspace_path: `/workspace/code/features/${config.workspaceSubpath}/`,
  });
}

import type { AgentSignal } from '../agents/schema.js';
import type { Round2Signal } from '../debate/types.js';

export interface Round2PromptParams {
  config: ParticipantAgentConfig;
  symbol: string;
  as_of: string;
  round1_signal: AgentSignal;
  peer_signals: Record<string, AgentSignal>;
}

export function renderRound2Prompt(params: Round2PromptParams): string {
  return env.render('debate/round2_critique.j2', {
    config: params.config,
    symbol: params.symbol,
    as_of: params.as_of,
    round1_signal: params.round1_signal,
    peer_signals: params.peer_signals,
  });
}

export interface Round3PromptParams {
  config: ParticipantAgentConfig;
  symbol: string;
  as_of: string;
  majority_direction: 'up' | 'down';
  avg_p_up: number;
  peer_r2_signals: Record<string, Round2Signal>;
  is_devils_advocate: boolean;
}

export function renderRound3Prompt(params: Round3PromptParams): string {
  return env.render('debate/round3_devils_advocate.j2', {
    config: params.config,
    symbol: params.symbol,
    as_of: params.as_of,
    majority_direction: params.majority_direction,
    avg_p_up: params.avg_p_up,
    peer_r2_signals: params.peer_r2_signals,
    is_devils_advocate: params.is_devils_advocate,
  });
}

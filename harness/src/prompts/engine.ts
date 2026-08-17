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

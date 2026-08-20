// Schema definitions and TypeScript interfaces for the M11 Skill System.

import { z } from 'zod';

export const SkillManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().min(10),
  version: z.string().default('1.0.0'),
  available_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target_agents: z.array(z.enum(['price', 'fii', 'dii', 'retail', 'all'])).default([]),
  tags: z.array(z.string()).default([]),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export interface SkillPackage {
  manifest: SkillManifest;
  instructions: string;
  scriptPath?: string | undefined;
  examples: string[];
  moduleName: string;
  lintWarnings: string[];
  contentHash: string;
  directory?: string | undefined;
}

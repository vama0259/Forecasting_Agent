// Formats and injects resolved participant skills into prompt contexts with sorting and token bounds.

import type { SkillPackage } from './types.js';

export interface RenderSkillsResult {
  block: string;
  dropped: string[];
}

// Renders an individual skill package into an XML block structure.
function renderSingleSkill(pkg: SkillPackage): string {
  const lines: string[] = [
    `  <skill name="${pkg.manifest.name}" version="${pkg.manifest.version}">`,
    `    <description>${pkg.manifest.description}</description>`,
    `    <instructions>`,
    pkg.instructions,
    `    </instructions>`,
  ];

  if (pkg.examples && pkg.examples.length > 0) {
    lines.push('    <examples>');
    for (const ex of pkg.examples) {
      lines.push(`      <example>${ex}</example>`);
    }
    lines.push('    </examples>');
  }

  if (pkg.scriptPath) {
    lines.push(`    <python_module>skills.${pkg.moduleName}</python_module>`);
  }

  lines.push('  </skill>');
  return lines.join('\n');
}

// Renders a sorted, character-budgeted <skills> XML block from resolved skill packages.
export function renderSkillsBlock(skills: SkillPackage[], maxTokens = 1500): RenderSkillsResult {
  if (!skills || skills.length === 0) {
    return { block: '', dropped: [] };
  }

  const maxChars = maxTokens * 4;
  const sorted = [...skills].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

  const acceptedEntries: string[] = [];
  const dropped: string[] = [];

  for (const pkg of sorted) {
    const entry = renderSingleSkill(pkg);
    const separatorLen = acceptedEntries.length > 0 ? 1 : 0;
    const currentInnerLen =
      acceptedEntries.reduce((acc, curr) => acc + curr.length, 0) +
      (acceptedEntries.length > 1 ? acceptedEntries.length - 1 : 0);
    const projectedLength = '<skills>\n'.length + currentInnerLen + separatorLen + entry.length + '\n</skills>'.length;

    if (projectedLength <= maxChars) {
      acceptedEntries.push(entry);
    } else {
      dropped.push(pkg.manifest.name);
      console.warn(
        `[SkillInjector] Skill '${pkg.manifest.name}' dropped due to token/char budget limit (${maxTokens} tokens / ${maxChars} chars)`,
      );
    }
  }

  if (acceptedEntries.length === 0) {
    return { block: '', dropped };
  }

  return {
    block: `<skills>\n${acceptedEntries.join('\n')}\n</skills>`,
    dropped,
  };
}

export class SkillInjector {
  // Renders a sorted, budget-capped XML skills block from an array of skill packages.
  static renderSkillsBlock(skills: SkillPackage[], maxTokens = 1500): RenderSkillsResult {
    return renderSkillsBlock(skills, maxTokens);
  }

  // Instance method delegation for renderSkillsBlock.
  renderSkillsBlock(skills: SkillPackage[], maxTokens = 1500): RenderSkillsResult {
    return renderSkillsBlock(skills, maxTokens);
  }

  // Injects the rendered skills block into a template context dictionary.
  static injectIntoContext(
    context: Record<string, unknown>,
    skills: SkillPackage[],
    maxTokens = 1500,
  ): Record<string, unknown> {
    const { block } = renderSkillsBlock(skills, maxTokens);
    return {
      ...context,
      skills_block: block,
    };
  }

  // Instance method delegation for injectIntoContext.
  injectIntoContext(
    context: Record<string, unknown>,
    skills: SkillPackage[],
    maxTokens = 1500,
  ): Record<string, unknown> {
    return SkillInjector.injectIntoContext(context, skills, maxTokens);
  }
}

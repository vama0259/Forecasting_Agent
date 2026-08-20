// Local filesystem scanner, manifest validator, point-in-time filter, and sandbox synchronizer.

import { createHash } from 'node:crypto';
import { readdir, readFile, copyFile, mkdir, access, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { SkillManifestSchema, type SkillPackage } from './types.js';
import type { ParticipantAgentConfig } from '../agents/types.js';

// Parses SKILL.md content into frontmatter object and instructions body string.
export function parseSkillMarkdown(content: string): { frontmatter: Record<string, unknown>; instructions: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  const rawGroup = match?.[1];
  const bodyGroup = match?.[2];
  if (!match || rawGroup === undefined || bodyGroup === undefined) {
    throw new Error('Invalid SKILL.md: missing or malformed YAML frontmatter delimiters (---)');
  }
  const rawYaml = rawGroup.trim();
  const instructions = bodyGroup.trim();
  const parsed = (parseYaml(rawYaml) as Record<string, unknown>) ?? {};
  return { frontmatter: parsed, instructions };
}

export class SkillRegistry {
  private readonly cache = new Map<string, SkillPackage[]>();

  // Discovers and parses skill packages filtered by point-in-time as_of date.
  async discover(asOf: string, skillsDir?: string): Promise<SkillPackage[]> {
    const dir = skillsDir ? resolve(skillsDir) : resolve(process.cwd(), 'skills');
    const cacheKey = `${dir}::${asOf}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache.set(cacheKey, []);
        return [];
      }
      throw err;
    }

    const packages: SkillPackage[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillDirPath = join(dir, entry.name);
      const skillMdPath = join(skillDirPath, 'SKILL.md');

      let skillMdContent: string;
      try {
        skillMdContent = await readFile(skillMdPath, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw err;
      }

      const { frontmatter, instructions } = parseSkillMarkdown(skillMdContent);
      const manifest = SkillManifestSchema.parse(frontmatter);

      const scriptPathCandidate = join(skillDirPath, 'script.py');
      let scriptPath: string | undefined;
      let scriptContent: string | undefined;
      try {
        scriptContent = await readFile(scriptPathCandidate, 'utf-8');
        scriptPath = scriptPathCandidate;
      } catch {
        // script.py is optional
      }

      const examples: string[] = [];
      const examplesDirPath = join(skillDirPath, 'examples');
      try {
        const exampleEntries = await readdir(examplesDirPath, { withFileTypes: true });
        for (const ex of exampleEntries) {
          if (ex.isFile()) {
            examples.push(join(examplesDirPath, ex.name));
          }
        }
      } catch {
        // examples directory is optional
      }

      const hasher = createHash('sha256');
      hasher.update(skillMdContent);
      if (scriptContent !== undefined) {
        hasher.update(scriptContent);
      }
      const contentHash = hasher.digest('hex');
      const moduleName = manifest.name.replaceAll('-', '_');

      const pkg: SkillPackage = {
        manifest,
        instructions,
        scriptPath,
        examples,
        moduleName,
        lintWarnings: [],
        contentHash,
        directory: skillDirPath,
      };

      if (manifest.available_from > asOf) {
        console.warn(
          `[SkillRegistry] Skill '${manifest.name}' excluded by as_of gate (${manifest.available_from} > ${asOf})`,
        );
        continue;
      }

      packages.push(pkg);
    }

    this.cache.set(cacheKey, packages);
    return packages;
  }

  // Returns a skill package matching the requested name if available on as_of, or null.
  async getSkill(name: string, asOf: string, skillsDir?: string): Promise<SkillPackage | null> {
    const skills = await this.discover(asOf, skillsDir);
    return skills.find((s) => s.manifest.name === name) ?? null;
  }

  // Resolves skills configured for a participant agent, skipping missing, archived, or filtered skills.
  async resolveForAgent(config: ParticipantAgentConfig, asOf: string, skillsDir?: string): Promise<SkillPackage[]> {
    const available = await this.discover(asOf, skillsDir);
    const resolved: SkillPackage[] = [];

    for (const name of config.skills ?? []) {
      const pkg = available.find((s) => s.manifest.name === name);
      if (!pkg) {
        console.warn(
          `[SkillRegistry] Agent '${config.name}' requested skill '${name}' which was not found or excluded by as_of '${asOf}'`,
        );
        continue;
      }
      if (pkg.manifest.status === 'archived') {
        console.warn(
          `[SkillRegistry] Agent '${config.name}' requested skill '${name}' which is archived and excluded from injection`,
        );
        continue;
      }
      resolved.push(pkg);
    }

    return resolved;
  }

  // Synchronizes Tier-2 Python scripts into the sandbox workspace skills directory with __init__.py.
  async syncToSandbox(skills: SkillPackage[], workspacePath: string): Promise<string[]> {
    const targetSkillsDir = join(workspacePath, 'skills');
    await mkdir(targetSkillsDir, { recursive: true });

    const initPyPath = join(targetSkillsDir, '__init__.py');
    try {
      await access(initPyPath);
    } catch {
      await writeFile(initPyPath, '# generated by SkillRegistry\n', 'utf-8');
    }

    const written: string[] = [];
    for (const pkg of skills) {
      if (pkg.scriptPath) {
        const destPath = join(targetSkillsDir, `${pkg.moduleName}.py`);
        await copyFile(pkg.scriptPath, destPath);
        written.push(destPath);
      }
    }

    return written;
  }
}

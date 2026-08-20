// Remote skill downloader, keyword/semantic search ranker, and Python script security sanitizer.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir, readFile, copyFile, mkdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { SkillManifestSchema, type SkillPackage } from './types.js';
import { parseSkillMarkdown } from './registry.js';

const execFileAsync = promisify(execFile);

// Dangerous Python primitives blocked/linted by the security sanitizer.
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  {
    pattern: /\bos\s*\.\s*(?:system|popen|exec[a-z]*|spawn[a-z]*|kill|remove|unlink)\b/,
    name: 'os.system / process execution',
  },
  { pattern: /\b(?:import\s+subprocess|from\s+subprocess\s+import|subprocess\s*\.)/, name: 'subprocess' },
  { pattern: /\b(?:import\s+socket|from\s+socket\s+import|socket\s*\.)/, name: 'socket' },
  { pattern: /\b(?:import\s+pty|from\s+pty\s+import|pty\s*\.)/, name: 'pty' },
  { pattern: /\b(?:import\s+ctypes|from\s+ctypes\s+import|ctypes\s*\.)/, name: 'ctypes' },
  { pattern: /\b(?:shutil\s*\.\s*rmtree|from\s+shutil\s+import[^\n]*\brmtree\b|\brmtree\s*\()/, name: 'rmtree' },
  { pattern: /\b__import__\s*\(/, name: '__import__' },
  { pattern: /\beval\s*\(/, name: 'eval' },
  { pattern: /\bexec\s*\(/, name: 'exec' },
  { pattern: /\bcompile\s*\([^)]*,\s*['"]exec['"]/, name: 'compile (exec)' },
];

export class SkillDownloader {
  // Searches local skills scoring title, tag, description, target agents, and instructions.
  search(query: string, availableSkills: SkillPackage[]): SkillPackage[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return [...availableSkills];
    }

    const tokens = trimmed.split(/[\s,._-]+/).filter(Boolean);
    if (tokens.length === 0) {
      return [...availableSkills];
    }

    const scored: Array<{ skill: SkillPackage; score: number }> = [];

    for (const skill of availableSkills) {
      let score = 0;
      const name = skill.manifest.name.toLowerCase();
      const nameTokens = name.split(/[\s,._-]+/).filter(Boolean);
      const tags = (skill.manifest.tags ?? []).map((t) => t.toLowerCase());
      const description = skill.manifest.description.toLowerCase();
      const targetAgents = (skill.manifest.target_agents ?? []).map((a) => a.toLowerCase());
      const instructions = skill.instructions.toLowerCase();

      // Exact or substring name match
      if (name === trimmed) {
        score += 50;
      } else if (name.includes(trimmed)) {
        score += 20;
      }

      for (const token of tokens) {
        if (nameTokens.includes(token)) {
          score += 15;
        } else if (name.includes(token)) {
          score += 8;
        }

        for (const tag of tags) {
          if (tag === token) {
            score += 10;
          } else if (tag.includes(token)) {
            score += 5;
          }
        }

        if (targetAgents.includes(token)) {
          score += 6;
        }

        if (description.includes(token)) {
          score += 4;
        }

        if (instructions.includes(token)) {
          score += 1;
        }
      }

      if (score > 0) {
        scored.push({ skill, score });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.skill.manifest.name.localeCompare(b.skill.manifest.name);
    });

    return scored.map((item) => item.skill);
  }

  // Alias for searchLocal.
  searchLocal(query: string, available: SkillPackage[]): SkillPackage[] {
    return this.search(query, available);
  }

  // Inspects Python script content for dangerous primitives and returns safety status.
  sanitizeScript(content: string): { safe: boolean; reason?: string } {
    for (const { pattern, name } of DANGEROUS_PATTERNS) {
      if (pattern.test(content)) {
        return {
          safe: false,
          reason: `Dangerous primitive detected: ${name}`,
        };
      }
    }
    return { safe: true };
  }

  // Fetches a skill package from a git repository, sanitizes, and installs into target directory.
  async downloadFromGit(gitUrl: string, skillSubpath: string, targetSkillsDir: string): Promise<SkillPackage> {
    const cloneDir = await mkdtemp(join(tmpdir(), 'skill-git-'));
    try {
      try {
        await execFileAsync('git', ['clone', '--depth', '1', gitUrl, cloneDir]);
      } catch (err: unknown) {
        throw new Error(`Failed to clone git repository from '${gitUrl}': ${(err as Error).message}`);
      }

      const resolvedCloneDir = resolve(cloneDir);
      const sourceDir = resolve(cloneDir, skillSubpath || '.');
      const relToClone = relative(resolvedCloneDir, sourceDir);

      if (relToClone.startsWith('..') || resolve(sourceDir) !== sourceDir || !sourceDir.startsWith(resolvedCloneDir)) {
        throw new Error(`Security violation: skillSubpath '${skillSubpath}' escapes repository root`);
      }

      // Hard limits and checks on host filesystem unpack
      const MAX_FILES = 50;
      const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB

      let totalFiles = 0;
      let totalBytes = 0;

      // Recursive scan of sourceDir checking for symlinks, file counts, and sizes
      const scanDir = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.git') {
            continue;
          }
          const fullPath = join(dir, entry.name);
          const lstatInfo = await lstat(fullPath);

          if (lstatInfo.isSymbolicLink()) {
            throw new Error(`Security violation: symlinks are not allowed in skill packages (${entry.name})`);
          }

          if (lstatInfo.isDirectory()) {
            await scanDir(fullPath);
          } else if (lstatInfo.isFile()) {
            totalFiles += 1;
            totalBytes += lstatInfo.size;

            if (totalFiles > MAX_FILES) {
              throw new Error(
                `Security violation: skill package exceeds maximum file count limit (${MAX_FILES} files)`,
              );
            }
            if (totalBytes > MAX_TOTAL_BYTES) {
              throw new Error('Security violation: skill package exceeds maximum size limit (5 MB)');
            }
          } else {
            throw new Error(`Security violation: non-regular file detected in skill package (${entry.name})`);
          }
        }
      };

      await scanDir(sourceDir);

      // Verify SKILL.md
      const skillMdPath = join(sourceDir, 'SKILL.md');
      let skillMdContent: string;
      try {
        skillMdContent = await readFile(skillMdPath, 'utf-8');
      } catch {
        throw new Error(`Invalid skill package: missing SKILL.md in '${skillSubpath || '.'}'`);
      }

      const { frontmatter, instructions } = parseSkillMarkdown(skillMdContent);
      const manifest = SkillManifestSchema.parse(frontmatter);

      // Verify target destination path
      const resolvedTargetSkillsDir = resolve(targetSkillsDir);
      const destDir = resolve(resolvedTargetSkillsDir, manifest.name);
      if (!destDir.startsWith(resolvedTargetSkillsDir)) {
        throw new Error(`Security violation: skill name '${manifest.name}' results in invalid destination path`);
      }

      // Check script.py if present
      const scriptCandidate = join(sourceDir, 'script.py');
      let scriptContent: string | undefined;
      const lintWarnings: string[] = [];
      try {
        scriptContent = await readFile(scriptCandidate, 'utf-8');
        const sanitization = this.sanitizeScript(scriptContent);
        if (!sanitization.safe && sanitization.reason) {
          lintWarnings.push(sanitization.reason);
        }
      } catch {
        // script.py optional
      }

      // Copy directory contents to destination
      await rm(destDir, { recursive: true, force: true });
      await mkdir(destDir, { recursive: true });

      const copyRecursive = async (src: string, dst: string): Promise<void> => {
        const entries = await readdir(src, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === '.git') {
            continue;
          }
          const srcPath = join(src, entry.name);
          const dstPath = join(dst, entry.name);
          if (entry.isDirectory()) {
            await mkdir(dstPath, { recursive: true });
            await copyRecursive(srcPath, dstPath);
          } else if (entry.isFile()) {
            await copyFile(srcPath, dstPath);
          }
        }
      };

      await copyRecursive(sourceDir, destDir);

      // Collect examples from destDir/examples
      const examples: string[] = [];
      const examplesDir = join(destDir, 'examples');
      try {
        const exampleEntries = await readdir(examplesDir, { withFileTypes: true });
        for (const ex of exampleEntries) {
          if (ex.isFile()) {
            examples.push(join(examplesDir, ex.name));
          }
        }
      } catch {
        // examples optional
      }

      // Compute contentHash
      const hasher = createHash('sha256');
      hasher.update(skillMdContent);
      if (scriptContent !== undefined) {
        hasher.update(scriptContent);
      }
      const contentHash = hasher.digest('hex');
      const moduleName = manifest.name.replaceAll('-', '_');
      const scriptPath = scriptContent !== undefined ? join(destDir, 'script.py') : undefined;

      const pkg: SkillPackage = {
        manifest,
        instructions,
        scriptPath,
        examples,
        moduleName,
        lintWarnings,
        contentHash,
        directory: destDir,
      };

      return pkg;
    } finally {
      await rm(cloneDir, { recursive: true, force: true });
    }
  }

  // Delegates general download source to downloadFromGit.
  async download(source: string, targetDir: string, skillSubpath = ''): Promise<SkillPackage> {
    return this.downloadFromGit(source, skillSubpath, targetDir);
  }
}

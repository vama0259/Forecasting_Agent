// Unit tests for SkillRegistry local discovery, point-in-time as_of filtering, and sandbox sync.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillRegistry } from '../../src/skills/registry.js';
import { AGENT_CONFIGS, type ParticipantAgentConfig } from '../../src/agents/types.js';

// Helper to format YAML frontmatter with body markdown.
function fm(
  fields: Record<string, unknown>,
  body = 'Detailed instructions describing how the skill should be applied.',
): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---', body);
  return lines.join('\n');
}

// Helper to create a temporary directory tree with specified files.
async function createFixtureDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'skill-test-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath);
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }
  return dir;
}

describe('SkillRegistry local discovery & point-in-time filtering', () => {
  const cleanupDirs: string[] = [];

  const createDir = async (files: Record<string, string>): Promise<string> => {
    const d = await createFixtureDir(files);
    cleanupDirs.push(d);
    return d;
  };

  afterEach(async () => {
    for (const d of cleanupDirs) {
      await rm(d, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  it('excludes skills whose available_from is after as_of', async () => {
    const dir = await createDir({
      'past-skill/SKILL.md': fm({
        name: 'past-skill',
        description: 'Valid skill description',
        available_from: '2026-01-01',
      }),
      'future-skill/SKILL.md': fm({
        name: 'future-skill',
        description: 'Valid skill description',
        available_from: '2026-12-31',
      }),
    });
    const names = (await new SkillRegistry().discover('2026-06-01', dir)).map((s) => s.manifest.name);
    expect(names).toEqual(['past-skill']);
    expect(names).not.toContain('future-skill');
  });

  it('includes skills whose available_from is on or before as_of', async () => {
    const dir = await createDir({
      'exact-skill/SKILL.md': fm({
        name: 'exact-skill',
        description: 'Valid skill description',
        available_from: '2026-06-01',
      }),
      'earlier-skill/SKILL.md': fm({
        name: 'earlier-skill',
        description: 'Valid skill description',
        available_from: '2026-05-30',
      }),
    });
    const names = (await new SkillRegistry().discover('2026-06-01', dir)).map((s) => s.manifest.name);
    expect(names).toContain('exact-skill');
    expect(names).toContain('earlier-skill');
  });

  it('defaults status to draft, never active', async () => {
    const dir = await createDir({
      'draft-test/SKILL.md': fm({
        name: 'draft-test',
        description: 'Valid skill description',
        available_from: '2026-01-01',
      }),
    });
    const [pkg] = await new SkillRegistry().discover('2026-06-01', dir);
    expect(pkg).toBeDefined();
    expect(pkg?.manifest.status).toBe('draft');
  });

  it('populates examples array when examples subfolder exists', async () => {
    const dir = await createDir({
      'with-examples/SKILL.md': fm({
        name: 'with-examples',
        description: 'Valid skill description',
        available_from: '2026-01-01',
      }),
      'with-examples/examples/ex1.md': 'Example 1 content',
      'with-examples/examples/ex2.md': 'Example 2 content',
    });
    const [pkg] = await new SkillRegistry().discover('2026-06-01', dir);
    expect(pkg).toBeDefined();
    expect(pkg?.examples).toHaveLength(2);
    expect(pkg?.examples.some((e) => e.includes('ex1.md'))).toBe(true);
  });

  it('computes contentHash over SKILL.md and optional script.py', async () => {
    const dir = await createDir({
      'pure-prompt/SKILL.md': fm({
        name: 'pure-prompt',
        description: 'Valid skill description',
        available_from: '2026-01-01',
      }),
      'with-script/SKILL.md': fm({
        name: 'with-script',
        description: 'Valid skill description',
        available_from: '2026-01-01',
      }),
      'with-script/script.py': 'def calculate(): return 42\n',
    });
    const registry = new SkillRegistry();
    const promptPkg = await registry.getSkill('pure-prompt', '2026-06-01', dir);
    const scriptPkg = await registry.getSkill('with-script', '2026-06-01', dir);

    expect(promptPkg?.contentHash).toHaveLength(64);
    expect(scriptPkg?.contentHash).toHaveLength(64);
    expect(promptPkg?.contentHash).not.toEqual(scriptPkg?.contentHash);
    expect(scriptPkg?.scriptPath).toBeDefined();
    expect(promptPkg?.scriptPath).toBeUndefined();
  });

  it('caches discovered skills per directory and asOf', async () => {
    const dir = await createDir({
      'cached-skill/SKILL.md': fm({
        name: 'cached-skill',
        description: 'Valid skill description',
        available_from: '2026-01-01',
      }),
    });
    const registry = new SkillRegistry();
    const first = await registry.discover('2026-06-01', dir);
    await writeFile(join(dir, 'cached-skill', 'SKILL.md'), 'corrupted content');
    const second = await registry.discover('2026-06-01', dir);
    expect(first).toBe(second);
  });

  it('rejects invalid SKILL.md missing frontmatter delimiters', async () => {
    const dir = await createDir({
      'bad-skill/SKILL.md': 'No frontmatter delimiters here at all',
    });
    await expect(new SkillRegistry().discover('2026-06-01', dir)).rejects.toThrow(/frontmatter/i);
  });

  it('rejects schema errors on invalid fields', async () => {
    const dir = await createDir({
      'bad-desc/SKILL.md': fm({ name: 'bad-desc', description: 'short', available_from: '2026-01-01' }),
    });
    await expect(new SkillRegistry().discover('2026-06-01', dir)).rejects.toThrow();
  });

  it('rejects invalid available_from format', async () => {
    const dir = await createDir({
      'bad-date/SKILL.md': fm({
        name: 'bad-date',
        description: 'Valid skill description',
        available_from: '01-01-2026',
      }),
    });
    await expect(new SkillRegistry().discover('2026-06-01', dir)).rejects.toThrow();
  });
});

describe('SkillRegistry getSkill & resolveForAgent', () => {
  const cleanupDirs: string[] = [];

  const createDir = async (files: Record<string, string>): Promise<string> => {
    const d = await createFixtureDir(files);
    cleanupDirs.push(d);
    return d;
  };

  afterEach(async () => {
    for (const d of cleanupDirs) {
      await rm(d, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  it('getSkill returns skill by name or null if missing or filtered', async () => {
    const dir = await createDir({
      'find-me/SKILL.md': fm({ name: 'find-me', description: 'Valid skill description', available_from: '2026-01-01' }),
      'future-me/SKILL.md': fm({
        name: 'future-me',
        description: 'Valid skill description',
        available_from: '2026-12-31',
      }),
    });
    const registry = new SkillRegistry();
    const found = await registry.getSkill('find-me', '2026-06-01', dir);
    expect(found?.manifest.name).toBe('find-me');

    const notFound = await registry.getSkill('non-existent', '2026-06-01', dir);
    expect(notFound).toBeNull();

    const filtered = await registry.getSkill('future-me', '2026-06-01', dir);
    expect(filtered).toBeNull();
  });

  it('resolveForAgent uses config.skills and ignores target_agents', async () => {
    const dir = await createDir({
      'wanted/SKILL.md': fm({
        name: 'wanted',
        description: 'Valid skill description',
        available_from: '2026-01-01',
        target_agents: [],
      }),
      'unwanted/SKILL.md': fm({
        name: 'unwanted',
        description: 'Valid skill description',
        available_from: '2026-01-01',
        target_agents: ['price'],
      }),
    });
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price');
    expect(priceConfig).toBeDefined();
    const cfg: ParticipantAgentConfig = { ...priceConfig!, skills: ['wanted'] };
    const got = await new SkillRegistry().resolveForAgent(cfg, '2026-06-01', dir);
    expect(got.map((s) => s.manifest.name)).toEqual(['wanted']);
  });

  it('resolveForAgent skips archived skills and missing skills with warning', async () => {
    const dir = await createDir({
      'archived-skill/SKILL.md': fm({
        name: 'archived-skill',
        description: 'Valid skill description',
        available_from: '2026-01-01',
        status: 'archived',
      }),
      'active-skill/SKILL.md': fm({
        name: 'active-skill',
        description: 'Valid skill description',
        available_from: '2026-01-01',
        status: 'draft',
      }),
    });
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price');
    expect(priceConfig).toBeDefined();
    const cfg: ParticipantAgentConfig = {
      ...priceConfig!,
      skills: ['archived-skill', 'active-skill', 'missing-skill'],
    };
    const got = await new SkillRegistry().resolveForAgent(cfg, '2026-06-01', dir);
    expect(got.map((s) => s.manifest.name)).toEqual(['active-skill']);
  });
});

describe('SkillRegistry syncToSandbox', () => {
  let ws: string;
  const cleanupDirs: string[] = [];

  const createDir = async (files: Record<string, string>): Promise<string> => {
    const d = await createFixtureDir(files);
    cleanupDirs.push(d);
    return d;
  };

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'ws-'));
  });

  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
    for (const d of cleanupDirs) {
      await rm(d, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  it('normalizes kebab-case names to snake_case when syncing script.py', async () => {
    const dir = await createDir({
      'has-hyphen/SKILL.md': fm({
        name: 'has-hyphen',
        description: 'Valid skill description',
        available_from: '2026-01-01',
      }),
      'has-hyphen/script.py': 'X = 1\n',
    });
    const [pkg] = await new SkillRegistry().discover('2026-06-01', dir);
    expect(pkg).toBeDefined();
    expect(pkg?.moduleName).toBe('has_hyphen');

    const written = await new SkillRegistry().syncToSandbox([pkg!], ws);
    expect(written).toEqual([join(ws, 'skills', 'has_hyphen.py')]);

    const content = await readFile(join(ws, 'skills', 'has_hyphen.py'), 'utf-8');
    expect(content).toBe('X = 1\n');

    const skillsFiles = await readdir(join(ws, 'skills'));
    expect(skillsFiles).toContain('__init__.py');
    expect(skillsFiles).toContain('has_hyphen.py');
    expect(skillsFiles).not.toContain('has-hyphen.py');
  });

  it('skips skills that do not have a scriptPath', async () => {
    const dir = await createDir({
      'prompt-only/SKILL.md': fm({
        name: 'prompt-only',
        description: 'Valid skill description',
        available_from: '2026-01-01',
      }),
    });
    const [pkg] = await new SkillRegistry().discover('2026-06-01', dir);
    expect(pkg).toBeDefined();
    const written = await new SkillRegistry().syncToSandbox([pkg!], ws);
    expect(written).toEqual([]);

    const skillsFiles = await readdir(join(ws, 'skills'));
    expect(skillsFiles).toContain('__init__.py');
    expect(skillsFiles).toHaveLength(1);
  });
});

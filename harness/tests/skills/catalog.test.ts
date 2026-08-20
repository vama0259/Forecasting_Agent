// Catalog validation, agent resolution, and script sanitization tests for pre-built quantitative skills.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SkillRegistry } from '../../src/skills/registry.js';
import { SkillDownloader } from '../../src/skills/downloader.js';
import { AGENT_CONFIGS } from '../../src/agents/types.js';

const ROOT_SKILLS_DIR = existsSync(resolve(process.cwd(), 'skills'))
  ? resolve(process.cwd(), 'skills')
  : resolve(process.cwd(), '..', 'skills');
const EXPECTED_SKILLS = [
  'wyckoff-volume-spread',
  'fii-derivative-positioning',
  'dii-sip-resilience',
  'option-chain-pcr-skew',
  'macro-rates-monitor',
  'option-vol-analysis',
] as const;

describe('Pre-Built Quantitative Skills Catalog', () => {
  const registry = new SkillRegistry();
  const downloader = new SkillDownloader();

  it('discovers all quantitative skills from skills/ directory', async () => {
    const discovered = await registry.discover('2026-12-31', ROOT_SKILLS_DIR);
    const discoveredNames = discovered.map((s) => s.manifest.name).sort();

    expect(discoveredNames).toEqual([...EXPECTED_SKILLS].sort());
  });

  it.each(EXPECTED_SKILLS)('validates schema and structure for skill: %s', async (name) => {
    const pkg = await registry.getSkill(name, '2026-12-31', ROOT_SKILLS_DIR);
    expect(pkg).not.toBeNull();
    if (!pkg) return;

    expect(pkg.manifest.name).toBe(name);
    expect(pkg.manifest.description.length).toBeGreaterThanOrEqual(10);
    expect(pkg.manifest.version).toBe('1.0.0');
    expect(pkg.manifest.available_from).toBe('2026-01-01');
    expect(pkg.manifest.status).toBe('active');
    expect(pkg.manifest.tags.length).toBeGreaterThan(0);
    expect(pkg.instructions.length).toBeGreaterThan(100);
    expect(pkg.instructions.length).toBeLessThan(5500);
    expect(pkg.contentHash).toHaveLength(64);
  });

  it('verifies Tier-2 python scripts exist for wyckoff and fii skills and pass security sanitization', async () => {
    const wyckoffPkg = await registry.getSkill('wyckoff-volume-spread', '2026-12-31', ROOT_SKILLS_DIR);
    const fiiPkg = await registry.getSkill('fii-derivative-positioning', '2026-12-31', ROOT_SKILLS_DIR);
    const diiPkg = await registry.getSkill('dii-sip-resilience', '2026-12-31', ROOT_SKILLS_DIR);
    const optionPkg = await registry.getSkill('option-chain-pcr-skew', '2026-12-31', ROOT_SKILLS_DIR);

    expect(wyckoffPkg?.scriptPath).toBeDefined();
    expect(fiiPkg?.scriptPath).toBeDefined();
    expect(diiPkg?.scriptPath).toBeUndefined();
    expect(optionPkg?.scriptPath).toBeUndefined();

    // Verify sanitization passes with no dangerous primitives
    const wyckoffScript = await readFile(wyckoffPkg!.scriptPath!, 'utf-8');
    const fiiScript = await readFile(fiiPkg!.scriptPath!, 'utf-8');

    const wyckoffSanitize = downloader.sanitizeScript(wyckoffScript);
    expect(wyckoffSanitize.safe).toBe(true);
    expect(wyckoffSanitize.reason).toBeUndefined();
    expect(wyckoffScript).toContain('def compute_wyckoff_vsa');

    const fiiSanitize = downloader.sanitizeScript(fiiScript);
    expect(fiiSanitize.safe).toBe(true);
    expect(fiiSanitize.reason).toBeUndefined();
    expect(fiiScript).toContain('def compute_fii_positioning');
  });

  it('resolves expected skills for each participant agent configuration', async () => {
    const priceConfig = AGENT_CONFIGS.find((c) => c.name === 'price')!;
    const fiiConfig = AGENT_CONFIGS.find((c) => c.name === 'fii')!;
    const diiConfig = AGENT_CONFIGS.find((c) => c.name === 'dii')!;
    const retailConfig = AGENT_CONFIGS.find((c) => c.name === 'retail')!;

    expect(priceConfig.skills).toEqual(['wyckoff-volume-spread', 'macro-rates-monitor']);
    expect(fiiConfig.skills).toEqual([
      'fii-derivative-positioning',
      'option-chain-pcr-skew',
      'macro-rates-monitor',
      'option-vol-analysis',
    ]);
    expect(diiConfig.skills).toEqual(['dii-sip-resilience']);
    expect(retailConfig.skills).toEqual(['wyckoff-volume-spread', 'option-chain-pcr-skew', 'option-vol-analysis']);

    const priceSkills = await registry.resolveForAgent(priceConfig, '2026-12-31', ROOT_SKILLS_DIR);
    expect(priceSkills.map((s) => s.manifest.name).sort()).toEqual(
      ['wyckoff-volume-spread', 'macro-rates-monitor'].sort(),
    );

    const fiiSkills = await registry.resolveForAgent(fiiConfig, '2026-12-31', ROOT_SKILLS_DIR);
    expect(fiiSkills.map((s) => s.manifest.name).sort()).toEqual(
      ['fii-derivative-positioning', 'option-chain-pcr-skew', 'macro-rates-monitor', 'option-vol-analysis'].sort(),
    );

    const diiSkills = await registry.resolveForAgent(diiConfig, '2026-12-31', ROOT_SKILLS_DIR);
    expect(diiSkills.map((s) => s.manifest.name)).toEqual(['dii-sip-resilience']);

    const retailSkills = await registry.resolveForAgent(retailConfig, '2026-12-31', ROOT_SKILLS_DIR);
    expect(retailSkills.map((s) => s.manifest.name).sort()).toEqual(
      ['wyckoff-volume-spread', 'option-chain-pcr-skew', 'option-vol-analysis'].sort(),
    );
  });

  it('point-in-time as_of gate filters skills before available_from date', async () => {
    const beforeRelease = await registry.discover('2025-12-31', ROOT_SKILLS_DIR);
    expect(beforeRelease).toHaveLength(0);

    const onRelease = await registry.discover('2026-01-01', ROOT_SKILLS_DIR);
    expect(onRelease).toHaveLength(EXPECTED_SKILLS.length);
  });
});

describe('Sandbox Synchronization with Real Catalog', () => {
  let ws: string;

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'catalog-sync-'));
  });

  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  it('syncs Tier-2 catalog scripts with snake_case module names into sandbox workspace', async () => {
    const registry = new SkillRegistry();
    const allSkills = await registry.discover('2026-12-31', ROOT_SKILLS_DIR);
    const written = await registry.syncToSandbox(allSkills, ws);

    expect(written).toHaveLength(2);
    expect(written).toContain(join(ws, 'skills', 'wyckoff_volume_spread.py'));
    expect(written).toContain(join(ws, 'skills', 'fii_derivative_positioning.py'));

    const dirContents = await readdir(join(ws, 'skills'));
    expect(dirContents).toContain('__init__.py');
    expect(dirContents).toContain('wyckoff_volume_spread.py');
    expect(dirContents).toContain('fii_derivative_positioning.py');
    expect(dirContents).not.toContain('dii_sip_resilience.py');
    expect(dirContents).not.toContain('option_chain_pcr_skew.py');
  });
});

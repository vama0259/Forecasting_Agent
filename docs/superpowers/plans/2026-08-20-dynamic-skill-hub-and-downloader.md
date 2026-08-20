# M11 Dynamic Skill Hub, Downloader Engine & Agent Skill Injection — Implementation Plan

**Revision 2 (2026-08-20)** — rewritten alongside spec revision 2. Revision 1 of this plan carried
none of the four artifacts CLAUDE.md requires per task (seam note, failing test, Gemini delegation
prompt, validator brief), and its Task 1 wrote into `workspace/skills/`, a directory no code
creates or mounts. Task 0 below is new and unblocks the rest.

> **Execution path:** `gemini-delegated-implementation` — delegate each task to Gemini 3.7 Flash
> (High) via `agy`, then verify **inline** in the main session. Never accept a self-reported
> "tests pass"; re-run every command from a cold shell.

**Spec:** `docs/superpowers/specs/2026-08-20-dynamic-skill-hub-and-downloader-design.md`

**Goal:** Search, download, validate, store, point-in-time filter, and dynamically inject
analytical prompt skills (Tier 1) and exploration-tier Python code skills (Tier 2) into the four
participant agents — on a workspace substrate that actually exists.

**Tech stack:** TypeScript, Zod, nunjucks (not Python Jinja2 — `harness/src/prompts/engine.ts:1`),
`yaml@^2.9.0` (already a dependency), dockerode, Vitest.

---

## ⚠️ Honesty note on the red-test steps

The failing-test code below is **paste-ready but has not been executed** — the modules under test
do not exist yet, so there is no run to watch. Each task states the **expected** failure mode.
Step 2 of every task is where the red is actually watched, by the implementer, before writing any
production code. Do not record a task as complete on the strength of this document's prediction.

---

## Global constraints

- `discover(asOf)` — `as_of` is a **required** parameter. An optional one reintroduces the leak.
- `status` defaults to `'draft'`. `ARCHIVED` excludes from injection; `ACTIVE` is reporting
  metadata in M11 (spec §1.6).
- `config.skills` is the sole injection authority; `target_agents` is a search hint only.
- Injected block capped at **6,000 characters** (stated ~4-chars/token proxy for 1,500 tokens).
  Overflow **drops whole skills**, never truncates.
- Skills sorted by `name` before rendering — determinism is what makes ADR-028's cache claim true.
- Archive-safety checks are **hard rejects**; Python-pattern lint is **warn-only** (spec §1.4).
- Strict mypy / ruff / eslint / prettier / vitest / pytest clean. Baselines: 283 harness tests,
  299 pytest — neither may regress.

---

### Task 0: `WorkspaceManager` — the ADR-021 substrate (NEW, blocks everything)

**Why this exists:** `grep -rn "workspacePath" harness/src` returns hits only in `types.ts:11` and
`manager.ts:87,245,249`. No caller ever passes one, so `manager.ts:249`'s
`const binds = workspacePath ? [...] : []` always evaluates to `[]` — **there is no host bind mount
on the explore tier today.** Without this task, Task 1's `syncToSandbox` writes to a host path no
container can see, and every one of its unit tests passes anyway.

**Files:** create `harness/src/sandbox/workspace.ts`, `harness/tests/sandbox/workspace.test.ts`;
modify `harness/src/sandbox/deepagents-adapter.ts`, `harness/src/pipeline/multi-agent.ts`,
`harness/src/pipeline/single-agent.ts`, `harness/src/sandbox/manager.ts`.

**Seam note.** The seam is `ExecutionRequest.workspacePath` (`sandbox/types.ts:11`), which already
exists and is already honoured by `getOrCreateWarmContainer`. Nothing about the mount mechanism
needs designing — it needs *feeding*. There are **two** seams to thread, and wiring only the first
leaves the silent no-op intact:

1. `SandboxBackendAdapter` (`deepagents-adapter.ts:13`) — its constructor already accepts an
   options object (`{sandboxManager, runId}`); add an optional `workspacePath` and forward it from
   `execute()` (`:47`) and `downloadFiles()` on every `runExplore` call.
2. Construction sites — `multi-agent.ts:237` and `single-agent.ts:122` must call
   `WorkspaceManager.prepare(runId, asOf)` and pass the returned host path in.

`WorkspaceManager` owns the directory contract and nothing else: it does not know what a skill is.
That keeps `harness/src/skills/` dependent on a path string rather than on Docker.

Also in `manager.ts:131`-adjacent explore-container creation: set
`Env: ['PYTHONPATH=/workspace:/opt/agent_lib']`. **Leave the validate container's
`PYTHONPATH=/workspace/m8:/opt/agent_lib` alone** — that asymmetry is what makes spec §1.1's
Tier-2 invariant runtime-enforced instead of a rule someone has to remember.

**Failing test** — `harness/tests/sandbox/workspace.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager } from '../../src/sandbox/workspace.js';

describe('WorkspaceManager ADR-021 persist/wipe', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ws-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('persists skills/ and models/, wipes scratch/, across two prepares', async () => {
    const wm = new WorkspaceManager(root);
    const p1 = await wm.prepare('run-1', '2026-08-20');
    await writeFile(join(p1, 'skills', 'keep.py'), 'X = 1');
    await writeFile(join(p1, 'models', 'keep.pkl'), 'model');
    await writeFile(join(p1, 'scratch', 'gone.txt'), 'temp');

    const p2 = await wm.prepare('run-1', '2026-08-21');
    expect(await readdir(join(p2, 'skills'))).toContain('keep.py');
    expect(await readdir(join(p2, 'models'))).toContain('keep.pkl');
    expect(await readdir(join(p2, 'scratch'))).toEqual([]);
  });

  it('creates skills/__init__.py so `import skills.x` resolves', async () => {
    const wm = new WorkspaceManager(root);
    const p = await wm.prepare('run-2', '2026-08-20');
    expect(await readdir(join(p, 'skills'))).toContain('__init__.py');
  });
});
```

Plus, in `harness/tests/sandbox/deepagents-adapter.test.ts`, an assertion that the adapter forwards
the path — this is the test that catches wiring only seam 1:

```typescript
it('forwards workspacePath to every runExplore call', async () => {
  const calls: unknown[] = [];
  const manager = { runExplore: async (r: unknown) => { calls.push(r); return { stdout: '', stderr: '', exitCode: 0, stdoutTruncated: false, stderrTruncated: false, durationMs: 1 }; } };
  const adapter = new SandboxBackendAdapter({ sandboxManager: manager as never, runId: 'run-1', workspacePath: '/host/ws/run-1' });
  await adapter.execute('echo hi');
  expect(calls[0]).toMatchObject({ workspacePath: '/host/ws/run-1' });
});
```

**Expected red:** `Cannot find module '../../src/sandbox/workspace.js'` for the first file; for the
second, `toMatchObject` fails because `execute()` currently sends `{runId, tier, code}` only.

**Run:** `pnpm --prefix harness test tests/sandbox/workspace.test.ts tests/sandbox/deepagents-adapter.test.ts`

**Gemini delegation prompt** (paste as-is):

> Work in `/home/varunmalhotra/Desktop/Forecasting_Agent`. Read
> `docs/superpowers/specs/2026-08-20-dynamic-skill-hub-and-downloader-design.md` §1.2 and §0 facts
> 5–8 first.
>
> The tests in `harness/tests/sandbox/workspace.test.ts` and the new `forwards workspacePath` case
> in `harness/tests/sandbox/deepagents-adapter.test.ts` are written and failing. Make them pass
> without modifying the test files.
>
> 1. Create `harness/src/sandbox/workspace.ts` exporting `class WorkspaceManager`. Constructor takes
>    a workspace root path. `prepare(runId: string, asOf: string): Promise<string>` creates
>    `<root>/<runId>/{skills,models,scratch}`, writes `skills/__init__.py` if absent, recursively
>    empties `scratch/` (the directory itself must remain), leaves `skills/` and `models/` untouched,
>    and returns the absolute `<root>/<runId>` path. This is ADR-021's persist/wipe policy — the
>    wipe must not touch the other two directories.
> 2. In `harness/src/sandbox/deepagents-adapter.ts`, add an optional `workspacePath?: string` to the
>    options-object form of the constructor, store it, and include it in EVERY `runExplore({...})`
>    call the class makes — both `execute()` (line ~47) and `downloadFiles()`. Keep the positional
>    `(manager, runId)` constructor form working; existing tests use it.
> 3. In `harness/src/sandbox/manager.ts`, when creating the WARM (explore) container, set
>    `Env: ['PYTHONPATH=/workspace:/opt/agent_lib']`. Do NOT change the validate container's
>    existing `PYTHONPATH=/workspace/m8:/opt/agent_lib` at line ~131 — the asymmetry is deliberate
>    and load-bearing.
> 4. In `harness/src/pipeline/multi-agent.ts` (~line 237) and `harness/src/pipeline/single-agent.ts`
>    (~line 122), instantiate a `WorkspaceManager` rooted at `<repo>/.workspaces` (create it if
>    missing), call `prepare(runId, asOf)`, and pass the result as `workspacePath` into the
>    `SandboxBackendAdapter` options object.
>
> Every new file needs a one-line top-of-file abstract; every function needs a one-line comment
> stating its input and output. No multi-line docstrings. 120-char lines.
>
> Then run `pnpm --prefix harness test` and `pnpm --prefix harness typecheck` and report the exact
> output. Do not commit.

**Validator brief** (run inline, in the main session):
1. Cold-shell re-run of `pnpm --prefix harness test` — confirm **283 + new** tests pass, zero
   regressions. Do not accept the reported number.
2. **Real Docker check, not the mocked suite.** Start a real explore container through
   `SandboxManager` with a `workspacePath`, then `docker inspect` it and confirm the bind appears
   in `HostConfig.Binds` and `PYTHONPATH=/workspace:/opt/agent_lib` in `Config.Env`. The mocked
   tests cannot see either.
3. Confirm the validate container's `PYTHONPATH` is **unchanged** — grep `manager.ts:131`.
4. Repeat-run check: call `prepare()` twice for the same `runId` and confirm idempotence with a
   real filesystem, not a mock.
5. `git status` — confirm no writes outside `harness/src/sandbox/`, `harness/src/pipeline/`,
   `harness/tests/sandbox/`. Specifically confirm nothing was written to the Obsidian vault.

**Commit:** `feat(sandbox): implement ADR-021 workspace persist/wipe lifecycle and thread workspacePath`

---

### Task 1: Skill types & point-in-time registry

**Files:** create `harness/src/skills/{types.ts,registry.ts,index.ts}`,
`harness/tests/skills/registry.test.ts`, plus fixtures under `harness/tests/fixtures/skills/`.

**Seam note.** `SkillRegistry` depends on a directory path and an `as_of` string — nothing else. It
does not import dockerode, nunjucks, or agent types, so it is testable with a temp directory and no
container. `syncToSandbox` takes the host path produced by Task 0 rather than discovering it, which
is what keeps that independence. `resolveForAgent(config, asOf)` is the one method that touches
`ParticipantAgentConfig`, and it exists so the injector never has to know the assignment rule.

**Failing test** — `harness/tests/skills/registry.test.ts` (abridged; four cases are load-bearing):

```typescript
it('excludes skills whose available_from is after as_of', async () => {
  const dir = await fixtureDir({
    'past-skill/SKILL.md': fm({ name: 'past-skill', available_from: '2026-01-01' }),
    'future-skill/SKILL.md': fm({ name: 'future-skill', available_from: '2026-12-31' }),
  });
  const names = (await new SkillRegistry().discover('2026-06-01', dir)).map((s) => s.manifest.name);
  expect(names).toEqual(['past-skill']);
  expect(names).not.toContain('future-skill');
});

it('defaults status to draft, never active', async () => {
  const dir = await fixtureDir({ 'x/SKILL.md': fm({ name: 'x', available_from: '2026-01-01' }) });
  const [pkg] = await new SkillRegistry().discover('2026-06-01', dir);
  expect(pkg.manifest.status).toBe('draft');
});

it('rejects a hyphenated skill that ships a script.py', async () => {
  const dir = await fixtureDir({
    'has-hyphen/SKILL.md': fm({ name: 'has-hyphen', available_from: '2026-01-01' }),
    'has-hyphen/script.py': 'X = 1',
  });
  await expect(new SkillRegistry().discover('2026-06-01', dir)).rejects.toThrow(/not a valid Python module name/i);
});

it('resolveForAgent uses config.skills and ignores target_agents', async () => {
  const dir = await fixtureDir({
    'wanted/SKILL.md': fm({ name: 'wanted', available_from: '2026-01-01', target_agents: [] }),
    'unwanted/SKILL.md': fm({ name: 'unwanted', available_from: '2026-01-01', target_agents: ['price'] }),
  });
  const cfg = { ...AGENT_CONFIGS[0], skills: ['wanted'] };
  const got = await new SkillRegistry().resolveForAgent(cfg, '2026-06-01', dir);
  expect(got.map((s) => s.manifest.name)).toEqual(['wanted']);
});
```

**Expected red:** `Cannot find module '../../src/skills/registry.js'`.

**Run:** `pnpm --prefix harness test tests/skills/registry.test.ts`

**Gemini delegation prompt:**

> Work in `/home/varunmalhotra/Desktop/Forecasting_Agent`. Read spec §1.3, §1.6, §3.2, §3.3 first.
> Tests in `harness/tests/skills/registry.test.ts` are written and failing. Make them pass without
> editing the test file.
>
> Create `harness/src/skills/types.ts` with `SkillManifestSchema` and the `SkillPackage` interface
> **exactly as written in spec §3.2** — in particular `available_from` is REQUIRED with no default,
> and `status` defaults to `'draft'`.
>
> Create `harness/src/skills/registry.ts` exporting `class SkillRegistry`:
> - `discover(asOf: string, skillsDir?: string)` — scan `<skillsDir ?? 'skills'>/*/SKILL.md`, parse
>   YAML frontmatter with the already-installed `yaml` package (do NOT add gray-matter or any new
>   dependency), validate against the schema, and **exclude any package whose `available_from` is
>   lexicographically greater than `asOf`** (ISO dates compare correctly as strings). Log each
>   exclusion. Cache results per (dir, asOf) — the registry is read once per run.
> - Throw a clear error containing "not a valid Python module name" if a package contains a
>   `script.py` and its `name` contains a hyphen.
> - `getSkill(name, asOf)`, `resolveForAgent(config, asOf, skillsDir?)` — the latter returns only
>   skills named in `config.skills`, in `config.skills` order, skipping (with a warning) any that
>   are missing, archived, or filtered out by `asOf`. `target_agents` must NOT affect the result.
> - `syncToSandbox(skills, workspacePath)` — copy each `scriptPath` to
>   `<workspacePath>/skills/<name>.py`, return the written paths.
> - `contentHash` is sha256 over `SKILL.md` bytes plus `script.py` bytes when present.
>
> Create `harness/src/skills/index.ts` re-exporting the public surface.
>
> One-line file abstract per file; one-line input/output comment per function; 120-char lines; no
> multi-line docstrings. Run `pnpm --prefix harness test tests/skills/` and report exact output.
> Do not commit.

**Validator brief:**
1. Cold-shell re-run of the full `pnpm --prefix harness test`.
2. **Responsiveness spot-check on the `as_of` filter** — this is the number that must move: build a
   fixture, call `discover('2026-06-01')` and `discover('2027-01-01')` against the *same*
   directory, and confirm the returned counts differ. If they don't, the filter is decorative
   regardless of what the unit test says.
3. Confirm `package.json` gained **no** new dependency (`git diff harness/package.json` must be
   empty) — the `yaml` package was already there.
4. Grep the implementation for `available_from` having acquired a `.default(...)` — reject if so.
5. `git status` for out-of-scope writes.

**Commit:** `feat(skills): add SkillRegistry with point-in-time as_of filtering`

---

### Task 2: Downloader — hard archive safety, soft script lint

**Files:** create `harness/src/skills/downloader.ts`, `harness/tests/skills/downloader.test.ts`.

**Seam note.** Two responsibilities that must not be conflated, because they defend different
boundaries (spec §1.4): archive-path checks defend the **host filesystem**, which Node touches
uncontained, and are hard rejects; Python-pattern checks describe code destined for a container
ADR-021 already concedes, and are warnings recorded on `SkillPackage.lintWarnings`. Keep them as
two exported functions so nobody later "unifies" them into one policy.

**Failing test** — `harness/tests/skills/downloader.test.ts`:

```typescript
it('hard-rejects an archive entry escaping the target dir', async () => {
  const tar = await makeTar({ '../../../etc/evil.md': 'x' });
  await expect(new SkillDownloader().download(tar, target)).rejects.toThrow(/outside target directory/i);
});

it('hard-rejects symlink entries', async () => {
  const tar = await makeTarWithSymlink('link', '/etc/passwd');
  await expect(new SkillDownloader().download(tar, target)).rejects.toThrow(/symlink/i);
});

it('WARNS but does not reject a script using subprocess', async () => {
  const tar = await makeTar({
    'SKILL.md': fm({ name: 'risky', available_from: '2026-01-01' }),
    'script.py': 'import subprocess\nsubprocess.Popen(["ls"])\n',
  });
  const pkg = await new SkillDownloader().download(tar, target);   // must NOT throw
  expect(pkg.lintWarnings.join(' ')).toMatch(/subprocess/);
  expect(pkg.manifest.name).toBe('risky');
});

it('installs downloaded skills as draft regardless of declared status', async () => {
  const tar = await makeTar({ 'SKILL.md': fm({ name: 'sneaky', available_from: '2026-01-01', status: 'active' }) });
  const pkg = await new SkillDownloader().download(tar, target);
  expect(pkg.manifest.status).toBe('draft');
});
```

**Expected red:** `Cannot find module '../../src/skills/downloader.js'`.

**Run:** `pnpm --prefix harness test tests/skills/downloader.test.ts`

**Gemini delegation prompt:**

> Work in `/home/varunmalhotra/Desktop/Forecasting_Agent`. Read spec §1.4 — especially the table
> distinguishing HARD REJECT from WARN ONLY — before writing anything. Tests in
> `harness/tests/skills/downloader.test.ts` are written and failing; make them pass without editing
> the test file.
>
> Create `harness/src/skills/downloader.ts` exporting `class SkillDownloader` plus two separate
> exported functions, `assertArchiveSafe(entries)` and `lintScript(source): string[]`.
>
> HARD REJECT (throw, before writing anything to disk): absolute paths, any `..` segment, symlinks
> or other non-regular entries, a resolved path outside the target directory, total unpacked size
> over 5 MB, more than 50 files, or a missing/invalid `SKILL.md`.
>
> WARN ONLY (collect strings into `SkillPackage.lintWarnings`, never throw): `os.system`,
> `subprocess`, `socket`, `eval(`, `exec(` appearing in `script.py`. Do not attempt to make this
> exhaustive and do not describe it as a security control in comments — spec §1.4 explains why it
> is a lint.
>
> `download(source, targetDir)`: `source` may be a local tarball path, a local directory, or a git
> URL (`git clone --depth 1` into a temp dir). Unpack to a temp dir, run the hard checks, run the
> lint, parse via the Task 1 schema, **force `status: 'draft'` and stamp `available_from` to today
> regardless of what the manifest declares**, then move into `targetDir`. Clean up the temp dir on
> every path including failure.
>
> `searchLocal(query, available)`: rank by name/tag/description substring match; `target_agents` may
> boost ranking only.
>
> One-line file abstract; one-line input/output comment per function; 120 chars. Run
> `pnpm --prefix harness test tests/skills/` and report exact output. Do not commit.

**Validator brief:**
1. Cold-shell full harness suite.
2. **Real filesystem escape attempt, not a mocked one** — craft an actual tarball containing
   `../../../tmp/pwned.txt`, run `download()` against it, and confirm `/tmp/pwned.txt` does **not**
   exist afterwards. A passing unit test that never touches the real FS does not establish this.
3. Confirm the lint does not throw: install the `subprocess` fixture for real and confirm it lands
   in `skills/` with warnings attached.
4. Confirm no new dependency was added for tar extraction unless genuinely required; if one was,
   confirm it is in `harness/package.json` and not merely importable from the local `node_modules`.
5. `git status` for out-of-scope writes.

**Commit:** `feat(skills): add SkillDownloader with hard archive safety and soft script lint`

---

### Task 3: Injector & template integration

**Files:** create `harness/src/skills/injector.ts`, `harness/tests/skills/injector.test.ts`;
modify `harness/src/prompts/engine.ts`, `harness/prompts/{price,fii,dii,retail}.j2`.

**Seam note.** `renderSkillsBlock(skills) → {block, dropped}` is a pure function of a sorted array —
no filesystem, no config, no clock. That is what makes the determinism test (below) meaningful.
`renderPrompt` gains one optional `skills` parameter and passes `skills_block` into the nunjucks
context; templates render `{{ skills_block }}` inside the existing `<rules>` region, which is why
no new ADR-028 XML boundary is introduced (spec §1.5).

**Failing test** — `harness/tests/skills/injector.test.ts`:

```typescript
it('is byte-identical regardless of input order (ADR-028 cache stability)', () => {
  const a = renderSkillsBlock([skillB, skillA]).block;
  const b = renderSkillsBlock([skillA, skillB]).block;
  expect(a).toBe(b);
});

it('drops whole skills on overflow and never truncates', () => {
  const big = makeSkill('big', 'x'.repeat(5_000));
  const also = makeSkill('also', 'y'.repeat(5_000));
  const { block, dropped } = renderSkillsBlock([big, also]);
  expect(block.length).toBeLessThanOrEqual(6_000);
  expect(dropped).toEqual(['big']);            // sorted: 'also' fits first, 'big' is dropped
  expect(block).not.toContain('x'.repeat(4_999));   // no partial body
});

// (a) INJECTION check -- necessary, NOT the comprehension gate (spec §5.1)
it('renders the skill body into the price prompt', () => {
  const withSkill = renderPrompt(priceConfig, ctx, [wyckoff]);
  const without = renderPrompt(priceConfig, ctx, []);
  expect(withSkill).not.toBe(without);
  expect(withSkill).toContain('Effort versus Result');
});

it('warns the agent that model.py must inline skills code', () => {
  expect(renderPrompt(priceConfig, ctx, [wyckoff])).toMatch(/must not import .*skills/i);
});
```

**Expected red:** `Cannot find module '../../src/skills/injector.js'`; the last two also fail on
`renderPrompt` accepting only two arguments.

**Run:** `pnpm --prefix harness test tests/skills/injector.test.ts tests/prompts/`

**Gemini delegation prompt:**

> Work in `/home/varunmalhotra/Desktop/Forecasting_Agent`. Read spec §1.1 (the Tier-2 invariant),
> §1.5, and §3.3. Tests in `harness/tests/skills/injector.test.ts` are written and failing.
>
> 1. Create `harness/src/skills/injector.ts` exporting
>    `renderSkillsBlock(skills: SkillPackage[]): { block: string; dropped: string[] }`. Sort by
>    `manifest.name` FIRST — never rely on input or directory order; ADR-028's ≥85% prefix-cache
>    claim depends on byte-identical output across runs. Emit
>    `<skill name="..." version="...">\n<body>\n</skill>` per skill, wrapped in `<skills>`. Add
>    skills in sorted order while the running total stays within **6000 characters**; a skill that
>    would exceed it is dropped WHOLE (its name goes in `dropped`) and the loop continues. Never
>    truncate a body.
> 2. In `harness/src/prompts/engine.ts`, add an optional third parameter
>    `skills: SkillPackage[] = []` to `renderPrompt` and pass `skills_block` (the rendered string,
>    or `''` when empty) into the nunjucks context. Change nothing else about the function.
> 3. In each of `harness/prompts/price.j2`, `fii.j2`, `dii.j2`, `retail.j2`, render
>    `{{ skills_block }}` near the TOP, in the static-instruction region before any market state —
>    ADR-028 §3 fixes that ordering. Also add this sentence to each template's Python section:
>    "Your `/workspace/model.py` must NOT import anything from `skills/` — the validation container
>    runs it with no network and no workspace mount, so inline any skill code you use directly into
>    the script."
>
> One-line file abstract; one-line input/output comment per function; 120 chars. Run
> `pnpm --prefix harness test` and report exact output. Do not commit.

**Validator brief:**
1. Cold-shell full harness suite — 283 baseline plus new, no regressions. Prompt-snapshot tests are
   the likely breakage; confirm any snapshot update is intentional and reviewed, not blanket `-u`.
2. **Measure the 6,000-char cap for real** — render a deliberately oversized skill set and
   `console.log(block.length)`. Do not accept "should be under 6000."
3. **Determinism against the real filesystem**: run `discover()` twice on a directory whose entries
   were created in different orders and confirm the two rendered blocks are byte-identical.
4. Confirm `{{ skills_block }}` landed at the head, not appended at the tail — read the diff of one
   `.j2` file directly.
5. `git status`.

**Commit:** `feat(skills): add deterministic budgeted skill injector and wire into prompt templates`

---

### Task 4: Catalog + the comprehension gate

**Files:** create `skills/wyckoff-volume-spread/{SKILL.md,script.py}`,
`skills/fii-derivative-positioning/{SKILL.md,script.py}`, `skills/dii-sip-resilience/SKILL.md`,
`skills/option-chain-pcr-skew/SKILL.md`; modify `harness/src/agents/types.ts`; create
`harness/tests/skills/catalog.test.ts` and `harness/tests/skills/responsiveness.test.ts`.

**Seam note.** Revision 1's catalog test asserted only that the four skills parse and match agent
assignments — an assertion that passes byte-identically whether `SKILL.md` contains Wyckoff analysis
or lorem ipsum. **That test is kept, but it is explicitly not the gate.** The gate is
`responsiveness.test.ts`, which is separated into its own file precisely so that nobody reads a
green `catalog.test.ts` as evidence that skills work.

**Failing test (a) — schema conformance, the weak check** — `catalog.test.ts`:

```typescript
it.each(['wyckoff-volume-spread', 'fii-derivative-positioning', 'dii-sip-resilience', 'option-chain-pcr-skew'])(
  '%s parses and is assigned to at least one agent config', async (name) => {
    const pkg = await new SkillRegistry().getSkill(name, '2026-12-31');
    expect(pkg).not.toBeNull();
    expect(pkg!.manifest.status).toBe('draft');
    expect(AGENT_CONFIGS.some((c) => c.skills.includes(name))).toBe(true);
  });
```

**Failing test (b) — THE COMPREHENSION GATE** — `responsiveness.test.ts`:

```typescript
// Spec §5.1(b). If this file is skipped or deleted, M11's premise is untested -- say so out loud
// rather than letting catalog.test.ts stand in for it.
it('agent output MOVES when the skill body changes', async () => {
  const base = await runRecordedPriceTurn({ skills: [] });
  const withSkill = await runRecordedPriceTurn({ skills: ['wyckoff-volume-spread'] });
  expect(withSkill.signal).not.toEqual(base.signal);

  const inverted = await runRecordedPriceTurn({
    skills: ['wyckoff-volume-spread'],
    mutate: (body) => body.replace('absorption', 'distribution').replace('bullish', 'bearish'),
  });
  expect(inverted.signal.direction).not.toBe(withSkill.signal.direction);
});
```

**Expected red:** both files fail on missing `skills/` fixtures; `responsiveness.test.ts`
additionally fails on `runRecordedPriceTurn` not existing.

**Run:** `pnpm --prefix harness test tests/skills/catalog.test.ts tests/skills/responsiveness.test.ts`

**Gemini delegation prompt:**

> Work in `/home/varunmalhotra/Desktop/Forecasting_Agent`. Read spec §2 and §5.1.
>
> 1. Author four skill packages under a new `skills/` directory, per spec §2. Each `SKILL.md` has
>    YAML frontmatter (`name`, `description`, `version: "1.0.0"`, `available_from: "2026-08-20"`,
>    `target_agents`, `tags`, `status: draft`) and a Markdown body of **real analytical content** —
>    concrete thresholds, concrete decision rules, concrete worked reasoning. Each body must stay
>    under 5,500 characters so two skills can co-exist within the 6,000-char budget.
>    `wyckoff-volume-spread` and `fii-derivative-positioning` additionally get a `script.py` that
>    parses the NSE data shape described in spec §2 — pure functions taking a parsed payload and
>    returning a DataFrame or dict; no I/O, no network, no `subprocess`.
>    NOTE: `script.py` requires a hyphen-free module name per spec §3.2, so name the files so that
>    `SkillRegistry` writes them as importable modules — check what Task 1's registry does with
>    hyphens and follow it; do not work around the check.
> 2. In `harness/src/agents/types.ts` `AGENT_CONFIGS`, set:
>    `price.skills = ['wyckoff-volume-spread']`,
>    `fii.skills = ['fii-derivative-positioning', 'option-chain-pcr-skew']`,
>    `dii.skills = ['dii-sip-resilience']`,
>    `retail.skills = ['wyckoff-volume-spread', 'option-chain-pcr-skew']`.
> 3. Implement the `runRecordedPriceTurn` helper the responsiveness test needs, in
>    `harness/tests/helpers/recorded-turn.ts`. If no recorded-LLM fixture infrastructure exists in
>    this repo, DO NOT fake it and DO NOT stub the assertion into passing — instead report back
>    exactly what is missing and leave the test failing. A falsely-passing responsiveness test is
>    worse than an absent one.
>
> Run `pnpm --prefix harness test tests/skills/` and report exact output, including which tests
> still fail and why. Do not commit.

**Validator brief:**
1. **Read all four `SKILL.md` bodies end to end.** Confirm they contain specific thresholds and
   rules, not generic prose that would satisfy the schema while teaching the agent nothing. This is
   a human-judgement check; no test substitutes for it.
2. Cold-shell re-run of the full suite.
3. **Run the comprehension check by hand and record the before/after values**: render the `price`
   prompt with and without `wyckoff-volume-spread`; then execute the responsiveness test and paste
   the two `AgentSignal` outputs into the session. State the plain-language question to the user:
   *"if the skill body changes, should the forecast move?"*
4. **If `runRecordedPriceTurn` could not be built** — do not paper over it. Record in the spec's
   §5.1 and in the Daily note that M11's core premise ships untested, and treat that as an open
   item, not a completed task.
5. Confirm each skill body is under 5,500 chars: `wc -c skills/*/SKILL.md`.
6. `git status` — the `skills/` directory is new; confirm nothing else appeared.

**Commit:** `feat(skills): add four Indian quantitative catalog skills and assign to agents`

---

### Task 5: CLI & `.skills.lock.json`

**Files:** create `harness/src/cli/skills.ts`, `harness/tests/skills/cli.test.ts`,
`harness/src/skills/lockfile.ts`.

**Seam note.** `harness/src/cli/` does not exist (spec §0 fact 11), so this task creates the
directory. The CLI is a thin argument-parsing shell over Tasks 1–2 — every command maps to one
registry or downloader call, and no business logic lives here. That is what makes the lockfile the
only new concept: `readLock()` / `writeLock()` over
`{name, version, available_from, contentHash}[]`, sorted by name for a stable diff.

**Failing test:**

```typescript
it('lockfile round-trips and is sorted by name', async () => {
  await writeLock(path, [entry('zebra'), entry('alpha')]);
  expect((await readLock(path)).map((e) => e.name)).toEqual(['alpha', 'zebra']);
});

it('skills add records available_from and contentHash in the lockfile', async () => {
  await runCli(['skills', 'add', localTarball]);
  const [e] = await readLock(lockPath);
  expect(e.available_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(e.contentHash).toHaveLength(64);
});

it('skills promote moves draft -> active and nothing else does', async () => {
  await runCli(['skills', 'add', localTarball]);
  expect((await getSkill('x', TODAY))!.manifest.status).toBe('draft');
  await runCli(['skills', 'promote', 'x']);
  expect((await getSkill('x', TODAY))!.manifest.status).toBe('active');
});
```

**Expected red:** `Cannot find module '../../src/cli/skills.js'`.

**Run:** `pnpm --prefix harness test tests/skills/cli.test.ts`

**Gemini delegation prompt:**

> Work in `/home/varunmalhotra/Desktop/Forecasting_Agent`. Read spec §3.4 and §1.6. Tests in
> `harness/tests/skills/cli.test.ts` are written and failing.
>
> Create `harness/src/skills/lockfile.ts` (`readLock`, `writeLock` over
> `{name, version, available_from, contentHash}[]`, always sorted by name, pretty-printed JSON at
> `.skills.lock.json`) and `harness/src/cli/skills.ts` implementing `list`, `search`, `add`,
> `remove`, `promote`, `archive` per spec §3.4. Use `node:util`'s `parseArgs` — do NOT add
> commander, yargs, or any CLI dependency.
>
> `list` prints name, version, status, `available_from`, and any `lintWarnings`. `search` searches
> the LOCAL index only (spec §1.4 defers remote search). `promote` is the ONLY path from `draft` to
> `active`, and it rewrites the `status` field in the skill's own `SKILL.md` frontmatter and prints
> a one-line note that in M11 `active` is reporting metadata, not a validated gate. Every mutating
> command updates `.skills.lock.json`.
>
> One-line file abstract; one-line input/output comment per function; 120 chars. Run
> `pnpm --prefix harness test tests/skills/` and report exact output. Do not commit.

**Validator brief:**
1. Cold-shell full suite.
2. **Run each CLI command for real against a scratch `skills/` directory** — not through the test
   harness. `add` a real local tarball, `list` it, `promote` it, `archive` it, `remove` it, and read
   `.skills.lock.json` after each step. Every prior Gemini delegation that skipped the real-invocation
   check surfaced bugs the mocked tests missed.
3. Confirm `harness/package.json` gained no CLI dependency.
4. Confirm `archive` actually excludes the skill from `resolveForAgent` — call it and check.
5. `git status`.

**Commit:** `feat(skills): add skills CLI and .skills.lock.json reproducibility lock`

---

### Task 6: Integration, real-Docker verification & quality gates

**Files:** `harness/tests/integration/skills-sandbox.test.ts`.

**Seam note.** Everything before this task is verifiable with mocks. This task exists because the
project's own record says mocked green is not evidence: a false "41/41 passed", a missing
`pyarrow`, and four bugs a real Docker run surfaced that Gemini's tests did not. The one property
that cannot be mocked is the §1.1 invariant — importable in explore, **not** importable in validate.

**Failing test:**

```typescript
// Requires a real Docker daemon and forecasting-sandbox:latest.
it('skill is importable in explore and NOT importable in validate', async () => {
  const ws = await new WorkspaceManager(root).prepare('it-run', '2026-08-20');
  await registry.syncToSandbox([wyckoff], ws);

  const explore = await manager.runExplore({
    runId: 'it-run', tier: 'explore', workspacePath: ws,
    code: 'python -c "import skills.wyckoff_volume_spread as s; print(s.__name__)"',
  });
  expect(explore.exitCode).toBe(0);
  expect(explore.stdout).toContain('skills.wyckoff_volume_spread');

  const validate = await manager.runValidate({ runId: 'it-run', tier: 'validate', modelScriptPath: importingModel });
  expect(validate.exitCode).not.toBe(0);
  expect(validate.stderr).toMatch(/ModuleNotFoundError.*skills/);
});
```

**Expected red:** the explore leg fails first with `ModuleNotFoundError` until Task 0's
`PYTHONPATH=/workspace:/opt/agent_lib` and bind mount are both actually in place — which is exactly
the assertion Task 0's mocked tests cannot make.

**Run:** `pnpm --prefix harness test tests/integration/skills-sandbox.test.ts`

**Validator brief — inline, no delegation:**
1. `pnpm --prefix harness test` — expect 283 baseline + all new, zero regressions. Report the exact
   number.
2. `uv run pytest` — expect 299, zero regressions.
3. `pnpm --prefix harness typecheck && pnpm --prefix harness lint`;
   `uv run ruff check . && uv run mypy src/`.
4. `docker inspect` the live explore container: bind present, `PYTHONPATH` correct.
5. **State the comprehension result in plain language in the session**, with the before/after
   `AgentSignal` values from Task 4 — or state plainly that the premise is untested and why.
6. `git status` clean; nothing written to `/home/varunmalhotra/Desktop/Knowledge` by any delegation.
7. Obsidian sync: Daily note, Kanban, project checklist, and an amendment note on ADR-027 §4
   recording that M11 ships the schema with **manual** transitions (spec §6).

**Commit:** a real commit of the integration test — **not** `git commit --allow-empty`. A commit
that asserts verification happened while containing nothing is the failure mode the comprehension
gate exists to prevent.

---

## Task dependency order

```
Task 0 (workspace)  ──┬──> Task 1 (registry) ──┬──> Task 3 (injector) ──> Task 4 (catalog)
                      │                        │                              │
                      │                        └──> Task 2 (downloader) ──> Task 5 (CLI)
                      │                                                       │
                      └───────────────────────────────────────────────────────┴──> Task 6
```

Tasks 2 and 3 are independent of each other once Task 1 lands and may be fanned out to parallel
`agy` worktrees. Task 0 blocks everything and must not be parallelised with Task 1 — Task 1's
`syncToSandbox` has nothing to write into until it lands.

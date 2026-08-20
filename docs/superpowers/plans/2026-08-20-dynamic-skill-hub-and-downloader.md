# M11 Dynamic Skill Hub, Downloader Engine & Agent Skill Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the M11 Dynamic Skill Hub and Downloader Engine allowing the Forecasting Agent to search, download, validate, store, and dynamically inject analytical prompt skills and Python sandbox code skills into participant agents.

**Architecture:** A TypeScript skill management engine (`harness/src/skills/`) providing discovery, remote fetching/sanitization, Docker sandbox syncing, and dynamic Jinja2 prompt injection for the 4 participant agents (`price`, `fii`, `dii`, `retail`).

**Tech Stack:** TypeScript, Zod, Nunjucks/Jinja2, Node.js fs/child_process, Vitest, Pytest.

**Spec:** `docs/superpowers/specs/2026-08-20-dynamic-skill-hub-and-downloader-design.md`

## Global Constraints
- `SkillManifestSchema` requires `name` (`^[a-z0-9-_]+$`), `description`, `version`, `target_agents`, `tags`, and `status`.
- Downloaded Python scripts are sanitized before placement in `workspace/skills/` (blocking unsanitized network sockets or host escapes).
- Injected skill prompt tokens capped at <= 1,500 tokens per agent.
- 100% strict mypy, ruff, eslint, prettier, vitest, and pytest compliance.

---

### Task 1: TypeScript Skill Types & Local Skill Registry Scanner

**Files:**
- Create: `harness/src/skills/types.ts`
- Create: `harness/src/skills/registry.ts`
- Create: `harness/src/skills/index.ts`
- Test: `harness/tests/skills/registry.test.ts`

**Interfaces:**
- Produces: `SkillManifestSchema`, `SkillPackage` interfaces.
- Produces: `SkillRegistry.discover(skillsDir?: string): Promise<SkillPackage[]>`
- Produces: `SkillRegistry.getSkill(name: string): Promise<SkillPackage | null>`
- Produces: `SkillRegistry.syncToSandbox(skillNames: string[], targetDir: string): Promise<string[]>`

- [ ] **Step 1: Write unit tests for SkillRegistry**
Test discovery of sample `SKILL.md` packages, frontmatter parsing, missing skill handling, and sandbox script copying.

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm --prefix harness test harness/tests/skills/registry.test.ts`

- [ ] **Step 3: Implement `types.ts`, `registry.ts`, and `index.ts`**
Implement Zod validation, YAML frontmatter parsing, and filesystem discovery.

- [ ] **Step 4: Run tests to verify they pass**
Run: `pnpm --prefix harness test harness/tests/skills/registry.test.ts`

- [ ] **Step 5: Commit**
```bash
git add harness/src/skills/ harness/tests/skills/registry.test.ts
git commit -m "feat(skills): implement SkillRegistry for local discovery and sandbox syncing"
```

---

### Task 2: Remote Skill Downloader & Sanitizer

**Files:**
- Create: `harness/src/skills/downloader.ts`
- Test: `harness/tests/skills/downloader.test.ts`

**Interfaces:**
- Produces: `SkillDownloader.download(sourceUrlOrName: string, targetDir: string): Promise<SkillPackage>`
- Produces: `SkillDownloader.search(query: string, availableSkills: SkillPackage[]): SkillPackage[]`

- [ ] **Step 1: Write unit tests for SkillDownloader**
Test keyword/tag search across skill manifests, git repository fetching mock, and malicious script rejection (e.g. scripts calling `os.system` / `subprocess.Popen`).

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm --prefix harness test harness/tests/skills/downloader.test.ts`

- [ ] **Step 3: Implement `downloader.ts`**
Implement search ranking, git/HTTP fetcher, YAML parser, and security sanitizer.

- [ ] **Step 4: Run tests to verify they pass**
Run: `pnpm --prefix harness test harness/tests/skills/downloader.test.ts`

- [ ] **Step 5: Commit**
```bash
git add harness/src/skills/downloader.ts harness/tests/skills/downloader.test.ts
git commit -m "feat(skills): implement remote SkillDownloader and security sanitizer"
```

---

### Task 3: Dynamic Skill Injector & Jinja2 Template Integration

**Files:**
- Create: `harness/src/skills/injector.ts`
- Modify: `harness/src/agents/factory.ts`
- Modify: `harness/prompts/price.j2`, `fii.j2`, `dii.j2`, `retail.j2`
- Test: `harness/tests/skills/injector.test.ts`

**Interfaces:**
- Produces: `SkillInjector.renderSkillsPrompt(skills: SkillPackage[]): string`
- Produces: `renderPromptWithSkills(templateName: string, context: Record<string, any>, skills: SkillPackage[]): string`

- [ ] **Step 1: Write unit tests for SkillInjector**
Test formatting of `<skills>` XML blocks, token length bounding, and Jinja2 prompt rendering with skills.

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm --prefix harness test harness/tests/skills/injector.test.ts`

- [ ] **Step 3: Implement `injector.ts` and update prompt templates**
Implement `<skills>` block formatting and update agent factory to inject assigned skills into template context.

- [ ] **Step 4: Run tests to verify they pass**
Run: `pnpm --prefix harness test harness/tests/skills/injector.test.ts`

- [ ] **Step 5: Commit**
```bash
git add harness/src/skills/injector.ts harness/src/agents/factory.ts harness/prompts/ harness/tests/skills/injector.test.ts
git commit -m "feat(skills): implement dynamic Jinja2 prompt injector for participant agents"
```

---

### Task 4: Pre-Built Quantitative Skills Catalog

**Files:**
- Create: `skills/wyckoff-volume-spread/SKILL.md` & `script.py`
- Create: `skills/fii-derivative-positioning/SKILL.md` & `script.py`
- Create: `skills/dii-sip-resilience/SKILL.md`
- Create: `skills/option-chain-pcr-skew/SKILL.md`
- Modify: `harness/src/agents/types.ts` (assign pre-built skills to `price`, `fii`, `dii`, `retail`)
- Test: `harness/tests/skills/catalog.test.ts`

**Interfaces:**
- Produces: 4 production-grade quantitative skills in `skills/`.

- [ ] **Step 1: Write tests for quantitative skills catalog**
Verify that all 4 skills parse validly against `SkillManifestSchema` and match agent assignments.

- [ ] **Step 2: Run test to verify failure**
Run: `pnpm --prefix harness test harness/tests/skills/catalog.test.ts`

- [ ] **Step 3: Author the 4 quantitative skills and update agent configs**
Create `wyckoff-volume-spread`, `fii-derivative-positioning`, `dii-sip-resilience`, and `option-chain-pcr-skew`.
Assign skills in `harness/src/agents/types.ts` `AGENT_CONFIGS`.

- [ ] **Step 4: Run tests to verify they pass**
Run: `pnpm --prefix harness test harness/tests/skills/catalog.test.ts`

- [ ] **Step 5: Commit**
```bash
git add skills/ harness/src/agents/types.ts harness/tests/skills/catalog.test.ts
git commit -m "feat(skills): add 4 pre-built Indian quantitative skills and assign to participant agents"
```

---

### Task 5: End-to-End Quality Gates & Smoke Test

**Files:**
- Test: All unit, integration, and e2e test suites.

- [ ] **Step 1: Run full TypeScript harness test suite**
Run: `pnpm --prefix harness test` (all tests passing).

- [ ] **Step 2: Run full Python test suite**
Run: `uv run pytest` (all 299+ tests passing).

- [ ] **Step 3: Run Linters and Typecheckers**
Run: `pnpm --prefix harness typecheck && pnpm --prefix harness lint`
Run: `uv run ruff check . && uv run mypy src/`

- [ ] **Step 4: Commit & Sync**
```bash
git commit --allow-empty -m "chore(skills): complete full verification of M11 Skill Hub and Downloader Engine"
```

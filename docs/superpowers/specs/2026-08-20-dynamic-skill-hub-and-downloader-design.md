---
type: adr
date: 2026-08-20
status: proposed
parent: "[[Forecasting Agent]]"
---

# M11 Dynamic Skill Hub, Downloader Engine & Agent Skill Injection — Design Spec

**Issue:** #43 (M11 Skill Registry & Dynamic Skill Hub) · **ADRs:** ADR-021 (Docker Sandbox workspace/skills/ lifecycle), ADR-027 (M11 Skill 3-state machine), ADR-029 (Imported vs agent-discovered skills), ADR-023 (Participant intent agents) · **Depends on:** #4 (Capability Layer), #10 (Participant Agents) · **Blocks:** M10 CLI Delivery Interface

---

## 0. Measured Environment & Codebase Facts

1. **Existing Skills Directory Structure:**
   - Root agent skills: `.agents/skills/` contains 40 existing skills with `SKILL.md` frontmatter (`name`, `description`, instructions, examples).
   - TypeScript harness `ParticipantAgentConfigSchema` in `harness/src/agents/types.ts:18` defines `skills: z.array(z.string()).default([])`, currently empty across all 4 participant agents (`price`, `fii`, `dii`, `retail`).
   - Docker execution sandbox preserves `workspace/skills/` and `workspace/models/` across runs while clearing `workspace/scratch/` per ADR-021.
2. **OpenClaw / ClawHub Pattern:**
   - Skills are modular packages containing `SKILL.md` (metadata, triggers, instructions), `scripts/` (executable code), and `examples/` (few-shot exemplars).
   - Discovered via semantic/keyword search (`npx skills find` or local index), downloaded/cloned into a local folder, and dynamically matched and loaded into agent prompts.
3. **No Dynamic Injection Engine Today:**
   - Participant agent prompt rendering (`harness/src/agents/factory.ts` and `prompts/*.j2`) currently has no dynamic `<skills>` injector; all domain knowledge is hardcoded in the templates.

---

## 1. Architectural Decisions

### 1.1 Two-Tier Skill Model (Prompt Skills + Python Sandbox Code Skills)

```
                               ┌──────────────────────────────────────────────┐
                               │           M11 Skill Architecture             │
                               └──────────────────────┬───────────────────────┘
                                                      │
                       ┌──────────────────────────────┴──────────────────────────────┐
                       ▼                                                             ▼
        ┌─────────────────────────────┐                               ┌─────────────────────────────┐
        │   Tier 1: Analytical        │                               │   Tier 2: Quantitative Code │
        │         Prompt Skills       │                               │            Skills           │
        ├─────────────────────────────┤                               ├─────────────────────────────┤
        │ • Location: `skills/`       │                               │ • Location:                 │
        │ • Format: `SKILL.md`        │                               │   `workspace/skills/*.py`   │
        │ • Injected into Jinja2      │                               │ • Reusable Python feature   │
        │   agent prompts at runtime  │                               │   and modeling scripts in   │
        │ • Defines analysis logic    │                               │   Docker sandbox            │
        │   (Wyckoff VSA, FII Squeeze)│                               │ • `import skills.vsa`       │
        └─────────────────────────────┘                               └─────────────────────────────┘
```

- **Pros:** Clean separation of concerns. LLM gets cognitive analysis frameworks via prompt skills; Python codeAct gets reusable math primitives via code skills without burning token budget re-writing formulas.
- **Cons:** Two distinct skill formats to maintain.
- **Where it fits best:** Quantitative market forecasting where agents combine macro/sentiment reasoning with Python statistical models.
- **Where it does not suit:** Pure chat applications that do not execute sandbox code.

### 1.2 Unified Skill Package Layout
Every skill is organized in a standard, self-contained directory:
```
skills/<skill_name>/
├── SKILL.md          # YAML frontmatter (name, description, tags, target_agents) + Markdown instructions
├── script.py         # Optional Python feature extractor (copied to workspace/skills/ if present)
└── examples/         # Concrete few-shot input/output examples
```

### 1.3 Discovery & Download Engine (`SkillManager`)
- **Local Indexing**: Scans `skills/` and `.agents/skills/` for valid `SKILL.md` manifests.
- **Remote Search & Fetch**:
  - Direct Git clone / GitHub raw fetch (`https://github.com/<owner>/<repo>/tree/main/skills/<skill>`).
  - Integration with `npx skills find <query>` / ClawHub / Skills.sh ecosystem.
  - Verification & Sanitization: Validates YAML frontmatter and scans Python scripts with security checks (rejecting `os.system`, `subprocess`, socket operations outside approved sandbox rules).

### 1.4 Sandbox Code Syncing & Prompt Injection (`SkillInjector` & `SkillRegistry`)
- **Docker Sandbox Code Sync**: When a skill containing `script.py` is loaded, `SkillRegistry` automatically copies or links it to `workspace/skills/<skill_name>.py` so sub-agent Python scripts in Round 1 can execute `import skills.<skill_name>` seamlessly.
- **Dynamic Prompt Injection**:
  - Reads agent configuration (`config.skills`).
  - Resolves required skills from `SkillRegistry`.
  - Injects formatted `<skills>` blocks into Jinja2 prompt contexts with `<skill name="...">` XML boundaries, maintaining prefix cache stability (ADR-028).

### 1.4.1 Dynamic Prompt Injection Engine
- `harness/src/skills/injector.ts`:
  - Reads agent configuration (`config.skills`).
  - Resolves required skills from `SkillRegistry`.
  - Injects formatted `<skills>` blocks into Jinja2 prompt contexts with `<skill name="...">` XML boundaries, maintaining prefix cache stability (ADR-028).

### 1.5 M11 Skill Lifecycle & Pruning (ADR-027)
- **3-State Machine**:
  - `DRAFT`: Newly created or downloaded skill under trial.
  - `ACTIVE`: Validated across >= 3 purged walk-forward folds with MASE < 1.0.
  - `ARCHIVED`: Decayed skill whose rolling 30-day MASE > 1.05.

---

## 2. Pre-Built Indian Quantitative Skills Catalog

We pre-populate 4 premier quantitative skills tailored for the 4 participant agents:

| Skill Name | Target Agent | Primary Analytical Focus |
| :--- | :--- | :--- |
| **`wyckoff-volume-spread`** | `retail`, `price` | Bhavcopy delivery volume vs price spread (Effort vs Result, Absorption vs Distribution). |
| **`fii-derivative-positioning`** | `fii` | Index Futures Long/Short ratio (<15% extreme short squeeze, >80% overbought exhaustion). |
| **`dii-sip-resilience`** | `dii` | Monthly mutual fund cash buffer absorption vs global macro selloffs. |
| **`option-chain-pcr-skew`** | `retail`, `fii` | Strike-wise Open Interest build-up, Max Pain migration, and Put-Call Ratio momentum. |

---

## 3. Interfaces & Implementation Plan

### 3.1 TypeScript Harness Modules (`harness/src/skills/`)

```
harness/src/skills/
├── index.ts
├── types.ts          # Zod schemas: SkillManifestSchema, SkillPackage
├── registry.ts       # Local file scanner, manifest parser, in-memory cache
├── downloader.ts     # Remote fetcher (git clone, github archive, sanitization)
└── injector.ts       # Jinja2 prompt injection formatter
```

#### Schema: `SkillManifestSchema` (`types.ts`)
```typescript
export const SkillManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-_]+$/),
  description: z.string().min(10),
  version: z.string().default("1.0.0"),
  target_agents: z.array(z.enum(["price", "fii", "dii", "retail", "all"])),
  tags: z.array(z.string()).default([]),
  status: z.enum(["draft", "active", "archived"]).default("active"),
});

export interface SkillPackage {
  manifest: z.infer<typeof SkillManifestSchema>;
  instructions: string;
  scriptPath?: string;
  examples: string[];
}
```

#### CLI Skill Commands (`harness/src/cli/skills.ts`)
```bash
forecasting-agent skills list                 # List installed skills and status
forecasting-agent skills search <query>       # Search local & remote skill hubs
forecasting-agent skills add <git-url|name>   # Download, validate, and install skill
forecasting-agent skills remove <name>        # Delete local skill
```

---

## 4. Edge Cases & Defensive Invariants

1. **Malicious / Unsanitized Scripts:** Downloaded Python scripts are statically inspected before placement in `workspace/skills/` to block arbitrary network sockets or host escapes.
2. **Missing Skill Graceful Degradation:** If an agent config declares a skill that is missing from disk, the loader logs a warning and omits the skill without crashing prompt compilation.
3. **Prompt Token Budget Cap:** Injected skill prompts are limited to <= 1,500 tokens per agent to preserve prompt cache and prevent context window exhaustion.
4. **Deterministic Versioning:** All installed skills maintain a version lock in `.skills.lock.json` for backtest reproducibility.

---

## 5. Verification Plan

1. **Unit Tests (`harness/tests/skills/`)**:
   - `registry.test.ts`: Test local skill discovery, YAML frontmatter parsing, and invalid manifest rejection.
   - `downloader.test.ts`: Test mock remote repository download and script sanitization.
   - `injector.test.ts`: Test Jinja2 prompt injection and token bounding.
2. **Integration Tests**:
   - Verify all 4 participant agents render their respective skills in prompt templates.
   - Verify Docker sandbox executes `script.py` when mounted in `workspace/skills/`.
3. **Full Suite Quality Gates**:
   - `pnpm --prefix harness test` (all 282+ tests passing).
   - `uv run pytest` (all 299+ tests passing).

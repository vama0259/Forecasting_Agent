# UI Debate Viewer — Implementation Plan

> **For the human dispatching this:** each task's "Gemini delegation prompt" is ready to paste into `agy --print "<prompt>" --add-dir ui/ --mode accept-edits`. Handoff and dispatch are intentionally NOT done by this plan — run each task yourself, in order (1 before 2, both before 3-4, all of 2-4 before 5-11, 5-11 before 12). Verify every task's "Validator brief" yourself before moving to the next — never accept Gemini's own "tests pass" claim, re-run cold (per the project's Gemini-delegation known-quality-gap list).

**Goal:** Build the live multi-agent debate viewer UI against a typed mock event stream — no real harness streaming route yet (that's a separate future plan). Implements `docs/superpowers/specs/2026-08-19-ui-debate-viewer-design.md`, cleared 2 consecutive `APPROVED` reviews (7 rounds).

**Architecture:** `ui/` (Next.js 16.3.1 + React 19.2 + Tailwind v4, already scaffolded, shadcn preset applied). `src/lib/mock-debate/` is a pure-TS module with zero React dependency (types, fixtures, pacing logic) — the seam the real streaming route will target later. `src/components/debate/` consumes only the `DebateEvent` type, never the mock directly.

**Tech Stack:** TypeScript, Vitest + `@testing-library/react` (new — `ui/` has no test runner yet, matching `harness/`'s existing `vitest` choice for consistency across the monorepo), AI Elements (`npx ai-elements@latest add ...`), Magic UI (`pnpm dlx shadcn@latest add @magicui/...`), Recharts.

## Global Constraints (every task)

- **No `git push`.** No task in this plan pushes to any remote. Local commits only, if any — the user decides when to push.
- **No Obsidian vault writes.** Nothing in this plan touches `/home/varunmalhotra/Desktop/Knowledge`. Per this project's own CLAUDE.md, obsidian-git handles vault sync on its own schedule — never run git or file-write commands there. Gemini has drifted into unprompted vault writes before (Gemini-delegation known-quality-gap list, item 4) — check `git status` after every task for exactly this.
- **Never trust "tests pass" as self-reported.** Re-run the exact test command yourself from a cold shell after every task.
- **One-line-abstract + one-line-per-function comments** on every new file (repo CLAUDE.md Code Style rule) — a top-of-file comment stating what the file does, one line per exported function/component stating input/output. No multi-line docstrings.
- **Color is never the sole distinguisher** (spec §3) — every agent-colored element also carries the agent's name/icon; this is a Validator-brief check on every component task from Task 6 onward, not just a design note.
- **`prefers-reduced-motion` respected** on every animated component (`Shimmer`, Border Beam) — render final state immediately when set.
- All commands run from `ui/` via `pnpm`.

---

## File Structure

```
ui/
  src/
    lib/mock-debate/
      types.ts        -- Task 2
      fixtures.ts      -- Task 4
      stream.ts        -- Task 3
    components/debate/
      checkpoint-timeline.tsx   -- Task 6
      agent-card.tsx            -- Task 7
      reasoning-panel.tsx       -- Task 8
      sandbox-output.tsx        -- Task 9
      evidence-list.tsx         -- Task 10
      forecast-chart.tsx        -- Task 11
    app/
      page.tsx                  -- Task 12 (composes everything)
      layout.tsx                -- Task 1 (fonts)
      globals.css                -- Task 1 (tokens)
  vitest.config.ts               -- Task 0
```

---

## Task 0: Test tooling

**Files:** Create `ui/vitest.config.ts`, `ui/vitest.setup.ts`. Edit `ui/package.json` (add `test` script + devDeps).

**Seam note:** Nothing to seam — this is infrastructure every other task depends on. Must run first, alone.

- [x] **Step 1: No test for this task** (tooling setup has no behavior to assert against — it's verified by Task 1 onward actually running tests successfully)
- [x] **Step 2: Install & configure**

**Gemini delegation prompt:**
```
In ui/ (Next.js 16.3.1, React 19.2, Tailwind v4 project), add Vitest + React Testing Library
for component testing, matching the pattern already used in the sibling harness/ package
(harness/package.json has "test": "vitest run --fileParallelism=false").

1. pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
2. Create ui/vitest.config.ts: use the react plugin, environment 'jsdom', setupFiles
   ['./vitest.setup.ts'], and resolve.alias mapping '@' to './src' (matching tsconfig's
   paths alias already in ui/tsconfig.json).
3. Create ui/vitest.setup.ts: import '@testing-library/jest-dom'.
4. Add "test": "vitest run" to ui/package.json scripts.
5. Verify: create a throwaway ui/src/__smoke__.test.ts with `import { it, expect } from
   'vitest'; it('works', () => expect(1).toBe(1));`, run `pnpm test`, confirm it passes,
   then delete the throwaway file.

Do not run git push. Do not touch anything outside ui/.
```

**Validator brief:**
- [x] `cat ui/vitest.config.ts` — confirms jsdom environment, `@` alias present
- [x] `cd ui && pnpm test` — runs clean, no leftover `__smoke__.test.ts` file (`git status` shows only intended files)
- [x] `git status` — no vault writes, nothing outside `ui/`

---

## Task 1: Design tokens & fonts

**Files:** Edit `ui/src/app/globals.css`, `ui/src/app/layout.tsx`.

**Seam note:** Pure CSS/config change, no logic — verified by visual inspection + a rendering smoke test, not unit tests.

- [x] **Step 1: Write the failing test**
```ts
// ui/src/app/__tests__/layout.test.tsx
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('design tokens', () => {
  it('globals.css defines the debate-viewer palette, not the zero-chroma preset default', () => {
    const css = readFileSync('src/app/globals.css', 'utf-8');
    expect(css).toContain('--agent-technical');
    expect(css).toContain('--agent-sentiment');
    expect(css).toContain('--agent-macro');
    expect(css).toContain('--round-challenge');
    expect(css).toContain('--signal-bull');
    expect(css).toContain('--signal-bear: #EF4444'); // NOT #DC2626 — the AA-failing color rejected in spec review
  });
});
```
- [x] **Step 2: Run test to verify it fails** — `pnpm test src/app/__tests__/layout.test.tsx` — expect FAIL (tokens don't exist yet)
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
In ui/src/app/globals.css, replace the :root block's color tokens (currently the shadcn
base-rhea zero-chroma default) with exactly this palette — copy verbatim from
docs/superpowers/specs/2026-08-19-ui-debate-viewer-design.md §2's CSS block:

  --background: #050810;
  --card: #0B0F1A;
  --foreground: #F1F3F5;
  --muted-foreground: #8B93A7;
  --border: #1E2433;
  --signal-bull: #16A34A;
  --signal-bear: #EF4444;
  --agent-technical: #3399CC;
  --agent-sentiment: #F0B429;
  --agent-macro: #21C99A;
  --round-challenge: #B45BCE;

Keep the existing --card-foreground/--popover/etc. structural tokens from base-rhea (only
replace the color VALUES per above, don't remove tokens the shadcn components still need —
map --card-foreground to --foreground, --popover to --card, etc. for anything not listed).

In ui/src/app/layout.tsx, load three Google Fonts via next/font/google: Newsreader
(headers), IBM Plex Sans (body — weights 400,500,600,700), IBM Plex Mono (data/tool output —
weights 400,500). Wire them as CSS variables (--font-newsreader, --font-plex-sans,
--font-plex-mono) applied to <html> or <body> className, and reference --font-plex-sans as
the default --font-sans in globals.css's @theme inline block (it currently maps --font-sans
to var(--font-sans) from create-next-app's default Geist — replace that mapping).

Run `pnpm test src/app/__tests__/layout.test.tsx` until it passes. Then `pnpm dev` briefly
to confirm the app still renders (no CSS/font loading errors in console), then stop the dev
server. Do not run git push.
```

**Validator brief:**
- [x] `pnpm test src/app/__tests__/layout.test.tsx` passes (re-run yourself, don't trust the report)
- [x] Read `ui/src/app/globals.css` — confirm `--signal-bear` is exactly `#EF4444`, not `#DC2626`
- [x] `pnpm dev`, open in browser, confirm dark background renders (not the old white/gray default) and no font-loading console errors

---

## Task 2: `DebateEvent` type

**Files:** Create `ui/src/lib/mock-debate/types.ts`, `ui/src/lib/mock-debate/types.test.ts`.

**Seam note:** Zero dependencies — pure type module. This is the contract every later task (3-12) is written against; get this exactly right, it doesn't change again without touching every consumer.

- [x] **Step 1: Write the failing test**
```ts
// ui/src/lib/mock-debate/types.test.ts
import { describe, it, expect } from 'vitest';
import type { DebateEvent } from './types';

function describeEvent(e: DebateEvent): string {
  switch (e.type) {
    case 'round-start': return `round-start:${e.round}:${e.roundIndex}`;
    case 'agent-turn-start': return `agent-turn-start:${e.agent}`;
    case 'reasoning-token': return `reasoning-token:${e.token}`;
    case 'tool-call': return `tool-call:${e.tool}`;
    case 'tool-result': return `tool-result:${e.status}`;
    case 'evidence': return `evidence:${e.source}`;
    case 'devils-advocate-assigned': return `devils-advocate-assigned:${e.agent}`;
    case 'consensus': return `consensus:${e.scenarios.length}`;
    case 'forecast': return `forecast:${e.horizon}`;
  }
}

describe('DebateEvent', () => {
  it('exhaustively narrows every variant', () => {
    expect(describeEvent({ type: 'round-start', round: 'debate', roundIndex: 2 }))
      .toBe('round-start:debate:2');
    expect(describeEvent({ type: 'tool-result', agent: 'technical', tool: 'run_backtest', status: 'error', output: undefined }))
      .toBe('tool-result:error');
  });
});
```
- [x] **Step 2: Run test to verify it fails** — `pnpm test src/lib/mock-debate/types.test.ts` — expect FAIL (`Cannot find module './types'`)
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/lib/mock-debate/types.ts. Copy the DebateEvent discriminated union EXACTLY as
written in docs/superpowers/specs/2026-08-19-ui-debate-viewer-design.md §5 — do not modify
the shape, it was verified to compile under `tsc --strict --noEmit` during spec review and
every consumer task in this plan is written against this exact contract. Also export the
Round and AgentId types from the same spec section.

Add a one-line file-top comment and one-line-per-exported-type comment per this repo's
CLAUDE.md Code Style rule.

Run `pnpm test src/lib/mock-debate/types.test.ts` until it passes, then
`npx tsc --noEmit --strict` from ui/ to confirm no project-wide type errors. Do not run git
push.
```

**Validator brief:**
- [x] `pnpm test src/lib/mock-debate/types.test.ts` passes
- [x] `cd ui && npx tsc --noEmit --strict` clean
- [x] Diff the type against spec §5 — must match exactly, including the `status: "success" | "error"` field from Round 1's review fix

---

## Task 3: `MockDebateStream`

**Files:** Create `ui/src/lib/mock-debate/stream.ts`, `ui/src/lib/mock-debate/stream.test.ts`. Depends on Task 2.

**Seam note:** Pure async-generator logic, no React, no timers left running after the test (must be cancellable/awaitable in tests without real delays — use `vi.useFakeTimers()`). This is the exact seam a real `fetch`-stream consumer swaps in later.

- [x] **Step 1: Write the failing test**
```ts
// ui/src/lib/mock-debate/stream.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockDebateStream } from './stream';
import type { DebateEvent } from './types';

describe('MockDebateStream', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replays a fixture array in order, one event per tick', async () => {
    const fixture: DebateEvent[] = [
      { type: 'round-start', round: 'independent', roundIndex: 1 },
      { type: 'agent-turn-start', agent: 'technical', round: 'independent' },
    ];
    const stream = new MockDebateStream(fixture, { delayMs: 10 });
    const received: DebateEvent[] = [];
    const iterPromise = (async () => {
      for await (const event of stream) received.push(event);
    })();
    await vi.advanceTimersByTimeAsync(100);
    await iterPromise;
    expect(received).toEqual(fixture);
  });
});
```
- [x] **Step 2: Run test to verify it fails** — expect FAIL (`Cannot find module './stream'`)
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/lib/mock-debate/stream.ts, depends on ./types.ts (already exists — Task 2).

Implement:

  export interface MockDebateStreamOptions { delayMs?: number; }

  export class MockDebateStream implements AsyncIterable<DebateEvent> {
    constructor(fixture: DebateEvent[], options?: MockDebateStreamOptions);
    [Symbol.asyncIterator](): AsyncIterator<DebateEvent>;
  }

Behavior: yields each event from the fixture array in order, waiting `delayMs` (default 150)
between each via setTimeout, so a consumer using `for await (const event of stream)` sees
events arrive paced like a real token/event stream rather than all at once. This is the
seam a real fetch-based stream consumer will replace later — the *shape* (AsyncIterable of
DebateEvent) must not change when that happens.

Add a one-line file-top comment and one-line-per-exported-member comment.

Run `pnpm test src/lib/mock-debate/stream.test.ts` until it passes. Do not run git push.
```

**Validator brief:**
- [x] `pnpm test src/lib/mock-debate/stream.test.ts` passes with fake timers (confirms no real 150ms×N wait in CI)
- [x] Read the implementation — confirm it's `AsyncIterable<DebateEvent>`, not tied to React/DOM in any way (the seam claim in the spec depends on this)

---

## Task 4: Fixture — one full 4-round run

**Files:** Create `ui/src/lib/mock-debate/fixtures.ts`, `ui/src/lib/mock-debate/fixtures.test.ts`. Depends on Task 2.

**Seam note:** Hand-authored data, not logic — the test asserts *structural* validity against the debate protocol (ADR-007), not against arbitrary content.

- [x] **Step 1: Write the failing test**
```ts
// ui/src/lib/mock-debate/fixtures.test.ts
import { describe, it, expect } from 'vitest';
import { fullDebateFixture } from './fixtures';

describe('fullDebateFixture', () => {
  it('has exactly one round-start per round, in order 1-4', () => {
    const starts = fullDebateFixture.filter(e => e.type === 'round-start');
    expect(starts.map(s => (s as any).roundIndex)).toEqual([1, 2, 3, 4]);
  });

  it('round 3 (devils-advocate) has a devils-advocate-assigned event', () => {
    expect(fullDebateFixture.some(e => e.type === 'devils-advocate-assigned')).toBe(true);
  });

  it('ends with consensus then forecast', () => {
    const last2 = fullDebateFixture.slice(-2).map(e => e.type);
    expect(last2).toEqual(['consensus', 'forecast']);
  });

  it('every agent (technical, sentiment, macro) gets at least one turn', () => {
    const agents = new Set(
      fullDebateFixture.filter(e => 'agent' in e).map(e => (e as any).agent)
    );
    expect(agents).toEqual(new Set(['technical', 'sentiment', 'macro']));
  });
});
```
- [x] **Step 2: Run test to verify it fails** — expect FAIL (`Cannot find module './fixtures'`)
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/lib/mock-debate/fixtures.ts, depends on ./types.ts (Task 2).

Export `fullDebateFixture: DebateEvent[]` — a hand-authored, realistic-reading sequence
covering all 4 rounds of the debate protocol (docs/ARCHITECTURE.md "4-Round Debate
Protocol"):
  R1 independent (roundIndex 1): each of technical/sentiment/macro gets an
    agent-turn-start, a few reasoning-token events forming a plausible sentence when
    concatenated, at least one tool-call+tool-result (e.g. technical runs a backtest,
    sentiment calls a news-search tool), and at least one evidence event.
  R2 debate (roundIndex 2): agents reference each other's R1 claims in reasoning-token text.
  R3 devils-advocate (roundIndex 3): a devils-advocate-assigned event naming one agent and a
    targetClaim string, then that agent's turn arguing against it.
  R4 consensus (roundIndex 4): a consensus event with 2 scenarios (bull, bear — probabilities
    summing to ~1.0), immediately followed by one forecast event with realistic-looking
    actual/forecast/confidenceBand numeric arrays (e.g. 20 points).

Write plausible financial-analysis text for reasoning-token content (this is what a reviewer
will actually read when eyeballing the UI later — make it read like real analysis, not
lorem ipsum).

Add a one-line file-top comment.

Run `pnpm test src/lib/mock-debate/fixtures.test.ts` until it passes. Do not run git push.
```

**Validator brief:**
- [x] `pnpm test src/lib/mock-debate/fixtures.test.ts` passes
- [x] Read the fixture's reasoning-token text yourself — confirm it reads as real analysis, not placeholder text (this fixture is what you'll be looking at every time you eyeball the UI)

---

## Task 5: Install component libraries

**Files:** None created — installs only. Depends on nothing (can run parallel to Tasks 2-4).

**Seam note:** N/A — this is a dependency-install task, verified by import success in Tasks 6-11, not by a standalone test.

- [x] **Step 1: No test** (nothing to assert until a component imports these)
- [x] **Step 2: Install**

**Gemini delegation prompt:**
```
In ui/, run these installs exactly (all previously verified to exist during spec review —
do not substitute alternate package/component names):

npx ai-elements@latest add checkpoint agent persona reasoning chain-of-thought tool stack-trace plan task sources inline-citation shimmer
pnpm dlx shadcn@latest add @magicui/terminal
pnpm dlx shadcn@latest add @magicui/border-beam
pnpm add recharts

If any `ai-elements add` slug errors as unknown (a few of these were not individually
pre-verified — see spec §7 "Accepted low-risk item"), report exactly which slug failed and
stop — do not guess a substitute name.

Run `npx tsc --noEmit --strict` after all installs to confirm nothing broke. Do not run git
push.
```

**Validator brief:**
- [x] `ls ui/src/components/ui/` — confirms all expected component files landed
- [x] `cd ui && npx tsc --noEmit --strict` clean
- [x] If Gemini reported an unknown slug: resolve it yourself (check `elements.ai-sdk.dev`) before proceeding to Tasks 6-11 that depend on it

---

## Task 6: Checkpoint timeline

**Files:** Create `ui/src/components/debate/checkpoint-timeline.tsx` + test. Depends on Tasks 2, 5.

**Seam note:** Consumes `DebateEvent[]` (or a derived `RoundSummary[]`), renders via AI Elements' `Checkpoint`. R3 must render with `--round-challenge`, not the uniform default — this is Grill finding from spec Round 5, test it explicitly.

- [x] **Step 1: Write the failing test**
```tsx
// ui/src/components/debate/checkpoint-timeline.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CheckpointTimeline } from './checkpoint-timeline';
import { fullDebateFixture } from '@/lib/mock-debate/fixtures';

describe('CheckpointTimeline', () => {
  it('renders all 4 round labels', () => {
    render(<CheckpointTimeline events={fullDebateFixture} />);
    expect(screen.getByText(/independent/i)).toBeInTheDocument();
    expect(screen.getByText(/debate/i)).toBeInTheDocument();
    expect(screen.getByText(/devil/i)).toBeInTheDocument();
    expect(screen.getByText(/consensus/i)).toBeInTheDocument();
  });

  it('gives round 3 a visually distinct style attribute, not shared with rounds 1/2/4', () => {
    render(<CheckpointTimeline events={fullDebateFixture} />);
    const r3 = screen.getByTestId('checkpoint-round-3');
    const r1 = screen.getByTestId('checkpoint-round-1');
    expect(r3.style.getPropertyValue('--round-accent')).not.toBe(r1.style.getPropertyValue('--round-accent'));
  });
});
```
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/components/debate/checkpoint-timeline.tsx. Props: { events: DebateEvent[] }
(import DebateEvent from '@/lib/mock-debate/types'). Derive 4 round summaries from the
round-start events in `events` (round, roundIndex, label text — "Independent Analysis",
"Debate", "Devil's Advocate", "Consensus"). Render using the installed AI Elements
`Checkpoint` component (ui/src/components/ui/checkpoint.tsx — read it first to see its
actual prop API before writing this).

Each round node needs `data-testid="checkpoint-round-{roundIndex}"`. Round 3 specifically
must set an inline CSS custom property `--round-accent: var(--round-challenge)` on its node;
rounds 1/2/4 must NOT set that property to the same value (leave them using Checkpoint's
default styling, or set --round-accent to a neutral/unset value) — this is a deliberate
accessibility/design requirement from spec review, not a style preference, so don't
"simplify" it to one shared class.

Add file-top + per-export comments per CLAUDE.md Code Style.

Run `pnpm test src/components/debate/checkpoint-timeline.test.tsx` until it passes. Do not
run git push.
```

**Validator brief:**
- [x] `pnpm test src/components/debate/checkpoint-timeline.test.tsx` passes
- [x] Visually confirm in `pnpm dev` that R3 actually looks different (open the page, don't just trust the DOM-attribute test)
- [x] Confirm no `Message`/`Conversation` AI Elements import anywhere in this file (spec's explicit exclusion)

---

## Task 7: Agent card

**Files:** Create `ui/src/components/debate/agent-card.tsx` + test. Depends on Tasks 2, 5.

**Seam note:** Props take a single `AgentId` + display state, not the whole event array — keeps this component reusable inside Tasks 8-10 without them needing to know about the mock stream at all.

- [x] **Step 1: Write the failing test**
```tsx
// ui/src/components/debate/agent-card.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentCard } from './agent-card';

describe('AgentCard', () => {
  it('renders the agent name as visible text, not color-only', () => {
    render(<AgentCard agent="macro" active={false} />);
    expect(screen.getByText(/macro/i)).toBeInTheDocument();
  });

  it('every agent maps to its own --agent-* color variable', () => {
    const { rerender, container } = render(<AgentCard agent="technical" active={false} />);
    const c1 = (container.firstChild as HTMLElement).style.getPropertyValue('--agent-accent');
    rerender(<AgentCard agent="sentiment" active={false} />);
    const c2 = (container.firstChild as HTMLElement).style.getPropertyValue('--agent-accent');
    rerender(<AgentCard agent="macro" active={false} />);
    const c3 = (container.firstChild as HTMLElement).style.getPropertyValue('--agent-accent');
    expect(new Set([c1, c2, c3]).size).toBe(3);
  });
});
```
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/components/debate/agent-card.tsx. Props:
  { agent: AgentId; active: boolean } (AgentId from '@/lib/mock-debate/types')
Display name mapping: technical -> "Technical", sentiment -> "Sentiment", macro -> "Macro"
(always render this as visible text — never color-only, per spec's accessibility
constraint). Use the installed AI Elements Agent + Persona components (read
ui/src/components/ui/agent.tsx and persona.tsx first for their actual prop API). Set inline
`--agent-accent: var(--agent-{agent})` on the root element (e.g. technical ->
var(--agent-technical)) so the color-distinctness test can verify it. When `active` is true,
show the Shimmer component (ui/src/components/ui/shimmer.tsx) to indicate this agent is
currently reasoning — wrap it in a check for `window.matchMedia('(prefers-reduced-motion:
reduce)').matches` and skip the animation (render final/static state) when true.

Add file-top + per-export comments.

Run `pnpm test src/components/debate/agent-card.test.tsx` until it passes. Do not run git
push.
```

**Validator brief:**
- [x] `pnpm test src/components/debate/agent-card.test.tsx` passes
- [x] Read the component — confirm agent name text is always rendered, never conditionally hidden
- [x] Confirm the `prefers-reduced-motion` check is real code, not a comment saying it's handled

---

## Task 8: Reasoning panel

**Files:** Create `ui/src/components/debate/reasoning-panel.tsx` + test. Depends on Tasks 2, 5.

**Seam note:** Consumes an already-accumulated string (component doesn't know about streaming/tokens — that's the parent page's job in Task 12), keeping this component trivially testable without fake timers.

- [x] **Step 1: Write the failing test**
```tsx
// ui/src/components/debate/reasoning-panel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReasoningPanel } from './reasoning-panel';

describe('ReasoningPanel', () => {
  it('renders accumulated reasoning text', () => {
    render(<ReasoningPanel agent="sentiment" text="Sentiment is turning bullish because..." streaming={false} />);
    expect(screen.getByText(/turning bullish/i)).toBeInTheDocument();
  });
});
```
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/components/debate/reasoning-panel.tsx. Props:
  { agent: AgentId; text: string; streaming: boolean }
Use the installed AI Elements Reasoning and ChainOfThought components (read
ui/src/components/ui/reasoning.tsx and chain-of-thought.tsx first for actual prop API) to
render `text` as a collapsible reasoning trace, labeled with the agent name (reuse the same
display-name mapping as agent-card.tsx: technical/sentiment/macro -> Technical/Sentiment/
Macro). `streaming` controls whether to show a live-typing indicator vs a settled/complete
state.

Add file-top + per-export comments.

Run `pnpm test src/components/debate/reasoning-panel.test.tsx` until it passes. Do not run
git push.
```

**Validator brief:**
- [x] `pnpm test src/components/debate/reasoning-panel.test.tsx` passes
- [x] Confirm this component takes plain props (no direct dependency on `MockDebateStream` or `DebateEvent[]`) — the seam this task exists for

---

## Task 9: Sandbox output

**Files:** Create `ui/src/components/debate/sandbox-output.tsx` + test. Depends on Tasks 2, 5.

**Seam note:** Must branch on `tool-result`'s `status` field (the Round 1 spec-review fix) — test this explicitly, it's the exact bug that review round caught.

- [x] **Step 1: Write the failing test**
```tsx
// ui/src/components/debate/sandbox-output.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SandboxOutput } from './sandbox-output';

describe('SandboxOutput', () => {
  it('renders normal Terminal output on success', () => {
    render(<SandboxOutput tool="run_backtest" status="success" output={{ sharpe: 1.2 }} stdout="Backtest complete" />);
    expect(screen.getByText(/Backtest complete/i)).toBeInTheDocument();
    expect(screen.queryByTestId('stack-trace')).not.toBeInTheDocument();
  });

  it('renders Stack Trace on error, distinct from success rendering', () => {
    render(<SandboxOutput tool="run_backtest" status="error" output={undefined} stderr="Traceback (most recent call last)..." />);
    expect(screen.getByTestId('stack-trace')).toBeInTheDocument();
  });
});
```
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/components/debate/sandbox-output.tsx. Props:
  { tool: string; status: "success" | "error"; output: unknown; stdout?: string; stderr?: string }
(matches the DebateEvent 'tool-result' variant's fields exactly — this component IS that
variant's renderer.)

When status === "success": render stdout inside the installed Magic UI Terminal component
(ui/src/components/ui/terminal.tsx — read it first for its prop API) wrapped in AI Elements'
Tool component for the call/result envelope chrome.

When status === "error": render stderr inside AI Elements' StackTrace component (read
ui/src/components/ui/stack-trace.tsx first), with `data-testid="stack-trace"` on its root.
Do NOT render the Terminal component in the error case — these are deliberately different
render paths per spec review (a Round 1 finding: success and error must not share ambiguous
rendering).

Add file-top + per-export comments.

Run `pnpm test src/components/debate/sandbox-output.test.tsx` until it passes. Do not run
git push.
```

**Validator brief:**
- [x] `pnpm test src/components/debate/sandbox-output.test.tsx` passes
- [x] Read the component — confirm `status === "error"` and `status === "success"` are genuinely different render branches, not the same JSX with a conditional className

---

## Task 10: Evidence list

**Files:** Create `ui/src/components/debate/evidence-list.tsx` + test. Depends on Tasks 2, 5.

**Seam note:** Straightforward list-rendering, lowest-risk task in this plan — good one to delegate first if running tasks out of strict order for schedule reasons (still respect the Task 2/5 dependency).

- [x] **Step 1: Write the failing test**
```tsx
// ui/src/components/debate/evidence-list.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceList } from './evidence-list';

describe('EvidenceList', () => {
  it('renders each evidence source with its snippet', () => {
    render(<EvidenceList items={[
      { source: 'Reuters', url: 'https://reuters.com/x', snippet: 'Q3 earnings beat estimates' },
      { source: 'Internal analysis', snippet: 'RSI shows oversold conditions' },
    ]} />);
    expect(screen.getByText(/Q3 earnings beat/i)).toBeInTheDocument();
    expect(screen.getByText(/RSI shows oversold/i)).toBeInTheDocument();
  });
});
```
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/components/debate/evidence-list.tsx. Props:
  { items: Array<{ source: string; url?: string; snippet: string }> }
(matches DebateEvent's 'evidence' variant fields, minus 'agent'/'type'.) Render using the
installed AI Elements Sources and InlineCitation components (read
ui/src/components/ui/sources.tsx and inline-citation.tsx first). If `url` is present, make
the source name a link; if absent, render as plain text (no broken/empty href).

Add file-top + per-export comments.

Run `pnpm test src/components/debate/evidence-list.test.tsx` until it passes. Do not run git
push.
```

**Validator brief:**
- [x] `pnpm test src/components/debate/evidence-list.test.tsx` passes
- [x] Confirm no `<a href="">` or `<a href={undefined}>` for evidence items without a URL

---

## Task 11: Forecast chart

**Files:** Create `ui/src/components/debate/forecast-chart.tsx` + test. Depends on Tasks 2, 5.

**Seam note:** The one component with a real accessibility contract from spec review (§3: solid actual line, dashed forecast line, labeled confidence band, hue never sole distinguisher) — test the line-style distinction explicitly, not just that a chart renders.

- [x] **Step 1: Write the failing test**
```tsx
// ui/src/components/debate/forecast-chart.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForecastChart } from './forecast-chart';

const sample = {
  horizon: '5d',
  actual: [100, 101, 99, 102, 103],
  forecast: [103, 104, 105, 106, 107],
  confidenceBand: [[102, 108], [101, 109], [100, 110], [99, 111], [98, 112]] as [number, number][],
};

describe('ForecastChart', () => {
  it('renders direct labels for actual and forecast series, not color-only legend', () => {
    render(<ForecastChart data={sample} />);
    expect(screen.getByText(/actual/i)).toBeInTheDocument();
    expect(screen.getByText(/forecast/i)).toBeInTheDocument();
  });

  it('gives the confidence band an accessible summary, per spec a11y fallback requirement', () => {
    render(<ForecastChart data={sample} />);
    expect(screen.getByText(/confidence/i)).toBeInTheDocument();
  });
});
```
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Create ui/src/components/debate/forecast-chart.tsx using Recharts (already installed - Task
5). Props:
  { data: { horizon: string; actual: number[]; forecast: number[]; confidenceBand: [number, number][] } }
(matches DebateEvent's 'forecast' variant.)

Follow the exact accessibility guidance from spec §3 (sourced from ui-ux-pro-max's
verified "Time-Series Forecast" chart-domain entry, do not deviate):
- Actual series: solid line, color var(--foreground) or similar neutral (not an agent
  color — this is aggregate, not per-agent).
- Forecast series: DASHED line (strokeDasharray), not just a different color — line
  style is the required distinguisher, hue alone is insufficient per spec.
- Confidence band: Area between the two confidenceBand values, ~15% opacity fill.
- Both series need a direct visible label near/on the chart (e.g. Recharts <Legend> or
  inline labels) — "Actual" and "Forecast" must appear as visible text, not only inferable
  from a color key.
- Include a visually-hidden (sr-only, not display:none) text summary near the chart
  describing the confidence range in words, e.g. "5-day forecast: 107, confidence range 98
  to 112" — this is the spec's required a11y fallback for the chart.

Add file-top + per-export comments.

Run `pnpm test src/components/debate/forecast-chart.test.tsx` until it passes. Do not run
git push.
```

**Validator brief:**
- [x] `pnpm test src/components/debate/forecast-chart.test.tsx` passes
- [x] Read the component — confirm the forecast line actually uses `strokeDasharray` (or equivalent), not just a different stroke color
- [x] Confirm the sr-only summary text is present in the DOM (inspect, don't just trust it renders correctly — `sr-only` classes are easy to get wrong and accidentally hide from everyone or no one)

---

## Task 12: Compose the page

**Files:** Edit `ui/src/app/page.tsx`. Depends on ALL of Tasks 1-11 (final integration task).

**Seam note:** This is the only task that ever imports `MockDebateStream` directly — every component below it only knows about `DebateEvent`/derived props, per the Dependency Inversion structure from spec §4. Swapping the mock for a real stream later only ever touches this one file.

- [x] **Step 1: Write the failing test**
```tsx
// ui/src/app/__tests__/page.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Page from '../page';

describe('debate viewer page', () => {
  it('eventually renders all 4 rounds and the final forecast after the mock stream completes', async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/consensus/i)).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText(/technical/i)).toBeInTheDocument();
    expect(screen.getByText(/sentiment/i)).toBeInTheDocument();
    expect(screen.getByText(/macro/i)).toBeInTheDocument();
  });
});
```
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement**

**Gemini delegation prompt:**
```
Edit ui/src/app/page.tsx (client component — add "use client" at top since this consumes
state and an async stream). Compose all of ui/src/components/debate/*.tsx (Tasks 6-11)
against `new MockDebateStream(fullDebateFixture)` (from '@/lib/mock-debate/stream' and
'@/lib/mock-debate/fixtures').

Consume the stream in a useEffect with `for await (const event of stream)`, accumulating
state per DebateEvent variant (round-start -> update current round for CheckpointTimeline;
agent-turn-start -> mark that agent active; reasoning-token -> append to that agent's
accumulated reasoning text; tool-call/tool-result -> feed SandboxOutput; evidence -> feed
EvidenceList; devils-advocate-assigned -> mark that round's challenge target; consensus +
forecast -> feed ForecastChart at the end). Layout: CheckpointTimeline at the top showing
round progress, then per-round content (AgentCard x3 + ReasoningPanel + SandboxOutput +
EvidenceList for whichever round is current/being viewed), ForecastChart appears once the
'forecast' event arrives.

Do NOT import AI Elements' Message or Conversation components anywhere in this file — the
spec explicitly excludes them (§3, "Explicitly excluded").

Add file-top + per-export comments.

Run `pnpm test src/app/__tests__/page.test.tsx` until it passes (10s timeout is intentional —
the mock stream's fixture takes real wall-clock time to fully replay in this integration
test, unlike the fake-timer unit tests in earlier tasks). Then `pnpm dev`, open in browser,
watch the full mock debate play out, confirm it visually reads as a transcript/timeline, not
a chat app. Do not run git push.
```

**Validator brief:**
- [x] `pnpm test src/app/__tests__/page.test.tsx` passes (cold re-run, real wait — don't shortcut this one)
- [x] `pnpm dev`, actually watch the mock debate play out in a browser — this is the "wow, not another AI bot" check, and it's the one thing in this entire plan that can't be verified by reading code or running `tsc`
- [x] `grep -ri "Message\|Conversation" ui/src/app/page.tsx` — confirm neither AI Elements component was pulled in
- [x] Final `git status` across the whole repo — confirm nothing was pushed, nothing touched the Obsidian vault, and everything changed is inside `ui/`

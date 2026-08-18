---
type: adr
date: 2026-08-19
status: proposed
parent: "[[Forecasting Agent]]"
---

# UI Debate Viewer — Design Spec

**Depends on:** ADR-001 (TS harness), ADR-004 (Docker sandbox), ADR-007 (multi-scenario output), 4-round debate protocol (docs/ARCHITECTURE.md "Core Concept"). **Scaffolded:** `ui/` (Next.js 16.3.1, React 19.2, Tailwind v4, App Router, shadcn `base-rhea` style — preset applied 2026-08-19).

## 1. Purpose

Show the full multi-agent debate as it happens — not a chat transcript, a **record of an argument being adjudicated**. Three sub-agents (Technical / Sentiment / Macro) each write and run code, argue, get challenged, and reach (or fail to reach) consensus across 4 rounds. The user's explicit requirement: this must not read as "another AI chatbot" — no generic dark-navy-plus-green SaaS dashboard, no chat bubbles.

**Non-goal for this pass:** wiring the real LangGraph stream. `harness/` has no HTTP layer yet (verified — no Express/Fastify/Hono dependency in `harness/package.json`, no server file under `harness/src/`). Building that streaming route is a separate, harder problem; coupling it to visual-design iteration would make every design change block on debugging live infra. This spec covers **UI against a typed mock data stream** — the mock's shape *is* the seam the real streaming route will target later, so nothing here is thrown away.

## 2. Design tokens (overrides the applied preset)

The shadcn preset applied to `ui/` (`base-rhea`, `baseColor: neutral`) is confirmed **near-zero-chroma across the working palette** (read from `ui/src/app/globals.css` — every `--color-*` is `oklch(_, 0, _)`, the only chromatic tokens are `--destructive` and `.dark`'s unused `--sidebar-primary`, and this design uses neither the destructive token nor the sidebar system). That's shadcn's stock grayscale default; every tutorial ships it unmodified. The block below **replaces** `base-rhea`'s `:root`/`.dark` tokens wholesale, not selectively — so this distinction doesn't affect the new palette, only corrects what was said about the old one.

```css
/* ui/src/app/globals.css — replaces the :root and .dark blocks from base-rhea */
:root {
  /* dark-first: OLED-safe base for long live-viewing sessions */
  --background: #050810;
  --card: #0B0F1A;
  --foreground: #F1F3F5;
  --muted-foreground: #8B93A7;
  --border: #1E2433;

  /* signal colors — reserved for bull/bear forecast state, NOT agent identity.
     Verified WCAG AA (4.5:1+) against --background. */
  --signal-bull: #16A34A;  /* 6.08:1 */
  --signal-bear: #EF4444;  /* 5.32:1 — #DC2626 (initial pick) only hit 4.15:1, fails AA text minimum */

  /* agent identity — fixed hues, verified WCAG AA (4.5:1+) against --background,
     deliberately excludes red/green so it never collides with --signal-* */
  --agent-technical: #3399CC;
  --agent-sentiment: #F0B429;
  --agent-macro: #21C99A;

  /* devil's-advocate round (R3) marker — distinct from the above 5, used only
     on the Checkpoint timeline node for R3, never as an agent or signal color */
  --round-challenge: #B45BCE;
}
```

Typography:
- **Headers (round labels, verdict, agent names):** Newsreader — serif built for long-form reading; reads as "record," not marketing copy. Rejected Fira Code/Fira Sans (the `ui-ux-pro-max` database's own default for "dashboard/analytics" — same pairing it returns for "Coding Bootcamp," i.e. generic).
- **Body/UI chrome:** IBM Plex Sans — multi-weight, actual character, distinct from Inter.
- **Data/tool output/timestamps:** IBM Plex Mono.

No new component library owns theming — these are CSS variables in `globals.css`, consumed by every component (shadcn base + AI Elements + Magic UI all read the same `--color-*` tokens via `@theme inline`, confirmed in the existing `globals.css` `@theme inline` block).

## 3. Component inventory

| Debate element | Component | Source | Install |
|---|---|---|---|
| 4-round timeline | `Checkpoint` | AI Elements | `npx ai-elements@latest add checkpoint` |
| Per-agent identity | `Agent`, `Persona` | AI Elements | `npx ai-elements@latest add agent persona` |
| Per-turn reasoning | `Reasoning`, `Chain Of Thought` | AI Elements | `npx ai-elements@latest add reasoning chain-of-thought` |
| Sandbox code execution (ADR-004) | `Terminal`, `Tool`, `Stack Trace` | AI Elements + Magic UI Terminal | `npx ai-elements@latest add tool stack-trace` / `pnpm dlx shadcn@latest add @magicui/terminal` |
| Supervisor's R3 assignment | `Plan`, `Task` | AI Elements | `npx ai-elements@latest add plan task` |
| Evidence/citations | `Sources`, `Inline Citation` | AI Elements | `npx ai-elements@latest add sources inline-citation` |
| "actively reasoning" live state | `Shimmer`, Border Beam | AI Elements / Magic UI | `npx ai-elements@latest add shimmer` / `pnpm dlx shadcn@latest add @magicui/border-beam` |
| Final bull/bear forecast | Line chart w/ confidence band, direct-labeled | Recharts (verified guidance: `ui-ux-pro-max --domain chart`, "Time-Series Forecast" entry — solid actual line, dashed forecast line, 15% opacity confidence band, hue never sole distinguisher) | `pnpm add recharts` |

**Accessibility constraint carried from verified `ux` domain guidance (applies everywhere in this table, not optional):** color is never the sole distinguisher — every agent-colored element also carries the agent's name/icon; every chart series carries a line-style or shape difference plus a direct label, not hue alone. `prefers-reduced-motion` is respected on every animated component (`Shimmer`, Border Beam, chart transitions) — render the final state immediately when set.

**Specific risk this rule exists for (computed, not assumed):** pairwise hue separation across the 6-color palette in §2 was checked — `--signal-bull` (142°) and `--agent-macro` (163°) are only 21° apart, the closest pair by far, and both fall in the range deuteranopia/protanopia (~8% of men) confuses most. The two will co-occur whenever the Macro agent's turn drives a bullish call. This is not a hypothetical edge case the general rule happens to cover — it's the concrete scenario the rule must hold for. Any component pairing `--agent-macro` near `--signal-bull` (e.g. a small colored dot/badge with no label) is a spec violation, not a style nit.

**Explicitly excluded:** AI Elements' `Message` and `Conversation` components. Every AI Elements quickstart starts from these two (chat bubbles in a scrolling thread) — they are the default path an implementer would reach for, and they are exactly the "another AI chatbot" look this spec exists to avoid (§1). `Checkpoint` + `Agent`/`Persona` + `Reasoning` together replace that role with a transcript/timeline structure instead. Do not add `Message`/`Conversation` to this project without a deliberate, separate decision.

## 4. Architecture (this pass)

```
ui/
  src/
    lib/
      mock-debate/
        types.ts        -- DebateEvent union type (the seam — see §5)
        fixtures.ts      -- 1-2 recorded/hand-authored full 4-round runs
        stream.ts        -- MockDebateStream: replays a fixture as an async
                            generator, paced with setTimeout, mimicking token-
                            by-token arrival so components built against it
                            behave identically once fed a real stream later
    components/
      debate/
        checkpoint-timeline.tsx   -- renders 4 rounds, R3 gets --round-challenge
        agent-card.tsx            -- Agent + Persona, colored via --agent-*
        reasoning-panel.tsx       -- Chain Of Thought wrapper per turn
        sandbox-output.tsx        -- Terminal + Stack Trace for code execution
        evidence-list.tsx         -- Sources + Inline Citation
        forecast-chart.tsx        -- Recharts confidence-band chart
    app/
      page.tsx                    -- composes the above against MockDebateStream
```

**Why a typed `DebateEvent` union now, even though nothing produces it yet:** every component in `components/debate/` is written against this type, not against the mock directly. When the harness streaming route exists, it needs to emit `DebateEvent`-shaped data (via `toUIMessageStream`'s custom `data-{type}` parts, per the verified `@ai-sdk/langchain` adapter API) — swapping `MockDebateStream` for the real `EventSource`/fetch-stream consumer touches zero component code. This is the Dependency Inversion piece of the CLAUDE.md OOP/SOLID requirement: components depend on the `DebateEvent` abstraction, not on "mock" or "real" concretely.

**Where this pattern fits:** any UI being built ahead of a backend that has a well-understood but unbuilt contract. **Where it doesn't:** if the backend shape is still genuinely unknown/changing — then the type would be guessed and the mock would encode wrong assumptions, worse than no abstraction at all. Here the shape is *not* a guess — it's derived directly from the LangGraph supervisor's existing event vocabulary (round transitions, agent turns, tool calls, tool results — all things the harness already emits internally via LangGraph's `streamEvents`), so the risk is low.

## 5. `DebateEvent` type (the seam)

```ts
// ui/src/lib/mock-debate/types.ts
type Round = "independent" | "debate" | "devils-advocate" | "consensus";
type AgentId = "technical" | "sentiment" | "macro";

type DebateEvent =
  | { type: "round-start"; round: Round; roundIndex: 1 | 2 | 3 | 4 }
  | { type: "agent-turn-start"; agent: AgentId; round: Round }
  | { type: "reasoning-token"; agent: AgentId; token: string }
  | { type: "tool-call"; agent: AgentId; tool: string; input: unknown }
  | { type: "tool-result"; agent: AgentId; tool: string; status: "success" | "error"; output: unknown; stdout?: string; stderr?: string }
  | { type: "evidence"; agent: AgentId; source: string; url?: string; snippet: string }
  | { type: "devils-advocate-assigned"; agent: AgentId; targetClaim: string }
  | { type: "consensus"; scenarios: Array<{ label: "bull" | "bear"; probability: number; summary: string }> }
  | { type: "forecast"; horizon: string; actual: number[]; forecast: number[]; confidenceBand: [number, number][] };
```

## 6. Deferred (explicitly, per your CLAUDE.md deferral-ledger discipline)

- Real harness streaming route (`harness/src/server/`, `@ai-sdk/langchain` wiring) — separate spec, separate issue.
- Multi-run history/persistence, auth — no consumer exists yet (matches ADR-006's phased-rollout precedent: build the mechanism when a real second consumer exists, not before).
- Vercel deploy config — not needed for local dev iteration on the mock.

## 7. Accepted low-risk item

The component-name slugs in §3 for `agent`, `persona`, `reasoning`, `chain-of-thought`, `tool`, `stack-trace`, `plan`, `task`, `sources`, `inline-citation`, `shimmer` are confirmed to exist as named entries in the AI Elements registry (48-component listing, fetched from `elements.ai-sdk.dev`), but each exact install slug was not individually fetched the way `checkpoint`, `@magicui/terminal`, and `@magicui/border-beam` were. This is accepted as low-risk rather than blocking: the CLI errors immediately and legibly on an unknown slug (self-verifying at install time), and the naming convention has held for every slug checked so far.

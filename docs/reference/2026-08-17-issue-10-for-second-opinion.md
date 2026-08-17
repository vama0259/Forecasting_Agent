# Issue #10 — participant agents — brief for a second model

Self-contained. No prior conversation needed. Written so you can hand this to a different AI
model and get a genuinely independent read, not a rubber stamp.

## What this project is

A private, AI-powered stock-forecasting system for Indian equities (NSE). It forecasts one stock
at a time. The core idea: instead of one AI just guessing, **4 separate AI agents each argue from
a different angle**, then debate, then a final call gets computed mathematically from their 4
opinions (not just picked by an LLM, to avoid AI sycophancy/groupthink).

Stack: TypeScript harness (LangChain + LangGraph + a package called `deepagents`), Python data/
scoring backend, Docker sandbox where agents can write and run real code, DeepSeek as the LLM.

## The 4 agents (issue #10 — not yet built, this is the design question)

1. **Price** — looks at the stock's own price history + macro signals (USD/INR, US bond yields).
   Already exists in a first version, already tested working end-to-end tonight.
2. **FII** — models foreign institutional investor behavior.
3. **DII** — models domestic institutional investor behavior.
4. **Retail** — models retail trader behavior (delivery %, bulk deals; news added later).

None of FII/DII/Retail exist yet. Price exists but needs extending.

## Real constraint already found (not a design choice — a fact about the data)

India's exchange (NSE) publishes foreign/domestic investor flow data **only in aggregate, market-
wide** — there is no way to know what FII/DII did on one specific stock, confirmed against the
live published file. So FII and DII agents can only honestly say "market-wide flow was X today,
and this specific stock reacted like Y" — correlation, not "FII bought this stock."

## The actual open question — where we want a second opinion

We (me and the user, across a long conversation) converged on a plan, but the user is
(rightly) worried I may have been reflexively pattern-matching to "keep it small / defer things"
because that approach worked well earlier in a different part of tonight's work — and wants an
independently-reasoned take, not a continuation of that momentum.

**The plan so far, roughly:**
- Build the 4 agents using a library (`deepagents`) that already provides a "SubAgent" concept —
  each agent is a small config object (name, prompt, tools, model, permissions) rather than 4
  separately hand-written functions/files.
- All 4 agents run in the same process, launched in parallel, not as separately-hosted services.
- Exactly 4 agents, fixed roster (not dynamically decided by the system) — because a "trust
  score per agent, built up over many runs" mechanism (already decided elsewhere in this project)
  needs a stable identity to accumulate against.
- Split the work into two phases: first generalize the shared plumbing (one agent-building
  function instead of four), prove it still works on the one already-working agent (Price), THEN
  build the new 3 agents against that proven plumbing.

**What the user is pushing back on, specifically — please engage with each of these on the
merits, not by default-deferring them:**

1. **Should each of the 4 agents be hosted as its own separate service** (the library has a real,
   built-in mechanism for this — call it by URL, check back on results later) — **instead of** all
   4 running together in one process? The user's argument: building this "generally" now,
   correctly, makes it trivial to go from exactly-4 to any-number-of-agents later. The
   counter-consideration: this requires standing up real new infrastructure (a hosted agent
   server) that doesn't exist yet, and the project has no working agent yet whose scaling need is
   proven.

2. **Should agent "memory" (a real, built-in feature of the library — persisting information
   across separate runs, not just one conversation) be used now** — specifically, is there a good
   case for using it for the "does this agent have a good track record" trust-weighting concept,
   given elsewhere in this project's design that trust-weighting was planned to be computed by a
   separate scoring subsystem, not stored as agent memory? Or is there a different, non-competing
   use for memory the user might mean (e.g., an agent recalling its own past reasoning on a
   specific stock)?

3. **Should each agent's AI model be chosen based on task size/importance** (e.g., the more
   important agent gets a stronger/more expensive model, a simpler agent gets a cheaper one)?
   Note: the config system already has a per-agent model field, so this specific ask may already
   be "free" — worth confirming rather than assuming more building is needed.

4. **Broader meta-question the user raised**: are we building the shared plumbing ("the harness")
   generally enough that going from 4 fixed agents to "any number, decided dynamically" later is
   *easy* — or are we quietly building something that will need a rewrite when that day comes?
   This is the crux of the disagreement — the user believes some of my design choices tonight
   have been too narrowly scoped to "get #10 done" rather than "build this so #10 and its
   successors are both easy."

## What a good second opinion would do

- Take a real position on each of the 4 questions above, with reasoning — not "it depends."
- Explicitly say whether the "build generally now vs. build narrowly and extend later" tradeoff
  should be resolved differently than described above, and why.
- Flag anywhere the existing plan looks like it optimizes for shipping #10 quickly at the cost of
  making the *next* agent-related story harder than it needs to be.
- It's fine to disagree with everything above. The goal is genuine independent judgment, not
  agreement.

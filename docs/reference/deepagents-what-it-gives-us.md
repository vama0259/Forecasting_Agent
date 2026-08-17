# What the `deepagents` library actually gives us

Plain-English reference, based on the real, installed version (`deepagents 1.12.3`) — not the
README, the actual package. Written for reading, not for a developer to copy-paste.

## The core idea

You call one function — `createDeepAgent` — and hand it a model, some tools, and some settings.
It hands you back a working AI agent that can think, use tools, write/read files, and (if you
give it a sandbox) run real code. Everything below is either a setting you pass into that one
function, or an add-on capability you can turn on.

## 1. Sub-agents — a built-in "config, not code" system

This is the most important piece for our project. A **SubAgent** is not a new file, not a new
function — it's a small description:

- **name** — what to call it
- **description** — what it's for
- **systemPrompt** — its instructions (this is where our prompt text goes)
- **tools** — what data/actions it's allowed to use
- **model** — which AI model powers it (can differ per agent, or share one)
- **permissions** — which files/folders it's allowed to read or write

You hand the library a list of these, and it does the wiring. **This is exactly the "config
instead of 4 separate functions" idea we designed ourselves tonight — it turns out the library
already has this built in.** We don't need to invent it; we plug our 4 agents into it.

There's also a ready-made "general purpose" sub-agent config you can copy and adjust instead of
writing one from scratch.

## 2. Async sub-agents — NOT what we need, ruled out  Comment we should use this becomes a agent to agent protocla and helpful when we dynamic agent

There's a second, different kind of sub-agent called an **AsyncSubAgent**. This one requires a
separate, remotely-hosted agent server (a URL, a login) — it's for calling an agent that lives on
a different machine entirely, and checking back on it later (start it, walk away, come check the
result). That's not our situation — our 4 agents all run together, in the same process, right
now. Confirmed this doesn't apply to us.

## 3. Filesystem tools — reading/writing files, sandboxed    we bult sandb

A built-in toolkit: list files, read a file, write a file, edit a file, search file contents,
find files by pattern. This is what lets an agent save its own work (like the Python scripts our
agents are supposed to write) and read it back later.

**Important control we can use:** you can restrict *which* of these tools an agent is allowed to
use, and set **permission rules** — literally "this agent may only write inside this folder,"
enforced automatically, not just a polite request in the prompt. This maps directly onto our
`workspace/code/features/<agent_name>/` requirement — each agent's folder can be a real,
enforced boundary, not just a naming convention.

## 4. Code execution ("sandbox" backends)

If you give the agent a sandbox backend, it also gets an **execute** tool — it can run real shell
commands / Python, get the output back, and use that to inform its answer. This is what Price
already uses today, and what FII/DII/Retail will need too, to actually compute things instead of
guessing.

## 5. Structured output enforcement   this we want

You can force an agent's *final* answer to match an exact shape (our "direction / probability /
confidence / evidence" format) — the library validates it before handing it back. This is already
what Price uses for its answer-shape today, and it works the same way per sub-agent config, so
each of the 4 agents can have its own enforced shape from day one.

## 6. Skills — a "loadable knowledge" system  this we can do after we have a skill options comming in

Agents can be given "skill" files — self-contained instructions for how to do a specific kind of
task — loaded from a folder path. Worth knowing this exists; it's conceptually close to your
project's own future idea (agent-discovered strategies, M11) but isn't something we need for #10
specifically.

## 7. Memory   this we need

There's a built-in memory system that can persist information across separate runs (not just
within one conversation). Worth knowing this exists as an option — we haven't decided to use it
for the trust/calibration tracking (that's currently planned as its own thing, computed by your
scoring system), but it's there if that changes later.

## 8. "Harness profiles" — per-model prompt/tool tuning We need this qa'



A way to apply small overrides (extra prompt text, renamed tool descriptions, excluded tools) —
meant for tuning behavior differently per AI model, not something we need to touch for #10.

## What this changes for our plan

We were about to hand-build:
- a config object per agent → **already exists, called `SubAgent`**
- a way to run multiple agents safely → **the library's sub-agent system already handles this**
- per-agent folder restrictions → **already exists, via filesystem permission rules**

We were NOT about to hand-build, and don't need:
- the "async remote agent" system (ruled out, wrong use case)
- skills, memory, harness profiles (real features, not needed for #10 specifically)

**Net effect:** less code to write ourselves than we thought. The right next step is to design
our 4 agents' configs (`SubAgent` entries) against this real API, instead of designing our own
system to reinvent what's already here.

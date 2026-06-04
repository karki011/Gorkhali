# Phantom Upgrade — What to Learn from the 2026 AI-Harness Landscape

Author: Subash Karki
Date: 2026-06-03

Synthesis of an 9-agent research program. Source reports in `research/harness-survey/`.
Studied: DeerFlow (actual source), LangGraph, OpenAI Agents SDK, Claude Agent SDK,
Microsoft Agent Framework, Mastra, Letta, OpenHands, + landscape survey.

---

## 0. The question that drove this

> "Markdown is Markdown — Claude can honor it or not. Should we convert something
> to code so it's more deterministic?"

**Answer: yes, but surgically.** Every serious harness in 2026 converges on ONE
principle, and Phantom should adopt exactly that principle and no more:

> **Control flow, gates, counters, and topology are CODE (deterministic).
> Reasoning, classification-under-ambiguity, and synthesis are LLM (probabilistic).**
> The LLM emits a typed value; CODE reads it and decides what happens next.
> *The workflow is code; the node is the LLM.*

This is Anthropic's own "workflows vs agents" guidance, LangGraph's conditional-edge
rule, OpenAI Agents SDK's guardrails, and Mastra's `.then()/.branch()` API — all the
same idea. Phantom is currently ~90% prompt-driven. The fix is **not** a rewrite —
it's coding the ~7 enumerable decision points and leaving every reasoning node in
Markdown. **Do not adopt any framework wholesale** — that breaks Phantom's killer
property (zero-infra plugin install). Steal the *patterns*, implement in the JS hook
layer Phantom already has.

---

## 1. DeerFlow — corrected ground truth

My first pass (web docs only) was directionally right but wrong on specifics. Cloned
the actual repo. Corrections:

| Claim | Verdict | Truth |
|---|---|---|
| Single `lead_agent` node, v1 multi-node graph discarded | ✅ Verified | Confirmed in `langgraph.json` |
| Skills lazy-loaded | ⚠️ Corrected | System prompt gets a skill **name list**; SKILL.md content is read **on-demand by the LLM** via file-read. `SummarizationMiddleware` *rescues* recently-read skills from compression |
| `task()` capped at 3 | ⚠️ Corrected | Cap is a `[2,4]` range; nesting is **code-blocked** (`disallowed_tools=["task"]`) not prompt-blocked |
| ACP `codex`/`claude_code` hardcoded | ⚠️ Corrected | They're example `config.yaml` entries, dynamically built; need a subprocess binary |
| `ask_clarification` + `is_plan_mode` | ⚠️ Corrected | Separate mechanisms. Clarification → `Command(goto=END)` (code interrupt). plan_mode → per-run flag activating `TodoMiddleware` |

**The thing my first pass completely missed — and the single biggest takeaway:**

> **In DeerFlow, the middleware IS the architecture.** 14+ composable middleware
> layers (`LoopDetectionMiddleware`, `SummarizationMiddleware` w/ skill-rescue,
> `SubagentLimitMiddleware`, `DynamicContextMiddleware`, `DeferredToolFilterMiddleware`)
> do all the safety + orchestration work. The "graph" is almost trivial; the
> middleware stack is where the engineering lives.

DeerFlow's determinism split (what they made code, not prompt): subagent cap, nesting
block, clarification interrupt, **loop-break** (warn → strip tool_calls at hard limit),
recursion limit (100), date injection, MCP schema hiding, ACP workspace isolation.
LLM-decided: whether to spawn, which skill to read, tool sequencing, when to stop.

**That maps exactly onto the principle above** — and Phantom's flat `hooks.json` is the
weaker version of DeerFlow's onion middleware. (See #3.1.)

---

## 2. The landscape — what's actually new in 2026

- **AutoGen is dead.** Microsoft shipped **Microsoft Agent Framework (MAF)**, GA
  May 2026 — successor to AutoGen + Semantic Kernel. Most teams haven't noticed.
- **Google ADK 2.0** (GA May 2026) — graph execution mixing deterministic code + LLM.
- **Mastra** — the only serious TS-native framework; durable suspend/resume. **Most
  portable to Phantom** because Phantom's hooks are already JS/TS.
- **Letta** (MemGPT successor) — sleep-time compute, self-editing memory. The
  research-backed version of Phantom's hand-rolled learnings.
- **OpenHands** Large Codebase SDK — parallel coding agents (though less automatic
  than advertised; see #3.5).
- **Claude Agent SDK** (renamed Claude Code SDK) — the in-family option.

---

## 3. What Phantom should steal — prioritized

Scored P0–P3 like Phantom's own power levels. Each is zero-infra (pattern, not framework).

> ⚠️ **Post-Rival note (2026-06-03):** an adversarial review of the overhaul plan
> downgraded most of P1–P3 below to "failure-pulled, not pre-built." The earned items
> are the loop-ceiling fix (correctly scoped to ~15 files) and the loop controller with
> an operator override. See `research/phantom-overhaul-plan.md` for the revised verdict.

### P0 — Code the verify→fix loop control  ⭐ highest leverage
*Sources: determinism-architecture, langgraph-openai-sdk*

The verify→fix loop (max-N attempts, same-finding-class escalation) is the one prose
rule whose failure mode is the worst one Phantom has — **stacking patches on a wrong
hypothesis past the ceiling.** It's currently prose, and prose drifts:

> **🐛 LIVE BUG — corrected by plan-checker (2026-06-03):** an earlier draft of this
> doc claimed `reference/router.md` says "max 3" — that is FALSE; router.md has no such
> constant. The real situation: the fix-loop ceiling is specified in **~15 places across
> 4 dirs** (`reference/`, `commands/`, `agents/`, `agents/reference/`) AND there appear
> to be **two distinct loops** — a "max 2" *review* loop (`temperature-review.md:58`,
> `verify.md:49`) and a "max 3" *fix* loop (`fix.md`, `apex.md:52`, `start.md`,
> `contracts.md:19`). `scripts/validate-artifact.js:126` also tracks `review.fixLoops`.
> Open question before any code: ONE drifted constant, or TWO deliberate ceilings?

**Do:** a ~30-line JS loop controller (in the hook layer) owning the attempt counter,
the hard stop, and the same-class-failure detector. Fix/re-review stay LLM; the
*counter and stop* become code. Best risk-reduction-per-line in the whole list.

### P0 — Typed Blade completion records (structured outputs at the boundary)
*Sources: claude-agent-sdk, mastra, microsoft-agent-framework, openhands*

Four independent agents flagged the same gap: **Blades return free text; Apex parses
it heuristically.** This is the "Blade passed but Apex misread the output" failure
class. Adopt a typed record every Blade writes at completion:

```
BladeCompletionRecord { status, files_written[], files_read[], test_result, blocker? }
```

Validate with a Zod/JSON schema at the boundary (Phantom already has
`validate-artifact.js`). OpenHands proves the wave-handoff value: wave N+1 reads wave
N's records before spawning. Mastra/SDK prove the schema-at-boundary discipline.

### P1 — Onion middleware chain (replace flat hooks)
*Sources: deerflow-ground-truth, microsoft-agent-framework*

DeerFlow ("middleware IS the architecture") and MAF (deliberate onion-over-flat choice,
ADR 0007/0016) independently land here. Phantom's `hooks.json` is **flat** — events
fire before XOR after, no wrapping. Restructure `hook-router.js` so each hook exports
`invoke(ctx, next)` and composes as a chain. Existing scripts become terminal
middleware. Unlocks composable loop-detection, token budgets, audit logging —
including the P0 loop controller as a clean layer.

### P1 — Pre-dispatch write-target overlap gate (conflict-free waves)
*Sources: openhands-parallel*

Before emitting a wiring wave: collect every Blade's declared write-targets, call
`phantom_graph_blast_radius` on the union, enforce **no two Blades in one wave share a
write path** (overlap → split to wave N+1). Phantom's `phantom-ai` MCP is already a
*richer* oracle than anything OpenHands ships (import/call graph vs path strings) — this
is a pure win, just a logic rule in the wiring step using the MCP that already exists.

### P2 — Sleep-time learnings consolidation (move /evolve offline)
*Sources: letta-memory*

Letta's standout: a sleep agent consolidates memory **after** sessions, at zero
live-session token cost. Phantom's `/phantom:evolve` does this *inline* (blocks the
session). Move it to a post-session hook (`sleep-consolidate.js`) that promotes
patterns, retires stale entries, and **collapses contradictory entries** for the same
keyword (Letta's self-editing-memory = rewrite, not append) before the next session.

> **Where Phantom is already ahead of Letta:** the `[failed]`-blocks +
> `[validated:5+]`-auto-applies keyword index is *structurally stronger* — Letta has
> no procedural block on re-applying failed patterns. **Keep it exactly as-is.**

### P2 — Attribution markers for compaction
*Sources: microsoft-agent-framework, deerflow-ground-truth*

Phantom's `PreCompact` hook (`memory-consolidator.js`) fires blind — no signal about
which messages matter. Add `<!-- phantom:attribution=checkpoint|ephemeral -->` markers
to phase-prompt templates (MAF's `source_id`/`attribution` pattern); consolidator keeps
checkpoints verbatim, drops ephemeral first. Pair with DeerFlow's skill-rescue idea.

### P3 — Typed suspend/resume schemas for pause/resume
*Sources: mastra*

Phantom's `pause-state.json` is informal; the LLM re-interprets it on resume. Declare
Zod `suspendSchema`/`resumeSchema`, validate both ends. (Full Mastra durable DB replay
is overkill — Phantom's file artifact is already process-restart-safe.)

---

## 4. The meta-decision: stay a plugin

Every infra-cost verdict came back the same: **adopt patterns, not frameworks.**
LangGraph needs a Python runtime; MAF needs .NET/Azure; Mastra/OpenAI SDK pull in
their ecosystems — all break Phantom's zero-infra `/plugin install` property, which is
*the* reason any engineer can use it with no coordination.

**Verdict: Option C — hybrid.** Keep plugin distribution. Move only the enumerable
gate/counter/topology decisions into the existing JS hook layer (optionally a tiny
typed sidecar). Everything above is implementable in `hooks/*.js` + Markdown front-matter
with **zero new runtime deps**. If true cross-process step-replay is ever needed,
`@libsql/client` (embedded SQLite, no server) is the minimal escalation.

---

## 5. Roadmap (suggested order)

1. **P0** Fix the max-2/max-3 prose-drift bug + code the verify→fix loop controller.
2. **P0** Typed `BladeCompletionRecord` + schema validation at the spawn boundary.
3. **P1** Refactor `hook-router.js` to an onion `invoke(ctx, next)` chain.
4. **P1** Wave write-target overlap gate via `phantom_graph_blast_radius`.
5. **P2** Offline `sleep-consolidate.js`; teach `/evolve` to collapse contradictions.
6. **P2** Compaction attribution markers.
7. **P3** Zod schemas on pause/resume state.

Principle holding it all together: **code the workflow, keep the nodes in Markdown.**
Don't pre-build past observed pain — ship P0, let real session failures pull the rest
into code (Anthropic's "simplest thing that works").

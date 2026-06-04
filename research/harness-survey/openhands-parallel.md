# OpenHands Parallel Agent Dispatch — Steal List for Phantom

> Author: Subash Karki
> Date: 2026-06-03
> Source: docs.openhands.dev SDK docs (v1.7.x), github.com/All-Hands-AI/OpenHands

---

## What OpenHands Actually Does (Honest Assessment)

OpenHands' "parallel agent dispatch" is NOT a dependency-map-aware wave scheduler.
It is simpler: `tool_concurrency_limit=N` on an `Agent` makes the SDK execute
multiple tool calls that arrive in a single LLM response concurrently. The LLM
itself decides what to dispatch together — OpenHands does not topologically sort
a dependency graph before spawning agents.

The docs are explicit:

> "Parallel tool execution is still **experimental**. By default,
> `tool_concurrency_limit=1` (sequential). Concurrent execution can lead to
> **race conditions or unexpected behavior** for tools that share state."

> "When NOT to use: Tools that must execute in a specific order, operations that
> **modify the same files**, workflows where one tool's output feeds into another."

So: OpenHands ships the primitives but pushes ordering responsibility back to the
LLM prompt. There is no built-in dependency graph, no blast-radius check, no wave
planner. The production-proven conflict prevention the landscape survey flagged is
real, but it comes from three surrounding patterns — not from a single framework
feature. Those patterns are what Phantom should steal.

---

## Idea 1 — Steal: Read-Before-Write Classification Gate (Pre-Dispatch Safety Check)

### What OpenHands Does

OpenHands' security layer (`openhands.sdk.security`) runs **action risk assessment
and validation before execution** at the tool level. Every tool call passes through
a validation layer that checks path traversal, command sanitization, and resource
limits before the action hits the workspace.

The parallel guide encodes the same logic as a rule: read-only ops are safe to
parallelize; write ops that touch the same files are blocked from concurrent
execution. The LLM is instructed to only co-schedule independent (non-overlapping)
tool calls.

### The Pattern

```
Before dispatching wave N:
  1. Collect all file write-targets for every Blade in wave N
  2. If any two Blades write the same path → split them into separate waves
  3. If Blade A reads a file that Blade B writes → B must precede A (ordering edge)
  4. Only after the full wave is conflict-free → spawn Blades
```

### Mapping to Phantom Wiring / Waves

Phantom's wiring mode already maps producer/consumer edges. The missing piece is a
**pre-dispatch gate** that runs at wave construction time, not just at assignment
time.

Concretely: before emitting "Wave N: dispatch Blades X, Y, Z," the orchestrator
calls `phantom_graph_blast_radius` on the union of all files those Blades will
touch, then checks for write-write and write-read overlaps. Any overlap forces a
topological split (move the overlap Blade to wave N+1).

This is zero-infra: it is a pure logic step in the wiring prompt / orchestrator
output, using the phantom-ai MCP that already exists.

### What to Add to Phantom

In `/phantom/reference/wiring.md` (or the orchestrator system prompt):
- Add a mandatory pre-wave classification step that declares each Blade's expected
  write targets
- Add an overlap check rule before any Blade is emitted into a wave
- Block co-dispatch of any two Blades with overlapping write-target sets

---

## Idea 2 — Steal: Immutable Event Log as Ground Truth (Replay-Safe State)

### What OpenHands Does

OpenHands' event system makes **every action and observation an immutable,
serializable, typed Pydantic snapshot**. The `Conversation` object is stateless
across steps — all state lives in the event log. This means:

- Any agent can reconstruct full context from the event stream
- If an agent crashes mid-wave, replay from last committed event
- No shared mutable state between concurrent agents — each agent writes to its own
  event log; the orchestrator reads summaries

The reasoning loop is deliberately **stateless**: agent operates on `Conversation`
(the log), not on its own internal memory. Tool calls are appended as events; the
next step reads the updated log.

### Why This Prevents Conflicts

When two parallel agents write to the same event log entry, OpenHands' model catches
it as a type error (Pydantic validation fails). In practice, each sub-agent gets its
own `Conversation` scoped to its workspace (worktree). The parent orchestrator reads
summary events, not raw file state.

### Mapping to Phantom Wiring / Waves

Phantom Blade agents currently communicate results back to the orchestrator via
Claude Code's native output. There is no typed, replayable event record per Blade.

Steal: each Blade emits a **structured completion record** (typed JSON/YAML) at the
end of its run:

```yaml
blade_completion:
  blade_id: "auth-refactor"
  wave: 2
  worktree: "worktrees/auth-refactor"
  files_written: ["src/auth/jwt.ts", "src/auth/session.ts"]
  files_read: ["src/types/user.ts"]
  status: "success"
  summary: "<one-paragraph diff summary>"
  conflicts_detected: []
```

The orchestrator for wave N+1 reads all wave N completion records before spawning.
If a wave N Blade's `files_written` overlaps with a wave N+1 Blade's plan, the
orchestrator can reorder or merge before dispatch — no file-system race needed.

This is also what makes post-wave `phantom_conflict_status` checks meaningful: the
typed record gives the MCP something concrete to diff against.

### What to Add to Phantom

- Define a `BladeCompletionRecord` schema in `/phantom/reference/` (or as a
  template in `/phantom/templates/`)
- Require every Blade to write this record to its worktree root at completion
- Require the orchestrator to read all N-1 records before opening wave N

---

## Idea 3 — Steal: Keyword-Scoped Skill Loading (Context Budget as Safety Valve)

### What OpenHands Does

OpenHands Skills are Markdown files with a YAML frontmatter `triggers:` list.
A skill is **only injected into the agent's context when one of its trigger
keywords appears in the prompt**. This is not just a UX nicety — it is a safety
mechanism: agents that never see irrelevant domain instructions cannot accidentally
apply them.

```yaml
---
name: github
triggers:
  - github
  - git
---
You have access to GITHUB_TOKEN ...
```

The direct analogy to Phantom: Phantom already uses Markdown agent personas. The
steal here is the **trigger-gating** pattern applied to the wiring assignment step.

### The Parallel-Safety Application

Each Blade in a wave should only load the skills/context relevant to its assigned
file set. A Blade assigned to `src/auth/` should not receive the `database-schema`
Skill, even if both are defined. Loading irrelevant skills causes two problems:
1. Wasted context budget (hits limits faster in large waves)
2. Agent makes changes outside its assigned scope (cross-Blade contamination)

OpenHands proves production-viability: their keyword gate keeps context under 200K
tokens per agent even when the global skill registry has 50+ skills.

### Mapping to Phantom Wiring / Waves

Phantom's wiring step already maps file clusters to Blades. Extend it with a
**skill-scope gate**:

- Each Blade declaration includes a `context_scope: [list of skill/domain names]`
- The orchestrator spawns each Blade with only the scoped skills injected
- Skills outside the scope are explicitly excluded from the Blade's system prompt

This directly prevents the "Blade writes outside its worktree" bug class: if the
skill that knows about `database/migrations/` is not in a Blade's context, it
cannot accidentally touch migration files.

### What to Add to Phantom

In the Blade spawn template, add a `context_scope` field. In the wiring orchestrator
prompt, add a rule: Blade scope is derived from its file cluster (via
`phantom_graph_related`); no Skill outside that scope is injected.

---

## Comparison: phantom-ai Blast Radius vs. OpenHands Dependency Map

| Dimension | phantom-ai blast radius | OpenHands parallel dispatch |
|---|---|---|
| Graph source | Live codebase dependency graph (phantom-ai MCP) | None — LLM decides implicitly |
| Pre-dispatch check | `phantom_graph_blast_radius` call available; not wired into wave construction yet | `tool_concurrency_limit` cap + "don't write same file" instruction |
| Conflict detection | Can detect cross-file impact chains (import deps, call graphs) | Detects only direct file-path collision (same path = conflict) |
| Ordering | Not yet enforced algorithmically pre-spawn | Not enforced — LLM-prompted |
| Post-wave validation | `phantom_conflict_status` available | No built-in equivalent |
| Production status | Available, partially wired | Experimental (default off) |

**Conclusion**: phantom-ai's blast-radius tool is architecturally richer than anything
OpenHands ships — it operates on the actual dependency graph, not just file paths.
OpenHands' advantage is the surrounding discipline: pre-dispatch classification,
immutable completion records, and skill-scoped context budgets. Those disciplines
work regardless of the underlying graph tool. Phantom should keep phantom-ai as the
graph oracle and layer the three OpenHands patterns on top.

---

## Priority Order for Implementation

1. **Idea 1 (Pre-Dispatch Gate)** — highest leverage. Stops write conflicts before
   they happen. Requires only a prompt-engineering change in the wiring orchestrator
   plus a `phantom_graph_blast_radius` call per Blade cluster.

2. **Idea 2 (Blade Completion Record)** — enables safe wave handoff. Pure schema
   addition, no new tooling. Unlocks replay, audit, and N+1 pre-flight checks.

3. **Idea 3 (Keyword-Scoped Skills)** — context hygiene. Prevents scope bleed in
   large waves (10+ Blades). Lower urgency unless context exhaustion is already a
   problem at current Blade counts.

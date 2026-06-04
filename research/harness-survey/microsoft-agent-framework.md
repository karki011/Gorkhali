# Microsoft Agent Framework (MAF) — Phantom Steal Analysis
**Author:** Subash Karki  
**Date:** 2026-06-03  
**Sources:** github.com/microsoft/agent-framework (main), MS Learn agent-framework docs, ADRs 0007 + 0016 + 0021

---

## What MAF Is (30-second orientation)

MAF is the production successor that unifies AutoGen 0.4 + Semantic Kernel agents into one framework. GA'd May 2026. Python + .NET only. Azure Foundry hosting optional (2-line deploy). The repo at `microsoft/agent-framework` is the live codebase; `microsoft/autogen` is now a legacy alias.

**Infra verdict up front:** MAF is Python/.NET. Phantom cannot adopt the framework. But the *patterns* — all three ideas below — are pure design, zero infra required.

---

## Idea 1 — Steal: Typed Onion Middleware (not flat hooks)

### What MAF does

MAF has three middleware layers, each an onion/wrapper chain (like Express middleware):

| Layer | Intercepts | Examples |
|---|---|---|
| `AgentMiddleware` | Full agent invocation (pre + post) | token budgets, approval gates, audit log |
| `ChatMiddleware` | Each LLM turn within a tool-call loop | RAG injection, loop detection mid-run |
| `ContextMiddleware` | Session context before/after invoke | history stores, compaction, RAG |

Every middleware follows the same contract:

```python
class AgentMiddleware:
    async def invoke(self, context, next):
        # pre-processing — mutate context before agent runs
        await next(context)
        # post-processing — observe/mutate after agent returns
```

The chain is composable: `[RateLimitMiddleware, AuditMiddleware, RAGMiddleware]` wraps in order. Each calls `next()` or short-circuits (blocks execution). Key detail from ADR 0007: middleware intercepts *multiple execution contexts* — not just final invoke, but tool calls and approval requests too. ADR 0016 chose this pattern over flat hooks explicitly because flat hooks (`before_run / after_run`) cannot wrap both sides of an inner call in one cohesive unit.

### Phantom's current model

`hooks.json` is flat and event-typed:

```
PreToolUse  → apex-subagent-driven-law.sh   (blocks on matcher)
Stop        → memory-writer.js              (fire-and-forget)
UserPromptSubmit → memory-reader.js         (inject context)
PreCompact  → memory-consolidator + guide   (two sequential commands)
```

Problems:
- No pre+post wrapping — a hook fires before OR after, never both sides of the same event.
- No chain ordering — hooks within an event run in declaration order, no `next()` escape hatch.
- No typed contexts — `hook-router.js` does pattern matching, not typed intercept points.
- Phase-level middleware (e.g. "wrap the entire Blade execution") is impossible.

### Steal: MiddlewareChain for Phantom hooks

Replace the flat array in `hooks.json` with a typed middleware chain per intercept point. Each item in the chain receives a context object and a `next` function. Implement in `hook-router.js`:

```js
// hooks-config.json — new shape
{
  "middleware": {
    "agentInvoke": [          // wraps full Apex or Blade agent run
      "token-budget-guard",
      "audit-log",
      "apex-subagent-law"
    ],
    "toolUse": [              // wraps each Edit/Write/Task call
      "edit-gate",
      "file-size-guard"
    ],
    "sessionContext": [       // wraps UserPromptSubmit+Stop pair
      "memory-reader",
      "memory-writer"
    ]
  }
}
```

`hook-router.js` builds the chain: each script exports `{ invoke(ctx, next) }`. Chain executes left-to-right, each can await `next(ctx)` or throw to block. This gives Phantom:
- Pre+post wrapping in one script (memory-reader AND memory-writer collapse to one `SessionContextMiddleware`).
- Ordered, composable layers — add loop detection as middleware between token-budget and audit without touching others.
- Short-circuit blocking — apex-subagent-law blocks by not calling `next()`, same semantics as now but explicit.

**Effort:** Medium. Requires refactoring `hook-router.js` and updating the 7 hook scripts to export `invoke(ctx, next)`. Existing flat hooks still work as terminal middleware (they just never call `next`).

---

## Idea 2 — Steal: Message-Level Attribution for Context Compaction

### What MAF does

ADR 0016 introduces `attribution` markers on chat messages. Every message added to context carries a source label and a preservation flag:

```python
# source attribution — which middleware injected this
context.add_messages(source_id="rag-retriever", messages=[...])

# preservation markers on individual messages
ChatMessage(
    content="...",
    additional_properties={
        "attribution": "important"    # never compact
        # or "ephemeral"              # safe to drop first
    }
)
```

During compaction, a `CompactionStrategy` (or `ChatReducer` in .NET naming) walks messages, preserves `important`-attributed ones, drops `ephemeral` first. The compaction hook fires at agent layer (before each turn) and optionally inside the tool-call loop.

### Phantom's current model

`PreCompact` fires `memory-consolidator.js` + `context-compact-guide.sh`. These fire at compact-time but have no knowledge of *which messages matter*. Compaction is best-effort; the guide is a static prompt injection. There is no per-message retention signal.

### Steal: Attribution markers in Phantom task/phase messages

When Apex writes a phase plan or a Blade writes an artifact, tag the message:

```
<!-- phantom:attribution=checkpoint -->   → always survives compaction
<!-- phantom:attribution=ephemeral -->    → drop first (scratch notes, progress chatter)
```

`memory-consolidator.js` reads these markers when building the compact summary. Checkpointed messages (phase boundaries, validated artifacts) are always included verbatim. Ephemeral messages are summarized aggressively or dropped.

This directly solves Phantom's context-window bleed problem: Blade run chatter gets purged; phase contracts and learnings survive.

**Effort:** Low. Two changes: (1) add attribution markers to phase-prompt templates in `agents/` so Apex naturally tags outputs. (2) Update `memory-consolidator.js` to parse `phantom:attribution` before summarizing.

---

## Idea 3 — Steal: Typed Handoff Contract (A2A-style capability declaration)

### What MAF does

A2A is a wire protocol (JSON over HTTP) for cross-runtime agent communication. For Phantom's purposes, the relevant part is the *capability declaration* pattern, not the transport. MAF agents advertise what they can do via an Agent Card — a structured capability manifest:

```json
{
  "name": "ResearchAgent",
  "capabilities": ["web_search", "document_summary", "citation_format"],
  "inputSchema": { "query": "string", "depth": "shallow|deep" },
  "outputSchema": { "findings": "string", "sources": ["url"] }
}
```

Routing logic selects the right agent by matching required capabilities to declared capabilities — not by name-matching or prompt-pattern-matching.

Additionally, MAF's `AgentAsFunctionTool` pattern exposes a sub-agent as a typed tool that another agent can call. The calling agent gets a function signature; the sub-agent handles execution. This makes Apex→Blade handoffs typed and inspectable.

### Phantom's current model

Apex routes to Blades by prompt pattern: "for feature work use the Feature Blade." The handoff is a Task spawn with a freeform string context. There is no schema for what a Blade accepts or returns. Observability of what got passed to a Blade requires log archaeology.

### Steal: Blade capability manifests

Each Blade agent file (e.g. `agents/blades/feature-blade.md`) gets a YAML front-matter block:

```yaml
---
blade: feature
capabilities: [code_edit, file_write, test_write]
input:
  phase_plan: string        # required
  target_files: [string]    # optional context
output:
  artifact_paths: [string]
  status: done|blocked|failed
  blockers: [string]        # populated on blocked/failed
---
```

`hook-router.js` reads this manifest at Apex spawn-time. If Apex tries to route a task requiring `database_schema` to a blade that only declares `code_edit`, the pre-spawn middleware warns (or blocks). The output schema drives what `validate-artifact.js` checks after Blade completes.

This replaces the current fully-probabilistic routing with *capability-gated routing*. Not full A2A (no HTTP transport needed), but the same determinism gain that A2A provides across runtimes.

**Effort:** Low-Medium. Manifests are just YAML front-matter — no new infra. `hook-router.js` needs a manifest loader. `validate-artifact.js` needs to check against declared output schema.

---

## MAF vs AutoGen — What's Genuinely New

| AutoGen 0.4 | MAF |
|---|---|
| GroupChat / RoundRobin / Selector | Typed graph: sequential, concurrent, handoff, group — all first-class node types |
| No checkpointing | Durable workflows with time-travel, resume from any checkpoint |
| No declarative format | YAML workflow definitions (`declarative-agents/workflow-samples/*.yaml`) |
| Middleware on agents only | Three-layer middleware: agent + chat + context |
| Manual tool-as-agent patterns | `AgentAsFunctionTool` — first-class, typed |
| No hosting story | 2-line deploy to Azure Foundry; A2A protocol for cross-runtime |
| Context management: three separate APIs | Unified `ContextMiddleware` / `ContextPlugin` with compaction + attribution |

MAF migration guide exists at `learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen`.

---

## Infra Cost Verdict

| Idea | Phantom infra needed | Verdict |
|---|---|---|
| Typed onion middleware chain | Refactor `hook-router.js` only | Zero infra. Pure JS pattern. |
| Attribution-based compaction | Update prompt templates + consolidator | Zero infra. Markdown markers. |
| Blade capability manifests | YAML front-matter + manifest loader | Zero infra. JSON/YAML. |

None of the three ideas require Python, .NET, Azure, or any MAF runtime. All three are design patterns Phantom can implement in its existing zero-infra JS hooks + Markdown directive architecture.

---

## Priority Order for Phantom

1. **Middleware chain** (Idea 1) — foundational. Everything else plugs into it. Replaces ad-hoc hook scripts with a composable, ordered, pre+post-aware layer. This is the structural change that makes Phantom's orchestration more deterministic.

2. **Attribution compaction** (Idea 2) — solves the immediate context-window bleed problem. Low effort, high ROI, can ship before Idea 1 restructure is complete.

3. **Blade capability manifests** (Idea 3) — reduces routing probabilism. Completes the determinism picture. Depends on manifest loader that pairs naturally with Idea 1's middleware registration.

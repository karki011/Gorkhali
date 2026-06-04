# DeerFlow (ByteDance) vs Phantom — Comparison

Author: Subash Karki
Date: 2026-06-03

> First external comparison of Phantom. TL;DR: **they are not competitors — they
> live at different layers.** DeerFlow is a standalone agent *harness* (its own
> Python/LangGraph runtime) that can delegate coding tasks to Claude Code via ACP.
> Phantom *is* a Claude Code plugin. In DeerFlow's world, Phantom is what it would
> hand the coding work to.

---

## 1. The one-line each

| | DeerFlow 2.0 | Phantom |
|---|---|---|
| **What** | General long-horizon SuperAgent workbench (deep research is flagship use) | Software-dev orchestration system (ticket → plan → code → verify → PR) |
| **Layer** | Standalone runtime / harness — owns its own process | Plugin *inside* Claude Code — owns no process |
| **Built by** | ByteDance (org team), 70.4k★, MIT | Subash Karki / CloudZero, internal |
| **Successor to** | LangManus | superpowers + feature-dev + code-sweep (all absorbed) |

---

## 2. Domain — different jobs

**DeerFlow** is a *general* workbench. Research → report is the headline, but v2
explicitly also does: autonomous coding, slide/web/newsletter/podcast generation,
image gen, web crawling, IM-bot task execution. The "deep research" branding is v1
legacy; v2 is a pluggable-skill superagent.

**Phantom** is *narrow by design*. It does one thing: ship software changes
against a (usually Jira) ticket. Router → plan → execute → verify → fix → wrap/PR.
Everything is shaped around the SDLC: power levels (P0–P3), PR creation, Jira
transitions, blast-radius checks, learnings scoped per-repo.

> **Implication:** comparing them head-to-head on "which is better" is a category
> error. DeerFlow is breadth; Phantom is depth on one vertical.

---

## 3. Architecture — the core divergence

### DeerFlow: single lead agent + dynamic fan-out

- **One LangGraph node**: `lead_agent` (a ReAct tool-calling loop). V1's named
  Coordinator→Planner→Researcher→Reporter graph was **discarded** in v2.
- Specialization comes from **skills** (Markdown workflow files, lazy-loaded) and
  the `task()` tool, which spawns *more lead-agent instances* as subagents
  (max 3 concurrent). Subagents are not specialist subgraphs — they're clones of
  the same loop.
- "Supervisor" is *implicit* in the lead agent's loop, not a graph topology.
- External work via **ACP**: `invoke_acp_agent("codex" | "claude_code", ...)`.

### Phantom: adaptive router + named specialist personas

- **No runtime.** Phantom is directives (Markdown commands) + hooks layered on
  Claude Code. Orchestration is prompt-driven, not a framework graph.
- A **router** classifies each task into DIRECT / PLAN / BRAINSTORM / FULL and
  scales human gates (0/1/2/3) to *uncertainty*, not task size.
- **Fixed specialist personas** with distinct roles and effort levels:
  Apex (orchestrator), Blade (impl), Ward (QA), Gaze (quality gate), Rival (plan
  challenger), Hound (forensics), Archer (cross-file review), Sweep, Lens, Sage.
- Apex *never writes code* — all edits route through spawned Blade subagents.

### Convergence worth noting

Both landed on **Markdown skills as the unit of specialized behavior** and both do
**parallel subagent fan-out**. The difference is *who the subagents are*: DeerFlow
spawns generic clones differentiated by injected skill; Phantom spawns
pre-defined personas differentiated by role + effort.

| Axis | DeerFlow | Phantom |
|---|---|---|
| Topology | 1 node, dynamic clones | Router → fixed persona set |
| Specialization via | Skills injected into clones | Named agents (Apex/Blade/Ward/…) |
| Orchestration substrate | LangGraph graph + ReAct loop | Prompt directives + Claude Code hooks |
| Decompose decision | Lead agent decides at runtime | Router classifies upfront |
| Concurrency cap | 3 (SubagentLimitMiddleware) | Wave-based (wiring), no hard cap |

---

## 4. Human-in-the-loop

| | DeerFlow | Phantom |
|---|---|---|
| Mechanism | `ask_clarification` tool (any turn) + `is_plan_mode` flag | Route-scaled gates (DIRECT=0, PLAN=1, BRAINSTORM=2, FULL=3) |
| Plan review | Lead agent proposes, user approves/edits | **Deliberative**: Planner ↔ Rival challenge for 2 rounds, human breaks ties |
| Default autonomy | High (IM channels run plan_mode=false) | Scales to uncertainty — known refactor = 0 gates |

Phantom's **Planner↔Rival adversarial deliberation** has no DeerFlow equivalent —
DeerFlow's gate is a single tool call, not a debate. Conversely DeerFlow's
`ask_clarification` can fire mid-execution on any turn; Phantom's gates are
phase-bounded.

---

## 5. Memory & learning

| | DeerFlow | Phantom |
|---|---|---|
| Store | Persistent facts, local | Scored learnings with **decay**, per-repo + global |
| Injection | `DynamicContextMiddleware` → first HumanMessage (keeps system prompt static for prefix-cache) | Hook-injected reference files + learnings INDEX scan |
| Anti-repetition | Dedup at apply time | `[failed]` entries **blocked**; `[validated:5+]` auto-apply |
| Self-improvement | `skill_creator` meta-skill; `update_agent` edits own SOUL.md | 3-tier self-evolution (reference auto-promote → skill edits → skill spawning, gated) |

Both inject memory per-turn to preserve prefix caching — same insight, different
plumbing. Phantom's scored/decaying learnings with explicit `[failed]` blocking is
more opinionated about *correction*; DeerFlow's memory is more about *fact recall*.

---

## 6. Tech & footprint

| | DeerFlow | Phantom |
|---|---|---|
| Runtime | Python 3.12, LangGraph, FastAPI + SSE, Next.js UI | None — pure Claude Code plugin (Markdown + JS hooks) |
| LLMs | OpenAI, Anthropic, DeepSeek, OpenRouter, + any LangChain class | **Opus 4.8 only**, differentiated by `effort` (low→max) |
| Sandbox | Local / Docker / K8s | Host (Claude Code's own perms model) |
| Interfaces | Web UI + 6 IM channels (Slack/Feishu/Telegram/…) | Claude Code CLI/IDE only |
| Observability | Langfuse, LangSmith | Session JSON artifacts, learnings, HTML reports |
| External agents | **Delegates TO** Codex CLI + Claude Code (ACP) | **Runs INSIDE** Claude Code |
| Deploy | Stand up a server (uv + Node, `make`) | `/plugin install` |

---

## 7. The layering insight (the actual headline)

```
        ┌─────────────────────────────────────────────┐
        │  DeerFlow harness (own runtime, LangGraph)   │
        │  research · slides · podcast · coding · IM   │
        │                                              │
        │     invoke_acp_agent("claude_code", …) ──┐   │
        └──────────────────────────────────────────┼───┘
                                                    ▼
        ┌─────────────────────────────────────────────┐
        │  Claude Code                                 │
        │   └── Phantom plugin (router → shadows)      │
        │        Apex · Blade · Ward · Gaze · Rival    │
        └─────────────────────────────────────────────┘
```

DeerFlow is a **meta-harness** that can sit *above* Claude Code and hand it work.
Phantom is a **depth layer** that lives *inside* Claude Code and makes that work
rigorous for the SDLC vertical. They could literally compose: DeerFlow does the
research/orchestration breadth, ACPs the implementation down to a Claude Code
session, and Phantom governs that session's plan→verify→ship discipline.

---

## 8. Where each wins

**DeerFlow wins on:**
- Breadth of output (research, slides, audio, newsletters, images)
- Being a deployable product (Web UI, IM bots, multi-tenant server, sandboxing)
- Model-agnostic / provider flexibility
- Maturity & community (70k★, MIT, ByteDance backing)

**Phantom wins on:**
- SDLC depth — adversarial plan deliberation, power levels, blast-radius, PR/Jira lifecycle
- Zero infra — install a plugin, no server to run
- Correction-grade memory — scored learnings with `[failed]` blocking, not just fact recall
- Tight Claude Code integration (hooks enforce discipline structurally, not via prompt ceremony)

**What Phantom could borrow from DeerFlow:**
- `ask_clarification`-style mid-execution gate (Phantom gates are phase-bounded)
- Pluggable output skills beyond code (Phantom is code-only; report/diagram gen could be a skill)
- Provider-agnostic model config (Phantom is Opus-locked by design — fine for now)

**What DeerFlow could borrow from Phantom:**
- Adversarial Planner↔Rival deliberation (DeerFlow's plan gate is shallow)
- Scored/decaying learnings with explicit failure-blocking
- Named specialist personas vs generic clones, where the vertical is well-known

---

## 9. Bottom line

Not a "vs" — a "where." DeerFlow is the **horizontal superagent harness**; Phantom
is the **vertical SDLC discipline layer**. The most interesting result of this
comparison isn't a winner — it's that DeerFlow's ACP feature means the two could
**stack**, with Phantom as the coding executor DeerFlow delegates to.

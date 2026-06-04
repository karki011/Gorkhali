# Orchestration Frameworks: LangGraph & OpenAI Agents SDK
# Determinism Analysis for Phantom Harness Upgrade
# Author: Subash Karki
# Date: 2026-06-03

---

## The Core Problem This Survey Addresses

Phantom today is Markdown-prompt-driven: the router writes a plan, Blades are "spawned" by prose
instructions, verify/fix loops are described in natural language. Claude may or may not honor the
intent. Every hand-off, gate check, and retry is a prompt-level suggestion, not a code-level
guarantee. The question is: what specific primitives from production orchestration frameworks
would make Phantom's control flow guaranteed rather than advisory?

---

## A. LangGraph

### Model: Graph as State Machine

LangGraph compiles a directed graph where:

- **Nodes** are Python callables (LLM calls, pure code, tool executors, sub-graphs).
- **Edges** are unconditional transitions (`add_edge(A, B)`).
- **Conditional edges** are routing functions (`add_conditional_edges(node, fn, map)`) where `fn`
  is pure Python that inspects the typed State and returns a string key. The map resolves that key
  to the next node name. This function is **never an LLM call** — it is deterministic code.
- **State** is a `TypedDict` (or Pydantic model) passed through every node. Each field can have
  a **reducer** (e.g., `Annotated[list, operator.add]`) that specifies how concurrent writes merge.
  Reducers are pure functions — no LLM involved.

The critical split:

| What is deterministic code | What can be LLM |
|---|---|
| Graph topology (edges, node names) | Node body (the LLM call itself) |
| Conditional edge routing functions | Structured output consumed by routing fn |
| Reducers on State fields | Content of any state value |
| Interrupt placement (`interrupt()` calls) | Decision to continue after interrupt |
| Retry/timeout config per node | Nothing — fully code-controlled |
| Subgraph boundaries | — |

The LLM is confined to node bodies. Routing is code. This is the fundamental determinism gain.

### Typed State Object

```python
from typing import Annotated
from typing_extensions import TypedDict
import operator

class PhantomState(TypedDict):
    plan: str                                    # written once by planner node
    files_changed: Annotated[list, operator.add] # accumulates across parallel coder nodes
    verify_passed: bool                          # written by verifier node
    fix_attempts: int                            # reducer: increment-only
    power_level: int                             # set at start, gates branch logic
```

Every node receives this struct. Routing functions read it. Nothing is lost between hops.

### Conditional Edges — The Routing Guarantee

```python
def route_after_verify(state: PhantomState) -> str:
    if state["verify_passed"]:
        return "wrap"
    if state["fix_attempts"] >= 3:
        return "escalate"       # hard stop, not a prompt suggestion
    return "fix"

builder.add_conditional_edges("verify", route_after_verify, {
    "wrap":     "wrap_node",
    "fix":      "fix_node",
    "escalate": "escalate_node",
})
```

The routing function is **pure Python evaluated by the runtime**, not re-interpreted by Claude.
If `fix_attempts >= 3`, the graph transitions to `escalate_node`. Claude cannot argue it out of
this. This directly replaces Phantom's "if verify fails, ask Claude to fix" Markdown loop.

### Checkpointing / Durable Execution

Every node execution writes a checkpoint keyed by `(thread_id, checkpoint_id)` before the node
runs and after. The checkpoint captures the full `State` snapshot.

What this buys:

1. **Resume after crash**: restart graph with the same `thread_id`, it replays from the last
   saved checkpoint — not from scratch.
2. **Human-in-the-loop interrupt**: `interrupt()` inside a node raises a special signal that
   suspends execution and persists state. A human (or code) calls `graph.invoke(Command(resume=value), config)` to continue. The graph resumes **exactly** at the interrupted node with the human's input injected into State — no re-running prior nodes.
3. **Time travel**: call `graph.invoke(None, config={"checkpoint_id": old_id})` to replay from
   any prior checkpoint. Or fork: supply modified state at replay time to explore an alternative
   path without mutating the original thread.
4. **Fault tolerance**: per-node retry config (`RetryPolicy`) + error handlers. If a node raises,
   LangGraph can retry N times before routing to a fallback node — all in code, not prompt.

```python
from langgraph.types import interrupt

def verify_node(state: PhantomState):
    result = run_tests(state["files_changed"])
    if result.ambiguous:
        # Pause here. Persist state. Wait for human or orchestrator.
        human_call = interrupt({"prompt": "Tests ambiguous, confirm proceed?", "result": result})
        # Execution resumes here with human_call = Command(resume=<human_value>)
    return {"verify_passed": result.passed}
```

### Subgraphs and Supervisor Pattern

A subgraph is a compiled `StateGraph` used as a node in a parent graph. It has its own internal
state schema; the parent maps fields in/out at the boundary.

```python
# Coder blade as a subgraph
coder_graph = StateGraph(CoderState)
coder_graph.add_node("scaffold", scaffold_node)
coder_graph.add_node("implement", implement_node)
coder_graph.add_edge("scaffold", "implement")
coder_blade = coder_graph.compile()

# Parent graph uses it as a node
builder.add_node("coder", coder_blade)
```

The supervisor pattern: a supervisor node runs an LLM with structured output that picks the next
worker by name. The conditional edge routes to that worker as code. Workers are subgraphs or
nodes. Control always returns to supervisor after each worker completes (or uses `Command` to
redirect). The LLM picks the label; the code does the routing.

### Phantom Pipeline as a LangGraph Graph

```
START
  │
  ▼
[router_node]           ← LLM: reads task, emits structured plan into State.plan
  │
  ▼ unconditional
[plan_node]             ← pure code: parses plan, sets State.subtasks, State.power_level
  │
  ▼ conditional_edge: power_level >= 3 → "parallel_blades", else → "single_blade"
  ├──────────────────────────────────────────────────────┐
  ▼                                                       ▼
[single_blade]                                   [parallel_blades]
  │  (subgraph: scaffold→implement→lint)           │  (fan-out via Send API)
  │                                                │  N coder subgraphs in parallel
  └─────────────────────┬──────────────────────────┘
                        ▼ reducer merges files_changed lists
                   [verify_node]       ← runs tests/linters deterministically
                        │
                        ▼ conditional_edge: route_after_verify()
              ┌─────────┼─────────┐
              ▼         ▼         ▼
           [wrap]    [fix_node] [escalate]
                        │         │
                  (fix_attempts++) │ (hard stop, notify human)
                        │
                    loops back to verify_node
                        │
                   (after max attempts → escalate)
              ▼
           [wrap_node]          ← pure code: commit, PR, summary
              │
             END
```

Key determinism wins vs. current Phantom:
- `route_after_verify` is Python, not prose. Max fix attempts is a hard int comparison.
- Power-level gating is a Python branch, not a Markdown instruction Claude might misread.
- Fan-out to parallel blades uses LangGraph's `Send` API (typed), not "spawn multiple agents."
- Checkpoints mean a crash mid-coder doesn't restart from scratch.

---

## B. OpenAI Agents SDK

### Model: Agents + Handoffs + Guardrails

The SDK (GA 2025, Swarm successor) has four determinism-relevant primitives:

### 1. Typed Handoffs

A handoff is a **tool call** that the LLM makes, but the *routing consequence* is deterministic
code. When an agent's LLM calls `transfer_to_<agent_name>`, the SDK:

1. Validates the tool call arguments against the typed `input_type` schema (Pydantic).
2. Runs the optional `on_handoff` callback (pure Python).
3. Transfers control to the target agent object.

The LLM decides *which* handoff tool to call (non-deterministic). The *effect* of calling it —
which agent runs next, what state is passed, which history is filtered — is code.

```python
from agents import Agent, handoff, RunContextWrapper
from pydantic import BaseModel

class VerifyInput(BaseModel):
    files_changed: list[str]
    test_suite: str

def on_verify_handoff(ctx: RunContextWrapper, inp: VerifyInput):
    # Runs deterministically when handoff is invoked
    ctx.context.verify_target = inp.test_suite

verifier = Agent(name="verifier", instructions="Run tests and report pass/fail")

coder = Agent(
    name="coder",
    handoffs=[
        handoff(
            agent=verifier,
            input_type=VerifyInput,
            on_handoff=on_verify_handoff,
            # Can be disabled: is_enabled=lambda ctx, inp: ctx.context.power_level >= 2
        )
    ]
)
```

Contrast with Phantom's "spawn a Blade" instruction: there, Claude re-interprets prose and
decides how/whether to spawn. Here, the SDK validates the tool call schema and executes the
transfer unconditionally once invoked. The routing *consequence* is guaranteed.

**Key difference from Phantom Markdown spawning**: handoffs are registered at construction time
with typed schemas. The LLM cannot invent a new handoff target or skip validation. If the typed
input is invalid, the handoff fails with a schema error, not a silent misinterpretation.

### 2. Guardrails — Deterministic Gates

Guardrails are Python async functions decorated with `@input_guardrail` or `@output_guardrail`.
They run **in parallel** with the agent's LLM call (input) or after generation (output). They
return a `GuardrailFunctionOutput` with a `tripwire_triggered: bool`.

When a tripwire fires, the SDK raises `InputGuardrailTripwireTriggered` or
`OutputGuardrailTripwireTriggered` immediately and halts agent execution. This is a hard stop
in Python — not a prompt instruction to stop.

```python
from agents import (
    Agent, GuardrailFunctionOutput, RunContextWrapper,
    input_guardrail, output_guardrail, InputGuardrailTripwireTriggered
)
from pydantic import BaseModel

class PhantomContext(BaseModel):
    power_level: int
    fix_attempts: int

@input_guardrail
async def max_fix_attempts_guard(
    ctx: RunContextWrapper[PhantomContext], agent: Agent, input: str
) -> GuardrailFunctionOutput:
    triggered = ctx.context.fix_attempts >= 3
    return GuardrailFunctionOutput(
        output_info={"attempts": ctx.context.fix_attempts},
        tripwire_triggered=triggered,
    )

@output_guardrail
async def verify_output_guard(
    ctx: RunContextWrapper[PhantomContext], agent: Agent, output: str
) -> GuardrailFunctionOutput:
    # Parse structured output from verifier LLM
    passed = "PASS" in output
    return GuardrailFunctionOutput(
        output_info={"passed": passed},
        tripwire_triggered=not passed,  # halt if failed
    )
```

Direct mapping to Phantom:
- **Power-level gate**: input guardrail checks `ctx.context.power_level`, trips before LLM runs.
- **Verify gate**: output guardrail parses verifier output, trips if tests failed.
- **Fix-attempt cap**: input guardrail on fix agent, trips after N attempts → caller catches
  exception and routes to escalation.

The key property: guardrails run as Python, their tripwire is an exception, exceptions are
caught in code. Claude cannot talk its way past a tripped guardrail.

### 3. Sessions and Tracing

Sessions group multiple `Runner.run()` calls into a logical thread (like LangGraph's `thread_id`).
Tracing wraps every span — LLM generation, tool call, handoff, guardrail — in structured spans
with unique IDs.

What this buys for Phantom:
- Every blade execution, handoff, and gate check has a span. Replay is possible by inspecting
  the trace (not as deep as LangGraph's checkpoint replay, but observable).
- Guardrail spans are separate from agent spans — you can see exactly which gate fired.
- Custom trace processors can push to any backend (no lock-in to OpenAI platform).

### 4. `is_enabled` on Handoffs — Dynamic Gating in Code

```python
handoff(
    agent=high_power_blade,
    is_enabled=lambda ctx, inp: ctx.context.power_level >= 3
)
```

This is a Python predicate evaluated at runtime before the handoff executes. The LLM may choose
to call the handoff tool, but `is_enabled=False` means the SDK silently refuses it and the LLM
is told the tool is unavailable. Power-level gating becomes code, not Markdown.

---

## Phantom's Current Gaps vs. What Each Framework Fixes

| Phantom Gap | LangGraph Fix | OpenAI Agents Fix |
|---|---|---|
| Router → Blade routing is prose | Conditional edges: pure Python routing fn | Handoffs with `is_enabled` predicates |
| Fix loop has no hard cap | `route_after_verify` checks `fix_attempts` int | Input guardrail trips at attempt N |
| Power-level gate is a Markdown hint | Conditional edge on `power_level` field | `is_enabled` lambda on handoff |
| Verify pass/fail is re-interpreted | `verify_passed: bool` in typed State, routed by code | Output guardrail parses result, trips if fail |
| Crash = restart from scratch | Checkpointer: resume from last node | No equivalent (sessions don't checkpoint mid-run) |
| No audit of what gate fired when | Checkpoint trace + Studio visualization | Guardrail spans in trace |
| Parallel blade fan-out is a suggestion | `Send` API: typed parallel node dispatch | Multiple agents with independent runs |

---

## Infrastructure Requirement: Do These Force Leaving the Plugin Model?

### LangGraph
**Yes, partially.** To use checkpointing you need a checkpointer backend:
- `InMemorySaver`: zero-infra, process-local, lost on restart. Sufficient for single-session
  determinism (routing, gating, typed state). Does not survive process death.
- `SqliteSaver`: one SQLite file, zero server. Survives restarts. Fits Phantom's local-first model.
- `PostgresSaver`: requires a Postgres server. Not suitable for zero-infra plugin distribution.

The graph topology, conditional edges, reducers, and subgraphs require **no infra**. They are
pure Python. You can get all routing/gating determinism from LangGraph with just `InMemorySaver`
or `SqliteSaver`.

LangGraph Studio (the visual debugger) requires LangSmith cloud or a local Docker container.
Not required for the primitives — only for debugging UI.

**LangGraph itself is a Python package (`pip install langgraph`).** No server needed.
However, it is Python-first. If Phantom's harness is Claude Code (TypeScript/shell), you'd
either use the JS port (`@langchain/langgraph`) or call a Python process. This is the real
adoption cost.

### OpenAI Agents SDK
**No, mostly.** The SDK is `pip install openai-agents` (Python). Guardrails, handoffs, and
typed agents are pure library primitives — no server. Sessions and tracing default to
OpenAI's platform (requires API key, no self-hosted option out of the box), but custom trace
processors can redirect to local storage. The SDK works with any OpenAI-compatible model endpoint,
including Anthropic via a compatibility layer.

**Critical constraint**: the SDK is designed around OpenAI's tool-call format. Routing via
handoffs assumes the LLM speaks the tool-call protocol. Claude does support tool calls, but
some handoff behaviors (especially auto-routing logic) may behave differently than with GPT-4o.
Test before committing.

### Phantom-Native Path (Steal Primitives, Not Frameworks)

Neither framework requires wholesale adoption. The specific primitives Phantom can steal and
implement natively in its harness (TypeScript / Claude Code hooks):

1. **Typed state struct** — a JSON schema validated at each hop (no framework needed).
2. **Routing function pattern** — a JS/TS function that reads state and returns the next blade
   name; Claude Code's hook system can invoke this after each agent completion.
3. **Guardrail-as-exception** — a synchronous check function that throws before an agent runs;
   the harness catches and routes to escalation. No framework, just a function.
4. **Checkpoint-to-SQLite** — write state JSON to a local SQLite row after each node; on crash,
   read the last row to resume. One `better-sqlite3` call, no server.

This is the "steal primitives" approach: adopt the pattern, skip the dependency.

---

## Primitives Worth Stealing (Priority Order)

### 1. Typed Routing Function (from LangGraph conditional edges)
**What it guarantees**: the routing decision — which blade runs next after verify/fix — is
evaluated by a named Python/TS function, not re-interpreted by Claude from Markdown. The function
reads typed fields (bool, int) and returns a string node key. Claude cannot misread it.

**Phantom equivalent to build**: after each blade completes, a `route(state: PhantomState): string`
function in the harness (not a prompt) decides the next step. Harness invokes the function;
Claude never sees the routing logic.

### 2. Guardrail as Hard Gate (from OpenAI Agents guardrails)
**What it guarantees**: a synchronous check function runs *before* the agent LLM call and throws
`GuardrailTripwireTriggered` if the condition fails. The agent never runs. The caller's
`try/catch` routes to the fallback path. Claude cannot argue past an exception.

**Phantom equivalent to build**: a `checkGate(state): void | throws` function in harness. Checks:
power level, fix attempts, file-count limits, secret patterns in diff. Runs as code before any
blade spawns. On throw, harness routes to escalation blade, never to the LLM.

### 3. Checkpoint-per-Node with SQLite (from LangGraph checkpointer)
**What it guarantees**: after every node completes, full state is persisted. On crash or restart,
the harness reads the last checkpoint for the session and resumes from the last completed node.
Phantom sessions today are ephemeral — a Claude Code crash loses all context.

**Phantom equivalent to build**: after each blade `on_complete` hook fires, write
`{session_id, node_name, state_json, timestamp}` to `~/.phantom-os/sessions.db`. On session
start, check for an incomplete session with the same task hash and offer resume.

---

## Summary

LangGraph and OpenAI Agents SDK converge on the same insight: **put routing and gating in code,
put generation in nodes**. The LLM is a pure content producer; the harness is a pure control
flow evaluator. Neither framework is necessary to adopt this insight — both can be stolen as
patterns and implemented natively in Phantom's Claude Code harness with zero new servers
(SQLite for checkpoints, TS functions for routing, TS throws for gates).

Adopting either framework wholesale would require leaving the plugin model: LangGraph needs a
Python runtime wired into the harness; OpenAI Agents SDK assumes OpenAI's tool-call ecosystem.
The steal-primitives path preserves zero-infra plugin distribution while getting the determinism
gains that matter most.

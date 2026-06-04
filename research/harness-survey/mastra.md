# Mastra — Research Notes for Phantom
**Date:** 2026-06-03  
**Author:** Subash Karki  
**Source:** mastra.ai/docs (workflows, suspend-resume, HITL, agents, memory, deployment)  
**Purpose:** Identify ideas Phantom can steal. Focus on (a) code-as-control-flow workflow API as model for Phantom's pipeline, (b) durable suspend/resume vs Phantom's JSON-artifact pause/resume.

---

## What Mastra Is

TypeScript-native AI agent framework. Core primitives: `createStep`, `createWorkflow`, `createAgent`. Workflow graph built by chaining methods on the workflow object. Steps have typed Zod schemas for input/output/suspend/resume. Storage backends: libsql, postgres, mongodb, cloudflare — swappable. Server: optional Hono-based server (`mastra build`), but the core library runs embedded in any Node process without a server. Can also integrate with Inngest for managed durable execution.

---

## The 3 Ideas Worth Stealing

---

### Idea 1 — Code-as-Control-Flow Workflow API

**What Mastra does.**

Workflow graph is expressed as a fluent chain of typed method calls. Each node is a `createStep` with explicit Zod schemas. The graph is committed once and is fully inspectable as a data structure before execution.

```typescript
// createStep: deterministic unit, can call LLMs internally
const fetchStep = createStep({
  id: 'fetch',
  inputSchema: z.object({ url: z.string() }),
  outputSchema: z.object({ body: z.string() }),
  execute: async ({ inputData }) => {
    const res = await fetch(inputData.url)
    return { body: await res.text() }
  },
})

const parseStep = createStep({ ... })
const highPathStep = createStep({ ... })
const lowPathStep = createStep({ ... })

export const pipeline = createWorkflow({
  id: 'my-pipeline',
  inputSchema: z.object({ url: z.string() }),
  outputSchema: z.object({ result: z.string() }),
})
  .then(fetchStep)                                          // sequential
  .branch([
    [async ({ inputData }) => inputData.value > 10, highPathStep],  // conditional
    [async ({ inputData }) => inputData.value <= 10, lowPathStep],
  ])
  .map(async ({ inputData, getStepResult }) => {            // merge branch outputs
    return getStepResult('high-path-step') ?? getStepResult('low-path-step')
  })
  .parallel([subWorkflowA, subWorkflowB])                  // fan-out
  .foreach(processDocWorkflow, { concurrency: 3 })          // map-reduce
  .dountil(retryStep, async ({ inputData }) =>              // loop until condition
    inputData.status === 'done'
  )
  .commit()                                                 // seals the graph
```

Key properties:
- **Deterministic graph, non-deterministic steps.** The control-flow structure (which step runs after which, under what conditions) is pure code — no LLM decides the route. Individual steps can call LLMs to produce their outputs.
- **`.commit()` seals.** The graph is a static data structure after commit. Can be introspected, serialized, visualized without running it.
- **Typed data contracts between steps.** Input/output schemas are Zod — runtime-validated at each edge. Type errors surface at step boundary, not buried in prompt output.
- **Nested workflows as first-class nodes.** `parallel([workflowA, workflowB])` or `foreach(workflow)` composes whole pipelines as graph nodes.

**Phantom parallel.**

Phantom's current pipeline is a sequence of markdown skill invocations driven by LLM reasoning. The LLM decides which step to run next based on prompt context. This is the opposite model: LLM-as-router rather than code-as-router.

**What Phantom can steal — directly, in JS/TS hooks.**

The *concept*, not the library. Phantom's hook layer (`hooks/hook-router.js`, `hooks/hooks.json`) is already Node/JS. A minimal version of the Mastra model is implementable without Mastra:

```javascript
// phantom/lib/pipeline.js — Mastra-inspired, no Mastra dependency
function createStep(id, fn) {
  return { id, run: fn }
}

function createPipeline(steps, control) {
  // control = { branch: [(condition, stepId)], parallel: [stepId[]] }
  return {
    steps,
    control,
    async run(ctx) {
      for (const node of control.sequence) {
        if (node.type === 'step') {
          ctx = await steps[node.id].run(ctx)
        } else if (node.type === 'branch') {
          for (const [cond, id] of node.branches) {
            if (await cond(ctx)) { ctx = await steps[id].run(ctx); break }
          }
        } else if (node.type === 'parallel') {
          const results = await Promise.all(node.ids.map(id => steps[id].run(ctx)))
          ctx = node.merge(results)
        }
      }
      return ctx
    }
  }
}
```

The key steal is the **separation principle**: control flow lives in code, LLM calls live inside individual step functions. Phantom's `execute.md` skill currently conflates these — the LLM interprets which agent to spawn next. Moving that routing into a JS pipeline definition means Phantom's pipeline is auditable, replayable, and testable without an LLM.

**Portability: HIGH.** Pure JS, no framework dependency. Implementable today in Phantom's hook layer.

---

### Idea 2 — Typed Suspend/Resume with Explicit Schemas

**What Mastra does.**

Every step that can pause declares three additional schemas alongside its normal input/output:

```typescript
const approvalStep = createStep({
  id: 'user-approval',
  inputSchema:   z.object({ requestId: z.string() }),
  outputSchema:  z.object({ result: z.string() }),
  resumeSchema:  z.object({ approved: z.boolean() }),   // shape of data needed to resume
  suspendSchema: z.object({ reason: z.string(), requestDetails: z.string() }),  // payload returned when suspending

  execute: async ({ inputData, resumeData, suspend, suspendData }) => {
    if (!resumeData?.approved) {
      // First execution: suspend with context payload
      return await suspend({
        reason: 'User approval required',
        requestDetails: `Request ${inputData.requestId} pending review`,
      })
    }
    // Resumed: suspendData still available (what we suspended with)
    return { result: `Approved — ${suspendData?.reason}` }
  },
})
```

When `suspend()` is called:
1. The full workflow execution snapshot is written to configured storage (libsql/postgres/etc.).
2. The run status becomes `suspended`. The suspend payload is returned to the caller.
3. The process can restart. The snapshot survives.
4. Resume is triggered via `run.resume({ step: 'user-approval', resumeData: { approved: true } })`.
5. Execution continues from exactly where it paused — no re-running prior steps.

Recovery after process restart:

```typescript
const state = await workflow.getWorkflowRunById('run-123')
if (state?.status === 'suspended') {
  const reader = createWorkflowStateReader(state)
  const suspendedStep = reader.getSuspendedStep()
  const run = await workflow.createRun({ runId: state.runId })
  await run.resume({
    step: suspendedStep?.path,
    resumeData: { approved: true },
  })
}
```

Multi-step approval: each step resumes in sequence. Suspend payload carries context forward. `suspendData` (what we paused with) is available on resume alongside `resumeData` (what the human sent back).

**Phantom parallel.**

Phantom's `pause.md` / `resume.md` saves a JSON artifact (`pause-state.json`) with git HEAD, phase, pending contracts, resume notes. On resume, the user restores context from this file via prompt. Key limitation: it's prompt-driven reconstruction. The LLM must re-interpret the artifact and re-establish state. There is no execution-level snapshot — only a human-readable summary.

The current mechanism also explicitly acknowledges it cannot survive a Claude Code process exit for in-flight dynamic workflows: "A Claude Code dynamic workflow does NOT survive exiting Claude Code — it restarts fresh next session."

**Mastra's mechanism is more robust — but partially portable.**

Full Mastra suspend/resume requires:
- A storage backend (libsql or postgres) that persists the execution snapshot.
- The `@mastra/core` runtime to replay from snapshot.
- A server or long-running process to receive the resume HTTP call.

Phantom's hook layer is stateless JS scripts invoked per-event. It cannot host a persistent snapshot store natively.

**What Phantom can steal — the schema discipline, not the runtime.**

The portable idea is the **typed suspend contract**: every pauseable phase should declare, in code:
- What data it emits when pausing (`suspendSchema` equivalent).
- What data it requires to resume (`resumeSchema` equivalent).
- What data it had when it paused, available on resume (`suspendData` equivalent).

Phantom's `pause-state.json` is an informal approximation of `suspendSchema`. Making it explicit and schema-validated (even with plain Zod or JSON Schema in a Node hook) would:
1. Prevent partial/malformed pause states from silently failing resume.
2. Allow a resume hook to validate incoming resume data before re-entering the pipeline.
3. Enable automated resume (e.g., a CI webhook posts `{ approved: true }` and the hook validates it against the schema before proceeding).

Concrete form in Phantom's JS layer:

```javascript
// phantom/lib/suspend.js
const { z } = require('zod')

const PlanApprovalSuspend = {
  suspendSchema: z.object({
    phase: z.enum(['A','B','C','D']),
    planPath: z.string(),
    pendingContracts: z.array(z.string()),
    reason: z.string(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    feedback: z.string().optional(),
  }),
}

function writePauseState(dir, ticket, data) {
  const validated = PlanApprovalSuspend.suspendSchema.parse(data)
  fs.writeFileSync(
    path.join(dir, 'sessions', ticket, 'pause-state.json'),
    JSON.stringify({ ...validated, _schema: 'v2', writtenAt: new Date().toISOString() })
  )
}

function validateResumeData(data) {
  return PlanApprovalSuspend.resumeSchema.parse(data)
}
```

**Portability: MEDIUM.** Schema discipline = HIGH portability (just Zod in a hook). Full durable snapshot (process-restart-safe) = LOW portability without adding a storage dependency (libsql is tiny and embeddable, but it's still a new dep).

---

### Idea 3 — Structured Workflow State Reader for Recovery

**What Mastra does.**

`createWorkflowStateReader(state)` is a typed accessor over the raw snapshot. Instead of parsing an opaque JSON blob, callers use:

```typescript
const reader = createWorkflowStateReader(state)
reader.getSuspendedStep()        // which step is waiting
reader.getResumeLabel('approve') // named resume point
reader.getStepOutput('fetch')    // output of a completed step
```

This decouples the internal snapshot format from the code that reads it. Snapshots can evolve without breaking consumers.

**Phantom parallel.**

`phantom:resume` reads `pause-state.json` directly via prompt. The LLM interprets the raw JSON. If the schema changes across Phantom versions, old artifacts silently break or produce wrong resume behavior.

**What Phantom can steal.**

A `readPauseState(filePath)` helper in a JS hook that:
1. Reads the artifact.
2. Validates it against the declared version schema.
3. Returns a typed accessor object with named getters (`getPendingContracts()`, `getCurrentPhase()`, `getResumeNotes()`).
4. Fails loudly on schema mismatch rather than letting the LLM reason over malformed data.

**Portability: HIGH.** Pure JS, no dependency.

---

## Suspend/Resume Verdict

| Dimension | Mastra | Phantom (current) |
|---|---|---|
| Pause mechanism | `await suspend(payload)` in step code | Write `pause-state.json` via skill prompt |
| State storage | DB snapshot (libsql/postgres) — process-restart-safe | File artifact — survives process restart but is prompt-interpreted |
| Resume trigger | `run.resume({ step, resumeData })` — programmatic HTTP call | `/phantom:resume` skill — LLM re-reads artifact |
| Schema validation | Zod schemas on suspend/resume payloads — runtime enforced | None — LLM interprets free-form JSON |
| Multi-step resume | Per-step resume in sequence, each validated | Single monolithic resume from top-level artifact |
| Process-restart safety | Full — snapshot survives restart, replays from exact step | Partial — artifact survives but requires LLM re-interpretation, no step-level replay |
| Portability to Phantom hooks | Schema discipline: HIGH. Full durable snapshot: LOW (needs storage dep) | — |

**Verdict:** Mastra's full suspend/resume is more robust for process-restart safety (true snapshot vs. summary artifact). However, the *most impactful portable steal* is not the runtime — it's the **schema contract discipline**: declare `suspendSchema` and `resumeSchema` as Zod objects in a JS hook, validate on write and on resume. This closes Phantom's current silent-failure gap without requiring a storage backend.

If Phantom ever needs true cross-process durability (e.g., Claude Code crashes mid-phase and must resume without re-running completed steps), the path is: add `@libsql/client` (SQLite-backed, embedded, no server) to persist step-level snapshots. Mastra's snapshot format is open — the idea is portable even without `@mastra/core`.

---

## What NOT to Steal

- **The full Mastra runtime.** Phantom's enforcement layer is Claude Code hooks — spawning a Mastra server alongside Claude Code adds operational complexity Phantom's architecture doesn't need.
- **Mastra's agent primitives.** Phantom's agents are Claude Code subagents defined by markdown system prompts. Mastra's `createAgent` wraps an LLM client directly — different layer, different concern.
- **Mastra's memory system.** Phantom already has agentdb (vector + graph memory). Mastra's semantic recall is the same concept, already solved.

---

## Summary — Top 3 Portable Steals

1. **Code-as-control-flow pipeline** (HIGH portability): Move Phantom's phase routing from prompt-driven to JS-defined. Steps are functions; control flow (`then/branch/parallel`) is code. The LLM never decides which step runs next — only what the step returns. Implementable today in `hooks/hook-router.js` or a new `phantom/lib/pipeline.js`.

2. **Typed suspend/resume schemas** (MEDIUM portability): Declare `suspendSchema` / `resumeSchema` as Zod objects per pauseable phase. Validate on write (`phantom:pause`) and on resume (`phantom:resume`). Eliminates silent failures from malformed artifacts. Schema-validated resume also enables programmatic resume (webhook, CI, API) without LLM interpretation.

3. **Structured state reader** (HIGH portability): A `readPauseState(path)` accessor with named getters and version validation, replacing raw JSON interpretation by the LLM on resume. Pure JS, zero new deps.

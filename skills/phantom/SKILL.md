---
name: phantom
description: Plan, execute, review, verify, pause, resume, and preserve software-development work through capability-adaptive role passes. Use for features, fixes, refactors, investigations, planning, implementation, code review, verification, session recovery, and progress checks.
---

# Phantom

Operate as the user's software-delivery shadow army. Preserve one workflow and
one artifact contract across every compatible agent runtime.

Maintained by Subash Karki.

## Non-negotiable rules

1. Read repository instructions and relevant learnings before proposing an
   approach or changing files.
2. Make only requested changes. Preserve unrelated user work.
3. For a defect, reproduce it, trace the exact code path, and confirm the root
   cause with the user before editing a fix.
4. Establish contracts and acceptance criteria before delegated implementation.
5. Inspect dependency impact before refactoring. Prefer a native dependency
   graph, otherwise run the bundled analyzer, and supplement partial results
   with local reference, test, and history tracing.
6. Choose the first minimum-sufficient solution after understanding the real
   code path. Prefer omission, reuse, standard or native capabilities, and
   installed dependencies before adding custom machinery.
7. Verify in proportion to risk. Never claim a check that did not run.
8. After correctness checks, run Sweep on every changed file. If Sweep changes
   files, repeat the affected checks before independent review.
9. Record durable state in the neutral Phantom data root. Do not make behavior
   depend on the runtime's brand, installation directory, or private metadata.
10. Ask before destructive, irreversible, externally visible, or materially
   scope-expanding actions unless the user already authorized them.
11. End with a clear `done`, `done-with-caveat`, or `blocked` status.

## Start every task

1. Read the nearest repository instructions and the Phantom learnings index for
   relevant corrections.
2. Inspect durable state and resume a matching active session when one exists.
   Do not create a new session before routing.
3. Trace the current behavior and gather minimum-sufficient-solution evidence,
   including omission, repository reuse, standard or native capabilities,
   installed dependencies, and candidate dependency impact.
4. Build a capability ledger using [capabilities](references/capabilities.md).
   Inspect exposed abilities without destructive probes.
5. Classify the route using [workflows](references/workflows.md):
   `direct`, `plan`, `brainstorm`, or `full`.
6. Select required role passes from [roles](references/roles.md). Apex
   automatically chooses `current-agent`, `native-serial`, or `native-parallel`
   execution using the route, dependency evidence, capability ledger, and
   [workflow policy](references/workflows.md). The user supplies the goal; do
   not ask them to choose workers, worker count, or models during the normal
   path. Honor explicit delegation constraints.
7. For `direct` and `plan`, select a solution rung from the gathered evidence;
   for `brainstorm` and `full`, defer selection until convergence. Record
   material choices in existing rationale, evidence, or session decisions.
8. Resolve compute using [model policy](references/models.md) after topology.
9. After route, topology, solution timing, and compute resolution are known,
   create a session when none was resumed; otherwise update the resumed
   [state](references/state.md). Record every fallback used.

When command execution is available, use the bundled state helper:

```text
node <skill-directory>/scripts/phantom-state.mjs start --workspace <path> --task <id> --intent <text> --route <route>
```

Resolve `<skill-directory>` from this `SKILL.md`; do not assume an installation
location. If command execution is unavailable, maintain the same artifact shape
with the runtime's file tools. If writing is unavailable, report a read-only
plan and do not pretend a session was persisted.

When a native dependency graph is unavailable and command execution exists,
run the bundled read-only analyzer before planning shared-file changes or a
refactor:

```text
node <skill-directory>/scripts/inspect-impact.mjs inspect --workspace <path> --depth 2 <relative-file> [...]
```

Treat `status: complete` as bounded dependency evidence. For `status: partial`,
read the warnings and supplement the result with text references, tests, and
version-control history. The analyzer is one-shot: it does not start a service,
register a capability, persist an index, or modify the workspace.

For plan and brainstorm review gates, create and persist the declared v3 JSON,
validate its decision contract, then invoke the bundled offline renderer on the
payload or its portable state envelope:

```text
node <skill-directory>/scripts/render-review.mjs plan --input <plan-json>
node <skill-directory>/scripts/render-review.mjs brainstorm --input <brainstorm-json>
```

Follow [planning](references/planning.md) and
[brainstorming](references/brainstorming.md) for their distinct information
contracts. New evidence records include when they were observed, confidence,
and known conflicts so stale or disputed inputs remain visible. JSON is the
source of truth; never author or repair HTML by hand. If file writing is
unavailable, present one fenced `json` block and state that it was not
persisted or rendered. If rendering or viewing is unavailable, preserve the
JSON, present the decision hierarchy in chat, and record the fallback.

## Capability fallbacks

Follow the complete ledger and fallback contract in
[capabilities](references/capabilities.md). A missing capability may block only
the affected stage; it never changes artifact meaning, removes a gate, or turns
missing evidence into a pass.

## Route the work

Classify `direct`, `plan`, `brainstorm`, or `full` using
[workflows](references/workflows.md). Routing selects gates and artifacts, not
worker count. Judge uncertainty, dependencies, and risk rather than size alone.

## Choose the minimum-sufficient solution

Trace the current behavior before minimizing it, then evaluate these options in
order and stop at the first one that completely satisfies the approved outcome:

1. If the requested mechanism does not need to exist, omit it.
2. If the repository already provides the behavior, reuse it or fix the shared
   path once.
3. If the language's standard library provides it correctly, use that.
4. If the native platform provides it, use the native capability.
5. If an already-installed dependency provides it safely, use that dependency.
6. If one clear, direct expression is sufficient, keep it direct.
7. Only then add the smallest custom implementation that works.

Apply this ladder automatically; do not make the user answer seven routine
questions. Ask only when omitting or materially reducing the mechanism would
conflict with an explicit requested outcome. Minimize implementation surface,
files, dependencies, agents, and models—not comprehension or verification.
Never simplify away explicit requirements, trust-boundary validation,
data-loss prevention, security, accessibility, or required compatibility. When
non-trivial custom logic remains, ensure at least one focused runnable check
covers it, preferring an existing repository-native check while preserving all
risk-proportionate and repository-required verification.

## Choose delegation automatically

Apex applies the automatic policy in [workflows](references/workflows.md) and
uses the smallest useful topology. Use only native delegation; never launch
another copy of the runtime or bypass nesting protections. Fall back to fresh,
labeled sequential role passes without removing gates. Honor explicit user
constraints and every runtime approval boundary.

When delegation is available, persist a versioned `delegation-task` before the
pass and a matching `delegation-result` after it. Carry typed context
references instead of copied conversation, identify whether judgment is
required, and validate the result before synthesis. Retry one malformed result
with its validation errors; if it remains invalid, escalate to a judgment-capable
Apex pass. Never silently accept an invalid envelope.

## Execute with role passes

Use [roles](references/roles.md) as behavioral contracts whether they run as
delegates or sequential passes. After topology, resolve the lowest sufficient
profile using [model policy](references/models.md); Apex remains `frontier`, an
explicit user selection wins, and unavailable selection inherits the active
model. When command execution is available:

```text
node <skill-directory>/scripts/resolve-profile.mjs --role <role> --profile <profile> --host <host-key>
```

The core sequence is Apex; Plan-checker and Rival when planning is required;
Blade; Ward; Sweep; Ward again if Sweep changes files; then Gaze. Add specialist
passes only when relevant. Apex validates and synthesizes all outputs. Every
assignment carries the minimum-sufficient-solution ladder and reports the
selected rung with brief evidence when it materially affects implementation.
Record the requested compute profile and only observable actual profile,
fallback reason, outcome, wall time, and tool turns. Never infer an actual
profile the host did not report.

## Preserve lifecycle state

Use `PHANTOM_DATA` when set; otherwise use the neutral default described in
[state](references/state.md). Keep runtime names diagnostic-only.

Useful helper operations:

```text
node <skill-directory>/scripts/phantom-state.mjs status --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs pause --workspace <path> --reason <text>
node <skill-directory>/scripts/phantom-state.mjs resume --workspace <path>
node <skill-directory>/scripts/phantom-state.mjs record --workspace <path> --type verification --status passed --input <json-file>
node <skill-directory>/scripts/phantom-state.mjs complete --workspace <path>
```

Pause before context loss. Resume from artifacts rather than conversational
memory. Record decisions, incomplete work, verification evidence, and the next
safe action.

## Complete the gate

Follow [verification](references/verification.md): inspect scope; run narrow and
repository-required correctness checks; run Sweep; repeat affected checks when
Sweep changes files; then run independent review. Record evidence and missing
capabilities, perform external lifecycle actions only when authorized, capture
reusable learnings, and complete or pause durable state.

## Reference map

- [Capabilities](references/capabilities.md): negotiation and degradation.
- [Manifest](manifest.json): bundle and portable contract versions.
- [Models](references/models.md): semantic compute profiles and resolution.
- [Roles](references/roles.md): provider-neutral shadow contracts.
- [State](references/state.md): paths, artifacts, locking, and resume behavior.
- [Workflows](references/workflows.md): routing and lifecycle procedures.
- [Planning](references/planning.md): decision-first plan contract and review surface.
- [Brainstorming](references/brainstorming.md): evidence-led divergence and convergence.
- [Verification](references/verification.md): evidence and quality gates.

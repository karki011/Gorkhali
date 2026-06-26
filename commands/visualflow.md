---
name: phantom:visualflow
description: "Use when building a NEW screen, feature, or flow — especially with NO Figma or design — and you want to nail down the flow BEFORE writing code. Produces a reviewable HTML flow artifact (screens, states, transitions) gated by a human before implementation. Also use when user says 'visual flow', 'plan the screens', 'flow before we build', or 'wireframe the flow'."
argument-hint: "<screen/feature description or ticket>"
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T3** — loads `_shared.md` + `_shared-shadows.md` + `_shared-discipline.md` + `_shared-contracts.md`

# /phantom:visualflow $ARGUMENTS

Pre-implementation visual flow planning — produces a reviewable HTML flow artifact (`visualflow.html`) BEFORE any code is written.

> **Counterpart to [`/phantom:visual`](visual.md)** — `phantom:visual` is POST-implementation browser verification (Lens screenshots the built UI). `phantom:visualflow` is the PRE-implementation mirror: it plans the flow and gates it with a human before code exists. Run `visualflow` first to lock the flow, then `visual` later to verify the implementation against it.

## Modes

- **Standalone**: interactive, default — gather → render → human gate → handoff
- **Auto-recommended**: Apex surfaces this via the `net_new_ui` signal before contracts/plan when a net-new screen/feature with no design is detected. User-gated — Apex recommends, never auto-runs.

## Execution

1. **Context:** Resolve TICKET from `$ARGUMENTS`, session state, or `git branch --show-current`. Ensure `{SESSION_DIR}` exists (`{TEAM_DIR}/sessions/{TICKET}/`, paths per `_shared.md`).

2. **Gather:** Derive the screens, user steps, per-screen states (empty / loading / error / success / edge), and transitions from `$ARGUMENTS` plus a quick read of related codebase patterns — existing routes, components, and design tokens. If a Figma/design already exists, note that `visualflow` is **optional** and recommend proceeding straight to implementation (or to `/phantom:visual` for verification once built).

3. **Build flow model:** Assemble an ordered screen-by-screen flow + per-screen state list + transitions/branches + open questions (decisions that need a human). Keep it low-fidelity — the goal is to agree on the flow, not the pixels.

4. **Render:** Write a self-contained HTML artifact to `{SESSION_DIR}/visualflow.html` using `reference/visualflow/flow-template.md` (substitute placeholders — zero external requests, all CSS inline). Then surface it: confirm the path written, and on darwin `open {SESSION_DIR}/visualflow.html`.

5. **HUMAN GATE:** Present the flow. Ask the human to **approve / adjust / add screens**. Loop on adjustments until approved, then lock the flow.

6. **Handoff:** The approved flow feeds downstream PLAN/contracts. Write `{SESSION_DIR}/visualflow.json` capturing `screens[]`, `states`, `transitions`, `openQuestions`, and `status: "approved"`.

## Rules

- Flow before fidelity — agree on screens, states, and transitions; do not design pixels.
- No code in this phase. Output is the flow artifact + locked JSON, nothing else.
- Figma/design already exists → recommend skipping straight to implementation; `visualflow` is optional.
- Human gate is mandatory — never mark `status: "approved"` without explicit human approval.

---
name: phantom:annotate
description: "Open an HTML artifact as a collaborative browser review surface — the human pinpoints elements or text and sends feedback, the agent applies it and loops. Use standalone via `/phantom:annotate <path-to-html>`, or auto-invoked by any flow that writes an HTML artifact for the human (brainstorm approaches, visualflow, an HTML plan gate). Also use when user says 'let me annotate this', 'open the artifact for review', or 'review this HTML in the browser'."
argument-hint: "<path-to-html>"
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob"]
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /phantom:annotate $ARGUMENTS

The review surface for HTML artifacts. Opens an artifact in a local browser via lavish-axi, long-polls for the human's annotations + queued prompts + browser layout warnings, applies the feedback, and loops until the human signals done. Standalone or auto-invoked by any flow that writes an HTML artifact — the human must never have to ask for the file.

> Wraps **lavish-axi** (MIT — Kun Chen / kunchenguid). No install: `npx -y lavish-axi` pulls the CLI on demand. No new npm deps — `npx -y` only.

<instructions>

## Step 1: Resolve + Preflight

1. **ARTIFACT** = `$ARGUMENTS` (path to the HTML file) when standalone, else the artifact the calling flow just wrote.
2. **Non-interactive guard (mandatory) — never start the loop with no human present.** If this run is headless (`--to-plan` mode, cron, queue, or any context with no human at the keyboard): do NOT start the annotate loop. Fall back to plain `open {ARTIFACT}` (or, when even `open` makes no sense headless, just report the artifact path in chat) and skip the poll entirely. This check happens before the availability check below — the never-hang guarantee must hold even when lavish itself is available.
3. **Availability check** — `command -v npx` and confirm the CLI can start (e.g. `npx -y lavish-axi --help` within a short timeout, ~15s).
4. **FALLBACK (mandatory) — never block a flow on lavish.** If `npx`/network is unavailable, or lavish fails to start within the timeout: fall back to today's behavior — `open {ARTIFACT}` on darwin (or print the path elsewhere) — and note in chat that annotation mode is unavailable this run. Then STOP (skip the poll loop). A flow NEVER waits on lavish.

## Step 2: Open + Poll

4. **Open:** `npx -y lavish-axi {ARTIFACT}` — opens or resumes the browser session (open-time layout gate on by default).
5. **Poll (background Bash task):** `npx -y lavish-axi poll {ARTIFACT}`. It long-polls and stays silent until the human acts or the browser reports fresh layout warnings. **stderr heartbeats are normal — never kill the poll.** If the harness kills or times it out anyway, just re-run it — queued feedback is never lost.

## Step 3: Apply Feedback (loop)

6. **On feedback** — annotations arrive as structured items (an element selector or a text range + the human's comment), plus any queued prompts:
   - **Apply each item:** revise the artifact — or the underlying plan/flow it renders — to address the annotation.
   - **Reply in-conversation, don't re-summon the browser for routine status:** `npx -y lavish-axi poll {ARTIFACT} --agent-reply "<what changed>"` shows your reply in the existing browser chat and keeps the loop going.
   - **Re-open etiquette:** a session the human ended from the browser will NOT reopen on a plain `npx -y lavish-axi {ARTIFACT}`. Pass `--reopen` ONLY when the human asks for more review or something genuinely important needs their visual attention. Otherwise deliver remaining updates directly in chat.
7. **On `layout_warnings` from poll** — follow the returned `next_step`: fix fresh **error-severity** findings and re-check them before asking the human to look. When every current warning is **persistent** or **low-severity**, proceed with a note instead of looping — never loop forever on heuristic warnings.

### Plan-gate case (artifact is a rendered `plan.html`)

When the artifact is a rendered plan (auto-invoked from `commands/start.md` PLAN route), the general "revise the artifact" flow in item 6 does NOT apply: **feedback is NEVER applied to the HTML.** `plan.html` is a rendered view; `plan.json` is the source of truth. Run this loop instead:

   a. **Classify** each annotation — **COSMETIC** (wording, rendering, typo) vs **MATERIAL** (scope, waves, files, tasks, assumptions, risks).
   b. **Apply ALL of them to `plan.json`** (the SSoT) — cosmetic and material alike. Never edit `plan.html` directly.
   c. **Re-validate material changes** — any MATERIAL change re-runs plan-checker on the revised `plan.json`; if scope moved (files added/removed, a new wave, a changed goal) re-run rival too. Cosmetic-only cycles skip re-validation.
   d. **Re-render** — `node scripts/render-plan.js {SESSION_DIR}/plan.json` regenerates `plan.html` from the revised source.
   e. **Re-present** — `npx -y lavish-axi poll {ARTIFACT} --agent-reply "<one-line summary of what changed>"`. If the human's browser session is still open, the refreshed `plan.html` is already live on reload; use `--reopen` ONLY per the re-open etiquette in item 6.
   f. **Record the cycle** — append a revision entry to `{SESSION_DIR}/decisions.json` (`revisions[]` array): `{cycle, annotations[], classification, planChanges, recheck}` where `recheck` holds the plan-checker/rival verdicts (or `null` on a cosmetic-only cycle).
   g. **Cycle ceiling: 3.** After 3 revise cycles without chat approval, STOP looping and escalate to plain chat discussion of the sticking points — say so explicitly rather than opening a 4th cycle.

Chat approval remains the gate exit throughout — annotations are feedback that feed this loop, not a second gate.

## Step 4: End

8. When the human signals done — browser **End session** / **Send & end session**, poll returns `status: ended`, or the human approves in chat — run `npx -y lavish-axi end {ARTIFACT}`. On `status: ended`, stop polling and do not reopen uninvited; deliver any remaining updates in chat.

</instructions>

<constraints>

## Rules

- **Never block a flow on lavish.** Any failure to start → plain `open` + chat note, then continue.
- **`npx -y` only** — no global install, no `package.json` change.
- **Annotations are feedback, not a second gate.** When auto-invoked at a plan/flow approval gate, annotations count as feedback on that plan/flow; the flow's existing chat approval remains valid.
- **Never kill the poll** — stderr heartbeats are expected. If interrupted, re-run; queued feedback is never lost.
- Fix fresh error-severity `layout_warnings`; proceed-with-a-note on persistent or low-severity ones.

</constraints>

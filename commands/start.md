---
name: start
description: "Use when starting any new feature, bug fix, refactor, or task: a ticket key, 'implement', 'build', 'fix', 'work on'. Plans, decomposes, and executes, with brainstorm, scout, and wiring folded in as phases."
argument-hint: "<requirement>"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
user-invocable: true
---

# /gorkhali:start "$ARGUMENTS"

The single entry point for new work. Reads `_shared.md` first, then runs the phases below in order; brainstorm and scout are optional, everything else always runs.

## Phase 1: Intake

Resolve the task id from `$ARGUMENTS`, or from the current session, or from the branch name. Open the session with `lib/session.js` - this creates `plan.json`, `progress.json`, and the scratch folder under the data root, never inside the project.

Fetch the ticket through the tracker adapter (`lib/tracker.js`): call its `fetch` descriptor. The provider it resolves comes from reading the preferences file, so nothing here names a provider directly. When the resolved provider is none, skip this silently - there is nothing to read. Read preferences and hold the text ready to inject verbatim, under the exact line `## User Preferences (verbatim)`, into every prompt built in the phases below.

Defect check: when the task reads as a bug, a regression, or a reported failure, hand it to Detective before anything else. Only a confirmed defect with a reproduction moves on to planning; anything short of that stops here and names the missing evidence.

## Phase 2: Route

Decide quick, plan, or full, and say the route plus a one-line reason. The user can change the route mid-session; when they do, say so and move to the new route's phases.

- **quick** - trivial, well-understood, one or two files. Run Phase 5 to write a minimal `plan.json` that still names every field `lib/plan-schema.js` requires - `briefing` (`tackling`, `problem`, `how`), `decision` (`question`, `recommendation`, `rationale`, `status`), `outcome` (`goal`, `doneWhen`), `scope` (`in`, `out`), and one task with its own `id`, `description`, `files`, `action`, `acceptance_criteria`, and `verify` - short values are fine, an absent field is not. Then skip Phase 6's approval gate straight to dispatch - pause, resume, status, and wrap all read `plan.json`, so quick never skips writing it, only the human gate.
- **plan** - normal scope. Write a plan, then stop at the one gate below.
- **full** - ambiguous scope, competing approaches, or the user asked to brainstorm. Add the brainstorm phase before planning.

User intent beats auto-detection: an explicit route request from the user always wins over the model's own read of scope.

## Phase 3: Brainstorm (full route, or on request)

Produce two or three genuinely distinct approaches, not variations of one idea. Chat brief only, no page, no artifact: name each approach and its one real trade-off. The user picks: Pick A / B / C, or asks for another option. Record the pick before planning starts.

## Phase 4: Scout (optional, any route)

When the codebase or the pattern to follow is unfamiliar, spawn read-only agents to gather context before planning. Skip it when the plan can already be written from what is known.

## Phase 5: Plan

Write `plan.json` in the session directory and validate it with `lib/plan-schema.js` before presenting it; an invalid plan never reaches the gate below. Every planning prompt, and every Opposition prompt that reviews it, carries the preferences block from Phase 1. On the quick route, this is still a real `plan.json` with every required field populated, just smaller - one task, short values - and it still must validate.

## Phase 6: Plan Approval (the one HUMAN GATE, skipped on the quick route)

The quick route skips straight from Phase 5 to Phase 7 - dispatch never waits on approval when the route itself was the approval. Every other route presents the plan as a chat brief only, no page, no artifact, no HTML:

- **What**: `briefing.tackling`
- **Problem**: `briefing.problem`
- **How**: `briefing.how`. A How without evidence is an assumption - say so.
- **Evidence**
- **Scope**
- **Risks**
- **Open questions**
- **Approve?**

Write it in plain English, one or two sentences a field, no file or symbol names in the prose. Say that implementation detail - files, tasks, waves, and dependency order - is available on request. Never degrade to a task-only gate. Feedback goes back into the plan and Opposition reruns before the brief is shown again.

Safety beats efficiency here: a plan that trades away a real safeguard for speed does not pass this gate on the strength of being fast.

## Phase 7: Wiring Notification

Before dispatch, print a short notification of the wave plan: which tasks run together, which wait on which. This is not a gate - it never blocks - but it is interruptible: the user can stop it and ask for a change before any agent spawns.

## Phase 8: Execution Dispatch

Spawn one agent per task. Each agent's name is built from its role and task id, `{role}-{taskId}`, with no separate naming registry to keep in sync. Each task's model comes from its role's tier resolved against the active host. Every Engineer prompt carries the preferences block from Phase 1.

Every task gets its own Inspector afterward: read-only, runs the checks it discovers, writes the record. No single verification pass covers two tasks at once.

The tracker adapter's start and done descriptors mark the ticket in progress and done when the resolved provider supports it. When the provider is none, these are no-ops - nothing to mark, nothing to fail.

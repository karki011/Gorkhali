# Base Agent Protocol

Common protocol inherited by all shadows members and allies. Agents reference this file instead of duplicating these sections.

## Project Inheritance
Before starting work, inherit project-specific knowledge:
1. Read `CLAUDE.md` in project root — code style, architecture, commands, tech stack
2. Read `.claude/rules/` — additional project rules
3. Read `AGENTS.md` if it exists — agent coordination rules
4. Read `.claude/agents/` — look for specialists in your domain
5. Read `.claude/skills/` — look for relevant skills
6. If found, follow their patterns EXACTLY

## Project Learnings
Check `${PHANTOM_DATA:-~/.phantom}/repos/{REPO_NAME}/learnings/` for project context:
- `INDEX.md` — quick reference (always read)
- Domain files matching your task: `ui.md`, `data.md`, `auth.md`, `testing.md`, `shadows.md`, `migration.md`, `tooling.md`

## On Task Completion

**Emit your deliverable as soon as you have one.** The order is: investigate, emit the deliverable, then refine or verify. A deliverable that still exists only in your head when the turn ends is lost, and to whoever spawned you a truncated turn looks exactly like a finished one.

- **After investigating, not before.** This rule governs WHERE the deliverable sits in the turn. It is not licence to report a conclusion you have not yet earned.
- **Before refinement, polish, or long-running verification** (test suites, builds, broad greps, wide reads). Those come after the deliverable exists, never before it.
- **If a turn must end early, it ends AFTER the deliverable, never before it.**
- **An observation is finished when you hold it; a completion claim is not.** A verdict or findings list reports what you saw, so it is done the moment you hold it. A status record claims work is finished: emit it on the same early schedule, but mark every check that has not actually run `not_observed` with the reason, never as passing, and amend the record once the check runs. The vocabulary is shared with `agents/ward.md` ("Observation Confidence Rule"): `checked:pass`, `checked:fail`, `not_observed`.
- **Refine by amending.** If a later finding changes your conclusion, restate it (or rewrite the artifact) immediately. Never leave a changed verdict living in prose only.

The deliverable itself is a detailed handoff note covering: what was done, key decisions, files changed, what the next agent needs to know, and any remaining concerns. If your role has a defined on-disk artifact (see your own agent definition), writing that file IS this step: put it on disk here rather than trusting the final message to survive.

## Sage Escalation
When stuck on a hard decision (2+ viable approaches, ambiguous requirement, first hypothesis failed):
- Spawn Sage (foreground — Sage's agent definition pins the top tier, opus / Opus 5) with: question, context, tentative approach
- Sage returns structured guidance (<100 words) — follow it
- Max 3 consultations per session. Beyond that = escalate to Apex.

## Model Behavior Notes
- Lead with the outcome; don't survey options you won't pursue or narrate routine steps.
- Brief instructions steer — don't over-enumerate.
- If a request is safety-rerouted to a different model mid-task, note it in your output and continue.

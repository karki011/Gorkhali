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
Check `${PHANTOM_DATA:-~/.claude/phantom-data}/repos/{REPO_NAME}/learnings/` for project context:
- `INDEX.md` — quick reference (always read)
- Domain files matching your task: `ui.md`, `data.md`, `auth.md`, `testing.md`, `shadows.md`, `migration.md`, `tooling.md`

## On Task Completion
Write a detailed handoff note covering: what was done, key decisions, files changed, what the next agent needs to know, and any remaining concerns.

## Sage Escalation
When stuck on a hard decision (2+ viable approaches, ambiguous requirement, first hypothesis failed):
- Before spawning: read `${PHANTOM_DATA:-~/.claude/phantom-data}/config.yaml`. If `models.sage` is set, pass it as the Agent-tool `model:` param. If absent or config missing, omit the param (sage.md's pin applies).
- Spawn Sage (foreground — Sage's agent definition pins the top tier) with: question, context, tentative approach
- Sage returns structured guidance (<100 words) — follow it
- Max 3 consultations per session. Beyond that = escalate to Apex.

## Model Behavior Notes
- Lead with the outcome; don't survey options you won't pursue or narrate routine steps.
- Brief instructions steer — don't over-enumerate.
- If a request is safety-rerouted to a different model mid-task, note it in your output and continue.

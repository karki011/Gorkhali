# GORKHALI - You Govern. They Execute.

[![CI](https://github.com/karki011/Gorkhali/actions/workflows/ci.yml/badge.svg)](https://github.com/karki011/Gorkhali/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-2.0.0-blue)](.claude-plugin/plugin.json)
[![tests](https://img.shields.io/badge/tests-passing-brightgreen)](test/)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Named for the soldiers of Gorkha - disciplined, loyal, and relentless.**
Gorkhali is a subagent delegation plugin for Claude Code.
It plans a change, hands the implementation to spawned agents, verifies and reviews the result independently, and only ships when you say so.

## What Gorkhali is

Gorkhali keeps the user on the loop, not in it, while enforcing its rules in code rather than in prose.
A `never-edits` hook stops the orchestrating session from calling Edit or Write directly; every change goes through a spawned agent.
Each role resolves to a fixed model tier (Inspector on economy, Engineer and Opposition on balanced, Auditor and Detective on deep), and a second hook denies any spawn whose explicit model contradicts its role's tier.
Verification and review are independent: an Inspector runs the discovered lint, build, test, and typecheck commands and records evidence, then a separate Auditor reviews the diff read-only against that evidence.
There is exactly one human gate: the plan, presented as What, Problem, How, Evidence, Scope, Risks, and Open questions, which you approve or send back.
After `wrap` opens the pull request, `greploop` drives it through all-author review until it is clean or a human has to decide; merging stays a human action.
The Engineer climbs a YAGNI ladder before writing code: skip, reuse, standard library, platform, dependency, one line, minimum code, in that order, and never cuts trust-boundary validation, error handling, security, or a runnable check.

## Install

```text
/plugin marketplace add karki011/Gorkhali
/plugin install gorkhali@gorkhali
```

Prerequisites: git and the Claude Code CLI. Recommended: the `gh` CLI for PR flows, an Atlassian MCP server if the tracker is Jira.

## Commands

| Command | What it does |
|---|---|
| `/gorkhali:start` | Entry point for new work: intake, route, optional brainstorm and scout, plan, the one approval gate, then dispatch. |
| `/gorkhali:pause` | Records where the session stands. No git operations. |
| `/gorkhali:resume` | Restores a paused or prior session's plan and progress. |
| `/gorkhali:verify` | Runs discovered checks and an independent review; never edits code to make a check pass. |
| `/gorkhali:fix` | Repairs the exact failures verification named; never guesses at a different problem. |
| `/gorkhali:review` | An on-demand, read-only second opinion on the current diff. |
| `/gorkhali:wrap` | Validates passed verification and review, then opens a ready-for-review PR. |
| `/gorkhali:greploop` | Drives an open PR through all-author review until clean or a human decides. |
| `/gorkhali:close` | Post-merge closeout: tracker to done, branch and worktree cleanup. |
| `/gorkhali:status` | The one notification surface: what is running, blocked, or shipped. |
| `/gorkhali:learn` | Appends one preference line, or a task-scoped scratch note. |
| `/gorkhali:visual` | Hands UI changes to a human checklist; runs a read-only Surveyor only if asked. |

## Preferences

Gorkhali reads a capped, twenty-line preferences file: a per-repo copy first, and only when that is missing, a global fallback.
Both live under the data root (`$GORKHALI_DATA`, or `$HOME/.gorkhali` by default) as `repos/<repo>/preferences.md` and `preferences.md`, never inside the project checkout, and are never committed.
`/gorkhali:learn` is how a preference gets written; every planner, brainstorm, Opposition, and Engineer prompt carries the text back verbatim.

## Ticket tracker

The tracker adapter resolves to `jira`, `github`, or `none`, in this order: an explicit override, then a `tracker: jira|github|none` line in the preferences file, then `none`.
Each provider exposes the same four operations: fetch, start, done, and comment.
Jira runs over an Atlassian MCP server. GitHub Issues support exists in the adapter but has not yet had its manual `gh` smoke test recorded, so treat it as untested until that run is logged.
With `none`, every operation is inert and Gorkhali works from git alone.

## What changed in 2.0

This is a full rewrite of the plugin surface, not an incremental release.

- Removed the five-route classifier, the difficulty-based router, and the self-updating knowledge layer.
- Removed session checkpoints, contracts, the cost ledger, the lifecycle state CLI, and decision contracts.
- Removed the roster naming system; an agent's name is now its role and task id by construction.
- Removed the alternate-host shims and the portable manifest; Claude Code is the only supported host.
- Folded brainstorm, scout, wire, execute, and contract into `/gorkhali:start` as phases instead of separate commands.
- Dropped `eval`, `evolve`, `health`, `validate`, `sessions`, `grill`, `recruit`, `loop`, `q`, `visualflow`, and `pr-review` as commands nobody used.
- Consolidated Steward and Justice into Auditor, and folded Clerk into the wrap and close procedures.

See `ROADMAP.md` for the full list of locked decisions behind this rewrite.

## Author

Built by [Subash Karki](https://github.com/karki011). Star the repo if Gorkhali earns it.

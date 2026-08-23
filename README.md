# GORKHALI — You Govern. They Execute.

[![CI](https://github.com/karki011/Gorkhali/actions/workflows/ci.yml/badge.svg)](https://github.com/karki011/Gorkhali/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-1.0.0-blue)](.claude-plugin/plugin.json)
[![tests](https://img.shields.io/badge/tests-1255-brightgreen)](test/)
[![runtimes](https://img.shields.io/badge/runtimes-Claude%20Code%20%2B%20Codex%20CLI%20%2B%20Kimi%20Code-8A2BE2)](project-docs/install.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Named for the soldiers of Gorkha — disciplined, loyal, and relentless. Gorkhali is a multi-agent development harness that turns one prompt into a planned, implemented, verified, independently reviewed pull request — and it never lets an agent break formation.**

One command assembles a full shadow cabinet for your codebase: a **Chief** who orchestrates and never touches code, **Engineers** who build in parallel, an **Inspector** who verifies with evidence, an **Auditor** who reviews independently, and an **Opposition** whose only job is to attack every plan before it executes. You approve the plan. They do everything else.

> Say `/gorkhali:recruit` and the right minister takes the brief.

## Why Gorkhali

Most agent setups trust the model to behave. Gorkhali doesn't. Its rules are **code, not prose** — hooks that return a decision *before* the tool call runs:

- **An engineer cannot spawn without a pinned model.** `hooks/engineer-model-gate.js` denies the spawn outright. No prompt can talk its way past it.
- **A session cannot end with an unreviewed PR.** `hooks/greploop-gate.js` blocks the stop until the review loop has run.
- **No silent edits outside a session.** `hooks/routing-gate.js` denies stray `Edit`/`Write` calls in a Gorkhali-known repo (opt-in via `GORKHALI_ROUTING_ENFORCE=1`).
- **A hand-edited routing decision does not survive CI.** Agent model pins are *generated* from one policy file; drift fails the build.
- **Evals decide, not reports.** `scripts/run-evals.js --gate` refuses to bless a partial run as a clean release — and recomputes the baseline from raw verdicts rather than trusting a stored number.

Every registration is visible in `hooks/hooks.json`. There is no hidden machinery.

## Measured, Not Claimed

**99.1% merge rate across 112 distinct PRs** — taken from `gh` as ground truth, over 191 recorded sessions spanning 152 tickets and two months of real use.

The caveats ship with the number: one developer, their own repositories, external review on 50 of 191 sessions. n=112 is a sample, not a study. The full table — and the beliefs this measurement *disproved* — are in `ROADMAP.md`.

## One Ticket, End To End

```text
/gorkhali:start CP-41606
  |- router classifies       -> PLAN route (3+ files, clear scope)
  |- Chief + Opposition      -> plan, attacked by the plan critic; you approve or break the tie
  |- Engineer x2 (parallel)  -> implementation in isolated worktrees
  |- Inspector               -> lint, build, test -> verification.json
  |- Auditor + Justice       -> scored review; P0/P1 auto-fixed, P2/P3 dropped
  `- /gorkhali:wrap           -> ready-for-review PR + ticket cost total
```

The PR opens **ready for review**, with a fixed three-section body — What & why, Verification, Review focus — assembled from real artifacts under hard caps. A missing artifact becomes an explicitly stated gap, never invented prose.

Report a bug instead of a feature and the route changes: the work is classified `investigation`, and **no fix runs until the evidence reaches `ready_for_fix`**. Proof before patch, every time.

## It Learns. It Adapts. It Stays In Budget.

- **Every session makes the next one smarter.** What worked, what failed, what got rejected in review — recorded, distilled, and loaded into the next run.
- **Difficulty-based routing.** Trivial tasks skip planning entirely. Ambiguous ones brainstorm first. Complex ones get full dependency wiring. You never pay ceremony tax on a typo fix.
- **A spend ceiling that halts honestly.** `GORKHALI_SPEND_CEILING_USD` stops unattended runs on a *confirmed* overrun — unknown spend continues with a record, interactive sessions are never capped, because the watching human is the ceiling.
- **Config with provenance.** Every resolved value reports which layer it came from. An unset key says unset — never a fabricated default.

## Runs Everywhere Your Agents Do

One provider-neutral Agent Skill at `skills/gorkhali/` runs natively on **Claude Code**, **Codex CLI**, and **Kimi Code** — zero external plugin dependencies, fully self-contained. Optional host capabilities degrade to explicit fallbacks instead of breaking. The Kimi preset routes only across Kimi's own model tiers, so a Kimi session never requests compute from another provider.

## Quick Start

Ask naturally in any Agent Skills-compatible host:

```text
Use Gorkhali to implement CP-41606 through a tested review request.
Use Gorkhali to investigate why the dashboard feels slow.
Use Gorkhali to pause this task and preserve a resumable checkpoint.
```

Or drive the command surface directly:

```bash
/gorkhali:start CP-41606                    # router → plan → execute → verify → ship
/gorkhali:start "the dashboard feels slow"  # ambiguous → brainstorm → plan → verify
/gorkhali:verify                            # run checks, report with evidence
/gorkhali:wrap                              # commit, push, PR, ticket transition
/gorkhali:pause → /clear → /gorkhali:resume # portable handoff packet
```

In Codex, type `$` or open `/skills` and pick a `gorkhali:*` skill. In Kimi Code the same bundle is discovered through the Agent Skills convention.

Ticket tracker optional — Jira via an Atlassian MCP server is supported today; Linear and GitHub Issues are designed for. Freeform sessions skip tracker sync entirely, so Gorkhali works out of the box with nothing but Git.

Full setup, native plugin install, and upgrade paths: [Install](project-docs/install.md).

## Documentation

| Document | What it covers |
|---|---|
| [Install](project-docs/install.md) | Portable skill and native plugin installation, prerequisites, upgrading |
| [Architecture and Key Concepts](project-docs/architecture.md) | The adaptive cognitive router and the Repo Brain knowledge layer |
| [Code Structure](project-docs/code-structure.md) | The portable skill tree, the native plugin tree, and the mutable state tree |
| [Shadows, Models and Effort](project-docs/agents.md) | The agent roster, role-to-profile routing policy, and effort rules |
| [Commands](project-docs/commands.md) | Every `/gorkhali:*` command and the route it takes |
| [Configuration](project-docs/configuration.md) | The layered config file and every user-relevant environment variable |
| [Portable Agent Skill](project-docs/portable-skill.md) | The provider-neutral bundle and runtime capability negotiation |
| [ROADMAP.md](ROADMAP.md) | Durable backlog, decisions, and the measured baseline with its caveats |

## Author

Built by [Subash Karki](https://github.com/karki011). Star the repo if Gorkhali earns it.

# PHANTOM - Your Shadow Army of AI Agents

[![CI](https://github.com/Cloudzero/research-phantom-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/Cloudzero/research-phantom-skills/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.4.1-blue)](.claude-plugin/plugin.json)
[![tests](https://img.shields.io/badge/tests-689-brightgreen)](test/)
[![runtimes](https://img.shields.io/badge/runtimes-Claude%20Code%20%2B%20Codex%20CLI-8A2BE2)](project-docs/install.md)

**Author: Subash Karki**

Phantom is a multi-agent development harness for Claude Code and Codex CLI that plans, implements, verifies, and ships work through specialized agents behind mechanically enforced gates.

> Inspired by Solo Leveling: you're the Monarch, your AI agents are the shadow army.
> Say `/phantom:recruit` - "Arise!" - and they answer.

## What It Does

Every task is a Gate. Phantom reads the difficulty, assembles the right shadows, and clears it. After every run, the system gains EXP - learning what works, remembering what doesn't.

Trivial tasks skip planning entirely. Ambiguous tasks brainstorm first. Complex tasks get full dependency wiring. Shadows deliberate among themselves; humans approve consensus or break ties.

Zero external plugin dependencies. Fully self-contained.

See `ROADMAP.md` for the durable backlog, decisions, and measured baseline.

## Mechanical Gates, Not Advice

The usual way to constrain an agent is prose in a prompt, which the model is free to ignore.
Phantom's gates are code that returns a decision before the tool call runs.

- `hooks/blade-model-gate.js` inspects every `Agent`/`Task` spawn and returns `permissionDecision: "deny"` in exactly two cases: an implementer role (`blade`, `sweep`, `ward`, `warden`) pinned to the retired Fable tier, or a `blade` spawn that set no explicit `model`.
  The spawn does not happen. There is no ceiling check here - the gate reads `skills/phantom/references/model-policy.json` only to word the deny reason, never to make the decision.
- `hooks/greploop-gate.js` is a `Stop` hook that returns `decision: "block"` when an active session's live PR has not been through the review loop, so a session cannot quietly end unreviewed.
  It is bounded to 3 blocks per PR, and any ambiguity allows the stop.
- `hooks/routing-gate.js` returns `permissionDecision: "deny"` on `Edit`/`Write`/`MultiEdit`/`NotebookEdit` inside a Phantom-known repository with no matching active portable Phantom session.
  It is opt-in via `PHANTOM_ROUTING_ENFORCE=1`, can explicitly expand to every Git repository with `PHANTOM_ROUTING_SCOPE=all-git`, and fails open on operational errors.
- `test/agent-frontmatter-drift.test.js` fails CI when any `agents/*.md` model pin drifts from `skills/phantom/references/model-policy.json`.
  A hand-edited routing decision does not survive to a merge.

Every registration is visible in `hooks/hooks.json`.

## Measured, Not Claimed

One number, with its sample stated before the number.

**99.1% merge rate across 112 distinct PRs** (111 merged, 1 closed), taken from `gh` as ground truth.
Produced by `scripts/baseline-report.js` over 191 canonical wrap records spanning 152 tickets and two months of real use.

The caveats matter more than the figure.
This is one developer's usage on their own repositories, the PRs were largely authored and merged by the same person, and external review ran on only 50 of those 191 sessions.
n=112 is a sample, not a study, and no third party has validated it.
The full table, and the beliefs that measurement disproved, are in `ROADMAP.md` sections 3 and 4.

## One Ticket, End To End

```text
/phantom:start CP-41606
  |- router classifies    -> PLAN route (3+ files, clear scope)
  |- Apex + Rival         -> plan, reviewed by the one plan critic; you approve or break the tie
  |- Blade x2 (parallel)  -> implementation in isolated worktrees
  |- Ward                 -> lint, build, test -> verification.json
  |- Gaze + Archer        -> scored review; P0/P1 auto-fixed, P2/P3 dropped
  `- /phantom:wrap        -> ready-for-review PR + ticket cost total
```

The PR body is a fixed three-section template — What & why, Verification, Review focus — assembled from those artifacts rather than written as free prose, under hard caps of 40 lines and 2500 characters.
A missing artifact means an explicit stated gap naming the artifact, never invented text.
The PR opens **ready for review**, because the evidence it ships with is what a reviewer would otherwise wait for.

Report a defect instead of a feature and no fix runs first.
The work is classified `investigation`, and no fix route can be selected until the evidence reaches `ready_for_fix`.

## What Is Actually In The Box

- **Proof before fix.** Every reported bug, regression, or flake writes a `defect-proof.json` and cannot reach a fix route until it reaches `ready_for_fix`. Spec: `reference/defect-proof.md`.
- **An unattended spend ceiling that halts honestly.** `PHANTOM_SPEND_CEILING_USD` (default `5`), enforced by `scripts/run-guard.js`, halts only on a CONFIRMED overrun and writes a halt record. Unknown spend continues rather than failing silently. Interactive sessions are never capped, because the watching human is the ceiling.
- **Model routing generated from one policy file.** `skills/phantom/references/model-policy.json` holds semantic role policy, `skills/phantom/references/model-presets.json` holds per-host models, and `scripts/gen-agent-frontmatter.js` generates every agent pin from them. No value is hand-maintained twice.
- **Outcome records with closed enums.** `scripts/outcome-write.js` writes a per-ticket outcome whose `pr_state` is one of `draft | open | merged | closed | absent`, derived from `gh` alone. Anything unmappable is recorded as unresolved instead of guessed. This is what made the measurement above possible at all.
- **A config layer with provenance.** `scripts/phantom-config.js get|set|list`, per-repo winning over global, created lazily. Every resolved value reports which layer it came from, and an unset key reports unset rather than a fabricated default.
- **Portable across runtimes.** One provider-neutral Agent Skill at `skills/phantom/` runs on Claude Code and Codex CLI alongside a native plugin distribution. Optional host capabilities degrade to explicit fallbacks instead of breaking the workflow.

## Quick Start

In an Agent Skills-compatible host, ask naturally:

```text
Use Phantom to implement CP-41606 through a tested review request.
Use Phantom to investigate why the dashboard feels slow.
Use Phantom to pause this task and preserve a resumable checkpoint.
```

The existing native plugin remains as a compatibility distribution with its
command surface:

```bash
/phantom:start CP-41606                    # router classifies → plan → execute → verify → ship
/phantom:start "the dashboard feels slow"  # ambiguous → brainstorm → plan → execute → verify
/phantom:verify                            # power level (P0/P1 fix, P2/P3 drop)
/phantom:wrap                              # commit, push, PR, Jira transition
/phantom:pause → /clear → /phantom:resume     # context mgmt + portable handoff packet
```

In Codex, type `$` or open `/skills`, then select the namespaced skill such as
`phantom:start`, `phantom:pause`, `phantom:wrap`, `phantom:loop`, or
`phantom:greploop`. Codex can also choose these skills implicitly from their
descriptions. Start a new task or CLI session after installing or updating the
plugin so the complete skill inventory is reloaded.

Full installation instructions, including the native plugin and upgrade paths,
are in [Install](project-docs/install.md).

## Documentation

| Document | What it covers |
|---|---|
| [Install](project-docs/install.md) | Portable skill and native plugin installation, prerequisites, upgrading from a pre-plugin install |
| [Architecture and Key Concepts](project-docs/architecture.md) | The adaptive cognitive router, the concepts behind each route, and the Repo Brain knowledge layer |
| [Code Structure](project-docs/code-structure.md) | The portable skill tree, the native plugin tree, and the mutable state tree |
| [Shadows, Models and Effort](project-docs/agents.md) | The agent roster, role-to-profile routing policy, and effort rules |
| [Commands](project-docs/commands.md) | Every `/phantom:*` command and the route it takes |
| [Configuration](project-docs/configuration.md) | The layered config file and every user-relevant environment variable |
| [Portable Agent Skill](project-docs/portable-skill.md) | The provider-neutral bundle, runtime capability negotiation, and dependency independence |
| [ROADMAP.md](ROADMAP.md) | Durable backlog, decisions, and the measured baseline with its caveats |

## Author

Subash Karki

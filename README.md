# GORKHALI — You Govern. They Execute.

[![CI](https://github.com/karki011/Gorkhali/actions/workflows/ci.yml/badge.svg)](https://github.com/karki011/Gorkhali/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-1.3.0-blue)](.claude-plugin/plugin.json)
[![tests](https://img.shields.io/badge/tests-passing-brightgreen)](test/)
[![runtimes](https://img.shields.io/badge/runtimes-Claude%20Code%20%2B%20Codex%20CLI%20%2B%20Kimi%20Code%20%2B%20Cursor-8A2BE2)](project-docs/install.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Named for the soldiers of Gorkha — disciplined, loyal, and relentless. Gorkhali is a multi-agent development harness that plans, implements, and independently verifies a change — then wrap authorizes a ready-for-review PR (`ship-pr`). It never lets an agent break formation.**

Start assembles a full shadow cabinet for your codebase: a **Chief** who orchestrates and never touches code, **Engineers** who build in parallel, an **Inspector** who verifies with evidence, an **Auditor** who reviews independently, and an **Opposition** whose only job is to attack every plan before it executes. You approve the plan. They implement and verify. Wrap is a separate `ship-pr` authorization — never implied by a passing verify.

## Why Gorkhali

Most agent setups trust the model to behave. Gorkhali doesn't. Its rules are **code, not prose** — hooks that return a decision *before* the tool call runs:

- **An engineer cannot spawn without a pinned model.** `hooks/engineer-model-gate.js` denies the spawn outright. No prompt can talk its way past it.
- **A live PR cannot skip the greploop gate.** `hooks/greploop-gate.js` blocks stop until greploop has run; greploop may write `skipped` if Greptile is unavailable. That is not a reviewed-PR guarantee.
- **No silent edits outside a session.** `hooks/routing-gate.js` denies stray `Edit`/`Write` calls in a Gorkhali-known repo (opt-in via `GORKHALI_ROUTING_ENFORCE=1`).
- **A hand-edited routing decision does not survive CI.** Agent model pins are *generated* from one policy file; drift fails the build.
- **Evals decide, not reports.** `scripts/run-evals.js --gate` refuses to bless a partial run as a clean release — and recomputes the baseline from raw verdicts rather than trusting a stored number.
- **The SDLC chain is committed, not recalled.** `start` writes a session-local proto-spec; wrap projects plan/spec beside the diff; review checks the diff against the plan. Session JSON remains the gate. Markdown is the audit copy.

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
  |- Auditor                 -> independent review; blocking or advisory — verify never auto-fixes
  `- operator runs wrap      -> ship-pr authorization, ready-for-review PR + ticket cost total
```

The PR opens **ready for review**, with a fixed three-section body — What & why, Verification, Review focus — assembled from real artifacts under hard caps. A missing artifact becomes an explicitly stated gap, never invented prose.

Report a bug instead of a feature and the route changes: the work is classified `investigation`, and **no fix runs until the evidence reaches `ready_for_fix`**. Proof before patch, every time.

## It Learns. It Adapts. It Stays In Budget.

- **Failed-command capture is automatic.** Distilling wrap.json and promoting learnings is a separate skill (`evolve`), not something every session does.
- **Difficulty-based routing.** Trivial tasks skip planning entirely. Ambiguous ones brainstorm first. Complex ones get full dependency wiring. You never pay ceremony tax on a typo fix.
- **A spend ceiling that halts honestly.** `GORKHALI_SPEND_CEILING_USD` stops unattended runs on a *confirmed* overrun — unknown spend continues with a record, interactive sessions are never capped, because the watching human is the ceiling.
- **Config with provenance.** Every resolved value reports which layer it came from. An unset key says unset — never a fabricated default.

## Runs Everywhere Your Agents Do

One provider-neutral Agent Skill at `skills/gorkhali/` runs natively on **Claude Code**, **Codex CLI**, and **Kimi Code** — zero external plugin dependencies, fully self-contained. Optional host capabilities degrade to explicit fallbacks instead of breaking. The Kimi preset routes only across Kimi's own model tiers, so a Kimi session never requests compute from another provider. **Cursor** slash commands come from this repo's matching hour-one skills (`/start` `/pause` `/resume` `/verify` `/review` `/pr-review` `/wrap`); the same-named `commands/*.md` files remain the canonical procedure and stay hidden. A portable copy of `skills/gorkhali` alone does not expose those slashes.

## Install

**Claude Code**

```text
/plugin marketplace add karki011/Gorkhali
/plugin install gorkhali@gorkhali
```

**Codex**

```bash
git clone https://github.com/karki011/Gorkhali.git
cd Gorkhali && codex
# Inside Codex: /plugins → select the repository marketplace → gorkhali → Install
```

**Kimi Code**

```text
/plugins install https://github.com/karki011/Gorkhali
/reload
```

**Cursor** (this repository as the workspace — no marketplace recipe yet)

Matching hour-one skills appear as `/start` `/pause` `/resume` `/verify` `/review` `/pr-review` `/wrap`; the same-named `commands/*.md` files remain the procedure and stay hidden. A portable copy of `skills/gorkhali` only is the router; named wrap/review/pr-review skills need the native plugin or the whole `skills/` tree.

**Any Agent Skills host** (portable, no plugin manager needed)

```bash
mkdir -p .agents/skills
cp -R /path/to/Gorkhali/skills/gorkhali .agents/skills/gorkhali
```

Prerequisites: git plus your host's CLI. Recommended: `gh` CLI for PR flows, Atlassian MCP if you want Jira sync. Upgrade paths and per-host details: [Install](project-docs/install.md).

## Quick Start

Ask naturally in any Agent Skills-compatible host (portable `skills/gorkhali` is the router):

```text
Use Gorkhali to implement CP-41606 through a tested review request.
Use Gorkhali to investigate why the dashboard feels slow.
Use Gorkhali to pause this task and preserve a resumable checkpoint.
```

**Cursor** (this repo checked out) — hour-one slash commands from the matching skills; `commands/*.md` remain the procedure and stay hidden:

```text
/start CP-41606     # router → plan → execute → verify (does not wrap)
/pause
/resume
/verify             # run checks, report with evidence; never auto-fixes
/review
/pr-review
/wrap               # ship-pr authorization: ready-for-review PR (does not merge)
```

Named wrap/review/pr-review skills need the native plugin or the whole `skills/` tree; a portable copy of `skills/gorkhali` only is the router.

In Codex, type `$` or open `/skills` and pick a `gorkhali:*` skill. In Kimi Code the same bundle is discovered through the Agent Skills convention. Claude Code's marketplace plugin exposes the full `/gorkhali:*` skill menu.

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
| [AI-native SDLC](project-docs/ai-native-sdlc-2026.md) | Mapping Anthropic's 2026 playbook onto Gorkhali: keep, adopt, reject |
| [ROADMAP.md](ROADMAP.md) | Durable backlog, decisions, and the measured baseline with its caveats |

## Author

Built by [Subash Karki](https://github.com/karki011). Star the repo if Gorkhali earns it.

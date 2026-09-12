# Gorkhali

**Lean engineering orchestration for Claude Code.**

Gorkhali turns a request into an approved plan, delegates implementation, checks
the integrated result, and opens a pull request with independent review evidence.
Version **3.0.0** is the MVP following the proof of concept.

## Fewer roles, clear responsibilities

The normal path uses **Engineer**, **Inspector**, and **Auditor**. Engineer writes
and commits the change. Inspector runs repository checks. Auditor independently
reviews correctness, requirement fit, security, compatibility, and complexity.
Opposition helps with ambiguous or high-risk plans; Detective diagnoses unclear
or repeated failures. Small work does not pay for either specialist by default.

Risk routing is deterministic: balanced implementation and review, economy checks,
and deep reasoning only when risk or failure warrants it. No model call decides
which model to call. Every plan needs approval; the user controls shipping and merge.

## Install

In Claude Code:

```text
/plugin marketplace add karki011/Gorkhali
/plugin install gorkhali@gorkhali
/gorkhali:start "Describe the change"
```

Requires Git, Node.js 20+, and a Claude Code version that supplies subagent identity
in tool hooks and supports Agent worktree isolation. GitHub shipping additionally
requires authenticated `gh` and an `origin` remote. Update Claude Code if subagent
identity is absent; the edit gate does not guess identity from another live agent.

Claude Code is the only supported host. Logical routing, scheduling, recovery, and
Git state live in ordinary JavaScript modules; Claude-specific hooks, prompts, and
model mapping stay at the boundary. Other hosts and a generic host framework are
outside this MVP.

## Commands

| Command | Purpose |
| --- | --- |
| `/gorkhali:start` | Plan, approve, route, and execute new work |
| `/gorkhali:pause` | Stop dispatch and save a stable handoff |
| `/gorkhali:resume` | Reconcile Git and recover interrupted work |
| `/gorkhali:status` | Read progress, blockers, and verification freshness |
| `/gorkhali:verify` | Run checks, independent review, and bounded repair |
| `/gorkhali:wrap` | Open a PR and own its external review loop |
| `/gorkhali:close` | Finish cleanup after human merge |
| `/gorkhali:learn` | Save an explicitly requested working preference |

## Conservative parallel work

Tasks run sequentially unless both explicitly declare `parallelSafe: true`, have
no dependency, and own disjoint files and logical resources. Directory overlap and
case aliases conflict; uncertain paths and high-conflict risks stay serial. Each
Engineer uses an isolated worktree aligned to the wave's exact base commit.
Integration checks every source commit against ownership and current task/dependency
revisions, then applies commits in
plan order. Conflicts stop for scoped resolution. One integrated Inspector follows
all waves by default, followed by one Auditor.

## Evidence survives interruption

Checkpoints record meaningful transitions automatically. Pause adds a stable handoff;
resume works without it. Verification is bound to HEAD, branch/worktree identity,
index, and tracked/untracked content, so an edit to an already-dirty file invalidates
an old pass. Auditor also names the exact Inspector record it reviewed.
User-visible changes require an explicit human checklist confirmation.

Mutable state stays outside the project in `~/.gorkhali` (override with
`GORKHALI_DATA`). Existing v2 plans remain valid and execute sequentially without
new metadata. Legacy sessions resume with stale verification and must verify again.
One lead owns session state; agents write separate completion/evidence records.

## Upgrading from v2

This release removes the standalone review, fix, visual, and PR-review-loop commands
and the optional visual agent. Use `verify` for review, repair, and visual confirmation;
use `wrap` for PR review. Removed commands have no compatibility stubs. The quick route
now requires plan approval too. All plugin manifests use 3.0.0.

## Development and limits

```sh
npm test
```

Tests exercise policy, real temporary Git worktrees, stale evidence, recovery, and
hook decisions. CI also installs the plugin into a scratch Claude configuration.
Live Claude acceptance and deterministic fault tests are recorded in the
[PRD acceptance record](project-docs/acceptance.md). Repeat the
[acceptance checklist](project-docs/architecture.md#live-acceptance) for future releases.

Hooks enforce lead editing discipline; they are not an OS sandbox for hostile
repository code. Checks may execute repository scripts. Repositories with submodules
or special tracked files block fingerprinting until separately supported. There is
no automatic merge, external service, daemon, or model-based routing system.

See [architecture and contracts](project-docs/architecture.md) for implementation
boundaries. [ROADMAP.md](ROADMAP.md) preserves explicitly historical decisions.

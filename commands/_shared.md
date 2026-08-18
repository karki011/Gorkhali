# Phantom Shadows -- Shared Context (Core)

> **Every `/phantom:*` subcommand MUST load this file first.**

## Governance

1. Read repo `AGENTS.md` + `.claude/rules/`
2. Coding principles (first found): repo `.claude/rules/coding-principles.md` → `{PLUGIN_ROOT}/reference/coding-principles.md` → defaults

<context>

## Paths

```
PLUGIN_ROOT = self-resolved, env-free (deterministic). CANONICAL Bash bootstrap - the ONE copy;
              every commands/ site cites it as {PR_BOOTSTRAP} rather than restating it:
              PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
              then: node -p "require('$PR/scripts/...')"  (or node "$PR/scripts/...", etc.)

              {PR_BOOTSTRAP} = that resolve line, verbatim. Every Bash call is a FRESH shell, so $PR
              never survives across calls: a site needing $PR PREPENDS {PR_BOOTSTRAP} in the SAME
              command, then uses bare "$PR/scripts/..." with the guard its context requires (below).
              The canonical form always re-resolves from disk rather than trusting an inherited
              $PR - deterministic, never env-derived. The 8 checkpoint one-liners in
              start.md/execute.md/resume.md predate this change and carry their own literal
              `PR="${PR:-...}"` shape instead - pinned verbatim by `test/portable-skill.test.js`,
              left as-is here on purpose rather than reconciled to the canonical form.

              NEVER process.env.CLAUDE_PLUGIN_ROOT / ${CLAUDE_PLUGIN_ROOT} / ${...:-$HOME/.claude/phantom} —
              pure self-resolve. (hooks/hooks.json keeps ${CLAUDE_PLUGIN_ROOT}: Claude Code substitutes it
              at hook-exec — the one reliable surface; nothing else relies on the env var.)

              EMPTY-GUARD (REQUIRED — fresh machine / dev clone has no cache dir, so $PR resolves EMPTY;
              an unguarded `node "$PR/scripts/..."` then becomes `node "/scripts/..."` → MODULE_NOT_FOUND crash).
              Every copy of the bootstrap MUST include one of two guards, by context:
                • GATE-CRITICAL (path resolution that must succeed) — fail READABLE, never crash:
                    [ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install"; exit 0; }
                • ADVISORY (checkpoints, cost-link, cost-report, compress — already 'never error / never blocks') — SKIP SILENTLY:
                    [ -n "$PR" ] && node "$PR/scripts/..."
                  (run only when $PR is non-empty; empty → no-op, the surrounding flow continues.)

Symbolic placeholders — defined HERE only (single home); resolve per-repo, never hardcode:
{TEST_CMD} {LINT_CMD} {BUILD_CMD} {TYPECHECK_CMD} = discovery protocol in skills/phantom/references/verification.md
{PKG_MGR}  = lockfile table in _shared-repo-detection.md
{DEV_PORT} = repo dev-server config

REPO_NAME = resolved by detectRepo()/phantom_detect_repo() — 6-step precedence
            (worktrees fast-path → PHANTOM_REPO → git remote basename → git main-root
            basename → .git walk-up → "_default"). SINGLE SOURCE: _shared-repo-detection.md
            §"Repo Name Resolution". Do NOT restate the order here — it drifted before.
TEAM_DIR  = ${PHANTOM_DATA:-~/.phantom}/repos/{REPO_NAME}   # default ~/.phantom; override with PHANTOM_DATA env
SESSION_DIR     = {TEAM_DIR}/sessions/{TICKET}   # Phase 0: checkpoints live at {SESSION_DIR}/checkpoints/
CONTRACTS       = {TEAM_DIR}/sessions/{TICKET}/contracts/
DECISIONS_GLOBAL   = {TEAM_DIR}/decisions/global.md
DECISIONS_SESSION  = {TEAM_DIR}/sessions/{TICKET}/decisions.md
LEARNINGS       = {TEAM_DIR}/learnings/
LEARNINGS_INDEX = {TEAM_DIR}/learnings/INDEX.md
LEARNINGS_EDGES = {TEAM_DIR}/learnings/EDGES.md
GLOBAL_PATTERNS = ${PHANTOM_DATA:-~/.phantom}/global/patterns/INDEX.md
GLOBAL_EDGES    = ${PHANTOM_DATA:-~/.phantom}/global/patterns/EDGES.md
```

</context>

## Checkpoints

Advisory session progress markers. Every `commands/` checkpoint site writes ONE line of the same
shape: the `PR="${PR:-...}"` resolve-with-fallback line (deliberately NOT the canonical {PR_BOOTSTRAP} -
see §Paths), an `if [ -n "$PR" ]` guard, `printf '%s\n' '{"ticket":"{TICKET}"}'` piped
into `scripts/lib/checkpoint.js`'s `write` sub-command with `{SESSION_DIR}/checkpoints` plus that
site's phase label, closed by `|| :`.

Semantics - the single home; sites cite this section instead of restating it: advisory only, never
blocks; `resume` reads the latest; empty `$PR` skips silently; `|| :` fails open. Phase labels are
lowercase kebab-case, and both the per-site label set and the one-liner's literal shape are pinned
by `test/portable-skill.test.js` - the sites stay verbatim and change only together with that test.

<constraints>

## Core Disciplines

15 rules preventing observed failures. Full enforcement details: `reference/governance.md`.

1. **Feature branch** — never default/protected branches (configurable via `git.protected_branches` / `PHANTOM_PROTECTED_BRANCHES`)
2. **Verify** — run commands, read output, confirm
3. **Anti-repetition** — scan INDEX.md before planning
4. **Rival** — the one plan critic; challenges every plan and writes `plan-check.json`
5. **Simplify** — after verify pass
6. **Intent check** — diff vs contract
7. **Smart PR** — ready-for-review PR with the 3-section body
8. **Jira transition** — after push/PR
9. **Learnings** — read + write every session
10. **Auto-SHADOWS** — 4+ files → parallel agents
11. **Root cause** — reproduce → trace → confirm → fix
12. **Parallel agents** — independent files → concurrent spawn
13. **Subagent-driven** — all edits via Agent tool
14. **Workflow delegation** — BIG gateless fan-out → RECOMMEND a Claude Code dynamic workflow (user triggers; Apex can't self-launch). See `reference/workflow-delegation.md`.
15. **Output contract** — script/skill output is minimal-field, counted, truncated-with-escape-hatch, `help[N]`-hinted, fails loud on unknown flags; human-facing deliverables (plans, research, reports, summaries) are self-contained HTML, never markdown. See `reference/output-contract.md`.
16. **Response shape** — the conversational response leads with the decision, names where the run stands, measures instead of hedging, ranks and caps findings, and carries no preamble or closer. See `reference/response-shape.md` and § Response Shape below.

</constraints>

### Self-Check (before "done")

All true? Feature branch, verify ran, anti-repetition, rival, simplify, intent, learnings, subagent-only. If ANY no → fix first.

## Response Shape

Governs the prose Apex writes to the human. Script output stays under `reference/output-contract.md`;
the last line stays under § Final Status Block below. Full contract and the conditions that override
it: `reference/response-shape.md`.

1. **Decision first** — first line is the verdict, route, or result. A report token (`[{ROUTE}]`,
   `[PLANNED]`) already satisfies this.
2. **Say where the run is** — "Gate 2 of 3 cleared: …". The reader does not carry state between turns.
3. **Measure, never hedge** — `4m12s, $0.38, 6 files`, not "a while" or "a fair amount". Unknown is
   stated as unknown, with why.
4. **Rank then cap** — findings by severity, five visible, remainder as a count plus where to read it.
5. **Errors: cause, then fix** — no "uh oh", no apology.
6. **Blockers first** — the blocker leads; its explanation follows.
7. **Tangents wait** — one line, at the end, as an offer.
8. **No preamble, no recap, no closer** — not "Great question", "Let me", "Hope this helps", "Let me
   know if you need anything else". The Final Status Block is the ending.

Overridden by: an explicit request to explain or walk through, a destructive action needing
confirmation, genuine ambiguity, an options question, the host's own system prompt, and any gate,
invariant, or Core Discipline that requires words this would cut. Shape never suppresses a required
disclosure, an authorization request, or a stated gap.

## Final Status Block

Every `/phantom:*` skill ENDS its response with one single-line work-state signal — last line, nothing after it:

- 🟢 = done & verified
- 🟡 = done but needs a specific non-routine follow-up — name it
- 🔴 = blocked — state the blocker

One line, one color. Examples:

- `🟢 Wired usePagination into the list view; tests green`
- `🟡 Code updated — set STRIPE_KEY in env before testing`
- `🔴 Blocked: missing DB credential, cannot run migration`

## Learning & Self-Correction
- When user corrects or rejects an approach: STOP, acknowledge the correction, record it to `${PHANTOM_DATA:-~/.phantom}/repos/{REPO_NAME}/learnings/{domain}.md` as `CORRECTION [{keyword}]: [{wrong}] — [{right}] [failed] ({date})`, then resume with corrected approach. Never repeat a corrected mistake.
- Before proposing any approach: scan learnings INDEX.md for matching corrections. Corrections with `[validated:5+]` = auto-apply. `[failed]` = blocked (must explain why different). Never ignore past failures.
- If a fix attempt fails twice with the same error class: STOP patching. The approach is wrong. Re-plan from scratch with failure context. Do not stack patches on a wrong hypothesis.
- After EVERY verification pass: run `simplify` on all changed files. Not optional. Not "if time permits." If simplify produces changes, re-verify before proceeding.

<context_management>

## Context Management

| Threshold | Action |
|-----------|--------|
| <30% | Full capacity |
| 30-40% | Caution — consider compact |
| 40-60% | **Compact NOW** |
| >60% | Emergency — finish step, fresh session |

Compact with hints. Subagents for heavy reads. After compact: re-read `intent.md` + contracts.

</context_management>

## Preamble Tiers

| Tier | Commands | Shared Contexts |
|------|----------|----------------|
| **T1** | status, sessions, health, learn, note, scout | `_shared.md` only |
| **T2** | verify, fix, validate, eval, hound | + repo-detection + auto-learning |
| **T3** | review, contract, recruit, visual | + shadows + discipline + contracts |
| **T4** | start, execute, wrap, resume, pause | ALL shared contexts |

> **Repo Brain** (on-demand, not a tier): `_shared-brain.md` — grep-only recall of `{TEAM_DIR}/brain/cards/`. Loaded ad hoc by `scout.md` / `start.md` Phase A; never auto-included by any tier above.

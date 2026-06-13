# Headless Probe — `--to-plan` Mode-2 Readiness

Empirical validation procedure for running `/phantom:start --to-plan` under headless `claude -p`. Run this once before enabling Mission Control mode-2 queue processing, and again after any major Claude Code version bump.

## Purpose

Two unknowns that tests cannot answer:

1. **Skill execution under `claude -p`** — `/phantom:*` skills are invoked interactively in day-to-day use; the `claude -p` path is functional but undocumented. This probe confirms whether the harness routes skill invocations correctly in a non-interactive process.
2. **End-to-end `--to-plan` procedure** — start.md's `--to-plan` path involves Atlassian MCP calls, optional nested agent spawns, and a self-check fallback. Each has a headless failure mode. The only way to know it works is to run it.

Record the outcome as a learning either way — a negative finding (mode-2 blocked) is as useful as a positive one.

## Prerequisites

Before running the probe, verify all of the following:

- **Resolve `config.yaml` FIRST** via `node -p "require(process.env.CLAUDE_PLUGIN_ROOT + '/scripts/lib/config-lite.js').resolveConfigPath()"` (resolution order: `PHANTOM_CONFIG` env → `${PHANTOM_DATA}/config.yaml` → legacy `~/.claude/phantom/config.yaml`) and read values via config-lite `readFlag`/`readString` semantics — never a bare/hardcoded `config.yaml` path.
- **The resolved `config.yaml` has `queue.enabled: true`**, top-level `jira.project` set, and `queue.jira_status` set.
- **A real ticket exists** in the Jira project with the status matching `queue.jira_status` (the status that signals "ready to plan"). The ticket must have a populated description — skeletal tickets produce low-quality plans and make pass/fail harder to assess.
- **Atlassian MCP authenticated** in the headless context. Interactively-authed MCP servers (OAuth flows completed in a browser session) may not carry over to a `claude -p` subprocess. If Atlassian MCP is absent headless, that absence is itself a probe finding: record it as a learning and block mode-2 until the auth path is solved.
- **Prepared worktree** at the path Phantom expects:

  ```sh
  # Resolve the expected path first
  TICKET=<your-ticket>   # e.g. ENG-1234
  WORKTREE_DIR=$(node -p "require('./scripts/lib/phantom-paths').worktreeDir('$TICKET')")

  # Create the worktree on a fresh branch
  git worktree add "$WORKTREE_DIR" -b "feat/$TICKET" origin/main
  ```

  The worktree must be clean (`git status --porcelain` empty) before the probe starts — a dirty worktree produces a false positive on pass condition 3.

See [Mission Control Recurrence](unattended.md) for how to run and recur the queue once the probe passes.

## The Command

Run this verbatim, substituting `<TICKET>` and `<worktree>`:

```sh
cd <worktree> && claude -p "/phantom:start <TICKET> --to-plan" --permission-mode bypassPermissions --output-format stream-json --max-turns 40
```

`<worktree>` is the path produced by `phantom-paths.worktreeDir('<TICKET>')` above. `--max-turns 40` is a ceiling; a healthy run completes well under that.

Capture stdout to a file if you want to inspect the stream-json events afterward:

```sh
cd <worktree> && claude -p "/phantom:start <TICKET> --to-plan" \
  --permission-mode bypassPermissions \
  --output-format stream-json \
  --max-turns 40 \
  | tee /tmp/probe-<TICKET>.jsonl
```

## Pass Conditions

All five must hold. Every check is filesystem- or stdout-observable — no runtime state required.

| # | Check | Command |
|---|-------|---------|
| 1 | Queue entry exists and parses | `node -e "const p=require('./scripts/lib/phantom-paths');const e=require('fs').readFileSync(p.queueEntryPath('$TICKET','queued'),'utf8');const d=JSON.parse(e);['ticket','repo','worktree','planRef','summary','assumptions','selfCheck','ts','status'].forEach(k=>{if(!d[k])throw new Error('missing: '+k)});console.log('ok')"` |
| 2 | Plan file written | `test -f <stateDir>/sessions/<TICKET>/plan.json && echo ok` |
| 3 | Worktree is clean | `git -C <worktree> status --porcelain` — output must be empty |
| 4 | No commits made | `git -C <worktree> log --oneline origin/main..HEAD` — output must be empty |
| 5 | Final stdout line | Last line of stream-json stdout matches `[QUEUED] <TICKET>` |

All five passing = mode-2 is safe to enable for this Claude Code version.

## Failure Interpretation

| Symptom | Likely cause | Action |
|---------|-------------|--------|
| No queue entry **and** no `plan.json` | Skill did not execute under `claude -p` — harness did not route the skill invocation | Record learning `BLOCKED: /phantom:* skills do not execute under claude -p [failed]`; mode-2 blocked until resolved |
| `plan.json` exists but no queue entry | Procedure completed planning but broke at queue-write | Inspect `phantom-paths.queueEntryPath` resolution; check whether `PHANTOM_DATA` resolves correctly headless |
| Queue entry has `selfCheck:"flagged"` | Self-check surfaced a blocking issue with the ticket (missing AC, ambiguous scope, etc.) | Working as designed — the ticket needs triage before planning can succeed |
| Worktree is dirty (condition 3 fails) | Procedure wrote or staged files before the `--to-plan` gate could stop it | Serious — source-clean invariant violated; investigate the write path before any mode-2 use |
| Atlassian MCP tool calls errored | Auth did not carry over to the headless process | Record learning; establish headless auth path (service account token or pre-authed credential file) before enabling mode-2 |
| Exit before `[QUEUED]` line, `--max-turns` hit | Plan generation ran long or looped | Raise `--max-turns`; if still hitting ceiling, the self-check fallback may be looping — inspect the JSONL trace |

## What CI Covers Instead

The probe is live-fire. Automated tests cover the stable parts:

- `test/phantom-paths.test.js` — path resolution correctness; runs on every PR.
- `test/queue-prose.test.js` — queue entry field shapes and prose pin assertions; covers the data contract without requiring a real Jira ticket.

Neither test exercises the full headless execution path or the Atlassian MCP call chain. This probe is the only check that does. **Run it once per Claude Code major version bump** and record the result in `repos/<repo>/learnings/mode2-headless.md`.

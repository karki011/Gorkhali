# Unattended Run Guardrails

How Phantom protects unattended (`bypassPermissions`) runs. Two layers: operator-level `settings.json` deny rules (hard boundary) and the Phantom gate hooks (tripwire / defense-in-depth).

## Two-Layer Model

| Layer | Mechanism | Bypassable? |
|-------|-----------|-------------|
| 1 — Operator | `permissions.deny` rules in `settings.json` | No — enforced by the harness itself |
| 2 — Phantom | PreToolUse hooks (`unattended-guard.js`, `fix-loop-gate.js`) | Yes — regex tripwires; `sh -c`, variable expansion, and heredocs can slip past |

Deny rules cannot be bypassed while hooks can — treat the hooks as a tripwire that catches the common destructive shapes, never as the security boundary. Always pair an unattended launcher with operator deny rules:

```json
{
  "permissions": {
    "deny": [
      "Bash(git push --force*)",
      "Bash(rm -rf*)",
      "Read(**/.env*)",
      "Read(**/*.pem)"
    ]
  }
}
```

## Activation Flow

1. The launcher sets `PHANTOM_UNATTENDED=1` for the process tree it spawns.
2. The launcher runs `bin/phantom-preflight --ticket T --arm`.
3. On a pass verdict, preflight writes the arming marker `<stateDir>/unattended/<repo>.json` (`{worktreeRoot, ticket, ts}` — `worktreeRoot` is the realpath of the repo root).
4. Both gate hooks are now active for that repo: env var (primary channel) or a fresh marker whose `worktreeRoot` contains `realpath(cwd)` (marker channel).

Either channel alone activates enforcement; sessions in other repos or outside the armed worktree are untouched.

## Disarming

- **Clear the marker**: `rm <stateDir>/unattended/<repo>.json`.
- **Expiry**: the marker self-expires 12h after its mtime; every preflight `--arm` rewrite refreshes the window.
- **NEVER export `PHANTOM_UNATTENDED` globally** (shell profile, `.zshrc`, CI base image): it arms enforcement in every session, including attended ones — the env var belongs to the launcher's process tree only.

## What Each Hook Denies When Active

| Hook | Tool(s) | Denies |
|------|---------|--------|
| `unattended-guard.js` | Bash | `rm -rf`/`-fr`/split `-r -f`, `rm --no-preserve-root`, `git push -f`/`--force` (`--force-with-lease` allowed), `git reset --hard` against `@{u}`/`origin/` refs, `git clean -fd` variants, `chmod -R 777` |
| `unattended-guard.js` | Read | `.env*` (except `.env.example`), `*.pem`, `*.key`, `*credentials*` |
| `unattended-guard.js` | Write / Edit / MultiEdit / NotebookEdit | Targets outside the active worktree root and the `PHANTOM_DATA` subtree; undeterminable root → deny fail-safe |
| `fix-loop-gate.js` | Skill (`phantom:fix`) | Fix-loop ceiling reached, same-finding-class repeat, or unverifiable loop state |

Both hooks always exit 0 — denials ride the stdout decision JSON. In attended sessions (no env, no marker) both are silent no-ops.

## phantom-loop

One-word launcher for the Mission Control queue. Lives in `bin/phantom-loop` (the plugin ships it; the stable launchd entry point is the shim at `${PHANTOM_DATA}/bin/phantom-loop-shim`).

| Subcommand | What it does |
|---|---|
| *(none)* | Armed coordinator: caffeinate + `/loop /phantom:queue` with `PHANTOM_UNATTENDED=1` and `bypassPermissions`. This is the standing interactive mode. |
| `--once` | Single interactive queue pass — no loop, no caffeinate. Useful for a manual sanity check. |
| `--headless` | One scheduled-style pass: hardened pidfile lock, timestamped log written to `${PHANTOM_DATA}/logs/`, `queue-last-pass` marker touched. Used by launchd via the shim. |
| `install-autolaunch [--interval-minutes N]` | Writes the shim, generates the launchd plist at `~/Library/LaunchAgents/com.phantom.queue.plist`, loads it. Default interval: 30 minutes. |
| `uninstall-autolaunch` | Unloads and removes the plist. The shim is left in place. |
| `status` | Token-free dashboard: autolaunch state, launchd registration, last-pass age, per-repo queue counts, silent-failure warning if the last pass is older than ~3 intervals. |

## Autolaunch (scheduled queue passes)

`install-autolaunch` wires up a launchd agent so the queue coordinator runs on a schedule without a terminal window open.

**How a scheduled pass flows:**

1. launchd fires at the configured interval and runs the **resolver shim** at `${PHANTOM_DATA}/bin/phantom-loop-shim` (a stable path that never changes between plugin versions).
2. The shim resolves the **newest installed plugin version by mtime** at run time (`ls -dt ~/.claude/plugins/cache/phantom/phantom/*/`) and execs that version's `bin/phantom-loop --headless`. Plugin updates never strand the schedule on a deleted versioned path. One edge case: restored-from-backup cache dirs can mislead the mtime resolver if the backup timestamps are newer than the real install.
3. `phantom-loop --headless` runs one `claude -p /phantom:queue` pass in the foreground (foreground is required — background agents die when the process exits). Planners spawned in this mode run foreground per queue.md's headless contract.
4. The pass writes a timestamped log and touches `${PHANTOM_DATA}/state/queue-last-pass` so `phantom-loop status` can detect silent failures.

**Caveats — read before enabling:**

- Run `reference/headless-probe.md` once before trusting autolaunch. `claude -p` and CLI-arg slash commands are functional but undocumented paths; the probe confirms they work in your environment.
- `RunAtLoad=false`: the first fire happens after the first full interval has elapsed, never at login.
- launchd skips intervals while the laptop sleeps — the next scheduled interval catches up when it wakes.
- The shim fixes plugin-path drift but not claude-CLI PATH drift. After a brew upgrade or Claude Code reinstall, re-run `phantom-loop install-autolaunch` — the plist bakes the absolute PATH at install time.
- Autolaunch only fills the plan queue. `phantom:approve` remains the human gate — nothing executes without it.
- Security: anything that can write to `${PHANTOM_DATA}/bin/` runs with full `bypassPermissions` at the next scheduled interval. That is the same user privilege as editing the plist itself — no escalation, but treat that directory accordingly.
- Pass logs are pruned to the newest 20; `phantom-loop status` emits a WARNING when no pass has been recorded for ~3 intervals — the silent-failure tripwire.

**Visibility:** planners and executors spawned by a scheduled pass appear in Claude Code's agents view (status bar `← for agents`). In interactive mode the coordinator itself can be sent to the background with `/background` and revisited from that list. A macOS notification fires when a pass queues one or more new plans.

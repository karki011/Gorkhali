# Mission Control Recurrence

How to run the Mission Control queue once and how to make it recur, per environment. `/phantom:loop` is the portable entry; the rest is the recurrence backend for each environment.

## /phantom:loop — portable queue entry (any session)

`/phantom:loop` (alias `/phantom:q`, `commands/loop.md`) is the portable entry to start the Mission Control queue, with no PATH binary required. It works in a local terminal, headless/scheduled passes, and cloud (claude.ai/code). It reuses `/phantom:queue` for the actual pass (no duplicated poll/dedup/spawn/reap) and respects the validated learning that a skill never self-launches `/loop`.

**Bare = one pass; continuous = the wrapper.** A bare `/phantom:loop` runs ONE `/phantom:queue` pass and then prints the recurrence command for the detected environment. It does not daemonize itself. Typing it IS the authorization to run — there is no separate arming step.

| Environment | Run once with | Recur with |
|---|---|---|
| Local terminal (interactive) | `/phantom:loop`, or the `phantom-loop` wrapper | `/loop /phantom:loop` (or the `phantom-loop` wrapper) |
| Cloud (claude.ai/code) | `/phantom:loop` | a `/schedule` routine running `/phantom:loop` on a cron interval (recommended, never auto-created) |
| Headless / scheduled | `phantom-loop --headless`, or `phantom-loop install-autolaunch` | launchd handles recurrence; `phantom-loop status` for the dashboard |

The `phantom-loop` binary below is a **local power-user optimization** (caffeinate + launchd convenience) — not the only entry. Prefer `/phantom:loop` for portability.

## phantom-loop

One-word launcher for the Mission Control queue. Lives in `bin/phantom-loop` (the plugin ships it; the stable launchd entry point is the shim at `${PHANTOM_DATA}/bin/phantom-loop-shim`).

| Subcommand | What it does |
|---|---|
| *(none)* | Coordinator: caffeinate + `/loop /phantom:queue` with `bypassPermissions`. This is the standing interactive mode. |
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

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

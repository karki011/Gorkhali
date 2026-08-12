# Routing Discipline

Phantom's routing system has two layers: an advisory nudge that fires at prompt time, and an opt-in enforcement gate that fires at edit time. Neither layer is required for Phantom to function — the nudge alone is the default, and it cannot block anything.

---

## Two-Layer Model

| Layer | Hook | Event | Behavior |
|-------|------|-------|----------|
| 1 — Nudge | `router-nudge.js` | `UserPromptSubmit` | Detects implementation-intent prompts; injects a routing reminder. ONE-SHOT per session (first matching prompt only). Never blocks. |
| 2 — Gate | `routing-gate.js` | `PreToolUse` | Denies Edit/Write/MultiEdit/NotebookEdit in Phantom-known repositories when no matching repository-scoped portable session is active. Fires only when `PHANTOM_ROUTING_ENFORCE=1`; `PHANTOM_ROUTING_SCOPE=all-git` explicitly expands its scope. |

Layer 1 is always on (unless `PHANTOM_ROUTING_NUDGE=0`). Layer 2 is off by default; it requires an explicit opt-in.

### Layer 1 — Nudge (router-nudge.js)

Fires on `UserPromptSubmit`. Checks whether the incoming prompt looks like implementation work using a pattern set that skips interrogative-opening prompts (diagnostic questions) before any pattern matching runs. Patterns include ticket keys (`PROJ-123`), imperative verbs (`fix`, `implement`, `build`, `add`, `refactor`), and conversational launchers (`let's`, `go ahead and`).

When a match fires, the hook injects this into the context once for that host session:

```
ROUTING: this prompt matches phantom implementation triggers — invoke
Skill(phantom:start) before the FIRST project-file edit unless the work is
purely diagnostic. A debug session that turns into a fix routes through
phantom at the FIRST edit. (One-time reminder this session — see reference/routing.md)
```

One-shot semantics: a marker is written to `<PHANTOM_DATA>/state/routing-nudge/<session_id>`. Subsequent matching prompts in the same session are silent. If the marker write fails, the hook fails toward one more emit — never toward silence.

### Layer 2 — Gate (routing-gate.js)

Fires on `PreToolUse` for Edit, Write, MultiEdit, and NotebookEdit. Checks these conditions in order:

1. Is `PHANTOM_ROUTING_ENFORCE=1` set in the environment? → if not, allow.
2. Is the target outside a Git repository or inside Phantom's own data tree? → allow.
3. Is the repository unknown to Phantom and `PHANTOM_ROUTING_SCOPE` is not `all-git`? → allow.
4. Does `state/current-session/<repo-id>.json` resolve to a valid schema-1 active session for this repository identity? → allow.

If the target is in scope and the portable state check definitively fails, the gate denies the edit. Operational read errors allow the edit under the fail-open contract. The deny message:

```
ROUTING GATE: implementation edit outside a matching Phantom session — invoke
phantom:start, or set PHANTOM_ADHOC=1 for ad-hoc work
(logged). See reference/routing.md
```

---

## Inverse Polarity — This Gate Fails Open

This is the most important thing to understand about routing-gate.js: it is a **fail-open discipline gate**, not a fail-closed safety gate.

| Gate | Kind | Fails | Why that direction is correct |
|------|------|-------|-------------------------------|
| `routing-gate.js` | Discipline (opt-in) | **Open** — crash or any unset/unrecognized value of `PHANTOM_ROUTING_ENFORCE` all allow the edit | Blocking legitimate work because the gate misbehaved would be worse than a missed routing event. The cost of a false-positive deny is high; the cost of a false-negative allow is a process note. An unset env var can **never** enable the gate — only `PHANTOM_ROUTING_ENFORCE=1` arms it. |

A fail-closed safety gate would invert this: any ambiguity or error would deny, because the cost of a false-negative allow (data loss, an unrecoverable state) outweighs the cost of blocking on uncertainty. This gate is the opposite — it never blocks on its own malfunction.

Enforcement defaults to off. If `PHANTOM_ROUTING_ENFORCE` is unset or anything other than `1`, the gate exits immediately. No path other than an explicit `PHANTOM_ROUTING_ENFORCE=1` can arm the gate.

---

## Honest Efficacy

By default (`PHANTOM_ROUTING_ENFORCE` unset), the gate never fires. The missed-routing incident class — implementation work that bypasses phantom and runs directly — is mitigated only by the advisory nudge in Layer 1. The deterministic enforcement layer exists for operators who explicitly set `PHANTOM_ROUTING_ENFORCE=1` after reviewing the bypass log. If you haven't done that, the gate is documentation, not enforcement.

---

## Scoping — Repository and Worktree Bound

When enforcement is enabled, the gate covers project-file edits in Phantom-known Git repositories. The repository is resolved by walking up from the edit target until a `.git` entry is found; linked-worktree `.git` files count. Set `PHANTOM_ROUTING_SCOPE=all-git` to explicitly include repositories Phantom has never managed.

Non-repository files and Phantom's mutable data tree remain outside the gate. `PHANTOM_ADHOC=1` remains the explicit logged bypass for deliberate ad-hoc repository work.

### Active Session Detection

A Phantom session satisfies routing only when the canonical repository identity resolves to `<PHANTOM_DATA>/state/current-session/<repo-id>.json`, that pointer references a session under the same repository's `sessions/` directory, and `session.json` is schema 1, active, task-matched, repository-matched, and identity-root-matched. The gate mirrors the portable lifecycle engine's identity root instead of inventing a second worktree rule: no-origin linked worktrees resolve through their shared Git common root, while remote-backed worktrees retain distinct checkout roots and cannot unlock sibling worktrees.

Missing, corrupt, dangling, paused, completed, and cross-repository state does not satisfy routing. Permission errors and other operational read failures are unknown rather than negative evidence, so the discipline gate fails open. The legacy global `.apex-active` marker remains available to legacy Claude/Apex behavior but is never accepted as portable lifecycle evidence.

The prompt nudge intentionally does not inspect lifecycle state. Each new Codex or Claude session receives its own one-shot reminder so an active task in another host session cannot silence routing instructions.

---

## Bypass — PHANTOM_ADHOC=1

Set `PHANTOM_ADHOC=1` in the environment before running Claude to allow edits in enforce mode without a phantom session. The gate allows the edit and appends a record to `<PHANTOM_DATA>/state/routing-bypass.jsonl`:

```json
{"ts": "2026-06-12T10:00:00.000Z", "file": "/path/to/file.ts", "cwd": "/path/to/repo"}
```

The log is reviewable. Logging failures do not block the bypass.

**Rollout**: leave `PHANTOM_ROUTING_ENFORCE` unset initially, review the bypass log to understand ad-hoc edit patterns, then set it to `1`. Add `PHANTOM_ROUTING_SCOPE=all-git` only when every Git repository should be covered.

---

## The Bash Loophole

Only tool-call edits (Edit, Write, MultiEdit, NotebookEdit) are covered. Shell edits — `sed -i`, output redirects, `tee`, heredocs — are not intercepted. This is deliberate: regex tripwires against every possible shell command give false confidence without meaningful coverage. If you need shell-level enforcement, use operator `permissions.deny` rules in `settings.json`.

---

## Hygiene Note

`routing-nudge/<session_id>` markers accumulate in `<PHANTOM_DATA>/state/routing-nudge/` over time — one file per host session that received a nudge. There is no current cleanup mechanism. This directory is a future candidate for `session-cleanup.js`.

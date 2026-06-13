# Routing Discipline

Phantom's routing system has two layers: an advisory nudge that fires at prompt time, and an opt-in enforcement gate that fires at edit time. Neither layer is required for Phantom to function — the nudge alone is the default, and it cannot block anything.

---

## Two-Layer Model

| Layer | Hook | Event | Behavior |
|-------|------|-------|----------|
| 1 — Nudge | `router-nudge.js` | `UserPromptSubmit` | Detects implementation-intent prompts; injects a routing reminder. ONE-SHOT per session (first matching prompt only). Never blocks. |
| 2 — Gate | `routing-gate.js` | `PreToolUse` | Denies Edit/Write/MultiEdit/NotebookEdit into phantom-known repos when no phantom session is active. Fires only when `routing.enforce: true`. |

Layer 1 is always on (unless `routing.nudge: false`). Layer 2 is off by default; it requires an explicit opt-in.

### Layer 1 — Nudge (router-nudge.js)

Fires on `UserPromptSubmit`. Checks whether the incoming prompt looks like implementation work using a pattern set that skips interrogative-opening prompts (diagnostic questions) before any pattern matching runs. Patterns include ticket keys (`PROJ-123`), imperative verbs (`fix`, `implement`, `build`, `add`, `refactor`), and conversational launchers (`let's`, `go ahead and`).

When a match fires and no phantom session is live, the hook injects this into the context:

```
ROUTING: this prompt matches phantom implementation triggers — invoke
Skill(phantom:start) before the FIRST project-file edit unless the work is
purely diagnostic. A debug session that turns into a fix routes through
phantom at the FIRST edit. (One-time reminder this session — see reference/routing.md)
```

One-shot semantics: a marker is written to `<PHANTOM_DATA>/state/routing-nudge/<session_id>`. Subsequent matching prompts in the same session are silent. If the marker write fails, the hook fails toward one more emit — never toward silence.

### Layer 2 — Gate (routing-gate.js)

Fires on `PreToolUse` for Edit, Write, MultiEdit, and NotebookEdit. Checks three conditions in order:

1. Is a phantom session currently active? (`.apex-active` marker, younger than 24h) → allow.
2. Is `routing.enforce` explicitly `true` in config? → if not, allow.
3. Is the target file inside a phantom-known repo? → if not, allow.

All three must fail before a deny fires. The deny message:

```
ROUTING GATE: implementation edit outside a phantom session — run
/phantom:start <ticket>, or set PHANTOM_ADHOC=1 for ad-hoc work
(logged). See reference/routing.md
```

---

## Inverse Polarity — This Gate Fails Open

This is the most important thing to understand about routing-gate.js: it is a **fail-open discipline gate**, not a fail-closed safety gate.

| Gate | Kind | Fails | Why that direction is correct |
|------|------|-------|-------------------------------|
| `routing-gate.js` | Discipline (opt-in) | **Open** — crash, missing config, garbage config, or missing `readFlag` module all allow the edit | Blocking legitimate work because the gate misbehaved would be worse than a missed routing event. The cost of a false-positive deny is high; the cost of a false-negative allow is a process note. A missing or unparseable config can **never** enable the gate — only the literal `true` arms it. |

A fail-closed safety gate would invert this: any ambiguity or error would deny, because the cost of a false-negative allow (data loss, an unrecoverable state) outweighs the cost of blocking on uncertainty. This gate is the opposite — it never blocks on its own malfunction.

`enforce` defaults to `false`. If config-lite is unavailable, `readFlag` is `null` and the gate exits immediately. No path through a broken or absent config can arm the gate.

---

## Honest Efficacy

With the default config (`routing.enforce: false` or absent), the gate never fires. The missed-routing incident class — implementation work that bypasses phantom and runs directly — is mitigated only by the advisory nudge in Layer 1. The deterministic enforcement layer exists for operators who explicitly set `routing.enforce: true` after reviewing the bypass log. If you haven't done that, the gate is documentation, not enforcement.

---

## Scoping — Phantom-Known Repos Only

The gate covers only repos that phantom has managed. "Phantom-known" means `<PHANTOM_DATA>/repos/<repo-name>` exists on disk. The repo name is resolved by walking up the directory tree from the edit target until a `.git` entry is found (file or directory — worktree pointers count); the basename of that directory is the repo name.

Repos that phantom has never touched — gsd workspaces, sparc projects, codex sessions, or anything else — are completely untouched regardless of `enforce` setting.

### Active Session Detection

A phantom session is active when `<PHANTOM_DATA>/.apex-active` exists **and** its mtime is younger than 24 hours. The 24-hour TTL prevents a crashed session from silently disabling routing forever. Both hooks share identical session-detection logic (the comment in each file marks this explicitly).

The active-session marker is global: one active phantom session unlocks all phantom-known repos. This is v1 semantics — per-repo marker identity is a noted future retrofit.

**W9 interaction**: in a long session (>24h), the marker may have expired by the time an edit fires, even if the one-shot nudge was already spent earlier. The deny message's remediation (`/phantom:start` or `PHANTOM_ADHOC=1`) covers recovery.

---

## Bypass — PHANTOM_ADHOC=1

Set `PHANTOM_ADHOC=1` in the environment before running Claude to allow edits in enforce mode without a phantom session. The gate allows the edit and appends a record to `<PHANTOM_DATA>/state/routing-bypass.jsonl`:

```json
{"ts": "2026-06-12T10:00:00.000Z", "file": "/path/to/file.ts", "cwd": "/path/to/repo"}
```

The log is reviewable. Logging failures do not block the bypass.

**Rollout**: ship with `enforce: false`, review the bypass log to understand your ad-hoc edit patterns, then enable `enforce: true`.

---

## The Bash Loophole

Only tool-call edits (Edit, Write, MultiEdit, NotebookEdit) are covered. Shell edits — `sed -i`, output redirects, `tee`, heredocs — are not intercepted. This is deliberate: regex tripwires against every possible shell command give false confidence without meaningful coverage. If you need shell-level enforcement, use operator `permissions.deny` rules in `settings.json`.

---

## Hygiene Note

`routing-nudge/<session_id>` markers accumulate in `<PHANTOM_DATA>/state/routing-nudge/` over time — one file per Claude session that received a nudge. There is no current cleanup mechanism. This directory is a future candidate for `session-cleanup.js`.

# Repo Brain — Card Schema

The **Repo Brain** is a per-repo, monotonically growing store of distilled
knowledge cards. One card per session (and, later, per backfilled artifact).
Cards live in **GORKHALI_DATA**, never in the plugin dir:

```
<data>/repos/{repo}/brain/cards/{id}.md
```

Retrieval is **on-demand only** — nothing is auto-loaded at session start. Agents
grep the cards dir at task start (see `commands/_shared-brain.md`, T4) and follow
`trace` pointers back to the raw session artifacts.

Writer/parser: `scripts/lib/brain-card.js`. This file is the **frozen schema** it
implements — T4 (retrieval), T5 (backfill), T6 (docs) build on it.

## Card format

Markdown with a flat, grep-friendly YAML frontmatter (one key per line). Example
of a real card:

```markdown
---
id: rb-a1b2c3
ticket: repo-brain
title: "Linked Card Brain: distilled cards + grep retrieval"
type: decision
status: active
date: 2026-07-01
files:
  - scripts/lib/brain-card.js
  - reference/brain.md
edges:
  - relates_to: rb-9f0e1d
  - supersedes: rb-000abc
trace:
  session: /Users/x/.gorkhali/repos/research-team-skills/sessions/repo-brain
  transcript: /Users/x/.claude/projects/-Users-x-.../<session>.jsonl
  pr: https://github.com/org/repo/pull/62
  commit: 34b3690
---

## What

One-paragraph distillation of what this session/decision actually did.

## Why (and what we rejected)

Why this path — and the alternatives that were considered and rejected, with
the reason. REQUIRED: a card whose Why is empty defeats the design (a
superseded decision still has to explain why the current one exists).

## Gotchas

Non-obvious traps, invariants, and follow-ups for the next agent.
```

## Frontmatter fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `rb-<6hex>` | yes | `hash(repo+ticket+date+title)` — deterministic (dedup) yet merge-safe across concurrent worktrees. Never hand-assign. |
| `ticket` | string | yes | Session/ticket key. |
| `title` | string | yes | Short human title. |
| `type` | enum | yes | `episode` \| `decision` \| `gotcha` \| `pattern`. Defaults to `episode`. |
| `status` | enum | yes | `active` \| `superseded`. Never deleted. |
| `date` | `YYYY-MM-DD` | yes | Write date; part of the id hash. |
| `superseded_by` | `rb-*` | no | Set on the OLD card when superseded. |
| `files` | string[] | no | Repo-relative paths this card is about (grep by path). `[]` when empty. |
| `edges` | list of single-key maps | no | Each `{relates_to\|supersedes\|caused_by: rb-*}`. `[]` when empty. |
| `trace` | object | yes | `{session, transcript, pr, commit}` — pointers back to raw sources. Empty string for unknown fields (close.md enriches `pr`/`commit`). |

## Body sections

- `## What` — the distillation.
- `## Why (and what we rejected)` — **REQUIRED** content when written from wrap;
  pull rejected alternatives from `decisions.json` / `intent.json`.
- `## Gotchas` — traps and follow-ups.

## Library API (`scripts/lib/brain-card.js`)

| Function | Contract |
|----------|----------|
| `makeCardId({repo, ticket, date, title})` | Deterministic `rb-<6hex>`. |
| `renderCard(card)` | Card object → markdown string. |
| `parseCard(content)` | Markdown string → normalized card object (round-trips `renderCard`). |
| `writeCard(card, {repo})` | Writes `<data>/repos/{repo}/brain/cards/{id}.md` atomically; computes `id` if absent. **Throws on IO failure** — callers guard the RUN. |
| `readCard(repo, id)` | Parsed card or `null`. |
| `supersede(oldId, newId, {repo})` | Flips old → `superseded` + `superseded_by`, adds `{supersedes: oldId}` edge on new. Never deletes. |
| `cardsDir(repo)` / `cardPath(repo, id)` | Path helpers. |

CLI (used by wrap/close as a guarded RUN):

```
node scripts/lib/brain-card.js write <repo>            # card JSON on stdin -> {id,file}
node scripts/lib/brain-card.js supersede <repo> <old> <new>
node scripts/lib/brain-card.js parse <file>            # -> card JSON
```

## Invariants

- **Grows monotonically**: supersede, never delete.
- **Write-time distillation** is the noise filter — cards are small and curated,
  not transcript dumps.
- **Never blocks the ship**: a card-write failure in wrap/close degrades silently
  (the caller guards the RUN, not the precondition).
- **Lives in GORKHALI_DATA**, never in the (immutable) plugin cache dir.

# Gorkhali Shadows -- Repo Brain Context

> **On-demand ONLY.** Never preloaded, never part of any preamble tier (see
> `_shared.md` §Preamble Tiers). Load this file — and grep the cards dir —
> only when an agent chooses to recall: `scout.md` recall section, `start.md`
> Phase A optional step. Schema frozen in `reference/brain.md`. Read-only here
> — writing cards is out of scope (wrap/close own that).

---

## Where

```
CARDS = {TEAM_DIR}/brain/cards      # {TEAM_DIR}: _shared.md SS Paths
```

## Recipes (substitute `{TICKET}` / `{PATH}` / `{KEYWORD}`)

```bash
# by ticket
rg -l "^ticket: {TICKET}" "$CARDS"

# by file path (files: list entries are `  - <path>`, optionally quoted)
rg -l -- '^\s*-\s"?{PATH}"?' "$CARDS"

# by keyword (title/body, case-insensitive)
rg -il '{KEYWORD}' "$CARDS"

# by type (decision|gotcha|pattern|episode)
rg -l '^type: {TYPE}' "$CARDS"
```

## Follow trace pointers

A match's `trace:` block points at the raw source — go deeper only if needed:

```bash
rg -A4 '^trace:' "$CARDS/{id}.md"
```

Then `Read` the `session`/`transcript` path, or check `commit`/`pr`.

## Using results

Cite matched card `id`s (not full contents) in `context.json` / scout output.
`Read` a full card only when its title or trace looks directly relevant —
recall is grep-cost, not "load everything found."

---
name: evolve
description: "Use when learnings files grow large or knowledge needs maintenance. Scans learnings, promotes patterns to global, distills oversized files, cleans stale entries ('clean up learnings')."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)

# /phantom:evolve

Run the 3-tier evolution pipeline on the learnings system via an Inspector sidecar agent.

<evolution_coordination>

## Coordinator Role (Main LLM)

You orchestrate the evolution. You do NOT run the evolution-runner.js script directly.

### Step 1: Assess Need

Check if evolution is warranted:
- Read `learnings/INDEX.md` — count entries, check for staleness signals
- Check `{TEAM_DIR}/evolution-log.json` for last evolution date
- If recent (< 3 sessions ago) and no bloat, inform user and skip

### Step 2: Spawn Inspector Sidecar

Spawn a **Inspector** agent to handle Tier 1 and Tier 2 processing:

- subagent_type: `inspector` (effort = session `high`; model per `reference/agents.md` → Model Routing)
- name: `inspector-tindal`
- mode: `bypassPermissions`

**Inspector prompt must include:**
- Script path: `$PR/scripts/evolution-runner.js`, reached via `{PR_BOOTSTRAP}` (per `_shared.md` §Paths) plus its GATE-CRITICAL guard: `[ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install; evolution skipped"; exit 0; }` (empty `$PR` aborts the runner readable — the runner is the skill's purpose, so there is nothing to do without it)
- Flag: `--dry-run` if user requested preview, otherwise no flag
- Instructions to run the script and capture full output
- Instructions to return structured report:
  ```
  {
    tier1: { staleCount: number, removedCount: number, entries: string[] },
    tier2: { promotedCount: number, patterns: string[] },
    tier3: { oversizedDomains: { domain: string, entryCount: number }[] }
  }
  ```
- Instructions to verify `{TEAM_DIR}/evolution-log.json` was updated (non-dry-run only)

### Step 3: Process Results

After Inspector returns:
- Present Tier 1 and Tier 2 results as summary
- If Tier 3 domains exist, handle them in main context (requires judgment):
  - Merge entries that say the same thing differently
  - Remove entries absorbed into reference/ or skill files
  - Sharpen: strip session-specific context, keep the rule
  - Preserve `[validated:N]` counts (merge = sum counts)
  - Never delete `[failed]` entries unless explicitly overridden
- Confirm evolution-log.json entry

</evolution_coordination>

## Flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview changes without writing any files |
| `--scout` | Run Tier 0 instead of the learnings pipeline: spawn a read-only scout for external-framework absorption (`reference/evolution.md` → Tier 0), produce a ranked backlog under `research/`, propose nothing without approval. |
| `--backfill` | Seed the Repo Brain from EXISTING session artifacts (`scripts/brain-backfill.js`). Runs the learnings pipeline's sibling, NOT the pipeline itself. |

When `--scout` is passed, skip the Inspector learnings sidecar (Steps 2–3 above) and run the Tier 0 recipe instead — it scans outward, not the inward learnings layer.

<backfill_coordination>

## Backfill Mode (`--backfill`)

Seeds `{TEAM_DIR}/brain/cards` from the artifacts already on disk. Skip the Inspector
learnings sidecar (Steps 2–3) and run this instead. Cards are written only via
`scripts/lib/brain-card.js` (makeCardId dedup = re-run safe); trace pointers use
the T2 resolver signals in `scripts/lib/session-trace.js`. Schema: `reference/brain.md`.

### Tiers 1–2 (scripted — no LLM)

Run the script directly (default DRY-RUN; add `--apply` to write):

```bash
node scripts/brain-backfill.js --repo <repo> --tiers 1,2          # preview counts
node scripts/brain-backfill.js --repo <repo> --tiers 1,2 --apply  # write cards
```

- **Tier 1** — `completed/*/wrap.json` + `sessions/*/wrap.json` → `episode` cards
  (Why from brief/summary/decisions/reviewPanel; trace.session = the session dir;
  trace.transcript resolved via `costs.json` session_id; trace.pr from the wrap `pr` field).
- **Tier 2** — learnings domain files → `gotcha`/`pattern` cards, **only** for
  entries carrying a ticket reference (e.g. `(CP-43187)`). Traceless entries → ZERO cards.

Report per-repo counts (`cand`/`write`/`skip`/`err`) to the user. A corrupt
source is skipped and counted, never fatal (per `[guards]`).

### Tier 3 (manifest + bounded parallel Blades)

`--tiers 3 --apply` writes `{TEAM_DIR}/brain/backfill-manifest.json` mapping
`ticket → transcript JSONL paths` **without reading any transcript content**.
Distillation of those transcripts into cards is a separate, coordinator-driven
pass — the manifest is the work-list:

1. Read the manifest; partition `tickets[]` into batches of **≤ 5 tickets per Engineer**
   (`[parallel-partition]` — each Engineer owns the output cards for its DISJOINT ticket
   set, so no two Blades write the same `makeCardId`).
2. Spawn the batch of Blades in parallel (`subagent_type: "engineer"`, `bypassPermissions`,
   `name: "engineer-backfill-{batchIndex}-{slotInBatch}"` per `reference/roster.md`'s
   Backfill Fan-Out rule - both indices read directly off `backfill-manifest.json`'s
   partition order, never counted at runtime). Each Engineer:
   - reads only its assigned transcript JSONLs,
   - distills 1–N cards per ticket via `scripts/lib/brain-card.js writeCard`
     (type `episode`/`decision`; trace.transcript = the JSONL it read,
     trace.session = the ticket session dir),
   - returns the written card ids.
3. After each batch returns, launch the next batch (bounded concurrency — do not
   fan out the whole manifest at once). Re-runs are safe: existing ids are skipped.

</backfill_coordination>

## When to Run

- After 5+ sessions (routine maintenance)
- When `learnings/INDEX.md` feels bloated
- Before archiving a milestone
- At `/phantom:wrap` time (evolution check in wrap protocol)
- `--scout`: quarterly, or when you spot a notable agent framework worth comparing (the outward feed — keeps phantom from only ever recycling its own ideas)

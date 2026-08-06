---
name: evolve
description: "Use when learnings files are getting large, patterns should be promoted to global, or the knowledge system needs maintenance. Scans learnings, proposes promotions to global patterns, distills oversized files, and cleans stale entries. Also use when user says 'clean up learnings', 'promote patterns', 'knowledge maintenance', or 'evolve the system'."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /phantom:evolve

Run the 3-tier evolution pipeline on the learnings system via a Ward sidecar agent.

<evolution_coordination>

## Coordinator Role (Main LLM)

You orchestrate the evolution. You do NOT run the evolution-runner.js script directly.

### Step 1: Assess Need

Check if evolution is warranted:
- Read `learnings/INDEX.md` — count entries, check for staleness signals
- Check `{TEAM_DIR}/evolution-log.json` for last evolution date
- If recent (< 3 sessions ago) and no bloat, inform user and skip

### Step 2: Spawn Ward Sidecar

Spawn a **Ward** agent to handle Tier 1 and Tier 2 processing:

- subagent_type: `ward` (effort = session `high`; model per `reference/agents.md` → Model Routing)
- name: `ward-corben`
- mode: `bypassPermissions`

**Ward prompt must include:**
- Script path: `{PLUGIN_ROOT}/scripts/evolution-runner.js` — self-resolve {PLUGIN_ROOT} env-free: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install; evolution skipped"; exit 0; }`, use `$PR/scripts/evolution-runner.js` (empty `$PR` aborts the runner readable — the runner is the skill's purpose, so there is nothing to do without it)
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

After Ward returns:
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

When `--scout` is passed, skip the Ward learnings sidecar (Steps 2–3 above) and run the Tier 0 recipe instead — it scans outward, not the inward learnings layer.

<backfill_coordination>

## Backfill Mode (`--backfill`)

Seeds `{TEAM_DIR}/brain/cards` from the artifacts already on disk. Skip the Ward
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

1. Read the manifest; partition `tickets[]` into batches of **≤ 5 tickets per Blade**
   (`[parallel-partition]` — each Blade owns the output cards for its DISJOINT ticket
   set, so no two Blades write the same `makeCardId`).
2. Spawn the batch of Blades in parallel (`subagent_type: "blade"`, `bypassPermissions`,
   `name: "blade-backfill-{batchIndex}-{slotInBatch}"` — both indices are each Blade's
   1-based position read directly off `backfill-manifest.json`'s partition order
   (`batchIndex` = the batch's position, `slotInBatch` = the Blade's position within
   that batch), per `reference/roster.md`'s Backfill Fan-Out rule, so every name stays
   reconstructible from the manifest alone even after context compaction). Each Blade:
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

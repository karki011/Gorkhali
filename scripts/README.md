# Phantom — Helper Scripts

Deterministic scripts for the Phantom. These do mechanical work that should not consume LLM tokens.

---

## Scripts

### `validate-artifact.js`

Validates historical Phantom JSON artifact envelopes. New workflow contracts
use the versioned schemas under `skills/phantom/schemas/`.

```bash
node validate-artifact.js <artifact-type> <file-path>
```

**Artifact types:** `context` `intent` `plan` `execution` `verification` `wrap` `pause-state`

**Checks:**
- Required `_meta` fields (`writtenAt`, `gitHead`, `gitBranch`, `phase`, `skill`, `version`)
- All required fields per schema
- Type correctness (string, boolean, number, array)
- Enum validation (e.g., `route: "solo"|"shadows"`, `verdict: "pass"|"fail"`)
- Array non-empty where required

**Exit:** 0 = valid, 1 = invalid (errors to stderr)

**Example:**
```bash
node validate-artifact.js verification ~/.phantom/repos/myrepo/sessions/ENG-1234/verification.json
```

---

### `check-learnings-index.js`

Verifies that `learnings/INDEX.md` is internally consistent with the domain files in the same directory.

```bash
node check-learnings-index.js [learnings-dir]
```

**Default dir:** `${PHANTOM_DATA:-~/.phantom}/repos/<detected-repo>/learnings`

**Checks:**
- Every `.md` file referenced in INDEX.md exists on disk
- Non-empty domain files are mentioned in INDEX.md
- All files in the directory are known domain files (`ui.md`, `data.md`, `auth.md`, `testing.md`, `tooling.md`, `migration.md`, `shadows.md`)
- INDEX.md entries have a lifecycle tag (`[proposed]`, `[validated:N]`, `[scope:global]`, `[stale]`, `[failed]`)

**Exit:** 0 = healthy, 1 = errors (warnings still printed to stdout)

**Example:**
```bash
node check-learnings-index.js ~/.phantom/repos/feature-web-apps/learnings
```

### `routing-report.js`

Summarizes model-routing evidence recorded across a session's JSON artifacts (`model_routing` blocks) into per-role distributions, profile deltas, and fallback-reason tallies.

```bash
node routing-report.js <session-dir> [--json]
```

**Flags:** `--json` emits the stable machine shape (`{perRole, deltas, fallbacks, records, reconciliationActive}`) instead of the human table.

**Checks:**
- Every `*.json` in the session root plus every `*.json` under `runs/` for a top-level `model_routing` object
- Per-role: requested-profile distribution, outcome tallies, fallback-reason frequencies
- Deltas where a host-reported `actual_profile` differs from the requested one (read-only, never inferred)

**Exit:** 0 = report produced (including empty sessions); nonzero on invalid args

**Example:**
```bash
node routing-report.js ~/.phantom/repos/myrepo/sessions/ENG-1234 --json
```

---

### `migrate-data.js`

Consolidates every historical Phantom data root into the one canonical neutral root (`<data>`, resolved by the T1 codec, `~/.phantom` by default).
It is dry-run-FIRST, content-fingerprinted, and migration-wide-locked.

```bash
node migrate-data.js                          # DRY-RUN (default). Zero writes; full manifest -> stdout.
node migrate-data.js > plan.json              # capture the dry-run plan for review + apply
node migrate-data.js --apply --manifest plan.json    # APPLY using a prior dry-run manifest
node migrate-data.js --map <srcId>=<canonId>  # pin an unresolved repo id (repeatable)
node migrate-data.js --apply --manifest plan.json --force  # ignore the marker; rescan changed sources
```

**Source registry (all env-overridable for tests):** the legacy Claude data root (`PHANTOM_MIGRATE_SRC_PHANTOM_DATA`), the legacy Claude phantom root (`PHANTOM_MIGRATE_SRC_PHANTOM`), the Claude team root (`PHANTOM_MIGRATE_SRC_TEAM`), and the upper- and lower-case Codex phantom roots (`PHANTOM_MIGRATE_SRC_CODEX_UPPER`, `PHANTOM_MIGRATE_SRC_CODEX_LOWER`).
The two Codex cases resolve to one inode on a case-insensitive filesystem and are deduped by realpath, so nothing is scanned twice.
See `buildSources()` for the exact defaults.
The existing `~/.phantom` is the destination BASELINE, never an immutable source.

**Safety guarantees:**
- The default invocation performs ZERO filesystem writes.
- Apply requires BOTH `--apply` and a manifest from a prior dry-run, and fails closed otherwise.
- External sources are never renamed, deleted, or symlinked; their bytes are byte-identical after apply.
- Before a learnings merge modifies a pre-existing canonical file, its original bytes are copied to a content-addressed rollback backup under `<data>/audit/rollback-backups/` and both hashes are recorded in the manifest.
- Repository ids map through the canonical codec plus the migrator's offline historical-alias helper; normal runtime never reads or writes aliases. An id that is not a safe path segment stays `unresolved` and requires an explicit `--map` (mappings are never guessed).
- Identical bytes at a canonical path DEDUPLICATE; different bytes CONFLICT-PARK under a deterministic `.from-<source>.<hash>` suffix (the baseline is never overwritten); learnings merge append-only through the T3 learning API lock.
- Apply takes a migration-wide lock (`<data>/locks/.data-migration.lock`) for the whole window, routes learnings merges through the per-learnings-dir lock and per-repo writes through the phantom-state lifecycle lock, so a concurrent state writer that races the migration blocks or fails closed.

**Per-item manifest classes:** `imported`, `deduplicated`, `conflict-parked`, `unresolved`, `skipped-live-state`, with per-root and per-artifact counts.

**Exit:** 0 = dry-run printed / apply succeeded / already-migrated / lock skip; 2 = apply refused (missing or mismatched manifest); 1 = unexpected error.

The real apply against live machine state is a separately gated, signed-off step -- the prompt path never auto-applies it.

---

### `migrate-repo-dirs.js`

Dry-run-first, non-destructive consolidation of branch-named orphan repo dirs under `<data>/repos/*` (and the legacy repos root named by `PHANTOM_MIGRATE_LEGACY_ROOT`) into their canonical repo dir.
Resolved targets are canonicalized through the offline historical-alias map used
only by migration and report tooling.

```bash
node migrate-repo-dirs.js                # DRY-RUN (default): computes the plan, writes a report, mutates nothing.
node migrate-repo-dirs.js --apply        # execute the plan + write the idempotent marker
node migrate-repo-dirs.js --apply --force  # ignore the marker; pick up newly-appeared orphans
node migrate-repo-dirs.js --map a=b      # pin orphan dir `a` to repo `b` (repeatable)
```

This migrator is never run by a prompt hook. Invoke it explicitly, review the
dry-run report, and opt into `--apply` when ready.

---

## Usage from skills

Portable skills resolve bundled helpers relative to their own `SKILL.md`.
Repository maintenance commands resolve `scripts/` from the checked-out
repository root. Host hook registration resolves hook paths through the host's
installed-plugin root; no provider-specific cache path is part of the contract.

---

## Requirements

- `node` (any modern version — uses only stdlib: `fs`, `path`)

No `npm install` needed.

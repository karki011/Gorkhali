# Phantom — Helper Scripts

Deterministic scripts for the Phantom. These do mechanical work that should not consume LLM tokens.

---

## Scripts

### `validate-artifact.js`

Validates a Phantom JSON artifact against its canonical schema from `reference/artifact-schemas.md`.

```bash
node validate-artifact.js <artifact-type> <file-path>
```

**Artifact types:** `context` `intent` `brainstorm` `decisions` `plan` `execution` `verification` `review` `wrap` `pause-state`

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

### `review-gaps.js`

The mechanically-derivable half of a code review (B10f): every changed **source** file with no correspondingly changed **test** file.

```bash
node review-gaps.js --from-git [<base>]      # changed files vs <base> (default: HEAD)
node review-gaps.js --files src/a.ts test/a.test.js
node review-gaps.js --json                   # machine-readable
git diff --name-only | node review-gaps.js   # or a list on stdin
```

Correspondence is derived from the file list alone — a changed test whose stem matches the source's stem (`src/session/Resume.ts` ↔ `test/resume.test.js`, `pkg/ledger.go` ↔ `pkg/ledger_test.go`). It is deliberately not an opinion about what "deserves" a test; that phrasing is what made the old Gaze priority un-auditable.

**Exit:** always 0 — this reports, it does not gate. A missing test cannot clear the blocking bar, so findings from it are `advisory` by construction. `--exit-code` opts into exit 1 when gaps exist.

---

### `review-round.js`

Re-review convergence (B12): the carry-over ledger and the round rule.

```bash
node review-round.js status --reviews {SESSION_DIR}/reviews          # which round the next pass is
node review-round.js close  --reviews {SESSION_DIR}/reviews --json   # apply the rule, append the round
```

`commands/review.md` deletes `gaze.json` before every pass so a truncated run cannot reuse an older verdict. The prior rounds' finding ids therefore cannot live in that file — they live in the sibling `rounds.json`, which the delete does not name and which carries **ids, severities and files only, never a verdict**. There is no stale verdict in it to reuse, so the freshness property is preserved by construction rather than by discipline. Rounds are appended only after a real artifact is read, so a truncated run leaves the round number where it was.

On round 2 and later, `close` reports `blocking` findings individually and returns the non-blocking ones as counts split into `carriedOver` and `new`, plus a `convergence` object for the recorded review payload.

**Exit:** 0 = report produced; 1 = I/O / usage (a missing review artifact is an error — it is `blocked`, never a clean round).

---

### `gen-review-standard.js`

Renders the review standard (severity scale, confidence scale, reporting rules, the verification pass, the convergence rule, security categories, canonical finding shape) from `scripts/lib/review-standard.js` into the reviewer prose that consumes it.

```bash
node gen-review-standard.js            # rewrite target files in place
node gen-review-standard.js --check    # verify no drift; exit 2 on drift
node gen-review-standard.js --list     # targets and their blocks
```

**Targets:** `agents/gaze.md`, `agents/archer.md`, `reference/agent-protocols/archer-protocol.md`, `reference/temperature-review.md`.

Same source-of-truth-plus-generator-plus-`--check` shape as `gen-schema-docs.js` and `gen-agent-frontmatter.js`, for the same reason: one severity concept spelled four ways in four prose files is exactly the drift this pattern exists to stop (ROADMAP F1, F5, F9). Prose outside the markers is hand-written and preserved.

---

### `migrate-review-findings.js`

Rewrites a reviewer artifact into the canonical B10 finding shape.

```bash
node migrate-review-findings.js <file>...          # rewrite in place
node migrate-review-findings.js --check <file>...  # report only; exit 2 if any file would change
```

**Optional.** The validator accepts every legacy spelling and normalizes on read, so nothing on disk is forced through this. It exists for a corpus you want to read by eye. Normalization is id-preserving by construction, and the script **refuses to write** any file where a finding id would move — a re-id would silently break the link to a disposition already recorded against it.

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

---

### `session-health.sh`

Checks a session directory for expected artifacts and validates their JSON.

```bash
./session-health.sh <session-dir> [--phase <phase>]
```

**Phases:** `A` `B` `C` `D` `verify` `wrap`

**What it checks:**
- Presence of: `context.json`, `intent.json`, `plan.json`, `execution.json`, `verification.json`, `wrap.json`, `pause-state.json` (optional)
- JSON validity of every found artifact
- Phase-specific required artifacts when `--phase` is given
- Auto-detects current phase from what's present (without `--phase`)

**Exit:** 0 = healthy, 1 = errors

**Examples:**
```bash
# Auto-detect phase
./session-health.sh ~/.phantom/repos/myrepo/sessions/ENG-1234

# Check that all wrap-phase artifacts are present
./session-health.sh ~/.phantom/repos/myrepo/sessions/ENG-1234 --phase wrap
```

---

### `preamble-tier.js`

Given a Phantom command name, outputs which preamble tier it belongs to and which shared context files it loads.

```bash
node preamble-tier.js [command] [--json]
```

**Without command:** prints all four tiers with their full context lists.

**With command:** prints tier, shared contexts, and active Core Rules for that command.

**Flags:** `--json` outputs machine-readable JSON.

**Exit:** 0 always (informational), 1 if command is unknown.

**Examples:**
```bash
# Show tier for a specific command
node preamble-tier.js start
node preamble-tier.js phantom:verify
node preamble-tier.js /phantom:status

# Machine-readable output
node preamble-tier.js wrap --json

# Show all tiers
node preamble-tier.js
```

---

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
- Repository ids map through the codec + aliases; an id that is not a safe path segment stays `unresolved` and requires an explicit `--map` (mappings are never guessed).
- Identical bytes at a canonical path DEDUPLICATE; different bytes CONFLICT-PARK under a deterministic `.from-<source>.<hash>` suffix (the baseline is never overwritten); learnings merge append-only through the T3 learning API lock.
- Apply takes a migration-wide lock (`<data>/locks/.data-migration.lock`) for the whole window, routes learnings merges through the per-learnings-dir lock and per-repo writes through the phantom-state lifecycle lock, so a concurrent state writer that races the migration blocks or fails closed.

**Per-item manifest classes:** `imported`, `deduplicated`, `conflict-parked`, `unresolved`, `skipped-live-state`, with per-root and per-artifact counts.

**Exit:** 0 = dry-run printed / apply succeeded / already-migrated / lock skip; 2 = apply refused (missing or mismatched manifest); 1 = unexpected error.

The real apply against live machine state is a separately gated, signed-off step -- the prompt path never auto-applies it.

---

### `migrate-repo-dirs.js`

Dry-run-first, non-destructive consolidation of branch-named orphan repo dirs under `<data>/repos/*` (and the legacy repos root named by `PHANTOM_MIGRATE_LEGACY_ROOT`) into their canonical repo dir.
Resolved targets are canonicalized through the T1 codec alias map so consolidation agrees with every other writer.

```bash
node migrate-repo-dirs.js                # DRY-RUN (default): computes the plan, writes a report, mutates nothing.
node migrate-repo-dirs.js --apply        # execute the plan + write the idempotent marker
node migrate-repo-dirs.js --apply --force  # ignore the marker; pick up newly-appeared orphans
node migrate-repo-dirs.js --map a=b      # pin orphan dir `a` to repo `b` (repeatable)
```

The `UserPromptSubmit` hook (`hooks/session-marker.js`) auto-runs `--apply` once per data root (marker-gated).

---

## Usage from skill commands

Reference these scripts from skill `.md` files by self-resolving the plugin dir env-free (deterministic — never via `CLAUDE_PLUGIN_ROOT`, which is reserved for `hooks/hooks.json`):

```
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
[ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install"; exit 0; }   # empty-guard: no cache dir → readable abort, not MODULE_NOT_FOUND
Run: node "$PR/scripts/validate-artifact.js" verification {VERIFICATION_JSON_PATH}
```

or in a PostToolUse hook to validate artifacts immediately after they are written.

---

## Requirements

- `node` (any modern version — uses only stdlib: `fs`, `path`)
- `bash` (for `session-health.sh`)

No `npm install` needed.

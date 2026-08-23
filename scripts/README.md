# Gorkhali — Helper Scripts

Deterministic scripts for the Gorkhali. These do mechanical work that should not consume LLM tokens.

---

## Scripts

### `validate-artifact.js`

Validates a Gorkhali JSON artifact against its canonical schema from `reference/artifact-schemas.md`.

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
node validate-artifact.js verification ~/.gorkhali/repos/myrepo/sessions/ENG-1234/verification.json
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

Correspondence is derived from the file list alone — a changed test whose stem matches the source's stem (`src/session/Resume.ts` ↔ `test/resume.test.js`, `pkg/ledger.go` ↔ `pkg/ledger_test.go`). It is deliberately not an opinion about what "deserves" a test; that phrasing is what made the old Auditor priority un-auditable.

**Exit:** always 0 — this reports, it does not gate. A missing test cannot clear the blocking bar, so findings from it are `advisory` by construction. `--exit-code` opts into exit 1 when gaps exist.

---

### `review-round.js`

Re-review convergence (B12): the carry-over ledger and the round rule.

```bash
node review-round.js status --reviews {SESSION_DIR}/reviews          # which round the next pass is
node review-round.js close  --reviews {SESSION_DIR}/reviews --json   # apply the rule, append the round
```

`commands/review.md` deletes `auditor.json` before every pass so a truncated run cannot reuse an older verdict. The prior rounds' finding ids therefore cannot live in that file — they live in the sibling `rounds.json`, which the delete does not name and which carries **ids, severities and files only, never a verdict**. There is no stale verdict in it to reuse, so the freshness property is preserved by construction rather than by discipline. Rounds are appended only after a real artifact is read, so a truncated run leaves the round number where it was.

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

**Targets:** `reference/review-standard.md` (the single generated home — `agents/auditor.md` and `agents/justice.md` point here and read it at runtime), `reference/agent-protocols/justice-protocol.md`, `reference/temperature-review.md` (both read standalone mid-review, so they keep their blocks inline).

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

**Default dir:** `${GORKHALI_DATA:-~/.gorkhali}/repos/<detected-repo>/learnings`

**Checks:**
- Every `.md` file referenced in INDEX.md exists on disk
- Non-empty domain files are mentioned in INDEX.md
- All files in the directory are known domain files (`ui.md`, `data.md`, `auth.md`, `testing.md`, `tooling.md`, `migration.md`, `shadows.md`)
- INDEX.md entries have a lifecycle tag (`[proposed]`, `[validated:N]`, `[scope:global]`, `[stale]`, `[failed]`)

**Exit:** 0 = healthy, 1 = errors (warnings still printed to stdout)

**Example:**
```bash
node check-learnings-index.js ~/.gorkhali/repos/feature-web-apps/learnings
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
./session-health.sh ~/.gorkhali/repos/myrepo/sessions/ENG-1234

# Check that all wrap-phase artifacts are present
./session-health.sh ~/.gorkhali/repos/myrepo/sessions/ENG-1234 --phase wrap
```

---

### `preamble-tier.js`

Given a Gorkhali command name, outputs which preamble tier it belongs to and which shared context files it loads. The tier registry in this file is CANONICAL — the `_shared.md` Preamble Tiers table and every command's blockquote are renderings of it, pinned by `test/preamble-tier.test.js`.

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
node preamble-tier.js gorkhali:verify
node preamble-tier.js /gorkhali:status

# Machine-readable output
node preamble-tier.js wrap --json

# Show all tiers
node preamble-tier.js
```

---

### `repo-detect.js`

Emits the per-repo facts that `commands/_shared-repo-detection.md`'s policy consumes — `repo_id` (+ `aliases`), `data_root`, `stack`, `package_manager`, `monorepo`, `has_ui`, discovered `verify_commands` — so command preambles never restate discovery prose. Read-only; facts degrade to null/false instead of throwing.

```bash
node repo-detect.js [--workspace <path>] [--json]
```

**Flags:** `--json` machine-readable output; `--workspace` overrides the detected directory (default: cwd).

**Exit:** 0 always (informational), 2 on usage error.

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
node routing-report.js ~/.gorkhali/repos/myrepo/sessions/ENG-1234 --json
```

---

### `outcome-write.js`

Derives and atomically writes the per-ticket `outcome.json` durable record from ground-truth sources (gh, `verification.json`, the timing jsonl, git, `session.json`). A script authors this record, not prose, so the shape is CLOSED: any field whose source is unavailable is written as `null` and named in `unresolved[]` with a reason - never fabricated.

```bash
node outcome-write.js --ticket <T> [--repo-path <path>] [--out <file>] [--no-gh] [--dry-run] [--json]
```

**Flags:** `--repo-path` selects the checkout to interrogate (default cwd); `--out` overrides the target file; `--no-gh` skips the gh query (pr fields become `null` + unresolved); `--dry-run` derives without writing; `--json` emits the record instead of the human summary.

**Checks:**
- `pr_state` is a closed enum (`draft | open | merged | closed | absent`) mapped only from gh's own answer; an unmappable state is nulled with a reason, never guessed
- `route` / `route_source` are copied from `session.json`: `route` is the closed SESSION-route enum (`lite | direct | plan | brainstorm | full`) chosen at `start` by `gorkhali-state.mjs` - NOT the `solo | shadows` EXECUTION route that lives in `wrap.json`/`plan.json`. `route_source` (`explicit | default | unknown`) says whether the route was chosen or defaulted; a session predating the field yields `unknown` + an unresolved entry
- An out-of-enum `route` or `pr_state` is refused at write time, never persisted verbatim
- `verified`, `fix_loops`, `wall_time_ms`, `agents` come from `verification.json`, loop-controller (counting `reviews/rounds.json`, the portable review round ledger, and falling back to legacy `verification.json` `review.fixLoops`), the session timestamps, and the timing jsonl respectively

**Exit:** 0 = record produced; 1 = write or internal error; 2 = usage error

**Example:**
```bash
node outcome-write.js --ticket ENG-1234 --dry-run --json
```

---

### `route-report.js`

Scores the router: aggregates every canonical `outcome.json` record per SESSION route (`lite | direct | plan | brainstorm | full`) - record counts, the `route_source` breakdown, and one metric block PER ATTRIBUTION CLASS (`explicit` vs `unattributable`): `pr_state` distribution, merge rate over settled PRs only, `verified` distribution, mean `fix_loops` / `review_comments` over non-null values, and priced cost (total/mean USD) where the ticket's ledger priced at least one session - the join states its coverage (`n` of records) and an unpriceable ledger is unknown, never $0. READ-ONLY: this script has no side effects.

```bash
node route-report.js [--json]
```

**Flags:** `--json` emits the stable machine shape (`{records, perRoute, scanned, caveat}`) instead of the human table.

**Checks:**
- Walks `${GORKHALI_DATA:-~/.gorkhali}/repos/*/{sessions,completed}/<ticket>/` at exactly depth 3; nested and off-bucket `outcome.json` copies are counted and reported, never aggregated
- Falls back to `session.json` for the route only when `outcome.json` predates the route field (key absent, not `null`)
- Merge rate = merged / (merged + closed): the denominator is SETTLED records only, and the sample is stated before the rate
- ATTRIBUTION CAVEAT (carried by both outputs): only `route_source: explicit` records measure a routing decision; `default`/`unknown`/unset records measure the router's default and accumulate in their own `unattributable` metric block per route - no combined number exists, because a rate over mixed attribution would ascribe the default's outcomes to the router's decisions
- Unparseable JSON is skipped and counted, never fatal

**Exit:** 0 = report produced (including an empty corpus); 2 = unknown flag/argument

**Example:**
```bash
GORKHALI_DATA=~/.gorkhali node route-report.js --json
```

---

### `route-bias.js`

Closes the router's measurement loop: reads the outcome corpus and proposes the next `correction.bias` for `reference/router/algorithm.md`'s `adjusted_uncertainty = uncertainty * (1 + correction.bias)`. Per SESSION route, over `route_source: explicit` records only: verified pass rate < 0.70 signals +1 (more ceremony), >= 0.90 signals -1 (less ceremony); the delta is 0.10 × the record-weighted mean, clamped with the current bias to ±0.3. Below 10 explicit records it refuses — a small sample must not tune the router.

```bash
node route-bias.js                    # DRY-RUN (default): current bias, proposed bias, evidence, exact entry
node route-bias.js --json             # machine-readable proposal
node route-bias.js --apply            # append the entry to <data>/repos/<repo>/learnings/shadows.md
node route-bias.js --min-sample 20    # stricter evidence floor
```

**Exit:** 0 = proposal/refusal printed or applied; 2 = usage error or `--apply` refused (insufficient sample).

---

### `migrate-data.js`

Consolidates every historical Gorkhali data root into the one canonical neutral root (`<data>`, resolved by the T1 codec, `~/.gorkhali` by default).
It is dry-run-FIRST, content-fingerprinted, and migration-wide-locked.

```bash
node migrate-data.js                          # DRY-RUN (default). Zero writes; full manifest -> stdout.
node migrate-data.js > plan.json              # capture the dry-run plan for review + apply
node migrate-data.js --apply --manifest plan.json    # APPLY using a prior dry-run manifest
node migrate-data.js --map <srcId>=<canonId>  # pin an unresolved repo id (repeatable)
node migrate-data.js --apply --manifest plan.json --force  # ignore the marker; rescan changed sources
```

**Source registry (all env-overridable for tests):** the legacy Claude data root (`GORKHALI_MIGRATE_SRC_GORKHALI_DATA`), the legacy Claude gorkhali root (`GORKHALI_MIGRATE_SRC_GORKHALI`), the Claude team root (`GORKHALI_MIGRATE_SRC_TEAM`), and the upper- and lower-case Codex gorkhali roots (`GORKHALI_MIGRATE_SRC_CODEX_UPPER`, `GORKHALI_MIGRATE_SRC_CODEX_LOWER`).
The two Codex cases resolve to one inode on a case-insensitive filesystem and are deduped by realpath, so nothing is scanned twice.
See `buildSources()` for the exact defaults.
The existing `~/.gorkhali` is the destination BASELINE, never an immutable source.

**Safety guarantees:**
- The default invocation performs ZERO filesystem writes.
- Apply requires BOTH `--apply` and a manifest from a prior dry-run, and fails closed otherwise.
- External sources are never renamed, deleted, or symlinked; their bytes are byte-identical after apply.
- Before a learnings merge modifies a pre-existing canonical file, its original bytes are copied to a content-addressed rollback backup under `<data>/audit/rollback-backups/` and both hashes are recorded in the manifest.
- Repository ids map through the codec + aliases; an id that is not a safe path segment stays `unresolved` and requires an explicit `--map` (mappings are never guessed).
- Identical bytes at a canonical path DEDUPLICATE; different bytes CONFLICT-PARK under a deterministic `.from-<source>.<hash>` suffix (the baseline is never overwritten); learnings merge append-only through the T3 learning API lock.
- Apply takes a migration-wide lock (`<data>/locks/.data-migration.lock`) for the whole window, routes learnings merges through the per-learnings-dir lock and per-repo writes through the gorkhali-state lifecycle lock, so a concurrent state writer that races the migration blocks or fails closed.

**Per-item manifest classes:** `imported`, `deduplicated`, `conflict-parked`, `unresolved`, `skipped-live-state`, with per-root and per-artifact counts.

**Exit:** 0 = dry-run printed / apply succeeded / already-migrated / lock skip; 2 = apply refused (missing or mismatched manifest); 1 = unexpected error.

The real apply against live machine state is a separately gated, signed-off step -- the prompt path never auto-applies it.

---

### `migrate-repo-dirs.js`

Dry-run-first, non-destructive consolidation of branch-named orphan repo dirs under `<data>/repos/*` (and the legacy repos root named by `GORKHALI_MIGRATE_LEGACY_ROOT`) into their canonical repo dir.
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
PR="$(ls -dt "$HOME"/.claude/plugins/cache/gorkhali/gorkhali/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
[ -z "$PR" ] && { echo "gorkhali: plugin dir not found under ~/.claude/plugins/cache/gorkhali — run /plugin to install"; exit 0; }   # empty-guard: no cache dir → readable abort, not MODULE_NOT_FOUND
Run: node "$PR/scripts/validate-artifact.js" verification {VERIFICATION_JSON_PATH}
```

or in a PostToolUse hook to validate artifacts immediately after they are written.

---

## Requirements

- `node` (any modern version — uses only stdlib: `fs`, `path`)
- `bash` (for `session-health.sh`)

No `npm install` needed.

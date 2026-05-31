# Phantom — Helper Scripts

Deterministic scripts for the Phantom. These do mechanical work that should not consume LLM tokens.

---

## Scripts

### `validate-artifact.js`

Validates a Phantom JSON artifact against its canonical schema from `reference/artifact-schemas.md`.

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
node validate-artifact.js verification ~/.claude/phantom-data/repos/myrepo/sessions/ENG-1234/verification.json
```

---

### `check-learnings-index.js`

Verifies that `learnings/INDEX.md` is internally consistent with the domain files in the same directory.

```bash
node check-learnings-index.js [learnings-dir]
```

**Default dir:** `~/.claude/phantom-data/repos/_default/learnings`

**Checks:**
- Every `.md` file referenced in INDEX.md exists on disk
- Non-empty domain files are mentioned in INDEX.md
- All files in the directory are known domain files (`ui.md`, `data.md`, `auth.md`, `testing.md`, `tooling.md`, `migration.md`, `shadows.md`)
- INDEX.md entries have a lifecycle tag (`[proposed]`, `[validated:N]`, `[scope:global]`, `[stale]`, `[failed]`)

**Exit:** 0 = healthy, 1 = errors (warnings still printed to stdout)

**Example:**
```bash
node check-learnings-index.js ~/.claude/phantom-data/repos/feature-web-apps/learnings
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
./session-health.sh ~/.claude/phantom-data/repos/myrepo/sessions/ENG-1234

# Check that all wrap-phase artifacts are present
./session-health.sh ~/.claude/phantom-data/repos/myrepo/sessions/ENG-1234 --phase wrap
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

## Usage from skill commands

Reference these scripts from skill `.md` files like:

```
Run: node ~/.claude/phantom/scripts/validate-artifact.js verification {VERIFICATION_JSON_PATH}
```

or in a PostToolUse hook to validate artifacts immediately after they are written.

---

## Requirements

- `node` (any modern version — uses only stdlib: `fs`, `path`)
- `bash` (for `session-health.sh`)

No `npm install` needed.

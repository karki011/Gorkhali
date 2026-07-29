# Self-Evolution Pipeline

Tiers 1–3 are **inward-facing**: they recycle learnings phantom already generated from its own sessions. Tier 0 is the **outward-facing** feed — it brings *new* ideas in from external agent frameworks, so the system can absorb advances it never would have produced on its own (e.g. ponytail's YAGNI ladder, absorbed in #50).

## Tier 0: External Absorption (user approval required)

Periodic scan of notable open-source agent/skill/prompt frameworks for mechanisms phantom **lacks**. Produces a ranked backlog, never edits agents directly.

1. Spawn a read-only scout agent (`bypassPermissions`, background) with: phantom's current agents/commands as context, a "find what we lack" brief, and a skeptic mandate (most candidates should be **rejected** as already-covered).
2. Scout writes a ranked HTML backlog to `research/absorption-backlog-<date>.html`: ABSORB table (idea | source+link | value | effort | plug-in point | rationale) + REJECTED table (idea | source | why) + top recommendation.
3. Each ABSORB row, once user-approved, routes to Tier 2 (directive edit) or Tier 3 (new skill) — same approval + git-prefix + log discipline as below.
4. Always credit the source license in the absorbing commit/diff (ponytail is MIT).

<!-- ponytail: Tier 0 is a prompt recipe run via the Agent tool, not a script. Promote to a scripted tier in evolution-runner.js only if the manual scan recurs often enough to automate. -->

## Three Tiers

### Tier 1: Reference Evolution (auto-apply)
Validated learnings (`[validated:5+]`) promote into `reference/` files.
- Append one line to relevant reference file
- Prune original INDEX entry → "absorbed into reference/X.md:LN"
- Low risk — supplementary content, auto-applies

### Tier 2: Skill Directive Evolution (user approval required)
Corrections repeated across 3+ sessions edit skill steps.
- Show proposed diff to user before applying
- Git commit with `skill-evolution:` prefix
- Max 1 directive edit per wrap session

### Tier 3: Skill Spawning (user approval required)
Repeated multi-step patterns (4+ sessions) become new micro-skills.
- Show proposed skill content to user
- Create on approval in `commands/` directory
- Git commit with `skill-spawn:` prefix

## Evolution Check Procedure (runs at wrap time)

1. Haiku agent scans `learnings/INDEX.md`:
   - `[validated:5+]` entries → Tier 1 candidates
   - `[failed]` corrections seen 3+ sessions → Tier 2 candidates
   - Repeated multi-step patterns → Tier 3 candidates
2. Tier 1: auto-apply, log to `state/evolution-log.json`
3. Tier 2-3: present proposals to user, apply on approval, log

## Safety Rails

- Never edit skills during active session — evolution only at wrap time
- Tier 1 auto-applies (low risk). Tier 2-3 require user approval.
- All changes git-committed with `skill-evolution:` or `skill-spawn:` prefix
- `state/evolution-log.json` tracks every change for rollback
- Max 1 directive edit per wrap session

## File Size Caps (triggers Haiku distillation)

| File Type | Cap | Action at Cap |
|-----------|-----|---------------|
| Skill directive | 80 lines | Haiku merges/prunes evolved steps |
| Reference file | 100 lines | Haiku distills, merges duplicates |
| INDEX.md | 80 entries | Haiku prunes absorbed + stale |
| Domain learnings | 50 entries | Haiku condenses verbose entries |

## Distillation Rules

- Merge entries that say the same thing differently
- Remove entries absorbed into reference/ or skill files
- Sharpen: remove session-specific context, keep the rule
- Preserve `[validated:N]` counts (merge = sum counts)
- Never delete `[failed]` entries unless explicitly overridden (the override is `--prune-failed`, below)

## Retention Arithmetic

Tier 1 retention is date arithmetic, not judgment.
`scripts/evolution-runner.js` is the only implementation; the constants live in `scripts/lib/constants.js` (`LEARNING_STALE_DAYS` 30, `LEARNING_REMOVE_DAYS` 60, `PROMOTE_THRESHOLD` 5).

| Class | Meaning | Expiry |
|-------|---------|--------|
| `[failed]` | A correction: something that already went wrong once | **Never** by date. Reported as PROTECTED past the window |
| `[validated:N]` where N >= `PROMOTE_THRESHOLD` | Proven | Never by date |
| `[validated:N]` where N < `PROMOTE_THRESHOLD` | Partially proven | Stale at 30d, removable at 60d |
| `[proposed]` | Suggested, not yet applied | Stale at 30d, removable at 60d |
| **untagged** | `validated:0` - recorded once, never re-confirmed, never contradicted | Stale at 30d, removable at 60d |

An **untagged** entry carries no `[failed]`, no `[proposed]` and no `[validated:N]`.
This is the majority class, not an edge case: 36 of the 54 entries on disk are untagged.
It means `validated:0` and it is the lifecycle's **entry state**, not a separate limbo class - unproven, expirable by date, never promotable, and ranked below any entry carrying a real confirmation.
Computed validation (below) is the one mechanism that moves an entry out of it.

**Removal is report-only by default.** A bare run prints the candidate set and writes nothing.
Two flags, both required, are the only path to a destructive pass:

- `--prune` acts on the removable set. Without it the run reports and exits.
- `--prune-failed` additionally releases the `[failed]` exemption. It has no effect without `--prune`, so no single flag can reach the anti-repetition corpus.

Removal deletes an entry's full line range (`lineNum..endLine`), because entries wrap and a first-line-only delete orphans the continuation lines.
Line offsets are computed at scan time, so before writing, each file is re-read and compared byte-for-byte against what was scanned; a file that changed is skipped, not written with stale offsets.

## Computed Validation

`[validated:N]` is **derived from artifacts, never from an agent's judgment**.

N = the number of distinct sessions that both cited the entry and recorded an observed verification pass.
It is a set size recomputed from disk on every run, so re-running cannot inflate a count and no ledger is needed for idempotence.
A session counts as evidence only when `verification.json` has `verdict: "pass"` **and** `correctness.observations.tests` is not `not_observed` - an unobserved pass is a claim, not a measurement.

The promotion tier reads this derived count (or the on-disk `[validated:N]` tag, whichever is higher; the tag is a manual floor).
Nothing rewrites the tag in the markdown, so there is no second destructive write path and the tag cannot drift into a stale cache.

**Missing input - the writer does not exist yet.**
No artifact currently records *which* learning entries a session recalled.
`context.json`'s `learningsRefs` is documented as "Paths to relevant learning files": file granularity, so it cannot attribute a validation to an entry.
The minimal field needed is `learningsCited: string[]` on `context.json`, holding the `[keyword]` of each entry that was injected; all 54 entries on disk carry a keyword, so it is a sufficient identity.
Its only possible writer is `hooks/memory-reader.js`, the component that selects the entries.
Until that field is written, every computed count is 0 and the runner says so explicitly - which is why max `validationCount` on disk is 2 and nothing has ever reached the promote threshold of 5.
The reader is built first, deliberately, so the field has a consumer the day it lands.

## Entry Classes: Environmental vs Judgment

Every learning entry falls into exactly one of two classes.
The distinction is what tells a reader whether an entry can still be trusted without a human re-checking it.

**Environmental** entries assert a fact about the current environment: a tool's absence, a config value, an API's behavior, a file's existence.
These facts can rot silently as the environment changes underneath them, so an environmental entry SHOULD carry a `check:`\`<shell command>\`` predicate (see "Executable Predicates" below).
An entry with a predicate is machine-checkable and self-invalidating: `scripts/evolution-runner.js --check-predicates` runs the command, and a non-zero exit is evidence the claim no longer holds.

**Judgment** entries assert a preference, a heuristic, or a stylistic rule: "prefer X over Y", "watch out for Z".
These are **advisory only**. Nothing executes them, and nothing in this codebase can verify them - they are not machine-checkable by construction, and describing them as enforced anywhere would overstate what the system does.
A judgment entry's only path to increased trust is `[validated:N]` via Computed Validation above: repeated citation in sessions that recorded an observed verification pass.

The two classes are not mutually exclusive of the existing lifecycle tags - `[proposed]`, `[validated:N]`, `[failed]`, `[stale]` apply to entries of either class.
`check:` is what separates a fact that CAN be re-checked from one that can only ever be re-judged.

## Executable Predicates

An entry may carry one optional predicate, appended after the existing trailing tokens:

```
PATTERN [no-greptile-this-repo]: body here [validated:1] check:`gh api repos/org/repo/issues/comments --jq '.[].user.login' | grep -q greptile-apps`
```

The command is delimited by backticks so it cannot be confused with `[validated:N]`, `q:`, `u:`, a date, or a following entry head.
`scripts/lib/learning-grammar.cjs` parses it into `entry.predicate` and strips it from the entry's body/text - the shared grammar owns recognition, exactly as it owns every other shape in this file's format.

**Execution is opt-in and gated in `scripts/evolution-runner.js` only**, behind two flags:

- `--check-predicates` runs every parsed predicate and reports pass/fail. Changes nothing on disk.
- `--flag-stale` (only with `--check-predicates`) writes `[stale]` onto entries whose predicate exited non-zero.
- A bare run parses and counts predicates but never executes one.

**Nothing on a read path ever executes a predicate.**
`hooks/memory-reader.js` runs on every prompt and must never shell out - it is the prompt-injection surface, not a place to run untrusted commands from a data file.
Each predicate runs under a hard timeout through a non-interactive shell; a predicate that hangs counts as FAILED, never as passed.
The command runs verbatim - there is no attempt to sanitize or allowlist shell metacharacters, because that would be false confidence rather than a real boundary.
The actual boundary is the explicit flag plus execution being scoped to the local canonical learnings directory (resolved through `scripts/lib/phantom-paths.js`), so a file arriving via merge or sync cannot gain execution just by sitting somewhere else.

## Brain Card Decay

Knowledge captured in Repo Brain cards decays via the `status=superseded` marker. When a newer card obsoletes an older one, the old card's `status` flips to `superseded` and gains `superseded_by: rb-<id>`, while the new card gets the `supersedes: rb-<id>` edge. Cards are **never deleted** — the full lineage remains queryable via these edges.

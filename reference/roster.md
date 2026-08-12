# Agent Naming Roster (SSoT)

Single source of truth for deterministic agent naming across every spawn site.
Every `Agent` spawn MUST pass a `name:` param derived from the rules below - never
left blank, never invented ad hoc.

## The Rules

1. **Fungible slots, globally unique per site.** `name = {role}-{character}`, where
   `character = roster[role][slot-1]`.
   Slots are STATICALLY derived: execute-wave blades AND their per-task ward
   verifiers use the task's index from `plan.json` (each role reserves the
   *first* N slots of its own roster for this - see Execute-Wave Reservation
   below); every other spawn site has its own permanently dedicated slot from
   the Spawn-Site Slot Table.
   **No two different spawn sites may ever share a character**, including the
   execute-wave-reserved range - a slot-table row must never use a character
   that execute-wave derivation could also produce.
   Slots are never counted at runtime and never read from Apex's memory.
2. **Role-differentiated panels.** When a spawn site fixes distinct functions on the
   same `subagent_type`, `name = {role}-{function}` instead of `{role}-{character}`.
   This covers the RPSL wrap panel (`archer-scope`, `archer-regression`,
   `archer-architecture`, `archer-skeptic` - maps 1:1 to `reviews/{function}.json`)
   and Council Mode's fixed lens enum (`council-mvp`, `council-risk`, `council-user`,
   `council-reuse`, `council-simple`) plus its Chairman (`council-chairman`). Council
   members still run through the Blade runtime type, but use the documented
   `council-*` Blade name alias because they reason only and never receive
   project-edit authority.
3. **Overflow.** Two distinct overflow shapes exist, and they must never share a
   shape with each other:
   - **Roster-length overflow** (a normal slotted site, or a dedicated
     multi-slot site's fan-out running past its reserved sub-range, e.g.
     `fix.md`'s repair-blade range past its 4 reserved slots): `slot > roster
     length` -> bare `{role}-{slot}` (e.g. `scout-10` once all 9 scout names are
     spoken for, or `blade-24` if a fix packet ever needs a 5th repair blade,
     since the `blade` roster is 23 long). **Any site whose fan-out count comes
     from user input, not a fixed spec** (today, only `scout.md`'s areas, taken
     from `$ARGUMENTS`) MUST overflow past the FULL roster length the moment it
     exceeds its own default reserved slots - never into another site's
     dedicated character slots that happen to still be numerically "spare" at
     that position. A 6th `scout.md` area is `scout-10` (past all 9 scout
     names), never `scout-6` (`brainstorm.md`'s dedicated `quorra`). A packet-
     bounded fan-out (`fix.md`'s repair Blades) already gets this for free,
     because its own overflow point (`blade-24`) sits past the full 23-long
     `blade` roster by construction - the risk is specific to sites whose
     default reserved range is SHORTER than the full roster, which today is
     only `scout.md` (5 reserved of 9 total).
   - **Execute-wave band overflow** (task-index derivation past its reserved
     1-8 range): `task_index > 8` -> `{role}-task-{task_index}` (e.g.
     `blade-task-24`, `ward-task-9`) - NOT the bare form above.
   These two shapes are structurally distinct strings (one has a `-task-`
   segment, one doesn't), so `blade-task-24` (execute-wave task 24) and
   `blade-24` (fix.md's own overflow) can coexist in the same session without
   ever colliding, even though both numbers can independently exceed 23. The
   same argument extends to every numeric-suffix shape this roster defines,
   including `{role}-backfill-{batchIndex}-{slotInBatch}` (Backfill Fan-Out,
   below): as long as each mode owns its own literal shape - bare `{role}-{N}`,
   `{role}-task-{N}`, `{role}-backfill-{B}-{S}` - no two modes can ever produce
   the same string, and none of them can collide with a dedicated character
   name either (a numeral is never a character token, e.g. `blade-9` the
   bare-overflow form vs. `blade-dorik` the dedicated site at character
   slot 9 - though note execute-wave itself never reaches bare `blade-9`; it
   would say `blade-task-9` if task index 9 existed, per the band rule above).
4. **Sage is parent-derived, not slot-derived.** `name = sage-{parent's own full spawn
   name}` (the parent's complete `{role}-{character}` or `{role}-{function}` name,
   not the character alone) - unique because parent names are already unique. Using
   the full name, not a role-stripped character, is what keeps this unique across
   roles too: `blade`, `ward`, `sweep`, and `archer` characters are drawn from
   independent per-role lists that are allowed to overlap (see Roster Table note
   below), so stripping the role prefix could collide two different parents onto
   the same Sage name. See Sage below.

**Same-site re-runs intentionally REUSE the name.**
A verify -> fix -> verify cycle, or any other resume-and-retry at the same spawn
site, is the same logical agent running sequentially - not a fresh stub that
could collide with an in-flight one.
Reusing the name is correct, not a bug.

**Why global uniqueness, not just concurrency-avoidance.**
Agent-record stubs PERSIST on disk after completion.
If two different logical spawn sites share a name, a later spawn at one site
resolves against an earlier, already-reconciled stub written by the other site -
`hooks/wake-classifier.js` cannot tell which site a completion belongs to, whether
or not the two spawns were ever in flight at the same moment.
This is why every row below gets its own character, permanently: one name maps to
exactly one logical spawn site, for the life of that site's definition.

## Execute-Wave Reservation

`execute.md` wave agents are not enumerated as table rows - they derive their name
from the task's index in `plan.json`. Two roles participate:

- **Blade** (the implementer) - task index N, for N 1-8 -> `blade-{roster.blade[N-1]}`
  (character name, drawn from `blade` slots 1-8); for N > 8 -> `blade-task-{N}`
  (Rule 3's execute-wave band-overflow shape), NOT `blade-{roster.blade[N-1]}` -
  the roster's character slots 9+ are dedicated to other sites (see the
  Spawn-Site Slot Table) and derivation must never reach into them - and NOT
  bare `blade-{N}`, which is a different overflow mode reserved for
  roster-length overflow at dedicated sites (e.g. `fix.md`'s repair-blade
  range).
- **Ward** (the per-task verifier) - the same rule, mirrored: task index N, for
  N 1-8 -> `ward-{roster.ward[N-1]}`; for N > 8 -> `ward-task-{N}`.

Both roles reserve their first 8 CHARACTER slots for this derivation, but the
derivation itself never runs past task index 8 in character form - it switches
to the `-task-` overflow shape instead, never the bare numeric shape. No
Spawn-Site Slot Table row for `blade` or `ward` may use a character from the
reserved 1-8 range - every dedicated `blade`/`ward` site below starts at
character slot 9 - and no dedicated site's own overflow may use the `-task-`
shape, since that shape is reserved for execute-wave derivation alone.

## Roster Table

Original manhwa-RPG-flavored names, invented for this roster (not drawn from any
published work).
Names are unique WITHIN each role; cross-role duplicates are fine because the
role prefix disambiguates.
Slot number = position in the ordered list.

| Role | Ordered names (slot 1, 2, 3, ...) |
|---|---|
| blade | kaze, joran, sabin, ryu, garok, thorne, vex, orin *(1-8, execute-wave reserved)*, dorik, lenna, pravo, quist, brakka, sennor, talvik, ossian, doven, kirran, mossa, ellow, tavric, sorne, vint *(9-23, dedicated sites)* |
| ward | torvan, ilkka, cassim, dreve, holt, wenna, arbek, sull *(1-8, execute-wave reserved)*, brann, isolde, corben *(9-11, dedicated sites)* |
| scout | pike, ravel, tessa, korin, nettle, quorra, haldis, brint, silven |
| gaze | elden, varel, ombric, sura |
| archer | sylas, mira, dain, wren *(reserve capacity - see Archer note below)* |
| hound | fenrik, corva |
| lens | yara, thal *(thal reserve)* |
| sweep | nix, oda |
| rival | dask, veyra *(veyra reserve)* |
| plan-checker | castor, lira *(ad hoc only - see below)* |
| warden | gorath, sena |
| explore | fenn |
| planner | rooke |
| hunter | vane |

**Archer note:** the RPSL panel (`wrap.md`) is function-named per Rule 2, but it
is NOT the only Archer site - `commands/_shared-archer.md` specs a second,
separately-triggered, single-agent Archer review (opt-in, during `verify.md`,
when the `code-review-graph` MCP is available). That site is character-slotted
per Rule 1, not function-named (it has no distinct sub-functions to name), and
is assigned `archer-sylas` in the Reference-Level table below. `mira`/`dain`/`wren`
remain genuine unused reserve capacity for any future Archer site.

**Explore / Planner note:** these name the generic Claude Code `Explore` and
`Plan` subagent types when `reference/planning.md`'s Codebase Research step
spawns them. The role prefix is `planner` (not `plan`) to avoid visual collision
with `plan.json` / `plan-checker` in prose and filenames; the underlying
`subagent_type` value passed to `Agent` is still `Plan`.

## Spawn-Site Slot Table: Command Files

One row per non-execute spawn site in `commands/*.md`.

| Command | Site | Role | Slot / Function | Resulting Name |
|---|---|---|---|---|
| `fix.md` | Step 4 - triage agent | gaze | 1 | `gaze-elden` |
| `fix.md` | Step 7 - scoped repair Blade(s), reserved range for the fix-packet fan-out (overflow beyond 4 -> `blade-24`, `blade-25`, ...) | blade | 9, 10, 11, 12 | `blade-dorik`, `blade-lenna`, `blade-pravo`, `blade-quist` |
| `hound.md` | Step 2 - Hound investigator | hound | 1 | `hound-fenrik` |
| `visual.md` | Step 5 - Lens inspection | lens | 1 | `lens-yara` |
| `visual.md` | Visual Fix Loop step 3 - Blade dispatch (UI-only fix) | blade | 13 | `blade-brakka` |
| `validate.md` | Ward Agent Dispatch - validation script runner | ward | 9 | `ward-brann` |
| `wire.md` | Step 2 - Dependency Analyst (ROLE FOCUS) | blade | 14 | `blade-sennor` |
| `verify.md` | Step 1 - sweep on changed files | sweep | 1 | `sweep-nix` |
| `verify.md` | Step 2 - Power Level review | gaze | 2 | `gaze-varel` |
| `verify.md` | Step 3 - Auto-Address fix agent | blade | 15 | `blade-talvik` |
| `wrap.md` | Step 4 - RPSL panel, 4 parallel archers | archer | function (Rule 2) | `archer-scope`, `archer-regression`, `archer-architecture`, `archer-skeptic` |
| `wrap.md` | Step 7 - ship ceremony mechanical tail | warden | 1 | `warden-gorath` |
| `wrap.md` | Step 8 - evolution check sidecar (full protocol: `reference/wrap/evolution.md`, which describes the same site generically as a "Haiku agent" - Ward pins haiku, so this is one site, not two) | ward | 10 | `ward-isolde` |
| `close.md` | Steps 2-6 - mechanical closeout tail | warden | 2 | `warden-sena` |
| `recruit.md` | Step 4 - ad hoc Blade with ROLE FOCUS | blade | 16 | `blade-ossian` |
| `evolve.md` | Step 2 - Ward sidecar (learnings pipeline) | ward | 11 | `ward-corben` |
| `start.md` | Phase A step 4 - defect proof gate Hound | hound | 2 | `hound-corva` |
| `start.md` | Route DIRECT step 3 - implementation Blade | blade | 17 | `blade-doven` |
| `scout.md` | Step 2 - parallel area scouts. Areas come from `$ARGUMENTS`, so the count is user-unbounded: the 5 default areas (design, api, patterns, deps, tests) take character slots 1-5; the 6th and any further area MUST use bare roster-length overflow (Rule 3) starting past the FULL 9-slot `scout` roster, never walking into slots 6-9 (dedicated to `brainstorm.md` and `reference/evolution.md`) | scout | 1, 2, 3, 4, 5 (default areas); 10, 11, ... (6th+ area) | `scout-pike`, `scout-ravel`, `scout-tessa`, `scout-korin`, `scout-nettle` (default areas); `scout-10`, `scout-11`, ... (6th+ area) |
| `review.md` | Step 2 - Gaze quality gate | gaze | 3 | `gaze-ombric` |
| `brainstorm.md` | Phase 1 - parallel research agents: Codebase Explorer, Constraint Mapper, Domain Researcher (optional) | scout | 6, 7, 8 | `scout-quorra`, `scout-haldis`, `scout-brint` |
| `brainstorm.md` | Council Mode Step 1 - 3-5 independent approach generators, one per lens (`mvp-first`, `risk-first`, `user-first`, `reuse-first`, `simplest`) | blade | function (Rule 2) | `council-mvp`, `council-risk`, `council-user`, `council-reuse`, `council-simple` (subset actually spawned per problem) |
| `brainstorm.md` | Council Mode Step 2 - one ranker per anonymized candidate, 3-5 fresh spawns | blade | 18, 19, 20, 21, 22 | `council-kirran`, `council-mossa`, `council-ellow`, `council-tavric`, `council-sorne` |
| `brainstorm.md` | Council Mode Step 3 - Chairman synthesis | blade | function (Rule 2) | `council-chairman` |
| `brainstorm.md` | Rival Pass - adversarial challenge on the approach spine, before Convergence | rival | 1 | `rival-dask` |
| `greploop.md` | Step E - substantial multi-file comment fix, prefer spawning a Blade | blade | 23 | `blade-vint` |
| `fix.md` | Step 8.5 - scrap-and-redo: a fresh agent replacing a repair Blade whose fix failed the same-class check, spawned with synthesized learnings instead of the failed code | blade | derived from the failed packet position (see Scrap-and-Redo below) | `blade-redo-{N}` |

## Spawn-Site Slot Table: Reference-Level / Cross-Cutting Sites

Sites specced in `reference/` or `agents/reference/` rather than a top-level
command file. Same rules apply - each gets its own permanent slot.

| Source | Site | Role | Slot / Function | Resulting Name |
|---|---|---|---|---|
| `reference/evolution.md` | Tier 0 - read-only external-absorption scout | scout | 9 | `scout-silven` |
| `reference/planning.md` | Codebase Research - `Explore` agent (file structure, patterns, similar implementations) | explore | 1 | `explore-fenn` |
| `reference/planning.md` | Codebase Research - `Plan` agent (same research pass, architect-facing) | planner | 1 | `planner-rooke` |
| `agents/reference/quality-gate.md` | Full Gauntlet Step 2 - sweep agent (paired with the hunter below) | sweep | 2 | `sweep-oda` |
| `agents/reference/quality-gate.md` | Full Gauntlet Step 2 - `pr-review-toolkit:silent-failure-hunter` | hunter | 1 | `hunter-vane` |
| `agents/reference/quality-gate.md` | Dual-Lens Protocol - second reviewer alongside the primary Gaze | gaze | 4 | `gaze-sura` |
| `commands/_shared-archer.md` | Opt-in cross-file pre-PR review, triggered by `verify.md` when `code-review-graph` MCP is available - a single Archer spawn, not a panel | archer | 1 | `archer-sylas` |

**`reference/planning.md`'s "Rival (mandatory, every plan)" gate is a documented
quirk, not a fifth Rival site.** Its heading says Rival, but its body spawns "sage
agent (top tier via agent definition - opus / Opus 5; no tools, blocking)" - that
description matches Sage's frontmatter pin exactly, not Rival's (Rival pins
sonnet). This roster reflects the file as written rather than silently
resolving the mismatch: the actual runtime name for this mandatory gate is
`sage-apex` (see Sage, below), not a `rival-*` name. No `rival` slot is consumed
by this site.

## Ad Hoc Sites (no fixed slot-table row)

Two roles are genuinely discretionary - no command file or reference doc pins a
literal `Agent()` call for them - so they keep a small assigned/reserve pair
instead of a table row.

- **Sage** - `reference/_base-agent.md`'s Sage Escalation is inherited by every
  role whose own agent definition cites that section for Sage escalation -
  today that is Blade, Ward, Sweep, and Archer (`agents/blade.md` carries its
  own duplicate copy of the same section; Gaze and Warden opt out). Any of
  these may consult Sage ad hoc (max 3 per parent), foreground, one
  consultation at a time. Name = `sage-{parent's own full spawn name}` (Rule 4)
  - e.g. a consultation from `blade-kaze` is `sage-blade-kaze`, and from
  `ward-torvan` is `sage-ward-torvan`. Deriving from the parent's FULL name
  (role prefix included), not just its character, is what keeps this safe even
  though blade/ward/sweep/archer character and function names are drawn from
  independent lists that "cross-role duplicates are fine" (Roster Table, above)
  explicitly permits to overlap - a stripped-prefix derivation would let two
  different parents collide onto the same Sage name the moment their
  character lists shared a token. This needs no reserved character list of its
  own.
  **Exception:** `reference/planning.md`'s mandatory "Rival" gate (see above)
  spawns this same Sage-tier agent directly from Apex, not from one of these
  four roles - there is no such parent to derive from. That one case gets the
  fixed name `sage-apex`.
- **Plan Checker** - referenced by `start.md`/`router.md` for decomposition
  validation and by `--to-plan` mode's inline self-checks, but no file pins a
  literal spawn site the way `wire.md` or `recruit.md` do; `start.md`'s
  `--to-plan` mode explicitly allows running plan-checker "INLINE" instead.
  `plan-checker-castor` is the **assigned** default when Apex does spawn it as a
  real subagent; `plan-checker-lira` is a **reserve** name held for the rare case
  of a second instance running concurrently in the same session context - it is
  not itself assigned to any site.

## Backfill Fan-Out (`evolve.md` Tier 3, `--backfill`)

`commands/evolve.md`'s Tier 3 backfill (`--tiers 3 --apply`) is the largest
non-execute Blade fan-out in the system, and it does not fit a static slot
row: it partitions an on-disk manifest (`{TEAM_DIR}/brain/backfill-manifest.json`)
into batches of up to 5 tickets per Blade, spawns one batch of Blades in
parallel, waits for it to return, then launches the next batch - unbounded in
total batch count, bounded in per-batch concurrency.

**Rule:** `name = blade-backfill-{batchIndex}-{slotInBatch}`.

- `batchIndex` is the batch's 1-based position in the manifest's partition
  order (batch 1 is the first parallel wave, batch 2 the second, and so on).
- `slotInBatch` is that Blade's 1-based position within its own batch, in the
  same partition order.

Both indices are read directly off the manifest file Tier 3 already writes
before spawning - never counted at runtime and never taken from Apex's memory,
consistent with Rule 1. This keeps every backfill Blade's name reconstructible
after the fact from `backfill-manifest.json` alone, and keeps concurrent
Blades within one batch from colliding (each gets a distinct `slotInBatch`)
without reserving a fixed character list sized for an unbounded ticket count.

## Scrap-and-Redo (`fix.md` Step 8.5)

`commands/fix.md` Step 8.5 fires when a repair Blade's fix fails re-verify in
the SAME failure class: the packet's owner entry did not resolve, so Step 8.5
discards its code (`git checkout -- <touched files>`) and spawns a fresh agent
with synthesized learnings instead of the failed attempt. This is a distinct
logical spawn from the original repair Blade at that packet position - reusing
`blade-dorik` (or whichever dedicated fix-packet slot produced the failed fix)
would be a same-name reuse across two different attempts that Apex needs to
tell apart when triaging the fix-loop history.

**Rule:** `name = blade-redo-{N}`, where `N` is the 1-based position of the
FAILED owner entry in `{SESSION_DIR}/fix-packet.json` (the same disk-derivable
position that produced its original `blade-dorik`-style name from the fix-packet
reserved range). The `-redo-` segment is its own structurally distinct shape,
per Rule 3's shape-safety argument - it can never collide with the bare
roster-length overflow shape, the execute-wave `-task-` shape, or the
`-backfill-` shape, and it self-documents in `agent-records/` as a redo of a
specific packet position without needing to cross-reference which dedicated
character name failed first.

## Stub Binding

An Agent spawn's `name:` param is the string that ties three things together:
its `agent-records/<name>.json` stub - **written by Apex**, the spawner, not by
the spawned agent - the `SendMessage` resume target for that agent, and (for
panel roles) the `reviews/{function}.json` artifact the agent writes for
*itself*, per Rule 2.
An agent uses its OWN name for its own role artifacts and as its SendMessage
address; it does not write its own `agent-records/` stub.
This is the invariant `hooks/wake-classifier.js` relies on via
`payload.agent_type` - get the name wrong at spawn time, or reuse it across two
different sites, and the stub, the resume, and the wake classification all
drift apart.

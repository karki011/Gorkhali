# Agent Naming Roster (SSoT)

Single source of truth for deterministic agent naming across every spawn site.
Every `Agent` spawn MUST pass a `name:` param derived from the rules below - never
left blank, never invented ad hoc.

## The Rules

1. **Fungible slots, globally unique per site.** `name = {role}-{character}`, where
   `character = roster[role][slot-1]`.
   Slots are STATICALLY derived: execute-wave engineers AND their per-task
   inspector verifiers use the task's index from `plan.json` (each role reserves
   the *first* N slots of its own roster for this - see Execute-Wave Reservation
   below); every other spawn site has its own permanently dedicated slot from
   the Spawn-Site Slot Table.
   **No two different spawn sites may ever share a character**, including the
   execute-wave-reserved range - a slot-table row must never use a character
   that execute-wave derivation could also produce.
   Slots are never counted at runtime and never read from Chief's memory.
2. **Role-differentiated panels.** When a spawn site fixes distinct functions on the
   same `subagent_type`, `name = {role}-{function}` instead of `{role}-{character}`.
   This covers the RPSL wrap panel (`justice-scope`, `justice-regression`,
   `justice-architecture`, `justice-skeptic` - maps 1:1 to `reviews/{function}.json`)
   and Council Mode's fixed approach enum (`council-mvp`, `council-risk`, `council-user`,
   `council-reuse`, `council-simple`) plus its Chairman (`council-chairman`). Council
   members still run through the Engineer runtime type, but use the documented
   `council-*` Engineer name alias because they reason only and never receive
   project-edit authority.
3. **Overflow.** Two distinct overflow shapes exist, and they must never share a
   shape with each other:
   - **Roster-length overflow** (a normal slotted site, or a dedicated
     multi-slot site's fan-out running past its reserved sub-range, e.g.
     `fix.md`'s repair-engineer range past its 4 reserved slots): `slot > roster
     length` -> bare `{role}-{slot}` (e.g. `scout-10` once all 9 scout names are
     spoken for, or `engineer-24` if a fix packet ever needs a 5th repair
     engineer, since the `engineer` roster is 23 long). **Any site whose fan-out
     count comes from user input, not a fixed spec** (today, only `scout.md`'s
     areas, taken from `$ARGUMENTS`) MUST overflow past the FULL roster length
     the moment it exceeds its own default reserved slots - never into another
     site's dedicated character slots that happen to still be numerically
     "spare" at that position. A 6th `scout.md` area is `scout-10` (past all 9
     scout names), never `scout-6` (`brainstorm.md`'s dedicated `wrennick`). A
     packet-bounded fan-out (`fix.md`'s repair Engineers) already gets this for
     free, because its own overflow point (`engineer-24`) sits past the full
     23-long `engineer` roster by construction - the risk is specific to sites
     whose default reserved range is SHORTER than the full roster, which today
     is only `scout.md` (5 reserved of 9 total).
   - **Execute-wave band overflow** (task-index derivation past its reserved
     1-8 range): `task_index > 8` -> `{role}-task-{task_index}` (e.g.
     `engineer-task-24`, `inspector-task-9`) - NOT the bare form above.
   These two shapes are structurally distinct strings (one has a `-task-`
   segment, one doesn't), so `engineer-task-24` (execute-wave task 24) and
   `engineer-24` (fix.md's own overflow) can coexist in the same session without
   ever colliding, even though both numbers can independently exceed 23. The
   same argument extends to every numeric-suffix shape this roster defines,
   including `{role}-backfill-{batchIndex}-{slotInBatch}` (Backfill Fan-Out,
   below): as long as each mode owns its own literal shape - bare `{role}-{N}`,
   `{role}-task-{N}`, `{role}-backfill-{B}-{S}` - no two modes can ever produce
   the same string, and none of them can collide with a dedicated character
   name either (a numeral is never a character token, e.g. `engineer-9` the
   bare-overflow form vs. `engineer-dovrin` the dedicated site at character
   slot 9 - though note execute-wave itself never reaches bare `engineer-9`; it
   would say `engineer-task-9` if task index 9 existed, per the band rule above).
4. **Advisor is parent-derived, not slot-derived.** `name = advisor-{parent's own
   full spawn name}` (the parent's complete `{role}-{character}` or
   `{role}-{function}` name, not the character alone) - unique because parent
   names are already unique. Using the full name, not a role-stripped character,
   is what keeps this unique across roles too: `engineer`, `inspector`,
   `steward`, and `justice` characters are drawn from independent per-role
   lists that are allowed to overlap (see Roster Table note below), so
   stripping the role prefix could collide two different parents onto the same
   Advisor name. See Advisor below.

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

- **Engineer** (the implementer) - task index N, for N 1-8 -> `engineer-{roster.engineer[N-1]}`
  (character name, drawn from `engineer` slots 1-8); for N > 8 -> `engineer-task-{N}`
  (Rule 3's execute-wave band-overflow shape), NOT `engineer-{roster.engineer[N-1]}` -
  the roster's character slots 9+ are dedicated to other sites (see the
  Spawn-Site Slot Table) and derivation must never reach into them - and NOT
  bare `engineer-{N}`, which is a different overflow mode reserved for
  roster-length overflow at dedicated sites (e.g. `fix.md`'s repair-engineer
  range).
- **Inspector** (the per-task verifier) - the same rule, mirrored: task index N,
  for N 1-8 -> `inspector-{roster.inspector[N-1]}`; for N > 8 -> `inspector-task-{N}`.

Both roles reserve their first 8 CHARACTER slots for this derivation, but the
derivation itself never runs past task index 8 in character form - it switches
to the `-task-` overflow shape instead, never the bare numeric shape. No
Spawn-Site Slot Table row for `engineer` or `inspector` may use a character from
the reserved 1-8 range - every dedicated `engineer`/`inspector` site below
starts at character slot 9 - and no dedicated site's own overflow may use the
`-task-` shape, since that shape is reserved for execute-wave derivation alone.

Task indexes are unique within a wave by construction (`plan.json` assigns
each task its own index), which is what keeps a wave's concurrent per-task
`inspector-*` verifiers collision-free against each other and against that same
wave's `engineer-*` implementers - two tasks in the same wave never derive the
same character, so two Inspectors (or an Inspector and an Engineer) never race
on one `agent-records/` stub.

## Roster Table

Office-flavored names, invented for this roster (not drawn from any
published work).
Names are unique WITHIN each role; cross-role duplicates are fine because the
role prefix disambiguates.
Slot number = position in the ordered list.

| Role | Ordered names (slot 1, 2, 3, ...) |
|---|---|
| engineer | varek, dunmar, brasco, ferrin, oskal, rignal, talwin, maren *(1-8, execute-wave reserved)*, dovrin, kestal, ralden, besner, dremmet, jarnek, kelwick, mendrik, norvale, ostrem, pellam, rendal, senwick, tarvel, vosler *(9-23, dedicated sites)* |
| inspector | halden, corliss, ebbet, farlow, gathrek, ondra, presk, welden *(1-8, execute-wave reserved)*, yarnell, zelmar, tindal *(9-11, dedicated sites)* |
| scout | pember, quade, ranthe, saldur, teviss, wrennick, arvick, bolen, crandal |
| auditor | ledgard, fenwick, ostin, pruett |
| justice | gavelin, robeck, sagard, verdick *(reserve capacity - see Justice note below)* |
| detective | draget, colven |
| surveyor | meridan, gantrey *(explicit visual inspection; gantrey reserve)* |
| steward | ordwin, tessle |
| opposition | contrell, parlow |
| clerk | ledgett, scrivet, herald |
| explore | farwick |
| planner | drafton |
| hunter | quarrick |

**Justice note:** the RPSL panel (`wrap.md`) is function-named per Rule 2, but it
is NOT the only Justice site - `commands/_shared-justice.md` specs a second,
separately-triggered, single-agent Justice review (opt-in, during `verify.md`,
when the `code-review-graph` MCP is available). That site is character-slotted
per Rule 1, not function-named (it has no distinct sub-functions to name), and
is assigned `justice-gavelin` in the Reference-Level table below. `robeck`/
`sagard`/`verdick` remain genuine unused reserve capacity for any future
Justice site.

**Explore / Planner / Hunter note:** these name the generic Claude Code
`Explore` and `Plan` subagent types when `reference/planning.md`'s Codebase
Research step spawns them, and the external
`pr-review-toolkit:silent-failure-hunter` agent that
`reference/agent-protocols/quality-gate.md`'s Full Gauntlet spawns as Hunter.
All three role tokens are deliberately NOT renamed under this roster's role
vocabulary, because they bind to identifiers outside this roster's control -
the native Explore/Plan agent types and the external silent-failure-hunter
plugin agent - and renaming the role prefix would break that binding; only
their character slots (`farwick`, `drafton`, `quarrick`) changed. The Planner
role prefix is `planner` (not `plan`) to avoid visual collision with
`plan.json` in prose and filenames; the underlying `subagent_type` value
passed to `Agent` is still `Plan`.

**Council note:** the `council-*` function aliases (`council-mvp`,
`council-risk`, `council-user`, `council-reuse`, `council-simple`,
`council-chairman`, and the five Council Mode Step 2 ranker names) are kept
unrenamed because they already fit this roster's office-flavored vocabulary.

## Spawn-Site Slot Table: Command Files

One row per non-execute spawn site in `commands/*.md`.

| Command | Site | Role | Slot / Function | Resulting Name |
|---|---|---|---|---|
| `fix.md` | Step 4 - triage agent | auditor | 1 | `auditor-ledgard` |
| `fix.md` | Step 7 - scoped repair Engineer(s), reserved range for the fix-packet fan-out (overflow beyond 4 -> `engineer-24`, `engineer-25`, ...) | engineer | 9, 10, 11, 12 | `engineer-dovrin`, `engineer-kestal`, `engineer-ralden`, `engineer-besner` |
| `detective.md` | Step 2 - Detective investigator | detective | 1 | `detective-draget` |
| `visual.md` | Explicit `--surveyor` advisory inspection | surveyor | 1 | `surveyor-meridan` |
| `validate.md` | Inspector Agent Dispatch - validation script runner | inspector | 9 | `inspector-yarnell` |
| `wire.md` | Step 2 - Dependency Analyst (ROLE FOCUS) | engineer | 14 | `engineer-jarnek` |
| `verify.md` | Step 1 - steward on changed files | steward | 1 | `steward-ordwin` |
| `verify.md` | Step 2 - Power Level review | auditor | 2 | `auditor-fenwick` |
| `verify.md` | Step 3 - Auto-Address fix agent | engineer | 15 | `engineer-kelwick` |
| `wrap.md` | RPSL panel, 4 parallel justices (full protocol: `reference/wrap/rpsl.md`) | justice | function (Rule 2) | `justice-scope`, `justice-regression`, `justice-architecture`, `justice-skeptic` |
| `wrap.md` | Ship ceremony mechanical tail (full protocol: `reference/wrap/ship-ceremony.md`) | clerk | 1 | `clerk-ledgett` |
| `wrap.md` | Evolution check sidecar (full protocol: `reference/wrap/evolution.md`, which describes the same site generically as an Inspector sidecar - one site, not two) | inspector | 10 | `inspector-zelmar` |
| `close.md` | Steps 2-6 - mechanical closeout tail | clerk | 2 | `clerk-scrivet` |
| `recruit.md` | Step 4 - ad hoc Engineer with ROLE FOCUS | engineer | 16 | `engineer-mendrik` |
| `evolve.md` | Step 2 - Inspector sidecar (learnings pipeline) | inspector | 11 | `inspector-tindal` |
| `start.md` | Phase A step 4 - defect proof gate Detective | detective | 2 | `detective-colven` |
| `start.md` | Route DIRECT step 3 - implementation Engineer | engineer | 17 | `engineer-norvale` |
| `scout.md` | Step 2 - parallel area scouts. Areas come from `$ARGUMENTS`, so the count is user-unbounded: the 5 default areas (design, api, patterns, deps, tests) take character slots 1-5; the 6th and any further area MUST use bare roster-length overflow (Rule 3) starting past the FULL 9-slot `scout` roster, never walking into slots 6-9 (dedicated to `brainstorm.md` and `reference/evolution.md`) | scout | 1, 2, 3, 4, 5 (default areas); 10, 11, ... (6th+ area) | `scout-pember`, `scout-quade`, `scout-ranthe`, `scout-saldur`, `scout-teviss` (default areas); `scout-10`, `scout-11`, ... (6th+ area) |
| `review.md` | Step 2 - Auditor quality gate | auditor | 3 | `auditor-ostin` |
| `brainstorm.md` | Phase 1 - parallel research agents: Codebase Explorer, Constraint Mapper, Domain Researcher (optional) | scout | 6, 7, 8 | `scout-wrennick`, `scout-arvick`, `scout-bolen` |
| `brainstorm.md` | Council Mode Step 1 - 3-5 independent approach generators, one per approach (`mvp-first`, `risk-first`, `user-first`, `reuse-first`, `simplest`) | engineer | function (Rule 2) | `council-mvp`, `council-risk`, `council-user`, `council-reuse`, `council-simple` (subset actually spawned per problem) |
| `brainstorm.md` | Council Mode Step 2 - one ranker per anonymized candidate, 3-5 fresh spawns | engineer | 18, 19, 20, 21, 22 | `council-ostrem`, `council-pellam`, `council-rendal`, `council-senwick`, `council-tarvel` |
| `brainstorm.md` | Council Mode Step 3 - Chairman synthesis | engineer | function (Rule 2) | `council-chairman` |
| `brainstorm.md` | Opposition Pass - adversarial challenge on the approach spine, before Convergence | opposition | 1 | `opposition-contrell` |
| `greploop.md` | Step E - substantial multi-file comment fix, prefer spawning an Engineer | engineer | 23 | `engineer-vosler` |
| `greploop.md` / `reference/pr-watch.md` | Phase 2 reply Clerk after `ack_assess` (tick glance is `pr-watch-tick.js`) | clerk | 3 | `clerk-herald` |
| `fix.md` | Step 8.5 - scrap-and-redo: a fresh agent replacing a repair Engineer whose fix failed the same-class check, spawned with synthesized learnings instead of the failed code | engineer | derived from the failed packet position (see Scrap-and-Redo below) | `engineer-redo-{N}` |

## Spawn-Site Slot Table: Reference-Level / Cross-Cutting Sites

Sites specced in `reference/` or `reference/agent-protocols/` rather than a top-level
command file. Same rules apply - each gets its own permanent slot.

| Source | Site | Role | Slot / Function | Resulting Name |
|---|---|---|---|---|
| `reference/evolution.md` | Tier 0 - read-only external-absorption scout | scout | 9 | `scout-crandal` |
| `reference/planning.md` | Opposition (mandatory, every plan) - the one plan critic, blocking; writes `plan-check.json` | opposition | 2 | `opposition-parlow` |
| `reference/planning.md` | Codebase Research - `Explore` agent (file structure, patterns, similar implementations) | explore | 1 | `explore-farwick` |
| `reference/planning.md` | Codebase Research - `Plan` agent (same research pass, architect-facing) | planner | 1 | `planner-drafton` |
| `reference/agent-protocols/quality-gate.md` | Full Gauntlet Step 2 - steward agent (paired with the hunter below) | steward | 2 | `steward-tessle` |
| `reference/agent-protocols/quality-gate.md` | Full Gauntlet Step 2 - `pr-review-toolkit:silent-failure-hunter` | hunter | 1 | `hunter-quarrick` |
| `reference/agent-protocols/quality-gate.md` | Dual-Auditor Protocol - second reviewer alongside the primary Auditor | auditor | 4 | `auditor-pruett` |
| `commands/_shared-justice.md` | Opt-in cross-file pre-PR review, triggered by `verify.md` when `code-review-graph` MCP is available - a single Justice spawn, not a panel | justice | 1 | `justice-gavelin` |

## Ad Hoc Sites (no fixed slot-table row)

One role is genuinely discretionary - no command file or reference doc pins a
literal `Agent()` call for it - so it keeps its derivation rule instead of a
table row.

- **Advisor** - `reference/_base-agent.md`'s Advisor Escalation is inherited by
  every role whose own agent definition cites that section for Advisor
  escalation - today that is Engineer, Inspector, Steward, and Justice
  (`agents/engineer.md` carries its own duplicate copy of the same section;
  Auditor and Clerk opt out). Any of these may consult Advisor ad hoc (max 3
  per parent), foreground, one consultation at a time. Name =
  `advisor-{parent's own full spawn name}` (Rule 4) - e.g. a consultation from
  `engineer-varek` is `advisor-engineer-varek`, and from `inspector-halden` is
  `advisor-inspector-halden`. Deriving from the parent's FULL name (role prefix
  included), not just its character, is what keeps this safe even though
  engineer/inspector/steward/justice character and function names are drawn
  from independent lists that "cross-role duplicates are fine" (Roster Table,
  above) explicitly permits to overlap - a stripped-prefix derivation would let
  two different parents collide onto the same Advisor name the moment their
  character lists shared a token. This needs no reserved character list of its
  own, and it has no exception: every Advisor name derives from one of those
  four parents, so an Advisor spawn with no such parent has no legal name.

## Backfill Fan-Out (`evolve.md` Tier 3, `--backfill`)

`commands/evolve.md`'s Tier 3 backfill (`--tiers 3 --apply`) is the largest
non-execute Engineer fan-out in the system, and it does not fit a static slot
row: it partitions an on-disk manifest (`{TEAM_DIR}/brain/backfill-manifest.json`)
into batches of up to 5 tickets per Engineer, spawns one batch of Engineers in
parallel, waits for it to return, then launches the next batch - unbounded in
total batch count, bounded in per-batch concurrency.

**Rule:** `name = engineer-backfill-{batchIndex}-{slotInBatch}`.

- `batchIndex` is the batch's 1-based position in the manifest's partition
  order (batch 1 is the first parallel wave, batch 2 the second, and so on).
- `slotInBatch` is that Engineer's 1-based position within its own batch, in
  the same partition order.

Both indices are read directly off the manifest file Tier 3 already writes
before spawning - never counted at runtime and never taken from Chief's memory,
consistent with Rule 1. This keeps every backfill Engineer's name reconstructible
after the fact from `backfill-manifest.json` alone, and keeps concurrent
Engineers within one batch from colliding (each gets a distinct `slotInBatch`)
without reserving a fixed character list sized for an unbounded ticket count.

## Scrap-and-Redo (`fix.md` Step 8.5)

`commands/fix.md` Step 8.5 fires when a repair Engineer's fix fails re-verify in
the SAME failure class: the packet's owner entry did not resolve, so Step 8.5
discards its code (`git checkout -- <touched files>`) and spawns a fresh agent
with synthesized learnings instead of the failed attempt. This is a distinct
logical spawn from the original repair Engineer at that packet position -
reusing `engineer-dovrin` (or whichever dedicated fix-packet slot produced the
failed fix) would be a same-name reuse across two different attempts that
Chief needs to tell apart when triaging the fix-loop history.

**Rule:** `name = engineer-redo-{N}`, where `N` is the 1-based position of the
FAILED owner entry in `{SESSION_DIR}/fix-packet.json` (the same disk-derivable
position that produced its original `engineer-dovrin`-style name from the
fix-packet reserved range). The `-redo-` segment is its own structurally
distinct shape, per Rule 3's shape-safety argument - it can never collide with
the bare roster-length overflow shape, the execute-wave `-task-` shape, or the
`-backfill-` shape, and it self-documents in `agent-records/` as a redo of a
specific packet position without needing to cross-reference which dedicated
character name failed first.

## Stub Binding

An Agent spawn's `name:` param is the string that ties three things together:
its `agent-records/<name>.json` stub - **written by Chief**, the spawner, not by
the spawned agent - the `SendMessage` resume target for that agent, and (for
panel roles) the `reviews/{function}.json` artifact the agent writes for
*itself*, per Rule 2.
An agent uses its OWN name for its own role artifacts and as its SendMessage
address; it does not write its own `agent-records/` stub.
This is the invariant `hooks/wake-classifier.js` relies on via
`payload.agent_type` - get the name wrong at spawn time, or reuse it across two
different sites, and the stub, the resume, and the wake classification all
drift apart.

# Phantom Roadmap

**Author:** Subash karki
**Date:** 2026-07-28
**Branch of record:** `model-routing-scope-check`

> This document SUPERSEDES `docs/team-skill-improvement-plan.md` (dated 2026-05-11).
> That plan names agents that no longer exist (Spark, Sentinel, Prism, Cortex) against today's roster (apex, blade, gaze, ward, warden, archer, sweep, rival, plan-checker, sage, hound, lens).
> Treat it as history only; it is archived by B7.

Research basis: `docs/research/agnostic-improvement-research.md` is AUTHORITATIVE for the peer landscape, the portability matrix, the per-hook verdicts, and the derivation of B1-B8.
This document does not restate those findings.
It records what was DECIDED, what was MEASURED, what was CORRECTED, and the order of work.

Each backlog item traces to a research weakness (section 6 of the research doc):

| Weakness | Backlog item |
|---|---|
| W1 - eval loop never closed | B2 |
| W2 - memory injection priority inversion | B3 |
| W3 - model routing two sources of truth | B1 |
| W4 - cost accounting Claude-locked/role-blind | B5 |
| W5 - wake-classifier reverse-engineered | section 12, port only `classify()` |
| W6 - repo and context bloat | B7 |
| W7 - ceremony candidates | B8 |

---

## 1. Status at a glance

| ID | Item | Status | Effort | Gate |
|---|---|---|---|---|
| B0 | Outcome recording (`scripts/outcome-write.js`) | DONE (uncommitted) | - | - |
| B0b | Baseline miner (`scripts/baseline-report.js`) | DONE (uncommitted) | - | - |
| R1 | Model bucketing fix in the report | DONE (uncommitted) | - | - |
| A1 | Unattended spend cap + stuck detection | DONE (uncommitted) | - | - |
| - | Version manifest sync to 0.2.7 | DONE (uncommitted) | - | - |
| B2 | Eval baseline | IN PROGRESS | 1d | blocks B7/B8 deletions |
| C1 | Config layer (`scripts/phantom-config.js`) | IN PROGRESS | 2d | blocks T1, T2, T3, greploop fix |
| B1 | Unify model routing on `model-policy.json` | PENDING | 2d | needs C1 for host config |
| B3 | Memory decay + validation accounting | PENDING | 3d | - |
| A2 | AC-triage eval cases | PENDING | 1d | needs B2 |
| B7/B8 | Doctrine dedup + approved deletions | PENDING | 5d | needs B2 |
| T1 | Tracker abstraction (loop providers) | PENDING | 3d | needs C1 |
| T3 | phantom-doctor | PENDING | 2d | needs C1 |
| T2 | phantom-setup + Terminal bundling | PENDING | 3d | needs C1, after B7/B8 |
| T5 | Dev-link for local skill edits | PENDING | 0.5d | needs T2 |
| B4 | Codex CLI hook adapter | PENDING | 3d | - |
| T4 | De-CloudZero + license + CONTRIBUTING | PENDING | 2d | after B2, B7/B8 |
| B5 | Per-role cost attribution | PENDING | 1d | partly collapsed into B0b |
| B6 | Down-pin measurement gate | PENDING | 1d | needs B1 |
| E1 | Eval cwd sandboxing | PENDING | 1d | gates the 7 judge cases |
| E2 | Release script for the three plugin manifests | PENDING | 1d | - |
| E3 | Diagnose 0/6 route eval failures | PENDING | 1d | cross-refs E1, F7 |

C1 and B2 landed after this table was first written; the status column above is authoritative.

---

## 2. Settled decisions

**D1. Runtime targets are Claude Code and Codex CLI only.**
Not N-runtime.
The evidence is Roo Code: the strongest per-mode-model story of 2025 shut down on 2026-05-15 and its repo is archived.
The tail of this market churns faster than adapter maintenance can be amortized.
Codex CLI is a RUNTIME target (it needs a hook adapter, B4), not merely Codex models as a provider.

**D2. Agentic development stays bounded at draft PR.**
`/phantom:loop` already terminates at a draft PR and never opens a PR for a weak-AC ticket.
Auto-merge is explicitly rejected while verification quality is unmeasured.
Revisit only after B2 plus A2 give the AC rubric and the eval suite real numbers.

**D3. Apex supplies a risk signal; policy decides the model.**
Apex must NOT pick model IDs.
Doing so creates a third source of truth alongside frontmatter and policy, which is exactly the defect B1 exists to remove.
The chain is: Apex supplies risk/complexity, `model-policy.json` resolves role plus risk to a profile (`critical_elevation` already exists), `model-presets.json` resolves profile plus host to a concrete model.
This matches model-right-sizer's rule that a pick is expressed as a delta against a known default, never as an absolute.

**D4. Deletions approved, gated on B2.**
`grill` becomes a flag on `review`.
`health` folds into `status`.
The `eval` skill folds into `wrap`.
`rival` plus `plan-checker` collapse into one plan critic.
None of this lands before B2 exists as a safety net, because a deletion without a recorded baseline is an untested behavior change to trigger routing.

**D5. Audience order is Subash, then CloudZero engineering, then open source.**
Open-sourcing is planned.
That is the only reason portability, setup, and doctor work exist at all.
It is also why B2 gates publication: shipping unmeasured effectiveness claims to a public audience is the one failure mode that cannot be walked back.

**D6. Terminal bundling is layered, not merged.**
The skills repo stays canonical and independently publishable; Phantom Terminal vendors a pinned built artifact at build time; a dev-link (T5) lets local skill edits apply immediately with no publish step.
This settles both readings of "stop juggling two repos": end users get all 29 skills with no separate clone (T2), and Subash stops hand-syncing two clones day to day (T5).
Rejected: a monorepo merge.
Moving skills into the internal app repo would make D5's open-sourcing require a permanent filtered export, and would graft 286 files / 44k lines / 49 test files into a Swift plus Rust app repo whose CI would then run both suites.
Both `research-phantom-skills` and `project-phantom-teminal` are INTERNAL in the CloudZero org today, so this is not resolving a public/private conflict, it is preserving the option to open one of them later without the other blocking it.

---

## 3. Measured baseline

First ever measurement, from `scripts/baseline-report.js` over two months of real usage.
These are the starting numbers every future change is compared against.

| Metric | Value |
|---|---|
| Canonical wrap records | 191 (201 `wrap.json` files exist on disk) |
| Distinct tickets | 152, of which 83 are `CP-*` |
| PR created | 70.2% (134/191) |
| Distinct PRs | 112 |
| Merge rate | **99.1%** (111 merged, 1 closed), via `gh` ground truth |
| Review cycles | median 2; 399 reviews, 482 comments total |
| `wall_time` coverage | 3/191 |
| Cost coverage | 21/191 |
| Greptile ran | 50/191 sessions |

Agent spawns: blade 1157, archer 464, sweep 300, gaze 113, warden 107, rival 50, plan-checker 44, ward 38, lens 18, sage 14, hound 13, apex 0.

`wrap.json` carries 89 distinct top-level keys, and `pr.status` had 16 free-text variants.
That schema drift is WHY measurement never happened before this session, and it is precisely what B0 fixed.

Greptile at 50/191 means it is already de facto optional on the ship path, despite `wrap.md:103` claiming it always runs.

---

## 4. Corrections

Things believed before measurement that measurement disproved.
Recorded so nobody re-derives the wrong conclusion.

- **"Outcomes are not recorded" was WRONG.** 201 `wrap.json` files exist. The earlier count measured `~/.phantom/sessions/` instead of `~/.phantom/repos/<repo>/{sessions,completed}/<ticket>/`. Outcomes were captured but UNSCHEMATIZED.
- **"Routing policy is frequently not applied" was WRONG.** It was a reporting artifact that merged legacy records into an `inherited` bucket. Truth: `param` 997, `pinned` 626, `session` 441, and 1018 records predate the `modelSource` instrumentation entirely. Genuinely un-pinned spawns across all 12 phantom agents: 65. For blade, 93.4% of attributable spawns carry an explicit model. **The Apex-picks-the-model rule IS being followed.**
- **"rival and sage are ceremony" was WRONG.** rival 50 spawns, plan-checker 44, sage 14. They are used. The only deletion candidates are `grill`, `health`, and the `eval` skill.
- **"fix_loops data is essentially absent (2/191)" was WRONG.** `verification.json` carries `review.fixLoops` in **120/191**, which is 63% coverage. It was in a different file, not missing.
- **There are 12 agents in `agents/`, not 13.** An earlier count included the `reference/` subdirectory.
- **`apex` at 0 spawns is CORRECT and is not a deletion signal.** Apex IS the main loop and is never spawned.

---

## 5. Open findings, not yet fixed

**F1. Two frontmatter drifts.**
`sweep` and `warden` are both `economy` (haiku) in `model-policy.json` but pinned `sonnet` in frontmatter.
warden ran sonnet across all 107 spawns, so every spawn used the drifted value.
This is B1's concrete scope: two files.

**F2. `sage` ran on `fable:4`** despite an explicit fable-deny in `hooks/blade-model-gate.js`.
Unexplained.
Needs investigation before B1 claims the gate is authoritative.

**F3. Eval harness contamination.**
`scripts/run-evals.js` spawns the agent under test with cwd set to this repo, so the child can READ `evals/evals.json` and recognize its own eval fixture.
Observed directly on case 46.
The 48 deterministic cases (30 trigger, 6 route, 12 regex) are unaffected.
The **7 llm-judge cases are uninterpretable** until the child cwd is sandboxed (E1).
Any baseline must label this.

**F4. Prompt overhead is the dominant cost line.**
A TRIVIAL sonnet call in this repo costs about $0.10, and a real convention case on opus about $0.62, driven by repo prompt overhead rather than by the model.
Against 3088 lifetime spawns, this promotes B7 from a tidiness item to a COST item.

**F5. No release script.**
All three plugin manifests are hand-bumped.
That is how `.claude-plugin/marketplace.json` and `.codex-plugin/plugin.json` drifted to 0.2.6 while `.claude-plugin/plugin.json` was 0.2.7 (fixed this session; commit `7a88e0c` was the cause).
Same "one value, N places, nothing enforcing agreement" pattern as F1.

**F6. Agent completion claims are unreliable.**
3 of 4 implementation agents this session ended their turns with fragment results while the work was actually on disk.
Verification must be mechanical (`git status`, run the thing), never prose trust.

**F7. The 0/6 route result is the more suspicious number in the first baseline, not the 47.3% headline.**
`evals/baselines/sonnet.json` (committed `8e6b553`) scores 26/55, passRate 0.473: untyped/trigger 14/30 (47%, failed ids 1,2,4,7,8,10,11,13,14,17,19,20,22,23,25,29), route 0/6 (0%, failed ids 31-36), convention 12/19 (63%, failed ids 39,40,41,46,47,48,49).
Zero of six on routing contradicts months of working daily use and the measured 99.1% merge rate (section 3), so this most likely means the eval harness measures routing wrong, not that routing is broken.
Cross-reference E1: both the 7 llm-judge cases (F3) and these 6 route cases bear on whether this baseline is trustworthy at all.
Consequence: the 47.3% figure must not be quoted as a system-effectiveness number until the 6 route cases are diagnosed (E3).

---

## 6. Done this session

Uncommitted at time of writing.

**B0 - outcome recording.**
`scripts/outcome-write.js`, script-authored so it cannot drift.
`pr_state` is a closed enum derived from `gh`.
Any absent field is written as `null` plus an entry in `unresolved[]` naming the field and the reason.
Wired into `wrap.md` Step 13 and `close.md` Step 8, non-blocking.

**B0b - `scripts/baseline-report.js`.**
Read-only retrospective miner over the existing corpus.
Zero side effects, mirrors `scripts/preflight.js` in shape.

**R1 - report bucketing fix.**
Model source buckets are now `param | pinned | session-inherited | legacy-no-field`.
Non-phantom agent types (`general-purpose`, `Explore`, `coder`) moved out of the policy-drift table, because they have no policy row and no pin by design.

**A1 - unattended spend cap plus stuck detection.**
`hooks/loop-controller.js` gains `unattendedHalt()` and `HALT_STATES`; `SPEND_CEILING_USD` defaults to $5 with env override; `scripts/run-guard.js` added.
Verified behavior: interactive never halts, confirmed overage halts, unknown spend does NOT halt, a repeated failure class halts as stuck.
**Honest limitation, recorded in the code and repeated here: this is a ceiling on OBSERVED spend, not a hard guarantee.**
A run with a missing cost ledger is uncapped, and `run-guard` says so out loud.

**Version manifest sync to 0.2.7.**
Test suite green at 658 pass, 0 fail, 1 skipped.

---

## 7. The backlog

Each item lists what, why, effort, and a HUMAN-OBSERVABLE test.
"Tests pass" is not an acceptable test for any item here.

### C1 - Config layer. 2d. IN PROGRESS.

What: two files, `<data>/config.json` global and `<data>/repos/<repo>/config.json` per-repo.
Resolution order is explicit > per-repo > global > detect > unset, and every resolved value carries its provenance.
Closed schema.
Why: prerequisite for T1, T2, T3 and the greploop fix, so it sits ahead of all four.
Test: run the config resolver in a repo with a per-repo override and watch it print the value plus the word `per-repo` as its source; delete that file, run again, and watch the same key print with source `global`.

### B1 - Unify model routing. 2d.

What: generate the `model:` frontmatter line in every `agents/*.md` from `model-policy.json` via `resolve-profile.mjs`; add a CI drift test; add the D3 Apex risk signal; resolve the sweep and warden drifts (F1) as one recorded decision; tighten the 65-spawn un-pinned tail.
Why: kills four restatements of policy and one live drift, and makes any future model migration a one-line policy edit.
Test: change warden to `balanced` in `model-policy.json`, run the generator, and watch `git diff` show exactly one frontmatter line change; then hand-edit `agents/warden.md`'s model line and watch CI go red naming that file.

### B3 - Memory decay + validation accounting. 3d.

What: `memory-reader.js:78` ranks `[failed]` at priority 0, ABOVE `[validated:N]` at 2-3, and nothing expires them, so the injection budget (top 5 entries, 1600 chars) is spent on the oldest one-off mistakes forever.
Add injection logging, decay `[failed]` past 60 days, and give `validated:N` an automatic increment path.
Today `validated:N` only moves when something manually says so, which is why nothing graduates.
Why: without the logging, recall precision stays unmeasurable forever; without the decay, the priority inversion permanently crowds out validated patterns.
Test: submit a prompt that matches a 60-day-old `[failed]` entry and watch the `<!-- memory-injection -->` block come back without it; then open the injection log and see the entry ids that WERE injected for that prompt.

### A2 - AC-triage eval cases. 1d.

What: eval coverage for the AC-solidity rubric at `commands/loop.md:48-55`.
Why: that rubric is an unmeasured LLM classifier deciding whether it is safe to auto-implement a ticket with no human present, and it has ZERO eval coverage today.
Test: run the eval suite and watch new AC-triage cases appear with pass/fail verdicts; hand a deliberately vague ticket body to `/phantom:loop --status` and watch it print WEAK.

### B7/B8 - Doctrine dedup + approved deletions. 5d.

What: dedup role/routing/workflow doctrine onto `skills/phantom/references/` as canonical; execute the D4 deletions; fold the ponytail ladder into `sweep`/`gaze` prose; archive `docs/team-skill-improvement-plan.md` plus the dated research notes and one-off HTML; remove the repo-root orphans.
Why: per F4 this is now a COST item, not tidiness, because prompt overhead dominates per-call cost across 3088 lifetime spawns.
Test: start a fresh session and watch the skill list come back with three fewer entries; run the same trivial task before and after and watch the reported cost drop.

### T1 - Tracker abstraction. 3d.

See section 8 for the full design.
Test: with `tracker: file`, add an unchecked line to `.phantom/backlog.md`, run `/phantom:loop --status`, and watch that line appear in the triage table with no network call and no auth prompt.

### T3 - phantom-doctor. 2d.

What: one command that reports trigger collisions, hook conflicts, degraded capabilities, and unresolvable profiles.
Why: it is the diagnostic surface for everything C1, B1, and the Tier rules make conditional, and it is the thing that becomes a Terminal panel (section 10).
Test: deliberately break `hooks.json` registration for one hook, run the doctor, and watch it name that hook as unregistered.

### T2 - phantom-setup + Terminal bundling. 3d.

What: a setup path that writes the C1 config and reports what it detected; Terminal ships this repo as a version-pinned plugin.
Why: the app already writes shims to `~/.phantom-terminal/bin/`, so the install path is the same shape of work.
Lands AFTER B7/B8, because bundling multiplies the audience for whatever quality currently exists.
Test: on a clean machine with no `~/.phantom`, run setup and watch it print each detected capability, then run `/phantom:status` successfully without editing a file by hand.

### T5 - Dev-link for local skill edits. 0.5d.

What: a symlink or env var (`PHANTOM_SKILLS_DEV_PATH`) that makes Terminal's vendored skills bundle resolve to this repo's working tree instead of the pinned build artifact.
Why: D6 settles the bundling shape as vendor-plus-dev-link; without this half, Subash is back to hand-copying files between two clones on every skill edit.
Test: set the dev-link, edit one skill's `SKILL.md` in this repo, and watch Phantom Terminal pick up the edited text on next invocation with no build or publish step run.
Depends on T2.

### B4 - Codex CLI hook adapter. 3d.

What: per `agnostic-improvement-research.md` section 7 B4.
Why: takes mechanical enforcement, the differentiating feature, to the second runtime target and validates D1 cheaply.
Test: on Codex CLI in a phantom-known repo with no active session and `PHANTOM_ROUTING_ENFORCE=1`, attempt a file edit and watch the ROUTING GATE denial appear.

### T4 - De-CloudZero + license + CONTRIBUTING. 2d.

What: remove CloudZero-specific defaults and references; add a license and CONTRIBUTING; rename `greploop` to `phantom:reviewloop` (section 9).
Why: D5 publication prerequisite.
Test: `grep -ri cloudzero` over the shipped plugin directories returns nothing, and a fresh clone's README walks a stranger to a first `/phantom:status`.

### B5 - Per-role cost attribution. 1d.

What: per-role cost per ticket in the wrap output.
Partly collapses into B0b, since the timing data it needs already exists and is already read.
Test: run `/phantom:wrap` and watch a per-role cost table print (`blade: $X, gaze: $Y, ward: $Z`) whose rows sum to the existing Total line.

### B6 - Down-pin measurement gate. 1d.

What: any move of a role to a cheaper model enters "measurement-required"; promote at <=1.15x wall-clock against the incumbent, revert at >1.25x.
Test: perform a trial down-pin, then watch `node scripts/timing-report.js --routing` print the before/after wall-clock plus a one-line promote or revert verdict.

### E1 - Eval cwd sandboxing. 1d.

What: sandbox the child cwd in `scripts/run-evals.js` so the agent under test cannot read `evals/evals.json`.
Why: gates whether the 7 llm-judge cases are ever usable (F3).
Test: run case 46 and watch the child's transcript contain no reference to the fixture file.

### E2 - Release script for the three plugin manifests. 1d.

What: one script or generator that bumps `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.codex-plugin/plugin.json` together.
Why: F5.
Test: run the bump to a new version and watch all three files change in one `git diff`; hand-edit one out of sync and watch CI go red.

### E3 - Diagnose the 0/6 route eval failures. 1d.

What: read failing route case ids 31-36 in `evals/evals.json` against what `run-evals.js` actually asserts for `kind: route`, and determine whether the harness asserts the wrong thing rather than routing being broken (F7).
Why: a 0% subscore this far from the measured 99.1% merge rate must be explained before the 47.3% baseline is quoted anywhere; cross-refs E1.
Test: after the fix or explanation, re-run the baseline and watch the route subscore change from 0/6 to a number that matches manual inspection of the same 6 prompts.

---

## 8. Loop provider design

The AC-solidity rubric (`commands/loop.md:48-55`) is ALREADY fully provider-neutral: a clear single goal, AC explicit and testable, no TBDs, bounded scope.
It judges text quality, not Jira fields.

Jira coupling is exactly FOUR operations: the capability gate (line 26), poll (line 30), fetch (line 48), and report (lines 63, 76).
Triage and dispatch are already portable.

So the provider interface is two functions.

- `poll() -> [{id, title, body, url}]`
- `report(id, text) -> ok | unsupported`

| Provider | poll | report |
|---|---|---|
| `jira` | MCP search | MCP comment |
| `linear` | `state:Ready` | comment |
| `github` | `gh issue list --assignee @me --label ready` | `gh issue comment` |
| `file` | unchecked items in `.phantom/backlog.md` | check the box |
| `none` | inactive | n/a |

Build `file` FIRST: zero dependencies, zero-config, proves the seam with no network or auth in the way.
Then `github`.
Jira becomes one provider among four rather than the substrate.

Two asymmetries that must NOT be abstracted away.

- The ready signal differs in KIND. Jira and Linear have workflow states, GitHub has labels, a file has "unchecked". Each provider declares its own predicate and config carries `ready_signal`.
- `report()` may be unsupported. Make it optional and provider-declared. When unsupported, the verdict goes to the B0 outcome record and prints.

The trigger never changes: typing the command IS the authorization (line 12), which is already provider-independent.
`tracker: none` generalizes the EXISTING `LOOP INACTIVE:` message at line 26 rather than adding new behavior.

**The real limitation is not the tracker.**
Loop's autonomy is gated on AC quality, a property of the team's process, not the tracker.
Most drive-by GitHub issues will be judged WEAK and produce plans rather than PRs - that is the rubric working correctly on thinner input, and it should be documented so a plans-only user does not assume loop is broken.

`--status` (line 20) is read-only with no writes.
Preserve that per provider and make it the acceptance test for every new provider.

---

## 9. Greploop, becoming reviewloop

Greptile is on the MANDATORY ship path (`wrap.md:103` says "always runs"), and `hooks/greploop-gate.js` is a registered blocking Stop hook.
It DOES fail open and it explicitly recognizes "not installed", but it does so by REGEX-MATCHING freeform prose an LLM wrote into `wrap.json`.
That is the same fragility class as the 16 free-text `pr.status` variants.

Fix:

- a `review.external` capability (`greptile | none`) determined by PROBING, not by string-matching prose;
- `wrap.md:103` becomes "runs when available" instead of "always runs";
- `greptile.status` becomes a closed enum: `pending | settled | unavailable | not_configured`;
- keep fail-open as defense in depth, but stop DEPENDING on it.

Rename to `phantom:reviewloop` at T4; `greploop` is vendor-branded, which is odd for a public repo.
A `coderabbit` key already appears in one historical `wrap.json`, so per ponytail rung 1, gate now with a closed enum and add provider adapters only when a second provider is actually needed.

**Standing principle: the ship path must never hard-depend on a paid third-party SaaS.**
This covers Greptile, Jira, and whatever comes next.

---

## 10. Skill tiers

| Tier | Requires | Skills |
|---|---|---|
| 1 core | git plus a runtime | start, execute, verify, fix, review, scout, hound, learn, pause, resume, status |
| 2 git-host | `gh` or equivalent | wrap PR creation, close |
| 3 vendor-optional | greptile, jira, figma, sentry | greploop, loop, visual |

Rule: **a Tier 3 skill whose capability is absent must not be ADVERTISED.**
A skill in the list that does not work is worse than one that is not there, and it burns trigger-disambiguation prose in every session for a feature the user cannot use.

---

## 11. Phantom Terminal integration

Three layers.

1. **Bundling.** Terminal ships this repo as a version-pinned plugin. The app already writes shims to `~/.phantom-terminal/bin/`, so the install path is the same shape of work.
   Bundling is settled as vendor-plus-dev-link, not a monorepo merge; see D6 (T2 for the vendored path, T5 for the dev-link).
   Terminal-side integration points for whoever picks this up: `daemon/src/sessions.rs`, `daemon/src/bin/phantom-claude.rs`, `app/Sources/PhantomApp/GhosttyTerminalSurface.swift` (all verified in `project-phantom-teminal`).
2. **The doctor as UI.** `phantom-doctor` output is better as a Terminal panel than as terminal text: trigger collisions, hook conflicts, degraded capabilities, and unresolvable profiles as a clickable checklist. No CLI-only peer can do this. It is what makes bundling more than convenience.
3. **Terminal owns the durable record.** `phantomd` already has SQLite with 60 tables and an event journal. The reason `wrap.json` accumulated 89 ad-hoc keys is that the skills layer's persistence is unstructured files an LLM writes freehand.

**The governing pattern: the portable artifact is the CONTRACT, the daemon is an OPTIONAL CONSUMER.**
Never the reverse, or the open-source version becomes the degraded one.
B0 already follows this: the skill writes portable JSON, Terminal ingests it when present.

Bundling lands AFTER the internal quality bar (after B7/B8), because bundling multiplies the audience for whatever quality currently exists.

---

## 12. Not doing

Each with the condition that would revive it.

**The native Rust AI harness.**
SHELVE the `feat/phantom-native-ai-harness` branch: roughly 62k inserted lines, cannot make an HTTPS call, no Swift integration, `db.rs` at 31k lines.
Do not delete it.
Revive only if measurement shows the external harness is the actual bottleneck.
The two genuine justifications, if it ever returns, are that a deterministic repo index only pays off if you control context assembly, and that replay-based routing calibration needs bounded assignments you can re-execute.
Note that `docs/research/phantom-harness-build-plan.md` is a COST QUOTE for this path, not a plan to execute.

**Full N-runtime agnosticism beyond Claude Code and Codex.**
Revives when a specific runtime both ships blocking hooks plus model-pinned subagents AND becomes a runtime someone on the team uses daily.

**MCP-server-owned enforcement.**
It cannot prevent native-tool bypass.
Revives if MCP gains a standardized interception layer for host tool calls.

**Porting `wake-classifier.js`'s payload parsing.**
Reverse-engineered, short half-life.
Port only the pure `classify()`.

**Reviving `ruvector.db` / vector memory.**
Referenced by nothing.
The memory problem is validation and decay, not retrieval technology.
Revives if B3's injection logging shows keyword-domain matching is the measured precision bottleneck.

**Hand-written per-runtime agent files.**
Every per-runtime artifact comes out of the B1 generator or does not exist.
This one is structural and never revives.

**Treating AGENTS.md as the portability strategy.**
It carries no roles, no workflow, no models, and no enforcement.
Worth emitting; not a strategy.

**Learned model routing.**
A solo user generates too few verified outcomes for the data question to resolve.
Revives if the audience becomes CloudZero engineering, or via replay of bounded assignments against recorded verifiers.

---

## 13. Kill criterion

If measurement ever shows this system's verified completion rate or cost-per-completion is worse than running the bare external harness with no orchestration, stop and simplify rather than adding layers.

The **99.1% merge rate** is the current bar to beat.
Any change that lowers it is a regression regardless of what else it improves.

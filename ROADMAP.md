# Gorkhali Roadmap

**Author:** Subash karki
**Date:** 2026-07-28, last corrected 2026-08-26
**Branch of record:** `model-routing-scope-check`

> This document SUPERSEDES `docs/team-skill-improvement-plan.md` (dated 2026-05-11).
> That plan names agents that no longer exist (Spark, Sentinel, Prism, Cortex) against today's roster (chief, engineer, auditor, inspector, clerk, justice, steward, opposition, advisor, detective).
> Treat it as history only; it is archived by B7.

**2026-08-26 correction.** B9–B13 (finding schema, verification pass, re-review convergence, structured PR body) stay closed. This session (P1) diverges from two later deferrals: `REVIEW.md` is read now (cheap, pr-review + Auditor), not waited on T4; greploop is always *invoked* but capability-gated, which is the wrap.md:103 fix section 9 asked for. Diff-size, Justice widening, and a low-risk fast path stay data-gated on B9. `plan-checker` is not a live role — Opposition is the one plan critic (D4).

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
| W8 - review effectiveness unmeasured | B9, B9b, B10, B11, B12, B13 |
| W9 - user-job packaging (four review surfaces, brainstorm/plan design-doc gaps, wrap/greploop ceremony) | P1 |

W8 derives from a second research doc, `project-docs/review-research-2026.md`, which is AUTHORITATIVE for the 2026 review landscape, the false-positive literature, and the derivation of B9-B13.
Same rule as above: this document does not restate those findings.

---

## 1. Status at a glance

| ID | Item | Status | Effort | Gate |
|---|---|---|---|---|
| B0 | Outcome recording (`scripts/outcome-write.js`) | DONE (uncommitted) | - | - |
| B0b | Baseline miner (`scripts/baseline-report.js`) | DONE (uncommitted) | - | - |
| R1 | Model bucketing fix in the report | DONE (uncommitted) | - | - |
| A1 | Unattended spend cap + stuck detection | DONE (uncommitted) | - | - |
| - | Version manifest sync (0.2.7 at the time; all three now 0.3.11, `npm run version:check` in sync) | DONE | - | - |
| B2 | Eval baseline | IN PROGRESS | 1d | blocks B7/B8 deletions |
| C1 | Config layer (`scripts/gorkhali-config.js`) | IN PROGRESS | 2d | blocks T1, T2, T3, greploop fix |
| B1 | Unify model routing on `model-policy.json` | PENDING | 2d | needs C1 for host config |
| B3 | Memory decay + validation accounting | PENDING | 3d | - |
| A2 | AC-triage eval cases | PENDING | 1d | needs B2 |
| B7/B8 | Doctrine dedup + approved deletions | PENDING | 5d | needs B2 |
| T1 | Tracker abstraction (loop providers) | PENDING | 3d | needs C1 |
| T3 | gorkhali-doctor | PENDING | 2d | needs C1 |
| T2 | gorkhali-setup + Terminal bundling | PENDING | 3d | needs C1, after B7/B8 |
| T5 | Dev-link for local skill edits | PENDING | 0.5d | needs T2 |
| B4 | Codex CLI hook adapter | PENDING | 3d | - |
| T4 | De-CloudZero + license + CONTRIBUTING | PENDING | 2d | after B2, B7/B8 |
| B5 | Per-role cost attribution | PENDING | 1d | partly collapsed into B0b |
| B6 | Down-pin measurement gate | PENDING | 1d | needs B1 |
| B9 | Review finding disposition | DONE | 1d | schema+id+disposition, plus the miner table (B9b) |
| B10 | Auditor finding schema + review standard | DONE | 2d | one scale, one shape, generated + drift-checked |
| B11 | Verification pass before findings land | DONE | 2d | pass + `confidence` axis shipped; the promote/revert gate is BUILT and cannot fire — corpus 0/0 measurable, and per F11 it now also refuses any comparison whose two sides cannot be shown to share one recorded reviewer `model` |
| B12 | Re-review convergence | DONE | 0.5d | carry-over ledger survives the deliberate `auditor.json` delete; round 2 itemizes blocking only |
| B9b | Per-finding table in the baseline miner | DONE | 0.5d | completes B9's stated test; corpus is 0/0 measurable until the first post-B9 fix loop closes |
| B13 | Structured PR body | DONE | 0.5d | - |
| P1 | Phase-judgment product packaging | DONE | 1d | W9; this session. Does not reopen B9–B13 |
| S1 | AI-native SDLC chain (`start` proto-spec + wrap projections + plan-compliance + fix test-file gate) | DONE | this PR | JSON stays canonical; no intake skill |
| E1 | Eval cwd sandboxing | PENDING | 1d | gates the 7 judge cases |
| E2 | Release script for the four plugin manifests | PENDING | 1d | - |
| E3 | Diagnose 0/6 route eval failures | PENDING | 1d | cross-refs E1, F7 |
| E4 | Roster-degradation drill | PENDING | 2d | - |
| E5 | Verifier-first escalation for direct routes | PENDING | 2d | needs the outcome `route` field |
| K1 | Kimi Code host (preset, host-support generalization, `.kimi-plugin` manifest) | DONE | - | shipped; version-synced fourth manifest |
| K2 | Kimi hook adapter | DONE | - | landed via the `.kimi-plugin/plugin.json` `hooks` field (routing-gate and test-file-gate on PreToolUse, greploop-gate on Stop); engineer-model-gate deliberately not wired |
| K3 | Kimi eval baseline (`evals/baselines/k3.json`) | PENDING | 0.5d | needs a real `--host kimi` run; do not fabricate |
| K4 | Kimi cost attribution in `scripts/cost-report.js` | PENDING | 1d | needs Kimi Code transcript format access (session `wire.jsonl` files are the likely source) |
| K5 | Verify per-spawn model selection on Kimi | PENDING | 0.5d | if the Agent tool gains a model param, apply the tiered preset at spawn and wire engineer-model-gate; until then `delegation.model_select` stays `unavailable` |
| TD1 | Preamble restructure | DONE | 2d | shipped in 0.10.0: `scripts/repo-detect.js` emits repo facts as JSON, `_shared-repo-detection.md` is policy-only, `_shared.md` §Paths collapsed, tier registry unified in `scripts/preamble-tier.js` (blockquote + table drift pinned by `test/preamble-tier.test.js`) |
| TD2 | Extract auditor/justice GENERATED blocks into `reference/review-standard.md` | DONE | 1d | shipped in 0.10.0: auditor.md 18.7KB→4.3KB, justice.md 14.9KB→5.3KB; agents cat the standard at runtime; temperature-review.md and justice-protocol.md stay generated inline (standalone mid-review reads) |
| TD3 | Post-merge eval tripwire for the haiku downshift | PENDING | 0.5d | after this PR merges, re-run the review-precision baseline (`node scripts/run-evals.js` compare path) against the clerk/inspector→haiku change; SPENDS TOKENS - needs explicit operator go-ahead; if precision dropped, the revert knob is one line in `skills/gorkhali/references/model-policy.json` (inspector/clerk back to `balanced`) |

C1 and B2 landed after this table was first written; the status column above is authoritative.

---

## 2. Settled decisions

**D1. Runtime targets are Claude Code and Codex CLI only.**
Not N-runtime.
The evidence is Roo Code: the strongest per-mode-model story of 2025 shut down on 2026-05-15 and its repo is archived.
The tail of this market churns faster than adapter maintenance can be amortized.
Codex CLI is a RUNTIME target (it needs a hook adapter, B4), not merely Codex models as a provider.

**D1a. Kimi Code is admitted as a third runtime target (supersedes D1's "only").**
Kimi Code consumes the Agent Skills spec natively, so the marginal adapter cost
D1 was protecting against is near zero: the host-support layer was generalized
(`codex-support/` became `host-support/` with a `--host`-parameterized resolver
and thin backward-compat shims) rather than duplicated. The Kimi preset spreads
across Kimi's own tiers only - `kimi-for-coding` (K2.7 Code) for economy,
`k3-256k` for balanced, `k3` for deep/frontier, with K3's `reasoning_effort`
mapping onto the profile effort field - so a Kimi-routed session can never
silently request Anthropic or OpenAI compute. (Note the two identifier spaces:
Kimi Code CLI uses `k3`-style IDs; the pay-per-token platform API uses
`kimi-k3`. `scripts/compress/compress.py` targets the latter.) The
`.kimi-plugin/plugin.json` manifest is version-synced with the other three by
`scripts/release-version.js` and the portable validator.
D1's N-runtime caution still stands: a fourth host needs the same evidence bar
(native skills consumption plus a maintained preset), not enthusiasm.

**D2. Agentic development stays bounded at a ready-for-review PR.**
`/gorkhali:loop` already terminates at a ready-for-review PR and never opens a PR for a weak-AC ticket.
Auto-merge is explicitly rejected while verification quality is unmeasured.
Revisit only after B2 plus A2 give the AC rubric and the eval suite real numbers.

**D3. Chief supplies a risk signal; policy decides the model.**
Chief must NOT pick model IDs.
Doing so creates a third source of truth alongside frontmatter and policy, which is exactly the defect B1 exists to remove.
The chain is: Chief supplies risk/complexity, `model-policy.json` resolves role plus risk to a profile (`critical_elevation` already exists), `model-presets.json` resolves profile plus host to a concrete model.
This matches model-right-sizer's rule that a pick is expressed as a delta against a known default, never as an absolute.
Status: IMPLEMENTED on claude-code (0.10.0) — spawn guidance resolves per role via `resolve-profile.mjs` and the preset ladder is live (`economy`→haiku, `balanced`/`deep`→sonnet-high, `frontier`→session-inherit). Kimi sub-agents still inherit the session model until K5 lands.

**D4. Deletions approved, gated on B2.**
`grill` becomes a flag on `review`.
`health` folds into `status`.
The `eval` skill folds into `wrap`.
`opposition` plus `plan-checker` collapse into one plan critic.
None of this lands before B2 exists as a safety net, because a deletion without a recorded baseline is an untested behavior change to trigger routing.

**D5. Audience order is Subash, then CloudZero engineering, then open source.**
Open-sourcing is planned.
That is the only reason portability, setup, and doctor work exist at all.
It is also why B2 gates publication: shipping unmeasured effectiveness claims to a public audience is the one failure mode that cannot be walked back.

**D6. Terminal bundling is layered, not merged.**
The skills repo stays canonical and independently publishable; Gorkhali Terminal vendors a pinned built artifact at build time; a dev-link (T5) lets local skill edits apply immediately with no publish step.
This settles both readings of "stop juggling two repos": end users get all 29 skills with no separate clone (T2), and Subash stops hand-syncing two clones day to day (T5).
Rejected: a monorepo merge.
Moving skills into the internal app repo would make D5's open-sourcing require a permanent filtered export, and would graft 286 files / 44k lines / 49 test files into a Swift plus Rust app repo whose CI would then run both suites.
Both `research-gorkhali-skills` and `project-gorkhali-teminal` are INTERNAL in the CloudZero org today, so this is not resolving a public/private conflict, it is preserving the option to open one of them later without the other blocking it.

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
| Merge rate | **99.1%** (111 merged, 1 closed, ZERO open), via `gh` ground truth — settled-only, which is what F12 made the miner's denominator too |
| Review cycles | median 2; 399 reviews, 482 comments total |
| `wall_time` coverage | 3/191 |
| Cost coverage | 21/191 |
| Greptile ran | 50/191 sessions |

Historical agent spawns at the time of measurement: engineer 1157, justice 464, steward 300, auditor 113, clerk 107, opposition 50, plan-checker 44, inspector 38, retired visual-agent role 18, advisor 14, detective 13, chief 0.

`wrap.json` carries 89 distinct top-level keys, and `pr.status` had 16 free-text variants.
That schema drift is WHY measurement never happened before this session, and it is precisely what B0 fixed.

Greptile at 50/191 means it was already de facto optional on the ship path, despite wrap then claiming it always runs (`wrap.md:103` at the time of measurement). P1 later aligned wrap with that fact: always invoke, capability-gate, skip without inventing a pass. See section 9.

Per F8 the two review rows above (review cycles, and the spawn ratio) describe the PRE-#109 pipeline and are superseded, not merely dated.
Their replacement is the `REVIEW FINDINGS` section of `scripts/baseline-report.js` (B9b), which measures precision per finding rather than cycles per PR.
Against the corpus as it stands that section reads **0 measurable findings**, because every reviewer artifact on disk predates B9 and carries no disposition.
That is the honest starting point of the re-baseline: the number is UNMEASURABLE, and it stays that way until the first post-B9 fix loop closes.

---

## 4. Corrections

Things believed before measurement that measurement disproved.
Recorded so nobody re-derives the wrong conclusion.

- **"Outcomes are not recorded" was WRONG.** 201 `wrap.json` files exist. The earlier count measured `~/.gorkhali/sessions/` instead of `~/.gorkhali/repos/<repo>/{sessions,completed}/<ticket>/`. Outcomes were captured but UNSCHEMATIZED.
- **"Routing policy is frequently not applied" was WRONG.** It was a reporting artifact that merged legacy records into an `inherited` bucket. Truth: `param` 997, `pinned` 626, `session` 441, and 1018 records predate the `modelSource` instrumentation entirely. Genuinely un-pinned spawns across all 12 gorkhali agents: 65. For engineer, 93.4% of attributable spawns carry an explicit model. **The Chief-picks-the-model rule IS being followed.**
- **"opposition and advisor are ceremony" was WRONG.** opposition 50 spawns, plan-checker 44, advisor 14. They are used. The only deletion candidates are `grill`, `health`, and the `eval` skill.
- **"fix_loops data is essentially absent (2/191)" was WRONG.** `verification.json` carries `review.fixLoops` in **120/191**, which is 63% coverage. It was in a different file, not missing.
- **There are 12 agents in `agents/`, not 13.** An earlier count included the `reference/` subdirectory.
- **`chief` at 0 spawns is CORRECT and is not a deletion signal.** Chief IS the main loop and is never spawned.

---

## 5. Open findings, not yet fixed

**F1. Two frontmatter drifts.**
`steward` and `clerk` are both `economy` (haiku) in `model-policy.json` but pinned `sonnet` in frontmatter.
clerk ran sonnet across all 107 spawns, so every spawn used the drifted value.
This is B1's concrete scope: two files.

**F2. `advisor` ran on `fable:4`** despite an explicit fable-deny in `hooks/engineer-model-gate.js`.
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

**F8. Section 3's review numbers describe a pipeline that no longer exists.**
The baseline was measured 2026-07-28.
`#109 refactor: simplify review and verification pipeline` landed 2026-08-11 and rewrote `agents/auditor.md`, `agents/justice.md`, `commands/review.md` and `commands/verify.md` together (246 insertions, 153 deletions), making Auditor the single default reviewer and Justice risk-triggered off verification's `requiredSpecialists`.
So the spawn ratio in section 3 — justice 464 against auditor 113, Justice running 4x the "one default reviewer" — is an artifact of the PRE-#109 architecture and must not be read as evidence about the current one.
Same for review cycles (median 2; 399 reviews, 482 comments): measured against a different pipeline.
Consequence: B9 is not merely additive instrumentation, it is a RE-baseline.
No review-quality claim may cite section 3's review numbers until B9 has re-measured post-#109, and `project-docs/review-research-2026.md` gap 11 (cross-file context is opt-in) rests on the stale ratio and must be re-derived rather than acted on.

**F9. Four severity vocabularies for one concept, and the canonical schema disagrees with the reviewer.**
`agents/auditor.md` uses `blocking`/`advisory`.
`agents/justice.md` uses `P0`/`P1`/`P2`.
`reference/temperature-review.md` uses `P0`-`P3`.
`reference/schemas/verification.md` uses `severity: "warn"`.
(An earlier draft of this finding counted `review.temperature` as a fifth vocabulary. It is not — see the correction below.)
Worse than the count: the SHAPES differ.
The canonical schema's `review.findings[]` is `{file, line, severity, message}`, while `auditor.json` findings are `{severity, file, line, evidence, impact, remediation}`, so the two cannot be read by one consumer.
And the schema's own worked example is `"Unused import"` — a lint nit that `agents/auditor.md` explicitly forbids reporting, because it is mechanically enforced elsewhere.
This is the F1/F5 pattern again: one value, N places, nothing enforcing agreement.
It is B10's concrete scope, and it is why B10 must land before B11 rather than after — B11 adds a `confidence` axis, and adding an axis to four disagreeing scales multiplies the drift instead of fixing it.
Note `temperature-review.md` now carries two unrelated jobs: it is the canonical home of `FIX_LOOP_CEILING` (live, referenced by `chief.md`, `contracts.md` and the verification schema) and of a severity table (superseded). Split them rather than deleting the file.

F9 as first written UNDERCOUNTS the drift. B9 found three more while building the `review` schema, all of them B10's scope:
- A THIRD finding shape for the same `auditor.json` path — `reference/temperature-review.md` instructs `{temperature, issue, fix}`, against auditor's `{severity, file, line, evidence, impact, remediation}` and the verification schema's `{file, line, severity, message}`.
- `agents/auditor.md` writes `observation_gaps`; `agents/justice.md` writes `observationGaps`. Same array, two spellings.
- `reference/schemas/_meta.md` says every artifact carries `_meta`; no reviewer artifact ever has. B9 validates `_meta` on `review` only when present, because requiring it would fail every `auditor.json` on disk. B10 decides whether reviewers start emitting it or `_meta.md` stops claiming universality.
The B9 `review` schema accepts all three finding shapes as legacy keys so that item could stay behaviour-neutral; B10 is what collapses them.

**F9 is CLOSED by B10.** Recorded here because the finding is the reason the fix has the shape it does:
the vocabulary is now DATA in `scripts/lib/review-standard.js`, the reviewer prose is GENERATED from it by `scripts/gen-review-standard.js`, and `--check` plus `test/review-standard.test.js` fail CI on a hand-edit.
A fifth prose restatement was the one solution guaranteed to drift again, which is the whole lesson of F1 and F5.
One correction to F9 as written: it calls `review.temperature` a fifth vocabulary for the same concept. It is not.
`review.temperature` is a 0-1 knob on how hard the reviewer LOOKS — an input — and `findings[].severity` is how a finding is scored once FOUND — an output.
They are orthogonal axes, both stay, and `reference/schemas/verification.md` now says so instead of leaving the overlap implied.

**F10. Section 3's baseline is not reproducible on the author's machine.**
A run on 2026-08-13 against `/Users/subash.karki/.gorkhali` reports **25** canonical wrap records, 24 distinct tickets, and 11 distinct PR urls.
Section 3 records 191, 152 and 112.
The miner resolved 24 canonical plus 1 unmapped repo path, so it is reading the canonical location and this is not the `~/.gorkhali/sessions/` mistake already corrected in section 4.
Either the corpus was pruned (`scripts/session-cleanup.js`, a data migration) or section 3 was measured against a data root that no longer exists.
Until that is explained, section 3's line "these are the starting numbers every future change is compared against" is FALSE — there is nothing to compare against, and no before/after claim may cite it.
Resolve this before B7/B8, which are gated on exactly that baseline.

**F11. Auditor ran on sonnet in 7 of 25 observed spawns despite an opus pin.**
The same run reports `auditor deep opus opus match` for policy-vs-frontmatter, and `opus:18 sonnet:7` for OBSERVED.
So the frontmatter drift check passes while 28% of the DEFAULT REVIEWER's actual spawns used the cheaper tier.
`engineer` shows the same shape worse (`sonnet:128 opus:23 haiku:12` against a sonnet pin), and `inspector` confirms F1 live (`haiku:21 sonnet:12`).
B1's "65-spawn un-pinned tail" is therefore not a tail for auditor — it is more than a quarter of its runs.
Consequence for W8: B11's precision gate would be comparing two different reviewers, not verified against unverified.
The gate must record the model per finding, or B1 must land first. This is a real confound, not a rounding error.

**F11's GATE half is FIXED; the model drift itself is NOT.** Read the two apart, because the green test says less than it looks like it does.

Fixed here, in two parts:
- The review artifact can now RECORD what it ran on: an OPTIONAL top-level `model` on `reference/schemas/review.md`, validated by `scripts/validate-artifact.js` and documented from `REVIEWER_MODEL` in `scripts/lib/review-standard.js`, so the reviewer prose is generated rather than restated.
  It is PER ARTIFACT, not per finding as F11 first wrote it: one review is one reviewer in one spawn, so every finding in a file shares its model and a per-finding copy would be the same value written N times with N chances to disagree.
  Optional, so no artifact on disk starts failing, and the field is content-free for B9 ids — `scripts/lib/review-finding.js` hashes `file + claim` only, asserted in `test/review-model-confound.test.js`.
  The prose forbids copying the value from a frontmatter pin: the pin is what was ASKED for, and F11 is precisely the case where it is not what ran.
- `precisionGate()` now REFUSES a confounded comparison. Unless both sides carry one and the same recorded model, the verdict is `unmeasurable` with `confound: "reviewer-model"`, the reason names which side ran what, and `scripts/baseline-report.js` adds a `review_model_confound` entry to `unresolved[]`. Mixed models, two different models, and an UNRECORDED model are all refusals — silence is never read as "one model". The check runs BEFORE the sample-size check, because a bigger sample cannot un-confound a comparison, and nothing is weighted, adjusted or estimated around the difference.
  A firing verdict now states the model it held constant (`both sides on opus`), so no verdict can be quoted without its control.

NOT fixed, and not this item's job:
- The drift itself — auditor pinned `opus` and running `opus:18 sonnet:7`, engineer `sonnet:128 opus:23 haiku:12`, inspector `haiku:21 sonnet:12` — is **B1**. The gate is now honest about the confound; it does not remove it.
- Nothing WRITES `model` yet. The honest source is the instrumentation that already knows the effective model (`hooks/timing-capture.js` resolves param > frontmatter pin > session-inherited), not the reviewer's self-report, which would just restate the pin. Until a writer lands, every corpus reads `model` unrecorded and the gate refuses — which is the intended state, not a regression.
- The frontmatter-vs-policy drift row still prints `match` for auditor. It compares the pin against the policy, and neither one is what ran; the OBSERVED column beside it is the real signal (B1).

See `project-docs/seat-provenance-design.md` for the v1 capture/tier design implementing this item, including a correction to the OBSERVED-column claim above: that column is REQUESTED-tier data from `hooks/timing-capture.js`, not served-model proof.

**F12. Merge rate counts a still-open PR as not-merged.**
`scripts/baseline-report.js:1068` computes `mergeRate = merged / ghResolved`, and `ghResolved` includes open PRs.
The 2026-08-13 run reports merged 9, open 2, closed 0 over 11 resolved — printed as 81.8%.
Excluding the 2 unfinished PRs it is 9/9.
Section 3's 99.1% had 111 merged and 1 closed with zero open, so the two numbers are not comparable and the apparent drop from 99.1% to 81.8% is mostly definitional.
Either exclude open PRs from the denominator or report merge rate over closed PRs only, with open counted separately.

**F12 is FIXED.** The denominator is SETTLED PRs only — `merged + closed`:
- `prs.mergeRate` is `merged/(merged+closed)`; `prs.settledPrs` and `prs.unfinishedPrs` are reported beside it, and the human table prints a `settled / unfinished` row. Open and draft are counted and shown, never in the denominator: an unfinished PR has not failed to merge.
- `mergeRateBasis` now states the division literally — `merged/(merged+closed) = 9/9 settled distinct PR url(s), gh ground truth over 11 resolved; 2 unfinished (open 2, draft 0) EXCLUDED from the denominator - an unfinished PR is not a failed one` — and says `0 open and 0 draft, so settled = every resolved PR` when there is nothing to exclude. That last clause is what makes section 3's 99.1% (111 merged + 1 closed, zero open) comparable to any later run at all: the two figures divided by the same thing only when the basis says so.
- With nothing settled, the rate is `null` and prints `absent`, with a basis reading `UNMEASURABLE: 0 settled PRs (merged+closed) among N resolved` — never 0%, never 100%. Both exclusions add a `merge_rate` entry to `unresolved[]`.
- `test/baseline-merge-rate.test.js` runs the production miner against a fake `gh` and pins the real shape: 9 merged + 2 open reads 100.0%, not 81.8%.

Still open after this: section 3's numbers remain unreproducible per F10, so the corrected rate has nothing to be compared against yet. Fixing the denominator does not resolve F10.

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
Non-gorkhali agent types (`general-purpose`, `Explore`, `coder`) moved out of the policy-drift table, because they have no policy row and no pin by design.

**A1 - unattended spend cap plus stuck detection.**
`hooks/loop-controller.js` gains `unattendedHalt()` and `HALT_STATES`; `SPEND_CEILING_USD` defaults to $5 with env override; `scripts/run-guard.js` added.
Verified behavior: interactive never halts, confirmed overage halts, unknown spend does NOT halt, a repeated failure class halts as stuck.
**Honest limitation, recorded in the code and repeated here: this is a ceiling on OBSERVED spend, not a hard guarantee.**
A run with a missing cost ledger is uncapped, and `run-guard` says so out loud.

**B9b - per-finding table in the baseline miner.**
`scripts/baseline-report.js` gains a `REVIEW FINDINGS` section: one row per finding id with its `fixed`/`dismissed`/`deferred` column, plus precision broken out per severity, per agent, and per dimension.
Precision is reported as a BAND, not a point — `fixed/(fixed+dismissed+deferred)` as the lower bound and `fixed/(fixed+dismissed)` as the upper — because a `deferred` finding is neither a confirmed true positive nor a confirmed false one.
Per F8 this is a re-baseline: a finding with no recorded disposition is counted as unmeasurable and never enters a denominator, an empty measurable set prints `UNMEASURABLE` rather than 0% or 100%, and the miner never calls `closeFixLoop()` (which would default every open pre-B9 finding to `deferred` and manufacture the data whose absence is the finding).
Two structural exclusions, both counted and reported rather than silent: a finding with no disposition, and a `preExisting` finding, which B10 defers BY RULE because it never entered the fix loop — counting it would measure the rule, not the review.
Severity is folded onto B10's one scale by READING `scripts/lib/review-standard.js` (a legacy `P0` and a canonical `blocking` are one table row, not two), while each finding row keeps the raw spelling that is actually on disk.
Per-dimension precision reports absent today: no finding schema field carries a dimension, and `agents/justice.md` names its five only in its chat format. That is B10's remaining gap.

**B10 - Auditor finding schema + review standard.**
Six changes landed as one pass, all of them prompts, schema and thresholds — no new agent.
(a) A behavioural claim must cite `file:line` in source. Made mechanical rather than advised: `scripts/validate-artifact.js` REJECTS a `blocking` finding that names a file and no line. An inference from a symbol's name has no line to cite, which is the point.
(b) `preExisting: true` marks a real defect the diff did not introduce. `preExisting` with `blocking` is rejected outright, `hooks/loop-controller.js` `fixLoopFindings()` never hands one to a fix agent, and `closeFixLoop()` closes it `deferred` — never `fixed`, not even when the loop touched its file, because counting it would inflate the precision number B9 exists to measure honestly.
(c) `blocking` requires the diff to make something WORSE than before or to fail the stated intent. Stated once, in data, and rendered into every reviewer prompt from there.
(d) Six named security categories anchored to OWASP Top 10:2025 — broken access control incl. SSRF, injection, cryptographic failures, secrets in code/config/logs, unsafe defaults, data exposure — replacing the bare word "security".
(e) The F9 collapse (below).
(f) `scripts/review-gaps.js` + `scripts/lib/test-companion.js`: changed source files with no correspondingly changed test file, derived from the changed-file list by stem match. Replaces "missing focused tests for non-trivial logic", which was the right intent stated unfalsifiably — nobody could audit whether a reviewer honoured it. Reports, never gates: exit 0 with gaps, because a missing test cannot clear the blocking bar.

**The scale is `blocking`/`advisory`. The shape is Auditor's.**
Chosen for a behavioural reason, not an aesthetic one: every live consumer already collapsed its scale to a binary before acting (Justice triaged P0/P1 -> FIX and P2 -> SKIP; the temperature table fixed P0/P1 and DROPPED P2/P3 unreported), so the extra levels carried no decision — only four spellings of one. Picking what the default reviewer already writes means the corpus needs no rewrite, and because the B9 id excludes `severity` and hashes `file || component` plus the first present claim key, normalization is provably id-preserving; `test/review-standard.test.js` asserts it per legacy shape.

**Drift-proofing, which is the actual deliverable.**
`scripts/lib/review-standard.js` is the source of truth; `scripts/gen-review-standard.js` renders the severity table, reporting rules, security checklist and canonical shape into `agents/auditor.md`, `agents/justice.md`, `reference/agent-protocols/justice-protocol.md` and `reference/temperature-review.md`; `--check` exits 2 on drift; `test/review-standard.test.js` runs it and additionally fails on any line in `agents/`, `commands/` or `reference/` that speaks P0-P3 as a LIVE vocabulary rather than a retired one. The same source of truth feeds `SCHEMAS` in `validate-artifact.js`, so `reference/schemas/review.md` inherits it through `gen-schema-docs.js --check`.

**Backward compatibility.** Nothing on disk fails. Legacy severities normalize (`P0`/`P1` -> `blocking`, `P2`/`P3`/`warn` -> `advisory`) and legacy keys fold (`temperature`->`severity`, `component`->`file`, `issue`/`message`/`description`->`evidence`, `fix`->`remediation`, `observation_gaps`->`observationGaps`). `scripts/migrate-review-findings.js` rewrites an artifact into the canonical shape for a human who wants to read the corpus, and REFUSES to write any file where a finding id would move.

**The `_meta` divergence F9 named is DECIDED: `_meta.md` stops claiming universality.**
Reviewer artifacts are the one documented exception, and `reference/schemas/_meta.md` now says so with the reason. A reviewer is a SUBAGENT: `phase`, `skill` and `version` describe the session that spawned it, so a reviewer filling them in is guessing at values it does not own, and a guessed provenance header is worse than an absent one because it looks like evidence. The binding `_meta` would provide is already provided, more strongly, by the portable lifecycle's worktree fingerprint. The alternative — make every reviewer emit it — would have failed every artifact on disk for zero information gained.

**`FIX_LOOP_CEILING` is split out, not deleted.**
`reference/fix-loop.md` is the new canonical home of the ceiling and the auto-address loop; `reference/temperature-review.md` keeps its filename (live references point at it) and now owns severity and the review prompt only. `agents/chief.md`, `reference/contracts.md` and `reference/schemas/verification.md` point at the new file, and `test/ceiling-prose.test.js` pins that exactly one of the two documents states the number.

**One more F9 item cleared in passing:** the verification schema's worked example was `{"severity": "warn", "message": "Unused import"}` — a fifth severity spelling attached to a lint nit `agents/auditor.md` explicitly forbids reporting. It is now a finding a reviewer is actually allowed to report.

**Closed B9b's stated gap.** `findings[].dimension` is now an optional, CLOSED field carrying Justice's five dimensions, so the miner's per-dimension precision has a field to read instead of a chat format to guess at.

**B11 - verification pass before findings land.**
Three parts, all of them in the B10 source of truth rather than in a fifth prose restatement.

*(a) The pass, and the thing it must not become.*
`VERIFICATION_PASS` in `scripts/lib/review-standard.js` is an ordered, source-side procedure rendered into `agents/auditor.md`, `agents/justice.md` and `reference/temperature-review.md`: RE-OPEN the cited file at the cited line now, READ the enclosing definition and the callers, QUOTE what you read into `evidence`, DECIDE against the source, DISCARD what it does not support into `discardedFindings` with a reason.
Every step names a source-side action on purpose. "Verify your findings" degrades into re-reading the findings, and §1.5 is explicit that same-context self-critique produces FALSE NEGATIVES on the model's own output while independent re-checking against the code is what cuts false positives — so the prose states the anti-pattern as an anti-pattern ("if your check did not involve opening a file, it did not happen"), and `test/review-verification.test.js` fails if that sentence or the reason behind it is edited out.
Discards are RECORDED, not deleted: `discardedFindings[].reason` is required and rejected when empty, because a dropped false positive is the evidence the pass ran.
Ordering was the one real conflict: Auditor's Artifact First says write early. The pass is the last step of INVESTIGATING, before the first write, and `auditor.md` now says so where both rules meet.

*(b) `confidence` as a second axis, kept mechanically apart from severity.*
`confirmed` / `possible` / `needs-verification`, optional and closed. Orthogonality is not asserted in prose, it is enumerable: the two vocabularies are disjoint, `normalizeSeverity` rejects every confidence value and `normalizeConfidence` every severity, no validator rule couples them, and the test walks all SIX combinations through the real CLI and watches each validate — `blocking`+`possible` (an unsure bug stays blocking) and `advisory`+`confirmed` (a certain nit stays advisory) included.
F9's correction is the precedent and is now rendered as data: `REVIEW_AXES` names strictness (`review.temperature`, an input), severity and confidence (outputs) side by side, so the conflation that happened once cannot be re-derived by guesswork.
`needs-verification` requires a matching `observationGaps` entry — otherwise it is a label for "I did not check", which is the false positive the pass exists to remove wearing a badge.
Absent `confidence` means UNVERIFIED, never confirmed: nothing on disk fails, and adding the key does not move a B9 id (asserted).

*(c) The promote/revert gate, built and honestly inert.*
`precisionGate()` compares the precision BAND of findings carrying a recorded `confidence` against the band of findings carrying none — the two populations that actually exist on disk — and `scripts/baseline-report.js` prints both sides, the input, the verdict and the reason under `VERIFICATION GATE (B11)`.
**It cannot fire today and says so in two independent ways.** The corpus is 0/0 measurable (B9b), and `minSample` is deliberately `null` with the reason recorded in the code: no sample size can be chosen from data that does not exist yet, and none is invented here.
The comparison is band-against-band rather than point-against-threshold precisely so no margin has to be guessed: promote needs the verified LOWER bound entirely above the unverified UPPER, revert the mirror, overlap is `inconclusive`. A `deferred`-only side has no upper bound and is read at its most permissive, which makes both verdicts harder rather than easier.
A THIRD refusal was added after F11 measured the confound: unless both sides carry one and the same recorded reviewer `model`, the verdict is `unmeasurable` with `confound: "reviewer-model"` and a `review_model_confound` entry in `unresolved[]`. Unrecorded counts as confounded, and the check runs before the sample-size check because more data cannot un-confound a comparison between two different reviewers. See F11 in section 5 for what that does and does not fix.

**B12 - re-review convergence.**
On round 2 and later, only `blocking` findings are itemized; non-blocking ones are reported as a count split into carried-over and first-seen-this-round.

**The design problem was the deliberate delete.** `commands/review.md` step 4 deletes `{SESSION_DIR}/reviews/auditor.json` before every pass so a truncated run cannot reuse a stale verdict. That stays. So the prior round's ids live in a SIBLING file, `{SESSION_DIR}/reviews/rounds.json`, owned by `scripts/review-round.js`.
The ledger is built so it cannot become a second way to resurrect a verdict: it carries ids, severities, files and a `blocking` flag, and NOTHING verdict-shaped — no `verdict` key, no top-level `findings` array a reader (or the baseline miner's shape check) could mistake for a review. There is no stale verdict in it TO reuse. Rounds are appended only after a valid artifact is read, so a truncated pass records nothing and the next pass is still the same round — the delete's freshness property extended to the round counter rather than punctured by it.
A NEW blocking finding in round 2 is always reported: the fix may have broken something and catching that is what a re-review is for. Carry-over is decided by the B9 content id, so a finding that merely moved lines or was re-scored is still the same finding.
One reading settled explicitly: the artifact stays COMPLETE. Suppression governs what a round SAYS, not what it writes — removing findings from the file would break the ids the suppression is counted with and would hide them from the B9b precision miner.

**Version manifest sync to 0.2.7.**
Test suite green at 658 pass, 0 fail, 1 skipped (982 pass / 1 known unrelated fail / 1 skipped after B11+B12).

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

What: generate the `model:` frontmatter line in every `agents/*.md` from `model-policy.json` via `resolve-profile.mjs`; add a CI drift test; add the D3 Chief risk signal; resolve the steward and clerk drifts (F1) as one recorded decision; tighten the 65-spawn un-pinned tail.
Why: kills four restatements of policy and one live drift, and makes any future model migration a one-line policy edit.
Test: change clerk to `balanced` in `model-policy.json`, run the generator, and watch `git diff` show exactly one frontmatter line change; then hand-edit `agents/clerk.md`'s model line and watch CI go red naming that file.

### B3 - Memory decay + validation accounting. 3d.

What: `memory-reader.js:78` ranks `[failed]` at priority 0, ABOVE `[validated:N]` at 2-3, and nothing expires them, so the injection budget (top 5 entries, 1600 chars) is spent on the oldest one-off mistakes forever.
Add injection logging, decay `[failed]` past 60 days, and give `validated:N` an automatic increment path.
Today `validated:N` only moves when something manually says so, which is why nothing graduates.
Why: without the logging, recall precision stays unmeasurable forever; without the decay, the priority inversion permanently crowds out validated patterns.
Test: submit a prompt that matches a 60-day-old `[failed]` entry and watch the `<!-- memory-injection -->` block come back without it; then open the injection log and see the entry ids that WERE injected for that prompt.

### A2 - AC-triage eval cases. 1d.

What: eval coverage for the AC-solidity rubric at `commands/loop.md:48-55`.
Why: that rubric is an unmeasured LLM classifier deciding whether it is safe to auto-implement a ticket with no human present, and it has ZERO eval coverage today.
Test: run the eval suite and watch new AC-triage cases appear with pass/fail verdicts; hand a deliberately vague ticket body to `/gorkhali:loop --status` and watch it print WEAK.

### B7/B8 - Doctrine dedup + approved deletions. 5d.

What: dedup role/routing/workflow doctrine onto `skills/gorkhali/references/` as canonical; execute the D4 deletions; fold the ponytail ladder into `steward`/`auditor` prose; archive `docs/team-skill-improvement-plan.md` plus the dated research notes and one-off HTML; remove the repo-root orphans.
Why: per F4 this is now a COST item, not tidiness, because prompt overhead dominates per-call cost across 3088 lifetime spawns.
Test: start a fresh session and watch the skill list come back with three fewer entries; run the same trivial task before and after and watch the reported cost drop.

### T1 - Tracker abstraction. 3d.

See section 8 for the full design.
Test: with `tracker: file`, add an unchecked line to `.gorkhali/backlog.md`, run `/gorkhali:loop --status`, and watch that line appear in the triage table with no network call and no auth prompt.

### T3 - gorkhali-doctor. 2d.

What: one command that reports trigger collisions, hook conflicts, degraded capabilities, and unresolvable profiles.
Why: it is the diagnostic surface for everything C1, B1, and the Tier rules make conditional, and it is the thing that becomes a Terminal panel (section 10).
Test: deliberately break `hooks.json` registration for one hook, run the doctor, and watch it name that hook as unregistered.

### T2 - gorkhali-setup + Terminal bundling. 3d.

What: a setup path that writes the C1 config and reports what it detected; Terminal ships this repo as a version-pinned plugin.
Why: the app already writes shims to `~/.gorkhali-terminal/bin/`, so the install path is the same shape of work.
Lands AFTER B7/B8, because bundling multiplies the audience for whatever quality currently exists.
Test: on a clean machine with no `~/.gorkhali`, run setup and watch it print each detected capability, then run `/gorkhali:status` successfully without editing a file by hand.

### T5 - Dev-link for local skill edits. 0.5d.

What: a symlink or env var (`GORKHALI_SKILLS_DEV_PATH`) that makes Terminal's vendored skills bundle resolve to this repo's working tree instead of the pinned build artifact.
Why: D6 settles the bundling shape as vendor-plus-dev-link; without this half, Subash is back to hand-copying files between two clones on every skill edit.
Test: set the dev-link, edit one skill's `SKILL.md` in this repo, and watch Gorkhali Terminal pick up the edited text on next invocation with no build or publish step run.
Depends on T2.

### B9 - Review finding disposition. 1d.

What: give every reviewer finding a stable id, and record its disposition (`fixed` / `dismissed` / `deferred`) when the fix loop closes.
Extends B2 to cover review quality, which B2 does not cover today.
Deliberately ships NO change to what reviewers report — the id and the disposition ride alongside current behavior so the baseline measures the pipeline as it stands.
Per F8 this is a re-baseline, not an addition: section 3's review numbers predate #109.
Why: review effectiveness is unmeasured, and B2 gates B7/B8 and T4 on exactly that class of claim.
The data path is already half-built — `verification.json` carries `review.fixLoops` in 120/191 (63%) — what is missing is attributing an outcome to an INDIVIDUAL finding rather than to the review as a whole.
Martian's Code Review Bench supplies a true-positive definition that needs no human labelling: a finding counts as a true positive if the code changed after it.
Without this, every threshold in B10 and B11 is set by taste, and D4's "no untested behavior change to trigger routing" rule forbids setting them that way.
Test: run `/gorkhali:review` on a diff with a known defect, apply the fix, then run the baseline miner and watch a per-finding table print one row per finding id with a `fixed`/`dismissed`/`deferred` column; hand-dismiss a finding and watch that row flip to `dismissed` without the review being re-run.

### B10 - Auditor finding schema + review standard. 2d. DONE - see section 6.

What: four changes to `agents/auditor.md` and the finding schema, landed as one pass.
(a) A behavioral claim must cite `file:line` in source; an inference from a symbol's name is not evidence.
(b) `preExisting: true` for a real defect the diff did not introduce — it reports, never blocks, never enters a fix loop.
(c) `blocking` requires the diff to make something WORSE than before, or to fail the stated intent; a change that improves a bad file is not held to a standard the surrounding code never met.
(d) Name the security categories — broken access control including SSRF, injection, cryptographic failures, secrets in code/config/logs, unsafe defaults, data exposure — instead of the single word "security".
(e) Per F9, collapse the four severity vocabularies and two finding shapes onto one scale and one shape, fix the schema's `"Unused import"` example to something Auditor is actually allowed to report, and split `FIX_LOOP_CEILING` out of `reference/temperature-review.md` from the superseded severity table.
(f) Add the one mechanically checkable test heuristic from the source article: flag source files changed by the diff with no corresponding change to their tests.
Auditor priority 3 already asks for "missing focused tests for non-trivial logic", which is the same intent stated unfalsifiably; this version is derivable from the changed-file list.
Why: (a) and (d) are the cheapest precision and blind-spot fixes available; the secure-review literature finds reviewers systematically under-discuss the weakness classes behind real CVEs, which a named checklist corrects and a generic instruction does not.
(b) and (c) are one change seen from two sides: today a genuine defect the diff merely touches must either block an unrelated ship or be discarded, and both are wrong.
Land with B7/B8, which already edits auditor prose — two passes over the same file is the thing B7 exists to stop.
Test: hand Auditor a diff touching a file with a pre-existing null-deref it does not introduce, and watch the finding return `preExisting: true` with the review verdict still `pass`; then hand it a finding whose only support is a function's name and watch it not appear at all.
Landed as two mechanical tests rather than one prompt trial, because a prompt trial is not a regression test: `preExisting: true` alongside `blocking` is REJECTED by the validator and the fix loop never receives such a finding, and a `blocking` finding with no cited line is REJECTED - a name-only claim has no line to cite.

### B11 - Verification pass before findings land. 2d. DONE - see section 6.

What: a bounded step between finding and artifact — re-read each cited `file:line`, confirm the claimed behavior is actually present, discard what cannot be confirmed — plus a `confidence` field (`confirmed` / `possible` / `needs-verification`) orthogonal to severity.
Promote or revert on measured precision against the B9 baseline, the way B6 does on wall-clock.
Why: this is the largest false-positive lever in the literature and Anthropic's own Code Review runs it as a distinct pipeline stage.
Published first-line FP rates span 8-54%, which is far too wide to guess where Gorkhali sits — hence B9 first.
The mechanism matters and is easy to get wrong: this must be independent re-checking AGAINST THE CODE, not same-context self-critique, which is shown to produce false negatives on the model's own output.
Severity and confidence must stay separate axes; today `blocking`/`advisory` encodes only importance, so an author cannot tell a confident nit from an unsure bug and skims both.
Test: replay a recorded review that produced a known false positive and watch the finding dropped with its reason recorded; then run the baseline miner and watch review precision print before and after with a promote or revert verdict.

### B12 - Re-review convergence. 0.5d. DONE - see section 6.

What: on the second and later pass over the same worktree, Auditor reports blocking findings only; non-blocking findings that did not appear in round 1 are suppressed and reported as a count.
Requires B9's stable finding ids to tell a carried-over finding from a newly invented one.
Why: `FIX_LOOP_CEILING` is 2 (`scripts/lib/constants.js:25`), so the loop is already bounded — but the ceiling only stops the churn, it does not prevent it.
Today nothing stops round 2 from surfacing a fresh crop of advisories that round 1 never mentioned, on a diff that only changed by the fix round 1 asked for, and hitting the ceiling escalates to the user, which converts reviewer noise into an interrupt.
Test: run a review that returns one blocking and two advisory findings, fix only the blocking one, re-run, and watch round 2 report the remaining advisories by count without adding new ones.

### B13 - Structured PR body. 0.5d.

What: a fixed template for the PR body Clerk writes — goal, approach, risk, verification evidence, what to look at first.
Why: the MSR 2026 study of ~13k agent-authored PRs (including Claude Code) found more structured descriptions correlate with faster reviewer response and shorter completion time, and DORA 2026 puts median time in PR review up 441% — human review latency is the measured bottleneck.
This is the only item in the W8 set that improves HUMAN review rather than machine review, and Gorkhali produces exactly the kind of PR the study measured.
Test: run `/gorkhali:wrap` on a session and watch the created PR body come back with all five sections populated from session artifacts rather than free prose.

**Deferred from the same research, deliberately — then P1 pulled one cheap item forward.**
`REVIEW.md` is no longer waiting on T4. P1 added a read of `REVIEW.md` / `.github/REVIEW.md` on the pr-review and Auditor paths when the file exists. That is not Anthropic managed-product interop and is not skip-rule tuning; those still belong with T4.
Diff-size policy, widening Justice cross-file context, and a low-risk fast path remain THRESHOLD decisions; B9's data settles them, and picking numbers before that data exists is the error D4 and B6 both exist to prevent.

### P1 - Phase-judgment product packaging. 1d. DONE this session.

What: five product-facing fixes after a 2026-08-26 judgment of brainstorm, planning, wrap-time review, and skill-book PR review. Not a reopen of B9–B13.

1. One-page map of the four review surfaces (Auditor, Justice, wrap→greploop, pr-review) on the gorkhali, wrap, review, and pr-review intros so users pick a *decision*, not four interchangeable commands.
2. pr-review as the skill-book product: five-line human checklist, intent sources `ticket` | `issue` | `pr-body` (`inferred` illegal), `REVIEW.md` when present, advisory / no-post / no-gate.
3. Brainstorm v3 requires `decision.nonGoals` + `decision.successSignal`; `--simple` (and the clearer path) skips HTML; council/HTML stay FULL.
4. Depth-gated `crossCutting` on standard/deep plans (security, privacy, observability, rollout, docs); write `oppositionVerdict` (legacy `devilsAdvocateVerdict` still read); `contract` is an optional projection of an approved plan, not a fifth source of truth.
5. Wrap hygiene: defense-brief does not default to stale `review-panel.json` / RPSL; wrap always *invokes* greploop (tests + sole writer of `greptile.status`) and greploop capability-gates itself; LITE/DIRECT wrap tells the user to run verify first because wrap does not run Auditor.

Why: users pick a decision. Four review surfaces, a design-doc-shaped brainstorm/plan, and wrap ceremony were the packaging gap; the precision work (B9–B13) already shipped.
Test: `node --test test/review-surfaces.test.js test/decision-first-output.test.js test/decision-contract-parity.test.js test/wrap-greploop-watch.test.js test/wrap-defense-brief.test.js`. Do not quote eval percentages or pre-#109 spawn ratios in user-facing copy.

What this is not: a reviewer agent, numeric maintainability scores, low-risk auto-approve, Justice widening, council-by-default, mandatory HTML on simple brainstorms, mandatory RPSL on wrap.

### B4 - Codex CLI hook adapter. 3d.

What: per `agnostic-improvement-research.md` section 7 B4.
Why: takes mechanical enforcement, the differentiating feature, to the second runtime target and validates D1 cheaply.
Test: on Codex CLI in a gorkhali-known repo with no active session and `GORKHALI_ROUTING_ENFORCE=1`, attempt a file edit and watch the ROUTING GATE denial appear.

### T4 - De-CloudZero + license + CONTRIBUTING. 2d.

What: remove CloudZero-specific defaults and references; add a license and CONTRIBUTING; rename `greploop` to `gorkhali:reviewloop` (section 9).
Why: D5 publication prerequisite.
Test: `grep -ri cloudzero` over the shipped plugin directories returns nothing, and a fresh clone's README walks a stranger to a first `/gorkhali:status`.

### B5 - Per-role cost attribution. 1d.

What: per-role cost per ticket in the wrap output.
Partly collapses into B0b, since the timing data it needs already exists and is already read.
Test: run `/gorkhali:wrap` and watch a per-role cost table print (`engineer: $X, auditor: $Y, inspector: $Z`) whose rows sum to the existing Total line.

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

### E4 - Roster-degradation drill. 2d.

What: a `GORKHALI_POOL_DROP`-style test mode that makes one named model or agent unavailable, then runs each route (`direct`, `plan`, `brainstorm`, `full`) against the degraded roster and asserts every run either completes or pauses honestly — never a silent fallback, never a fabricated result.
Why: the Conductor trains against randomized k-of-n agent pools precisely because a policy tuned to one fixed roster breaks the day a worker is missing (the Conductor paper, arXiv 2512.04388); Gorkhali's routing is deterministic but has never been PROVEN to degrade honestly, only assumed to.
Test: set the drop flag for one implementer model, run a ticket through each route, and watch every session end in either a completed state or a pause record naming the unavailable roster member as the reason — with zero runs that report success while the dropped model's work is absent.

### E5 - Verifier-first escalation for direct routes. 2d.

What: on a `direct`-route ticket, run deterministic verification (lint, build, focused tests) BEFORE any planning overhead, and escalate to the `plan` route only when verification surfaces breadth the router did not see; the escalation is recorded, never silent.
Why: effort should scale with difficulty decided per request, and the cheapest honest difficulty probe Gorkhali owns is its existing mechanical verification, not more up-front classification (the Conductor paper, arXiv 2512.04388, adapts effort to difficulty per request); depends on the route field this PR adds to `outcome.json`, because an escalation that is not recorded cannot be scored.
Test: hand a direct-route ticket whose fix actually spans multiple files, and watch verification fail, the session escalate to `plan` with the escalation reason recorded, and the outcome record carry both the original and the escalated route; hand a genuinely trivial ticket and watch it ship with no plan artifact ever created.

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
| `file` | unchecked items in `.gorkhali/backlog.md` | check the box |
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

**P1 landed the wrap.md "always runs" fix.** Wrap still always *invokes* greploop (the Stop hook and wrap tests require a single writer of `greptile.status`). Greploop probes `review.external` (`node scripts/gorkhali-config.js get review.external --repo <workspace> --json`). If the value is `none`, or the key is unset and no Greptile check-run exists, it writes `greptile.status: skipped` and stops. Bot auto-fix only unless `--fix-humans`; `--no-fix` skips all edits.

Still open from this section:

- `hooks/greploop-gate.js` still fail-opens and still PREFIX-matches freeform `greptile.status` (same fragility class as the 16 historical `pr.status` variants). Canonical writes are `pending | done | skipped`; the gate still allows unknown settled values.
- Close the enum in the validator (`pending | done | skipped`, plus a documented unavailable/not-configured alias if you need it) so wrap.json cannot accumulate a fourth freeform dialect.
- Rename to `gorkhali:reviewloop` at T4; `greploop` is vendor-branded, which is odd for a public repo.
- A `coderabbit` key already appears in one historical `wrap.json`, so per ponytail rung 1, gate now with a closed enum and add provider adapters only when a second provider is actually needed.

**Standing principle: the ship path must never hard-depend on a paid third-party SaaS.**
This covers Greptile, Jira, and whatever comes next. P1 honors it by skipping, not by pretending a pass.

---

## 10. Skill tiers

| Tier | Requires | Skills |
|---|---|---|
| 1 core | git plus a runtime | start, execute, verify, fix, review, scout, detective, learn, pause, resume, status |
| 2 git-host | `gh` or equivalent | wrap PR creation, close, pr-review |
| 3 vendor-optional | greptile, jira, figma, sentry | greploop, loop, visual |

Rule: **a Tier 3 skill whose capability is absent must not be ADVERTISED.**
A skill in the list that does not work is worse than one that is not there, and it burns trigger-disambiguation prose in every session for a feature the user cannot use.

---

## 11. Gorkhali Terminal integration

Three layers.

1. **Bundling.** Terminal ships this repo as a version-pinned plugin. The app already writes shims to `~/.gorkhali-terminal/bin/`, so the install path is the same shape of work.
   Bundling is settled as vendor-plus-dev-link, not a monorepo merge; see D6 (T2 for the vendored path, T5 for the dev-link).
   Terminal-side integration points for whoever picks this up: `daemon/src/sessions.rs`, `daemon/src/bin/gorkhali-claude.rs`, `app/Sources/GorkhaliApp/GhosttyTerminalSurface.swift` (all verified in `project-gorkhali-teminal`).
2. **The doctor as UI.** `gorkhali-doctor` output is better as a Terminal panel than as terminal text: trigger collisions, hook conflicts, degraded capabilities, and unresolvable profiles as a clickable checklist. No CLI-only peer can do this. It is what makes bundling more than convenience.
3. **Terminal owns the durable record.** `gorkhalid` already has SQLite with 60 tables and an event journal. The reason `wrap.json` accumulated 89 ad-hoc keys is that the skills layer's persistence is unstructured files an LLM writes freehand.

**The governing pattern: the portable artifact is the CONTRACT, the daemon is an OPTIONAL CONSUMER.**
Never the reverse, or the open-source version becomes the degraded one.
B0 already follows this: the skill writes portable JSON, Terminal ingests it when present.

Bundling lands AFTER the internal quality bar (after B7/B8), because bundling multiplies the audience for whatever quality currently exists.

---

## 12. Not doing

Each with the condition that would revive it.

**The native Rust AI harness.**
SHELVE the `feat/gorkhali-native-ai-harness` branch: roughly 62k inserted lines, cannot make an HTTPS call, no Swift integration, `db.rs` at 31k lines.
Do not delete it.
Revive only if measurement shows the external harness is the actual bottleneck.
The two genuine justifications, if it ever returns, are that a deterministic repo index only pays off if you control context assembly, and that replay-based routing calibration needs bounded assignments you can re-execute.
Note that `docs/research/gorkhali-harness-build-plan.md` is a COST QUOTE for this path, not a plan to execute.

**Full N-runtime agnosticism beyond Claude Code and Codex.**
Revives when a specific runtime both ships blocking hooks plus model-pinned subagents AND becomes a runtime someone on the team uses daily.

**MCP-server-owned enforcement.**
It cannot prevent native-tool bypass.
Revives if MCP gains a standardized interception layer for host tool calls.

**Porting `wake-classifier.js`'s payload parsing.**
Reverse-engineered, short half-life.
Port only the pure `classify()`.

**Numeric maintainability scoring on reviews.**
The 1-10 per-dimension scoring in the source article's maintainability prompt (readability, complexity, dependency risk, change isolation) is REJECTED.
`reference/temperature-review.md` already drops P2/P3 outright, and the false-positive literature says the win is fewer, better-verified findings — a score turns every review into four numbers nobody acts on, which is volume without a decision attached.
Revives only if B9's disposition data shows maintainability findings being ACTED ON at a rate comparable to correctness findings, which would mean the P2/P3 drop is throwing away value.
P1 reconfirmed this: do not add a reviewer agent, numeric scores, or a low-risk auto-approve path.

**Council-by-default and mandatory HTML on simple brainstorms.**
Rejected in P1. `--simple` and the clearer path stay chat Pick A/B/C. FULL keeps council/HTML.
Revives only if measured sessions show users asking for the HTML that `--simple` skipped, not because a design-doc template exists.

**Mandatory RPSL / review-panel on wrap.**
Rejected in P1. Defense-brief sources that were not produced this session stay `None flagged this session`. `--deep-review` is the opt-in.
Revives only if wrap-time humans actually used those sections enough to measure, which they have not.

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

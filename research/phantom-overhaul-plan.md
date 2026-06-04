# Phantom Overhaul Plan — "The Spine" (v2, post-deliberation)

Author: Subash Karki
Date: 2026-06-03
Status: REVISED after Rival + plan-checker challenge — pending human gate
Basis: `research/phantom-upgrade-from-harness-research.md`

---

## Deliberation outcome (read this first)

v1 proposed a 5-phase Spine. **Rival** (strategy) and **plan-checker** (execution)
independently shredded ~80% of it. Verdict: **the v1 plan violated Phantom's own "Less
is More" principle** — it coded theoretical failures with no evidence any prose gate
ever failed in a real session. The research agents were primed to find things to steal,
so they did. Two factual errors surfaced:

1. **The bug map was wrong.** `reference/router.md` does NOT say "max 3" (it has no
   loop constant). The fix-loop ceiling lives in **~15 places across 4 dirs**, and there
   are plausibly **two different loops** (max-2 review vs max-3 fix), not one drifted
   constant. v1's Phase 0a under-scoped by ~7×.
2. **Phase 2's target is dead code.** `hooks/hook-router.js` is invoked by nothing; the
   live dispatcher is `hooks/hooks.json` (calls scripts directly). The onion refactor is
   a no-op until `hooks.json` is rewired through the router — and that rewire (funneling
   all 5 hook events through one dispatcher that halts on first non-zero exit) is the
   real, dangerous, unscoped work. **Phase 2 = RED.**

This v2 keeps only what's evidence-backed and adds the override Rival demanded.

---

## Thesis (unchanged, but disciplined)

Code only the enumerable decisions that have *demonstrated* pain. Keep everything else
in Markdown. **No framework. No new runtime. Zero-infra plugin preserved.** The closing
line of the research is now the governing rule: *ship the earned fix, let real session
failures pull the rest into code.*

---

## APPROVE NOW (evidence-backed, small, safe)

### Step 1 — Settle the loop semantics (5-min human decision, blocks everything)
Before any code: decide whether **"max 2 review loops" and "max 3 fix loops" are ONE
drifted constant or TWO deliberate ceilings.** This single answer decides whether the
next step is a find-replace or a semantic re-model. Cheap now, expensive after coding.

### Step 2 — Fix the loop-ceiling drift (correctly scoped)
- Define the ceiling(s) in ONE canonical place.
- Update ALL ~15 references: `reference/temperature-review.md:58,65`, `commands/verify.md:49`,
  `reference/contracts.md:19`, `commands/fix.md:3,24,34`, `agents/apex.md:52`,
  `commands/start.md:82,92,100,104`, `commands/visual.md:17,40,49` (note: visual loop may
  be a 3rd, separate loop — confirm), `agents/reference/visual-protocol.md:74`,
  `agents/reference/agents.md:59,74`, and align with `scripts/validate-artifact.js:126`
  (`review.fixLoops`).
- Verify with a grep-assertion test (`node --test`) that the constant resolves to one
  value everywhere it should.

### Step 3 — `loop-controller.js` with operator override
- ~30-line module owning the attempt counter + hard stop + same-class escalation.
- **Override (Rival's demand):** an explicit escape hatch for the legitimate-Nth-attempt
  case — when attempt N *uncovered a new narrower bug* (real progress, not patch-stacking),
  the loop may continue with a logged justification. The counter is a default, not a wall.
- Reconcile with the existing `verification.json` `review.fixLoops` field — do not create
  a parallel source of truth (that's the drift bug, relocated).
- Update the prose in fix.md/verify.md/etc. to *reference the controller's authority*
  rather than re-specifying the number (or the JS↔Markdown drift returns).
- Test headless via the existing `test/seam-integration.test.js` spawn-the-process pattern.

---

## HOLD — pending a real transcript (one logged failure per gate, or it doesn't get coded)

These are good ideas with NO observed pain yet. Do not pre-build. Code each only after a
real session demonstrates the failure it prevents.

- **Typed `BladeCompletionRecord`** — and when built, EXTEND the existing `execution.json`
  schema (`scripts/validate-artifact.js:93-109`, `reference/schemas/execution.md`), don't
  duplicate it. Only `files_read[]`, `test_result`, `blocker` are genuinely new fields.
  Trigger: a logged session where Apex misread a Blade's free-text output.
- **Wave write-target overlap gate** — and fix Rival's over-block objection first:
  file-level overlap ≠ conflict (two Blades editing different functions in one file merge
  cleanly). Gate on *region/symbol* overlap via `phantom_graph_blast_radius`, not raw path
  union. Trigger: a logged session where parallel Blades clobbered each other.
- **Sleep-time learnings consolidation + contradiction collapse** — `memory-consolidator.js`
  and `evolution-runner.js` already exist; this is an enhancement, not net-new. Trigger:
  evidence `/evolve` token cost is actually hurting.

## REJECT as planned work

- **Onion middleware refactor (v1 Phase 2)** — no user-facing payoff, highest blast radius,
  targets dead code, and the real work (rewiring `hooks.json`) bricks every hook if wrong.
  Phantom has a handful of hooks, not enough composable layers to justify the abstraction
  (DRY before 3 use cases). Keep each coded gate a standalone pure function. If a genuine
  need for composition appears later, revisit — with `hooks.json` named explicitly.
- **Durable pause/resume schemas (v1 Phase 5)** — pause-state is already restart-safe by
  the plan's own admission. Schema discipline is fine if free; not worth a phase.

---

## What stays exactly as-is (do not "improve")
- The learnings index (`[failed]`-block / `[validated:5+]`-auto-apply) — stronger than Letta.
- Opus-only, no new providers.
- Markdown-driven reasoning nodes — the prose IS why Phantom adapts.

## Single recommendation to the human
**Approve Steps 1–3 as one small PR. Make every HOLD item failure-pulled.** ~80% of the
real risk reduction for ~15% of the work, and the only path consistent with the "Less is
More" property this overhaul claims to protect.

## The one gate question
**Is "max 2 review" + "max 3 fix" one drifted constant or two deliberate ceilings?**
Everything downstream forks on this answer.

---

## LOCKED DECISIONS (human gate, 2026-06-03)
- **Scope:** Approved trimmed + 1 HOLD item. HOLD item pulled forward = **BladeCompletionRecord** (extend `execution.json`, don't duplicate; lowest-risk, most self-contained).
- **Loop semantics:** ONE drifted constant. Unify the **review/fix** loop to a single canonical ceiling.
- **Ceiling value = 2** — per CLAUDE.md global rule "if a fix fails twice with the same error class, STOP patching." Operator override (Step 3) handles the legitimate new-bug case.
- **Visual loop is SEPARATE** (`commands/visual.md`, `agents/reference/visual-protocol.md` "max 3 iterations") — a distinct iteration loop, NOT the fix/review loop. Leave at 3; add a one-line note distinguishing them so they don't get re-conflated.
- **Execution:** sequential in-tree Blades, headless `node --test` verification, NO auto-commit — diff presented for human review before any wrap/PR.
- **Out of scope:** onion refactor (dead-code `hook-router.js`), durable pause/resume, wave gate, sleep-consolidation (all failure-pulled).

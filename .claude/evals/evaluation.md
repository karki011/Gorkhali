# Phantom Shadows Evaluation Rubric

Author: Subash Karki

The scoring authority for both eval paths.
This file owns the **scale**, the **confidence levels**, the **anti-fabrication rule**, and the **session-level dimensions**.
It does NOT own the per-agent criterion lists — those live in [`commands/eval.md`](../../commands/eval.md) and are referenced, not duplicated, here.

Two consumers read this rubric:

- **Per-agent eval** — `/phantom:eval` scores each active shadow 1-5 using the criterion lists in `commands/eval.md`, applying the scale and evidence rules below.
- **Session-level eval** — `phantom:wrap` Step 5 (Shadows Evaluation) scores the whole session across the five dimensions below and records the result in the session file.

> If an eval cannot READ this file, it MUST report `eval-failed` and stop.
> It must never invent a scale, invent criteria, or proceed on remembered rules.

---

## Scale (1-5)

Every criterion is scored on this single scale.
Anchors are concrete so a 2 and a 4 are not a matter of taste.

| Score | Anchor | What it looks like |
|---|---|---|
| **5** | Exemplary | Criterion fully met with margin. Evidence is unambiguous and complete. Nothing a reviewer would change. |
| **4** | Solid | Criterion met. Minor, non-blocking gaps only (a missed edge case, a small stylistic miss). Evidence covers the claim. |
| **3** | Acceptable | Criterion met at the bar, but with notable gaps a reviewer would flag. Evidence is present but partial. |
| **2** | Below bar | Criterion partially met. Real problems that would need rework. Evidence shows the shortfall directly. |
| **1** | Failed / absent | Criterion not met, or the work it describes never happened. Evidence shows failure or absence. |

A score is only as trustworthy as its evidence, so every score carries a confidence.

## Confidence (high / medium / low)

| Level | Earns it |
|---|---|
| **high** | A single authoritative artifact fully covers the criterion (e.g. `verification.json` verdict for "did it pass"), or multiple artifacts corroborate. No inference required. |
| **medium** | One artifact covers the criterion but is incomplete, OR the score is inferred by combining two or more artifacts. Reasonable, not certain. |
| **low** | Evidence is indirect, ambiguous, or a single weak signal. The score is a judgement call the artifacts only partly support. |

Confidence is about evidence strength, not about the score.
A 5/high and a 2/high are both fully evidenced; a 4/low means "probably a 4, but the artifacts don't nail it."

---

## Anti-Fabrication Rule (load-bearing)

A hallucinated score is indistinguishable from a real one to anyone reading the summary.
The only defense is that every number is chained to something on disk.
These rules are not advisory.

1. **Every scored criterion MUST cite on-disk evidence** — an artifact path (e.g. `sessions/{TICKET}/verification.json`) or captured command output.
   The citation names the source and the fact drawn from it.
   A score with no citation is invalid and must not appear in a summary.

2. **No-evidence rule:** if a criterion has no citable on-disk evidence, it is scored `not-evaluable` (`n/e`) — NOT guessed, NOT given a middle score.
   `n/e` is excluded from every average.
   A criterion is never invented to fill a gap; the gap is reported as `n/e`.

3. **A rubric summary without per-criterion evidence lines is INVALID.**
   The evidence lines ARE the eval; a bare table of numbers is not an eval and must be rejected by the reader.

4. **If this rubric file cannot be read, report `eval-failed`** and produce no scores.
   A missing rubric is a failure to evaluate, never a license to improvise one.

### Per-criterion evidence line — required format

```
{criterion}: {score}/{confidence} — {artifact-path-or-command} :: {fact drawn from it}
```

Example:

```
Ward (build) verification completeness: 5/high — sessions/CP-0000/verification.json :: verdict "pass", 409/409 tests, gitHead matches HEAD
Gaze KISS/DRY enforcement: n/e — no review-panel.json or gaze verdict on disk :: not evaluated
```

---

## Per-Agent Evaluation

The per-agent criterion lists (Apex, Blade React/UI/API/Documentation, Ward test/build, Gaze) live in [`commands/eval.md`](../../commands/eval.md).
Do not restate them here — read them there, then score each listed criterion 1-5 with a confidence and an evidence line per the format above.
An agent's score is the mean of its evaluable criteria (`n/e` criteria excluded).
Report the `n/e` count alongside the mean; an agent scored mostly on `n/e` criteria is reported as `not-evaluable`, not as a low number.

---

## Session-Level Evaluation

`phantom:wrap` Step 5 scores the session across five dimensions.
Each dimension is scored 1-5 with a confidence and at least one evidence line drawn from session artifacts.

| Dimension | Weight | Question | Primary evidence |
|---|---|---|---|
| **Outcome quality** | 30% | Did it ship AND verify — pass with matching HEAD, tests green? | `verification.json` (verdict, counts, `_meta.gitHead`), `wrap.json` (pr status) |
| **Plan fidelity** | 20% | Does what shipped match the approved plan and contract scope? | `plan.json` vs `git diff main...HEAD`, contract files, `wrap.json` scope-creep notes |
| **Review efficacy** | 20% | Were findings caught BEFORE ship, not after? | `review-panel.json` (RPSL perspectives, fixes applied), greptile status |
| **Loop discipline** | 15% | Were fix-loops bounded and gates honored (no ship past a red verify)? | loop-controller state, fix-session artifacts, `verification.json` history |
| **Evidence hygiene** | 15% | Are the session's own claims backed by artifacts (e.g. PR Validation section built from files, not prose)? | PR `## Validation` section vs `verification.json`/`review-panel.json`/`wrap.json` |

### Overall score

Weighted mean of the five dimension scores:

```
overall = 0.30·outcome + 0.20·planFidelity + 0.20·reviewEfficacy + 0.15·loopDiscipline + 0.15·evidenceHygiene
```

Renormalize the weights over the evaluable dimensions when one is `n/e` (drop its weight, rescale the rest to sum to 1).

**Overall confidence is the LOWEST confidence among the contributing dimensions** — the eval is only as certain as its weakest evidenced input.
If 2 or more dimensions are `n/e`, cap overall confidence at `low` and say so explicitly; a session scored on half its dimensions is a weak signal regardless of the number.

---

## Output Contract

A valid eval — per-agent or session-level — always contains:

1. A score table (agents, or the five dimensions + overall).
2. One evidence line per scored criterion/dimension, in the required format.
3. The `n/e` count and, for session-level, the confidence cap note when it applies.

Missing (2) makes the eval invalid.
An unreadable rubric or a total absence of citable artifacts makes the eval `eval-failed`.

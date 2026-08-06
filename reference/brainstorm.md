# Brainstorm Protocol

Loaded by Apex when router classifies task as `BRAINSTORM_PLAN` or `FULL`.
Purpose: DIVERGE → CONVERGE before planning begins. Output feeds `intent.json`.

---

## When to Activate

Trigger brainstorm if ANY of these are true:
- No clear file targets (vague goal, no codebase anchor)
- New domain — no learnings for this area, unfamiliar codebase section
- Architecture choice required (multiple valid structural approaches)
- User signal: "what if", "I'm thinking about", "how should we", "explore"

Skip brainstorm if scope is already clear — jump to planning.

---

## Question-Asking Rules

Before asking ANYTHING, check:
1. Does `CLAUDE.md` or project docs answer this?
2. Does the code graph / learnings / git history answer this?
3. Does the answer change WHAT is built (not HOW)?

If no to #3 → don't ask. If yes to #1 or #2 → don't ask, just use the answer.

**Ask only when the answer changes scope, technology choice, or integration contract.**

**Skip anything the scout agents already answered** — Codebase Explorer, Constraint Mapper, and (when spawned) Domain Researcher run before questions are drafted; re-asking what their summaries already settled wastes a round.

Format: batch 2–5 related questions in a single message.

Each question must include:
- The question
- Why it matters (scope impact)
- Recommended default
- Alternatives

**Stop criterion — stop asking when EITHER is true:**
- The plan can be written with no unfounded assumptions: every open question has a confirmed answer or a human-accepted default.
- Answers are degrading: two consecutive responses land on "up to you" / "I don't know" / a shrug. Treat that as consent to the recommended default, not a cue to rephrase and ask again.

Never ask: generic discovery ("what's your stack?"), things CLAUDE.md already defines, HOW questions (that's for planning).

---

## Exploration Protocol

Propose 2–3 approaches. Never more (analysis paralysis). Never fewer (false certainty).

**Generate-then-evaluate.** Produce ALL approaches in one pass before any critique, scoring, or ranking touches any of them. Never draft one, judge it, then draft the next — that anchors every later option against the first and kills genuine divergence. Council Mode enforces this structurally (independent parallel generation); the Simple path enforces it by discipline — draft all N, then step back and evaluate.

**Lens diversity.** Each approach must come from a distinct, concrete stance — not "be creative" applied N times. 3–5 well-differentiated lenses beat 10 generic samples. State the lens per approach; it becomes `whyLens`. See Council Mode's lens menu for the standard set.

Each approach fills the full spine from `reference/schemas/brainstorm.md`:
- `id`, `name`, `thesis` (one-sentence core argument), `description`
- `whyLens` — the generating stance
- `effort` / `risk` / `reversibility`
- `whatBreaks` — what needs rework if this is wrong
- `whenToPick` — the deciding condition
- `mutualExclusivity` (optional) — approaches this one rules out
- `visualType` (optional) — `diagram` / `flow` / `sitemap` / `mockup` when a sketch would help the human decide faster

Before proposing: scan `learnings/INDEX.md`.
- `[failed]` entry matches → do NOT propose that approach. Flag it as "previously attempted and failed."
- `[validated:5+]` entry matches → surface it as the recommended default.

**Recommended default is mandatory.** Every brainstorm ends with `recommendedDefault: { id, reason }`. Lead with it at Convergence, then show the full tradeoff set. "No recommendation, pick one" is not an option — if genuinely tied, recommend the lower-risk one and say so.

---

## Council Mode (anonymized peer-ranking + chairman synthesis)

> Borrowed from [karpathy/llm-council](https://github.com/karpathy/llm-council). Phantom is
> single-provider, so treat peer-rankings as a **self-consistency** signal, not independent
> validation — same-family agents share blind spots. Council costs ~2-3 + 2-3 + 1 spawns, so use it
> only when divergence is genuinely open. Measure the cost with `scripts/timing-report.js`.

**Use council when** the route is FULL, an architecture choice is in play, the problem is
high-uncertainty, or `--council` is passed. **Otherwise** the coordinator drafts the 2-3 approaches
directly (simple path, no extra spawns) and skips to Convergence.

**Step 1 — Independent generation.** Spawn 3-5 approach-generator Blades, each with a DISTINCT lens,
in parallel (`run_in_background: true`). Each produces exactly ONE candidate approach from the gathered
context, in the Exploration Protocol shape, and states its lens as `whyLens` — never leave it implicit.
No candidate sees another's output before it's written; ranking (Step 2) only starts once ALL are in.
Lens menu (pick 3-5 well-differentiated ones per problem, not all five every time) — each lens is a
fixed function-name per `reference/roster.md` Rule 2, spawn only the subset actually used:
- `mvp-first` — smallest slice that ships real value now; defer everything else (YAGNI, taken literally) → `name: "blade-mvp"`
- `risk-first` — assume the riskiest edge case happens; design so that failure is cheap and visible → `name: "blade-risk"`
- `user-first` — optimize for the person using the result, even if it costs the implementer more → `name: "blade-user"`
- `reuse-first` — leans hardest on existing patterns/abstractions already in this codebase → `name: "blade-reuse"`
- `simplest` — least code/scope that solves the core problem today (KISS narrowly — distinct from
  `mvp-first`: this minimizes implementation, that minimizes feature surface) → `name: "blade-simple"`

Generators are reasoning-heavy → session model. Inject `[failed]` / `[validated:5+]` learnings into each prompt.

**Step 2 — Anonymized peer-ranking.** Apex relabels the candidates `Approach A / B / C`, stripping lens
and author identity. Spawn one ranker per candidate (fresh spawns, `subagent_type: "blade"`, `name:` the
next dedicated ranker slot per `reference/roster.md` — `blade-kirran`, `blade-mossa`, `blade-ellow`,
`blade-tavric`, `blade-sorne` for up to 5 candidates) given the FULL anonymized set; each
ranks ALL candidates on **Fit / Risk / Simplicity** with a one-line justification each. No agent may
identify or favor "its own" — the anonymization is the point. Apex aggregates (average rank; ties broken
by lower Risk). Ranking is rubric-scoped → Apex may route rankers to Sonnet; default = inherit (session model).

**Step 3 — Chairman synthesis.** Spawn ONE Chairman (session model, `subagent_type: "blade"`,
`name: "blade-chairman"` per `reference/roster.md` Rule 2) with the anonymized approaches + the aggregate
ranking. It produces: the **recommended** approach (may graft the winner's spine + the runners-up's best
ideas), the ranked alternatives, and a rationale citing the rankings. **The Chairman does NOT decide** —
its output feeds the human gate below.

---

## Rival Pass

Once ALL approaches exist (either path) and before Convergence, run one lightweight adversarial pass
(`subagent_type: "rival"`, `name: "rival-dask"` per `reference/roster.md`) —
borrows `agents/rival.md`'s stance, scoped to the approaches themselves rather than a full plan:

- One question per approach: "what's the strongest reason this approach is *wrong*, not just imperfect?"
- Target the spine, not implementation detail — attack `thesis`, `whatBreaks`, `whenToPick`, and any
  assumption the lens didn't surface.
- Output feeds the approach cards directly (tighten `whatBreaks`/`risk`, sharpen `whenToPick`). It does
  NOT block or re-loop — the human gate is still Convergence's gate, not this pass.
- Skip only when there is no live alternative to compare against (e.g. a single `[validated:5+]`
  approach with nothing else proposed).

This is what catches a flawed approach before it reaches the human looking polished — pushback belongs
at brainstorm time, not one step later at the plan gate.

---

## Convergence

1. **Write `brainstorm.json`** with `_meta.version: 3` (schema:
   `reference/schemas/brainstorm.md`). Capture the decision frame and evaluation
   criteria before the researched evidence, open questions, 2-3 independently
   generated approaches, recommendation, cheapest experiment, and direction
   gate. This is the source of truth; nothing downstream reads chat prose.
   Each evidence item states its decision implication. Each approach carries
   distinct benefits, tradeoffs, what breaks, its strongest failure mode, and
   the condition under which it wins. The recommendation records the accepted
   tradeoff, confidence, and next action. Reject filler and renamed duplicates.
2. **Review HTML:** Have the active AI author `{SESSION_DIR}/brainstorm.candidate.html` from the
   canonical JSON. It chooses the information design, but the self-contained page must lead with the
   recommendation and decision frame, then pending calls, an evidence ledger, cheapest experiment,
   comparison, and detailed option dossiers. Promote only a valid candidate with `node
   {PLUGIN_ROOT}/skills/phantom/scripts/validate-review-html.mjs brainstorm --source
   {SESSION_DIR}/brainstorm.json --candidate {SESSION_DIR}/brainstorm.candidate.html --out
   {SESSION_DIR}/brainstorm.html`. Open the accepted HTML directly and collect feedback and direction
   selection in chat. Apply feedback to `brainstorm.json`; regenerate and validate/promote a fresh
   candidate before any requested re-review. If generation, validation, or opening is unavailable,
   present the same hierarchy in chat and record the capability fallback.
   A user should not
   have to read every approach before discovering Phantom's recommendation.
3. Human picks one OR asks for more exploration (max 2 rounds total).
4. On decision → write to `intent.json`:
   - `approach`: chosen approach name
   - `scopeDecisions`: key constraints and choices made
   - `exploredAlternatives`: what was ruled out and why
5. Hand off to Plan phase. Planner reads `intent.json` and does NOT re-brainstorm.

Scope guardrail: **clarifying ambiguity ≠ adding features.**
If a question would expand scope, flag it as out-of-scope and stop.

---

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Asking what CLAUDE.md already defines | Wastes turns, erodes trust |
| Brainstorming when scope is clear | Delays execution for no value |
| Proposing >3 approaches | User paralysis, Apex overload |
| Re-brainstorming in planning phase | Breaks diverge/converge contract |
| Letting exploration expand scope | Brainstorm becomes scope creep |
| Skipping learnings check | Repeats past failures |
| Scoring/ranking before all approaches are drafted | Anchors later approaches to the first, kills divergence |
| "Be creative" as the whole lens | Produces generic samples, not distinct stances |

---

Author: Subash Karki

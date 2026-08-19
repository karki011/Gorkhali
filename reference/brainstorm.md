# Brainstorm Protocol

Canonical: `skills/phantom/references/brainstorming.md`

Loaded by Chief when the router classifies a task as `BRAINSTORM_PLAN` or `FULL`.
The portable reference owns the shared contract: when to activate, the
question-asking rules, the exploration protocol, divergence and convergence, the
artifact field shapes, the review order, and the anti-patterns table. This file
keeps only the native-host mechanics: roster-bound spawn sites and the native
session-artifact layout.

## Native artifact deltas

Each approach fills the spine defined in `reference/schemas/brainstorm.md`, which
adds one native-only optional field on top of the canonical shape:

- `visualType` (optional) — `diagram` / `flow` / `sitemap` / `mockup` when a sketch would help the human decide faster

---

## Council Mode (anonymized peer-ranking + chairman synthesis)

> Borrowed from [karpathy/llm-council](https://github.com/karpathy/llm-council). Phantom is
> single-provider, so treat peer-rankings as a **self-consistency** signal, not independent
> validation — same-family agents share blind spots. Council costs ~2-3 + 2-3 + 1 spawns, so use it
> only when divergence is genuinely open. Measure the cost with `scripts/timing-report.js`.

**Use council when** the route is FULL, an architecture choice is in play, the problem is
high-uncertainty, or `--council` is passed. **Otherwise** the coordinator drafts the 2-3 approaches
directly (simple path, no extra spawns) and skips to Convergence.

**Step 1 — Independent generation.** Spawn 3-5 reasoning-only Council members, each with a DISTINCT lens,
in parallel (`run_in_background: true`). Each produces exactly ONE candidate approach from the gathered
context, in the canonical Exploration Protocol shape, and states its lens as `whyLens` — never leave it
implicit. No candidate sees another's output before it's written; ranking (Step 2) only starts once ALL
are in. Lens menu (pick 3-5 well-differentiated ones per problem, not all five every time) — each lens is a
fixed function-name per `reference/roster.md` Rule 2, spawn only the subset actually used:
- `mvp-first` — smallest slice that ships real value now; defer everything else (YAGNI, taken literally) → `name: "council-mvp"`
- `risk-first` — assume the riskiest edge case happens; design so that failure is cheap and visible → `name: "council-risk"`
- `user-first` — optimize for the person using the result, even if it costs the implementer more → `name: "council-user"`
- `reuse-first` — leans hardest on existing patterns/abstractions already in this codebase → `name: "council-reuse"`
- `simplest` — least code/scope that solves the core problem today (KISS narrowly — distinct from
  `mvp-first`: this minimizes implementation, that minimizes feature surface) → `name: "council-simple"`

Generators are reasoning-heavy → session model. Inject `[failed]` / `[validated:5+]` learnings into each prompt.

**Step 2 — Anonymized peer-ranking.** Chief relabels the candidates `Approach A / B / C`, stripping lens
and author identity. Spawn one ranker per candidate (fresh spawns, `subagent_type: "engineer"`, `name:` the
next dedicated ranker slot per `reference/roster.md` — `council-ostrem`, `council-pellam`, `council-rendal`,
`council-senwick`, `council-tarvel` for up to 5 candidates) given the FULL anonymized set; each
ranks ALL candidates on **Fit / Risk / Simplicity** with a one-line justification each. No agent may
identify or favor "its own" — the anonymization is the point. Chief aggregates (average rank; ties broken
by lower Risk). Ranking is rubric-scoped → Chief may route rankers to Sonnet; default = inherit (session model).

**Step 3 — Chairman synthesis.** Spawn ONE Chairman (session model, `subagent_type: "engineer"`,
`name: "council-chairman"` per `reference/roster.md` Rule 2) with the anonymized approaches + the aggregate
ranking. It produces: the **recommended** approach (may graft the winner's spine + the runners-up's best
ideas), the ranked alternatives, and a rationale citing the rankings. **The Chairman does NOT decide** —
its output feeds the human gate below.

---

## Opposition Pass

Once ALL approaches exist (either path) and before Convergence, run one lightweight adversarial pass
(`subagent_type: "opposition"`, `name: "opposition-contrell"` per `reference/roster.md`) —
borrows `agents/opposition.md`'s stance, scoped to the approaches themselves rather than a full plan:

- One question per approach: "what's the strongest reason this approach is *wrong*, not just imperfect?"
- Target the spine, not implementation detail — attack `thesis`, `whatBreaks`, `whenToPick`, and any
  assumption the lens didn't surface.
- Output feeds the approach cards directly (tighten `whatBreaks`/`risk`, sharpen `whenToPick`). It does
  NOT block or re-loop — the human gate is still Convergence's gate, not this pass.
- Skip only when there is no live alternative to compare against (e.g. a single `[validated:5+]`
  approach with nothing else proposed).
- Chat-only: this pass writes no `plan-check.json`. That artifact belongs to the plan gate
  (`reference/planning.md` → Opposition), where the same agent runs its full eight checks.

This is what catches a flawed approach before it reaches the human looking polished — pushback belongs
at brainstorm time, not one step later at the plan gate.

---

## Convergence

Native session-file layout for the canonical convergence contract:

1. **Write `brainstorm.json`** with `_meta.version: 3` (schema:
   `reference/schemas/brainstorm.md`). This is the source of truth; nothing
   downstream reads chat prose.
2. **Review HTML:** Have the active AI author `{SESSION_DIR}/brainstorm.candidate.html` from the
   canonical JSON, in the canonical page order. Promote only a valid candidate with `node
   {PLUGIN_ROOT}/skills/phantom/scripts/validate-review-html.mjs brainstorm --source
   {SESSION_DIR}/brainstorm.json --candidate {SESSION_DIR}/brainstorm.candidate.html --out
   {SESSION_DIR}/brainstorm.html`. Open the accepted HTML directly and collect feedback and direction
   selection in chat. Apply feedback to `brainstorm.json`; regenerate and validate/promote a fresh
   candidate before any requested re-review. If generation, validation, or opening is unavailable,
   present the same hierarchy in chat and record the capability fallback.
3. Human picks one OR asks for more exploration (max 2 rounds total).
4. On decision → write to `intent.json`:
   - `approach`: chosen approach name
   - `scopeDecisions`: key constraints and choices made
   - `exploredAlternatives`: what was ruled out and why
5. Hand off to Plan phase. Planner reads `intent.json` and does NOT re-brainstorm.

---

Author: Subash Karki

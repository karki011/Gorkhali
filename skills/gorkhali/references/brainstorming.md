# Decision-first brainstorming

Brainstorming resolves material ambiguity. It returns a recommended decision
portfolio, not an unranked idea dump and not an implementation task list.

## When to Activate

Brainstorm when any of these hold:

- No clear file targets: a vague goal with no repository anchor.
- A new domain: no recorded corrections for the area, or an unfamiliar part of
  the repository.
- An architecture choice is required, with multiple valid structural approaches.
- A user signal such as "what if", "I'm thinking about", "how should we", or
  "explore".

Skip brainstorming when the scope is already clear and go straight to planning.

## Frame and investigate

Record the decision, desired outcome, audience, constraints, non-goals,
evaluation criteria, known evidence, unknowns, and research budget before
generating options. Choose and record a persistent stance: `facilitator` when
the user must supply ideas, `creative-partner` when both sides contribute, or
`generate-for-me` when delegated ideation is explicit. Ask only
questions that materially change scope, solution, or risk and cannot be answered
from available evidence. Batch 1-3 questions, include a recommended default, and
stop after two rounds.

Fan out only independent, read-heavy uncertainty: repository patterns,
dependencies and corrections, or current external evidence. Each pass returns
claims, sources, evidence state, conflicts, and remaining unknowns. Run the same
passes sequentially when delegation is unavailable.

### Question-Asking Rules

Before asking anything, check:

1. Do the repository instructions or project docs answer this?
2. Do the code graph, recorded corrections, or repository history answer this?
3. Does the answer change what is built, rather than how it is built?

If the answer to 3 is no, do not ask. If the answer to 1 or 2 is yes, do not
ask; use the answer. Ask only when the answer changes scope, technology choice,
or integration contract, and skip anything the research passes already settled.

Each question states the question, why it matters for scope, a recommended
default, and the alternatives. Stop asking when either is true:

- The plan can be written with no unfounded assumptions: every open question has
  a confirmed answer or a human-accepted default.
- Answers are degrading: two consecutive responses land on "up to you", "I don't
  know", or a shrug. Treat that as consent to the recommended default, not as a
  cue to rephrase and ask again.

Never ask generic discovery questions, anything the repository instructions
already define, or how-questions; those belong to planning. Clarifying ambiguity
is not adding features: if a question would expand scope, flag it as
out-of-scope and stop.

## Diverge and converge

### Exploration Protocol

Propose 2-3 approaches. Never more, which causes analysis paralysis; never
fewer, which fakes certainty.

Generate, then evaluate. Produce every approach in one pass before any critique,
scoring, or ranking touches any of them. Never draft one, judge it, then draft
the next: that anchors every later option against the first and kills genuine
divergence.

Each approach comes from a distinct, concrete stance rather than "be creative"
applied repeatedly. Three to five well-differentiated lenses beat ten generic
samples. State the lens per approach; it becomes `whyLens`.

Before proposing, check the recorded corrections. A matching failed correction
means that approach is not proposed: flag it as previously attempted and failed.
A repeatedly validated correction is surfaced as the recommended default.

A recommended default is mandatory. Every brainstorm ends with
`recommendedDefault`. Lead with it at convergence, then show the full tradeoff
set. "No recommendation, pick one" is not an option; when genuinely tied,
recommend the lower-risk approach and say so.

Track the active phase as `frame`, `diverge`, `cluster`, `converge`, or
`decision`. During divergence, generate more raw ideas than the final shortlist
from distinct axes such as simplest viable, highest upside, lowest risk, user
outcome, operations, or a contrarian assumption. Record each idea's lens,
technique, evidence, and assumptions. Finish divergence before evaluation. Do
not use free-form all-to-all debate.

Cluster related and conflicting ideas, name the connection, and preserve the
non-obvious insight. Then converge to 2-3 materially different approaches. Map
each shortlisted approach to its decision drivers and strongest reservation so
the final options visibly descend from the exploration rather than appearing
fully formed.

Normalize each candidate into thesis, evidence, effort, risk, reversibility,
failure cost, tradeoffs, and deciding condition. Compare candidates blindly
against the evaluation criteria. Run one advisory Opposition pass - it tightens the
cards and writes no plan-check verdict - then have Chief recommend
one practical direction while preserving a higher-upside or minority option.

For a decision-grade review, each approach must describe distinct benefits,
tradeoffs, what breaks, its strongest failure mode, and the condition under
which it wins. Do not emit renamed versions of one idea or repeat generic
effort/risk prose across every card. Attach an implication to each evidence
item. The recommendation records its accepted tradeoff, confidence, and next
action so the user can approve a direction without reverse-engineering the
comparison. Preserve the strongest dissenting case and the trigger that would
make it preferable; disagreement is decision information, not noise.

Record the cheapest experiment capable of resolving the most important
uncertainty. When the remaining choice is policy/preference or repository
evidence already resolves it, record `status: not-applicable` with the reason
instead of inventing an experiment. Obtain the user's choice or record
previously delegated authority; never invent approval.

## Artifact and review

Use `contract_version: 3` in a portable brainstorm payload. New sessions record
depth, stance, active phase, and the information completed through that phase:
the decision frame at `frame`; raw ideas at `diverge`; connections at `cluster`;
2-3 approaches and their shortlist at `converge`; then dissent, recommendation,
cheapest experiment, and direction gate at `decision`. Quick brainstorms may
omit clusters and dissent when the decision is narrow; standard/deep sessions
require clusters from the cluster phase onward and dissent at the decision
phase. Legacy v3 decision records without phase fields remain readable.

Use these exact JSON field shapes so every host produces the same contract:

- `briefing`: `{ tackling, problem, how, scope, risks }`.
- `decision`: `{ question, outcome, audience: [], nonGoals: [], constraints: [],
  evaluationCriteria: [], successSignal }`. `nonGoals` and `successSignal` are
  required on every new v3 frame. `successSignal` is an observable, not a vibe.
- `evidence[]`: `{ claim, source, status, kind, observed_at, confidence, conflicts? }`,
  where status is `verified`, `supported`, `inferred`, or `unknown`,
  `kind` is `user` or `repo` (write it on every new row; a How supported only
  by `repo` inference is an assumption), `observed_at` is an RFC 3339 timestamp with timezone, `confidence` is from
  `0` to `1`, and `conflicts` is an optional string array. Older v3 rows without
  freshness metadata or `kind` remain readable; new canonical writes require both.
- `ideas[]`: `{ id, title, summary, lens, technique, evidence: [],
  assumptions: [] }`.
- `clusters[]`: `{ id, name, insight, ideaIds: [] }`; every standard/deep idea
  must be referenced from the cluster phase onward.
- `approaches[]`: `{ id, name, thesis, description, whyLens, effort, risk,
  reversibility, whatBreaks: [], whenToPick }`, plus decision-grade benefits,
  tradeoffs, failure mode, and mutual-exclusivity details when relevant.
- `shortlist[]`: `{ approachId, drivers: [], reservation }`; every converged
  approach must have exactly one entry.
- `recommendedDefault`: `{ id, reason }`; its ID must name an approach.
- `dissent`: `{ approachId, case, trigger }`; it must challenge the recommended
  approach.
- `cheapestExperiment`: `{ question, method, successSignal, cost }`, or
  `{ status: "not-applicable", reason }`.
- `directionGate`: `{ question, options: [] }`; option IDs must name approaches.
  The gate asks for a human choice but does not imply approval. Record the
  actual choice or delegated authority separately; never infer it from the
  recommendation.

After validating the portable JSON, generate full-width, self-contained HTML
using `<skill-directory>/references/review-html.md` and run
`<skill-directory>/scripts/validate-review-html.mjs` against
it — except on a `quick` or `--simple` brainstorm, which presents the same
What/Problem/How brief and Pick A/B/C in chat and skips HTML. Order the page as:
What, Problem, and How first; then current direction; a comparison table of
the distinct approaches; frame and stance; evidence; divergence lanes;
connections and clusters; convergence funnel and shortlist; dissent; cheapest
experiment; open questions; direction gate. Put detailed approach cards in
collapsed `<details>` with no `open` attribute; the comparison table must
appear in `<main>` before any details. Treat this as an exploration workbench,
not a plan dossier. JSON remains the source of truth and generated HTML is
never parsed back. If HTML generation or opening is unavailable, present the
same What/Problem/How brief in chat, then Pick A/B/C. A How without supporting
evidence is an assumption. The input may be a direct v3 payload or the
portable state envelope.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Asking what the repository instructions already define | Wastes turns, erodes trust |
| Brainstorming when scope is clear | Delays execution for no value |
| Proposing more than 3 approaches | User paralysis, coordinator overload |
| Re-brainstorming during planning | Breaks the diverge/converge contract |
| Letting exploration expand scope | Brainstorm becomes scope creep |
| Skipping the recorded-corrections check | Repeats past failures |
| Scoring or ranking before all approaches are drafted | Anchors later approaches to the first, kills divergence |
| "Be creative" as the whole lens | Produces generic samples, not distinct stances |

# Decision-first brainstorming

Brainstorming resolves material ambiguity. It returns a recommended decision
portfolio, not an unranked idea dump and not an implementation task list.

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

## Diverge and converge

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
against the evaluation criteria. Run one Rival pass, then have Apex recommend
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

- `decision`: `{ question, outcome, audience: [], nonGoals: [], constraints: [],
  evaluationCriteria: [] }`.
- `evidence[]`: `{ claim, source, status, observed_at, confidence, conflicts? }`,
  where status is `verified`, `supported`, `inferred`, or `unknown`,
  `observed_at` is an RFC 3339 timestamp with timezone, `confidence` is from
  `0` to `1`, and `conflicts` is an optional string array. Older v3 rows without
  freshness metadata remain readable; new canonical writes require it.
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
it. Order the page as:
current direction; frame and stance; evidence; divergence lanes; connections
and clusters; convergence funnel and shortlist; dissent; cheapest experiment;
open questions; direction gate. Treat this as an exploration workbench, not a
plan dossier. JSON remains the source of truth and generated HTML is never
parsed back. If HTML generation or opening is unavailable, present the same hierarchy
in chat. The input may be a direct v3 payload or the portable state envelope.

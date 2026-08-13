# Code Review Research — 2026 State of Practice

Research notes comparing Phantom's review stack (`agents/gaze.md`, `agents/archer.md`,
`commands/review.md`, `reference/temperature-review.md`, `reference/wrap/rpsl.md`)
against current industry practice and empirical literature.

Sources are listed at the bottom. Nothing here has been implemented — this is the
input to that decision, not the decision.

---

## 1. What the sources actually say

### 1.1 The Rephrase article (the starting point)

The article's thesis is that prompt structure *is* the review strategy: "Don't ask
Claude to approve a PR. Ask it to inspect specific failure modes."

Its recommended prompt skeleton:

1. State the PR goal.
2. Add codebase context (module, architecture rule, business constraint).
3. Define review priorities explicitly.
4. Force evidence — cite file paths, functions, exact diff behavior.
5. Force uncertainty handling — `confirmed issue` / `possible risk` / `needs more context`.
6. Specify the output shape — severity, rationale, fix, ready-to-paste comments.

The seven prompts are role-scoped variants: senior engineer (balanced), security-first,
regression hunter, test gap, maintainability (1–10 scoring), comment generator, and
self-check (two-pass).

**Assessment.** Steps 1–3 and 6 Phantom already does structurally — and does better,
because they're encoded in agent definitions and JSON artifacts rather than re-typed
prose. Steps 4 and 5 are the real gaps, and prompt #7 (two-pass) points at the largest
one. The seven "prompts" are mostly Phantom's specialist roster in prompt form; the
article is aimed at people without an agent framework. The parts worth stealing are
narrow but genuinely valuable.

One claim in it is wrong for our purposes: prompt #7 asks the model to critique its
*own* findings in the same pass. Research below shows that specific mechanism is the
weak version.

### 1.2 Anthropic's own Code Review product

The managed Code Review service is the most directly relevant reference implementation,
because it's the same models doing the same job at scale:

- **Parallel agents by issue class, then a verification step** that checks candidate
  findings against actual code behavior to filter false positives. Results are then
  deduplicated and ranked.
- **Three severity markers**: 🔴 Important (fix before merge), 🟡 Nit (minor),
  🟣 **Pre-existing** (real bug, but not introduced by this PR).
- **Never blocks.** The check run always completes neutral; findings inform, they don't gate.
- **Default focus is correctness** — "bugs that would break production, not formatting
  preferences or missing test coverage."
- **`REVIEW.md`** at repo root, injected as highest-priority instruction into every agent
  in the pipeline. `CLAUDE.md` violations are flagged as nits.
- Cost: ~$15–25 and ~20 minutes per review.

Their `REVIEW.md` tuning guidance names five levers, each of which maps to a gap in ours:

| Lever | What it does |
|---|---|
| Severity redefinition | Repo-specific definition of what "Important" means |
| Nit volume cap | "Report at most five nits, mention the rest as a count" |
| Skip rules | Paths/categories with no findings, or a higher bar rather than a skip |
| Verification bar | "Behavior claims need a `file:line` citation, not an inference from naming" |
| Re-review convergence | "After the first review, suppress new nits and post Important findings only" |

### 1.3 Meta's RADAR (production evidence for risk-based routing)

RADAR combines eligibility gates, static heuristics, a machine-learned Diff Risk Score,
LLM review, and deterministic validation:

- 535K+ diffs reviewed, 331K+ landed, peaking at 25K diffs/day.
- Revert rate **1/3** that of non-RADAR diffs; production incident rate **1/50**.
- Median time to close reduced by >330%; median review wall time by 35%.
- Relaxing the risk threshold from the 25th to the 50th percentile raised auto-approve
  to 60.31% — i.e. the risk score is a *tunable dial*, not a binary.

This is strong production validation of the thing Phantom already does: route reviewer
depth by risk rather than reviewing everything the same way.

### 1.4 Empirical literature on review effectiveness

- **Mäntylä & Lassenius**: roughly three quarters of code review findings concern
  evolvability/maintainability rather than externally visible behavior. Reviewers
  naturally drift toward the things that don't break production.
- **Missed bugs**: across 77 OSS projects, 187 bugs slipped through 173 reviewed PRs.
  Review is a filter, not a gate.
- **Static analysis covers ~16%** of what manual review surfaces — the layers are
  complementary, not redundant.
- **Security is under-discussed**: in 135,560 review comments across OpenSSL and PHP,
  reviewers raised concerns in 35 of 40 weakness categories, but memory and resource
  management — categories tied to actual past CVEs — came up disproportionately rarely.
- **PR description structure** (MSR 2026, ~13k agent-authored PRs including Claude Code):
  more structured descriptions correlate with faster reviewer response and shorter
  completion time. How a change is communicated affects the review, independent of
  whether the code is correct.

### 1.5 Verification passes and false positives

This is the best-evidenced lever in the whole body of research:

- Two-stage workflows where a **second model critiques each positive finding** by
  re-reading the source alongside the first model's rationale: first-line false-positive
  rates run 8–54% even at strong F1; the second stage improves F1 by 0.04–0.25.
- Multi-Review / Self-Agg with 10 independent passes plus an aggregator: **+43.67% F1**
  over single-pass.
- Micro-agent architecture with specialized reviewers: **−51% false positives** without
  losing recall.
- Well-tuned SAST with custom rules and framework awareness: FP from 30–60% down to
  10–20%; hybrid LLM+static methods report 94–98% reduction in industrial settings.

**The important caveat**, and the correction to the article's prompt #7: LLM
*self*-review produces **false negatives on its own output**, while detailed-prompt
review of *third-party* code produces false positives. Independent validators outperform
same-context self-critique. "Critique your own findings" is the weak version of the
right idea.

### 1.6 The three-layer consensus

Broad agreement across the practitioner sources: deterministic automation (linters,
formatters, type checkers) → AI review → human review. Formatting, lint, type errors and
style should never reach a human. The corollary that matters for us: they shouldn't reach
the *AI reviewer's output* either.

### 1.7 DORA 2026 — review is now the bottleneck

This is the strategic frame for everything else, and it's the most important number set here.

AI coding assistants raise individual output sharply — ~21% more tasks completed, ~98%
more PRs merged — while organizational delivery metrics stay flat. The 2026 data on where
that goes:

| Metric | Change |
|---|---|
| Median time in PR review | **+441%** (vs +91% in the 2025 dataset) |
| Pull request size | +51.3% |
| Bugs per developer | +54% |
| Incidents per PR | +242.7% |

DORA's framing: AI is an **amplifier of existing conditions**, not a universal booster —
it magnifies a high-performing org's strengths and a struggling one's dysfunctions
equally. If a team increases output but keeps reviewing changes the same way, with
limited context and few risk signals, the speed gained in development is lost in
validation.

The practical read for Phantom: throughput at the review stage is now the constrained
resource, and diffs are getting bigger at the same time. That argues for the low-risk
fast path (Gap 7) being worth more than I credited it in the first pass, and it makes
diff-size handling (Gap 10 below) a first-order concern rather than a nicety.

### 1.8 SmartBear / Cisco — the empirical numbers on review size

Still the largest study of its kind: 10 months, 2,500 reviews, 3.2M lines of code.

- **200–400 LOC** is the effective ceiling for a single review.
- Review of that size over **60–90 minutes** yields **70–90% defect discovery**.
- Detection rates **plummet** past 60–90 minutes.
- Inspection **under 300 LOC/hour** gives best detection; under 500 is still acceptable;
  faster than that misses a significant share of defects.
- Lightweight review takes <20% the time of formal inspection and finds as many bugs.

The rate limits are about human attention and don't transfer directly to an agent. The
*size* finding largely does: signal degrades as a single reviewing pass covers more
unrelated surface, and that degradation is a context and attention-budget problem for
Gaze too. Google's guidance points the same way — small CLs (~100 lines reference,
1,000 ceiling) are described as the single highest-ROI process change available.

### 1.9 Google on review speed and the "good enough" bar

Two norms worth naming because they're culturally load-bearing:

- **One business day** maximum to respond to a review request.
- **"Not perfect, but better than the current state" → approve.** A reviewer who sees
  further improvement available can leave comments for later and still grant LGTM. This
  is explicitly framed as the secret to maximizing velocity.
- **"LGTM with comments"** — approve while leaving unresolved non-blocking comments when
  the reviewer is reasonably confident the author will handle them.

The second point is a standard Phantom doesn't currently encode: Gaze reviews the diff
against intent, but never against *the state of the code before the diff*. A change that
improves a bad file but doesn't reach the repo's ideal has no defined verdict today.

### 1.10 Tooling architecture — where the bugs actually are

Comparative benchmarks across the current field:

- **Greptile** indexes the entire codebase and reviews each PR against that context —
  targeting bugs "in the seams between files, services, and shared dependencies."
- **CodeRabbit** focuses on diff-level annotation over a layer of 40+ linters and SAST
  scanners, and learns from developer edits and approvals to reduce noise over time.
- **Graphite Diamond** wove review into a stacked-diff workflow (acquired by Cursor,
  Dec 2025).

In a head-to-head on 50 open-source PRs, **Greptile caught over 50% more bugs than
CodeRabbit** — the difference attributed to full-codebase context vs. diff-level analysis.

That is a direct argument about Archer. Cross-file coherence is where the bug density is,
and in Phantom that capability is currently opt-in behind a risk trigger.

### 1.11 Benchmark methodology — a usable definition of "true positive"

Martian released **Code Review Bench** in March 2026, the first independent evaluation
framework built for AI review systems: 17 tools, 200,000+ real PRs, tracked live across
GitHub during January–February 2026.

Its online metric is the useful part:

> A comment counts as a **true positive if the developer modified the code after the comment.**

That's a behavioral proxy for usefulness that needs no human labeling, and it's directly
implementable for us. Qodo's benchmark and CodeAnt's 200k-PR study use the same
precision / recall / F1 frame. Some approaches use multi-model majority voting with an
arbiter model to filter model-specific hallucinations.

### 1.12 Conventional Comments and OWASP mapping

Two ready-made vocabularies worth borrowing rather than inventing:

- **[Conventional Comments](https://conventionalcomments.org/)** — a labeling standard
  with eight core labels (`praise`, `nitpick`, `suggestion`, `issue`, `question`,
  `thought`, `chore`, `note`) plus **blocking / non-blocking** decorators. The
  blocking/non-blocking split as a *decorator* rather than a severity level is precisely
  the severity-vs-confidence separation Gap 2 is about, arrived at independently.
- **OWASP Top 10:2025** — Broken Access Control is #1 with SSRF now folded into it;
  Cryptographic Failures is A04. Secure review checklists organize around input
  validation, authn/authz, cryptography, error handling, and secrets management, and map
  findings to Top 10 / ASVS 5.0 categories. Recall from §1.4 that reviewers reliably
  *under*-discuss memory and resource management despite those categories driving real
  CVEs — a checklist is what corrects that bias.

---

## 2. Where Phantom already matches or leads

Worth stating plainly, because it bounds how much should change.

| Practice | Phantom | Notes |
|---|---|---|
| Three-layer separation | ✅ | Ward = mechanical gates, Gaze/Archer = AI, user verification = human. `agents/gaze.md` explicitly forbids repeating mechanically-enforced lint/style. |
| Risk-based reviewer routing | ✅ Leading | `requiredSpecialists` persisted at verification, consumed by `commands/review.md`. Same shape as RADAR, decided earlier in the lifecycle. |
| Structured output contract | ✅ Leading | JSON artifacts with an enforced schema beat "ask for a nice format" prompting. Artifact-first ordering (write before summarizing) is a genuinely good idea most tools lack. |
| Evidence-over-vibes | ✅ | Every finding requires file/component, evidence, impact, smallest remediation. |
| Anti-over-engineering | ✅ | Gaze priority 5 and `agents/rival.md` both target speculative abstraction — matches Google's "be especially vigilant about over-engineering." |
| Noise suppression | ✅ Aggressive | `temperature-review.md` drops P2/P3 outright. Stronger than Anthropic's "cap the nits." |
| Missing-evidence ≠ pass | ✅ Leading | `observationGaps`, `blocked` verdicts, "a missing artifact is not a clean review." Most tools silently degrade to pass. |
| Pre-implementation review | ✅ | Rival reviews the *plan*. Cheapest possible place to catch a bad approach; almost nobody does this. |
| Approve-with-comments | ✅ | `advisory` severity is Google's "LGTM with comments" — non-blocking findings don't hold the ship. |

The specialist roster (Gaze / Archer / Sweep / Rival / Lens / RPSL) is already close to
the "micro-agent architecture" the FP research credits with −51% false positives.

---

## 3. Gaps worth acting on

Ordered by expected value, highest first.

### Gap 1 — No verification pass. *(highest leverage)*

Gaze writes findings straight to `gaze.json`. Nothing checks a candidate finding against
actual code behavior before it lands. Every source above converges on this being the
single biggest FP lever, and Anthropic's own pipeline has it as a distinct stage.

**Proposal.** Add a bounded verification step between finding and artifact. Critically,
per §1.5, this must be an **independent check against the code**, not same-context
self-critique: re-read the cited `file:line`, confirm the claimed behavior is really
there, drop anything that can't be confirmed.

Cheapest viable version: fold it into Gaze as a mandatory pre-write step ("for each
finding, re-read the cited lines and confirm the behavior; discard what you can't
confirm"). Stronger version: a separate verifier role. Start with the cheap one — it
costs no new agent and captures most of the benefit.

### Gap 2 — Severity and confidence are conflated.

`blocking|advisory` (Gaze) and P0–P3 (`temperature-review.md`) both encode *importance*.
Neither encodes *certainty*. An `advisory` finding might be a confident nit or an unsure
bug, and the author can't tell which — so they treat all of them the same way, which is
to say they skim them.

**Proposal.** Add an orthogonal confidence field: `confirmed` / `possible` /
`needs-verification`. This is the one thing the Rephrase article gets straightforwardly
right, it pairs naturally with Gap 1 (verification is what promotes `possible` →
`confirmed`), and it's a small schema change.

### Gap 3 — No way to report a pre-existing bug.

Anthropic's 🟣 Pre-existing marker solves a real problem we currently have no answer for.
Today a reviewer that finds a genuine bug the diff didn't introduce has two bad options:
flag it blocking (scope creep, blocks an unrelated ship) or drop it (the finding is lost).

**Proposal.** Add `preExisting: true` to the finding schema. It reports, it never blocks,
and it never enters a fix loop. Low cost, recovers information we're currently discarding.

### Gap 4 — No re-review convergence.

`commands/review.md` step 4 deletes `gaze.json` and runs a fresh pass every time. Correct
for avoiding stale verdicts, but it means round N has no memory of rounds 1..N−1. In a
fix loop, a one-line fix can attract a fresh batch of advisories forever. Anthropic calls
this out explicitly as a rule worth writing down.

**Proposal.** Pass the prior round's finding IDs into the next review with an instruction
along the lines of: after round 1, report blocking findings only; new advisories are
suppressed. Keeps the fresh-pass property while bounding churn.

### Gap 5 — Evidence isn't required to be a citation.

Gaze requires "evidence" but doesn't constrain its form, so an inference from a
function's *name* satisfies the schema as readily as a line of code does. Anthropic's
recommended verification bar is specific: "behavior claims need a `file:line` citation in
the source, not an inference from naming."

**Proposal.** One sentence in `agents/gaze.md` requiring behavioral claims to cite
source. Nearly free; directly reduces the most annoying class of false positive. Archer
already does this via its `FILE:LINE` output format.

### Gap 6 — No `REVIEW.md` support.

Phantom inherits project context via `reference/_base-agent.md` and `CLAUDE.md`.
Supporting a repo-root `REVIEW.md` would give per-repo review tuning (severity
calibration, skip paths, always-check rules) and make Phantom interoperate with
Anthropic's managed Code Review, which reads the same file.

**Proposal.** Have Gaze and Archer read `REVIEW.md` when present, as highest-priority
review-only instruction. Note that the local `/code-review` command deliberately does
*not* read it — supporting it is a point of differentiation, not just parity.

### Gap 7 — No low-risk fast path.

RADAR's headline result is that ~60% of diffs can be auto-approved at a relaxed risk
threshold while *lowering* revert and incident rates. Phantom runs full Gaze on every
diff regardless of risk. We already compute `requiredSpecialists` — the machinery for a
risk signal exists; we just never use it to make the review *cheaper*, only to make it
deeper.

**Proposal.** Speculative, needs data before building. Worth noting that `ROADMAP.md`
line 112 records median 2 review cycles across 399 reviews — that's the dataset to check
before designing this. Do not build it on intuition.

### Gap 8 — Feedback loop is open.

Anthropic collects 👍/👎 on every finding and tunes the reviewer on it. Phantom has
`evals/` and `/phantom:learn` but no record of which findings the user *accepted* versus
*rejected* — which is the only signal that tells us whether the review is calibrated.

**Proposal.** Record accept/reject per finding at fix time. This is the input to
everything else on this list; without it, tuning severity thresholds is guesswork.
Given the repo already has an evals harness, this is the highest-value cheap instrument.

> **Superseded — see "Gap 8, revised" below.** Round 2 supplied a concrete metric and
> showed the instrumentation is already half-built.

### Gap 9 — PR descriptions aren't structured.

Warden writes PR bodies from values handed to it. The MSR 2026 result says structured
descriptions measurably speed up human review of agent-authored PRs — which is exactly
what Phantom produces.

**Proposal.** A fixed PR body template (goal / approach / risk / verification evidence /
what to look at first). Cheap, and it's the only item here that improves *human* review
rather than machine review.

### Gap 10 — No diff-size policy. *(promoted after round 2)*

`agents/gaze.md` says "review the whole changed scope once." A 2,000-line diff gets the
same single pass as a 50-line one, with no adjustment and no signal to the user that
coverage is now thinner. Meanwhile DORA 2026 has PR size up 51.3% and the SmartBear data
puts effective single-review coverage at 200–400 LOC.

**Proposal.** A size threshold in `commands/review.md` that changes *behavior* rather
than just warning. Above the threshold, Gaze first ranks changed files by risk and
reviews in ranked chunks, and records a `coverage` field naming what got full attention
and what got a lighter pass. The Rephrase article gets to the same place from intuition
("if the diff is huge, ask it to identify the riskiest files first"); the SmartBear
numbers are the evidence for where the threshold goes.

Note this composes with `observationGaps` — thin coverage on a low-risk chunk is exactly
an observation gap, and Phantom already has a place to put it.

### Gap 11 — Cross-file context is opt-in.

Greptile's >50% bug-catch advantage over CodeRabbit is attributed to full-codebase
context vs. diff-level analysis. In Phantom, Gaze is the always-on reviewer and Archer —
the one that actually models the dependency graph — runs only on an explicit risk
trigger from `requiredSpecialists`.

The current split is a defensible cost decision, but the benchmark evidence says the
opt-in capability is the one with the higher bug yield.

**Proposal.** Don't add anything; change a threshold. Widen Archer's trigger conditions,
or give Gaze a cheap cross-file pass (resolve imports/exports touched by the diff and
check consumers) without spawning Archer. Worth measuring with Gap 8 instrumentation
before committing — this is a question data can answer.

> **Unresolved — do not act on this gap yet.** The premise that cross-file review is
> *rare* has no current evidence behind it. `ROADMAP.md` §3 records archer 464 spawns
> against gaze 113, which would suggest the opposite, but those counts were measured
> 2026-07-28 and PR #109 rewrote the whole review pipeline on 2026-08-11 — so they
> describe an architecture that no longer exists (`ROADMAP.md` F8). Neither reading is
> supported until B9 re-measures. Note also that Greptile *is* the full-codebase-index
> architecture from §1.10, Phantom already integrates it, and it ran in 50/191 sessions —
> so the cheapest version of this gap may be raising that number rather than changing
> Archer at all.

### Gap 12 — No "better than current state" standard.

Gaze reviews the diff against intent and against repository patterns, but never against
the *prior state of the code*. Google's rule is explicit: a change that improves things
without degrading code health should be approved even if imperfect. Without that
baseline, a reviewer improving a legacy file can be blocked for not reaching the repo's
ideal — the diff gets held to a standard the surrounding code never met.

**Proposal.** One clause in Gaze's priorities: a finding is only `blocking` if the diff
makes something *worse* than before, or fails the stated intent. Pre-existing badness the
diff merely touches is `preExisting` (Gap 3), not a block. This and Gap 3 are the same
change viewed from two sides.

### Gap 13 — Security review is generic.

Gaze priority 2 names "security, privacy, data loss, and compatibility" without
categories. §1.4 found reviewers systematically under-discuss the weakness classes tied
to real CVEs — generic instruction doesn't correct a systematic blind spot; an explicit
checklist does.

**Proposal.** Give the security dimension concrete named categories anchored to OWASP Top
10:2025 — broken access control (now including SSRF), injection, cryptographic failures,
secrets in code/config/logs, unsafe defaults, data exposure. Cheap, and it converts a
category Phantom is probably weak at into one it's checkable at.

### Gap 8, revised — the metric already half-exists.

Round 2 makes this concrete and cheaper than I first estimated. Martian's definition —
*a finding is a true positive if the developer modified the code after it* — needs no
human labeling, and Phantom is unusually well-positioned to capture it: fix loops already
run against review findings, and `ROADMAP.md` line 134 records that `verification.json`
carries `review.fixLoops` in 120/191 sessions.

So the question "was this finding acted on?" is already partly answered by data on disk.
What's missing is attributing the outcome back to the *individual finding* rather than
the review as a whole.

**Revised proposal.** Add a stable finding ID, then record per-finding disposition at fix
time: `fixed` / `dismissed` / `deferred`. That yields precision per severity, per
dimension, and per agent — which is what tells us whether to widen Archer (Gap 11), where
to set the risk threshold (Gap 7), and whether the verification pass (Gap 1) actually
moved anything.

### Gap 14 — Output vocabulary is bespoke. *(low priority)*

Phantom uses `blocking|advisory`, Archer uses P0/P1/P2, `temperature-review.md` uses
P0–P3. Three vocabularies for one concept across three files. Conventional Comments is an
established standard with the label set and a blocking/non-blocking decorator that maps
cleanly onto Gaps 2 and 3.

**Proposal.** Worth doing only if Phantom starts posting findings to GitHub, where the
interop matters. Internally, unifying the three existing scales is the more valuable half
of this.

---

## 4. Recommendation

**Batch 1 — the finding schema.** Gaps 1, 2, 3, 5, and 12 are one coherent change to the
finding schema plus Gaze's pre-write step: verify before writing, separate severity from
confidence, add `preExisting`, require citations, and block only on
*worse-than-before*. They're mutually reinforcing and they target the false-positive
problem every source converges on.

**Batch 2 — instrumentation, in parallel.** Gap 8 with Martian's true-positive definition
and stable finding IDs. This is the prerequisite for deciding anything else on evidence
rather than taste, and round 2 showed it's cheaper than it looked because `review.fixLoops`
already exists.

**Batch 3 — coverage.** Gap 10 (diff-size policy) and Gap 13 (OWASP categories) are
independent, cheap, and evidence-backed. Gap 10 rose in priority once DORA showed PR size
climbing 51.3% year over year.

**Later, and only on data.** Gaps 7 (low-risk fast path) and 11 (widen cross-file
context) are both threshold decisions that Batch 2's data should settle. Gaps 4, 6, 9,
and 14 are independent follow-ons with no ordering constraint.

Two things worth holding onto:

The roster is already six reviewers deep, and everything above is satisfied by editing
prompts, thresholds, and the finding schema. Not one of these fourteen gaps requires a
seventh reviewer — the highest-value changes are all subtractive or clarifying, and
that seems like the constraint worth keeping.

And DORA's finding that AI amplifies existing conditions cuts both ways for a tool like
this. The gaps that make review *sharper* (verification, confidence, citations) compound;
the ones that make it *louder* (more agents, more findings, more advisories) compound too,
in the wrong direction. When in doubt, the evidence favors fewer, better-verified
findings over broader coverage.

---

## Sources

**Primary**
- [Code Review — Claude Code Docs](https://code.claude.com/docs/en/code-review) — pipeline architecture, severity model, `REVIEW.md` tuning levers
- 7 Claude PR Review Prompts for 2026 — Rephrase, Ilia Ilinskii, March 12 2026 (starting point; original at `rephrase-it.com`)
- [What to look for in a code review — Google eng-practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — design, functionality, complexity, tests, naming, comments

**Research**
- [Automating Low-Risk Code Review at Meta: RADAR](https://arxiv.org/abs/2605.30208) — risk-calibrated auto-review at scale
- [How AI Coding Agents Communicate](https://arxiv.org/abs/2602.17084v1) — MSR 2026; PR description structure vs. reviewer response
- [A Roadmap on Modern Code Review](https://arxiv.org/pdf/2405.18216) — challenges and opportunities survey
- [Toward effective secure code reviews](https://link.springer.com/article/10.1007/s10664-024-10496-y) — security weakness coverage in review comments
- [An empirical study of the impact of modern code review practices on software quality](https://link.springer.com/article/10.1007/s10664-015-9381-9)
- [Self-reflection in Automated Qualitative Coding](https://arxiv.org/html/2601.09905) — two-stage critique, FP rates, F1 deltas
- [LLM Self-Review Failure in Code Modernization](https://agentpatterns.ai/patterns/anti-patterns/self-review-modernization-failure/) — why self-review ≠ independent validation
- [Are LLMs reliable code reviewers? Systematic overcorrection in requirement conformance judgement](https://link.springer.com/article/10.1007/s10515-026-00638-5)

**Industry data and standards**
- [DORA 2026 — The ROI of AI-assisted Software Development](https://kodus.io/en/dora-accelerate-state-of-devops/) — review as the AI bottleneck; PR review time +441%, incidents per PR +242.7%
- [Key takeaways from the DORA Report 2025](https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025) — AI as amplifier; throughput up, delivery flat
- [Code Review at Cisco Systems (SmartBear)](https://static1.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf) — 2,500 reviews / 3.2M LOC; the 200–400 LOC and 300 LOC/hr numbers
- [Speed of Code Reviews — Google eng-practices](https://google.github.io/eng-practices/review/reviewer/speed.html) — one business day, LGTM-with-comments, "better than current state"
- [Conventional Comments](https://conventionalcomments.org/) — label vocabulary with blocking/non-blocking decorators
- [OWASP Secure Code Review Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html) — checklist structure; Top 10:2025 mapping
- [Stacked pull requests are now in public preview](https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/) — GitHub native stacked PRs, July 2026

**Benchmarks**
- [Martian Code Review Bench](https://www.coderabbit.ai/blog/coderabbit-tops-martian-code-review-benchmark) — 17 tools, 200k+ PRs; the "developer modified the code after the comment" true-positive definition
- [AI Code Review Benchmark: results from 200,000 real pull requests](https://www.codeant.ai/blogs/ai-code-review-benchmark-results-from-200-000-real-pull-requests)
- [How Qodo built a real-world benchmark for AI code review](https://www.qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review/)
- [Best Code Review Tools 2026 (Greptile)](https://www.greptile.com/content-library/best-ai-code-review-tools) — full-codebase indexing vs. diff-level analysis

**Practitioner**
- [How to Review Code in 2026](https://codeant.ai/blogs/code-review-process-guide) — three-layer automation model
- [Why AI Code Review Overwhelms Developers](https://codeant.ai/blogs/prevent-ai-code-review-overload)
- [Reducing AI Code Review False Positives](https://www.propelcode.ai/blog/ai-code-review-false-positives-reducing-noise)
- [Stacked pull requests — Michaela Greiler](https://www.michaelagreiler.com/stacked-pull-requests/)

# Determinism Architecture: Code vs Prompt in Phantom's Orchestration

Author: Subash Karki
Date: 2026-06-03

## Question

Phantom's orchestration is almost entirely PROMPT-DRIVEN via Markdown directives
(commands/*.md, reference/*.md, agents/*.md). Owner's concern: "Markdown is Markdown —
Claude can honor it or not." Should some of it become CODE for determinism?

Phantom already has deterministic code: JS hooks (subagent law, file-size guard, artifact
validation, memory read/write), JSON-schema validation of artifacts, shell scripts. What's
still prompt-driven is the orchestration LOGIC: routing, planning, deliberation rounds, gate
decisions, verify/fix loop control, power-level scoring, wave assignment, learnings blocking.

---

## What the field actually does

Every serious 2025-26 agent framework draws the SAME line: **the workflow is code; the
node is the LLM.** The disagreement is only about syntax (graph DSL vs plain functions).

### Anthropic — "Building Effective Agents"

The foundational distinction, and it maps 1:1 to Phantom's problem:

> **Workflows** are systems where LLMs and tools are orchestrated through **predefined code
> paths**. **Agents** are systems where LLMs **dynamically direct their own processes**.

Anthropic's five workflow patterns (prompt chaining, routing, parallelization,
orchestrator-workers, evaluator-optimizer) are explicitly *code orchestration* — the
execution path is predetermined; the LLM only fills nodes. Their headline guidance:
**"start with workflows, not frameworks"** and **"use the simplest thing that works; don't
add framework complexity prematurely."** Workflows give predictability/consistency for
well-defined tasks; reserve dynamic agency for genuinely open-ended ones.

Phantom is structurally a **workflow** (fixed phases: route → plan → deliberate → wire →
execute → verify → fix → wrap), yet it encodes the workflow's control flow in *prose* — the
one place Anthropic says code belongs.

### LangGraph — the cleanest statement of the principle

LangGraph is a "deterministic execution engine for AI reasoning workflows." The edges
(control flow) are code; the nodes (reasoning) are LLM. Critical design rule, verbatim from
their docs and the rationale Phantom needs:

> A **router function should only read state and return a string** — it should not call an
> LLM, write to state, or produce side effects. All computation belongs in nodes. **Unlike
> ReAct, the LLM doesn't decide the flow — it acts within the flow you control.**

Conditional edges *can* incorporate an LLM-informed signal, but the **transition itself is
deterministic code** keyed off state. That is exactly the code/prompt seam.

### OpenAI Agents SDK

States the tradeoff plainly:

> While orchestrating via LLM is powerful, **orchestrating via code makes tasks more
> deterministic and predictable** in speed, cost and performance. Common pattern: use
> structured outputs to generate well-formed data you **inspect with your code**, and ask an
> agent to **classify into a few categories, then pick the next agent based on the
> category.**

So even the "router" is split: LLM does ambiguous *classification* → emits a structured enum
→ **code does the dispatch**. Guardrails (input/output/tool) are deterministic validators
that gate LLM output — typed checks, not vibes.

### Microsoft Agent Framework / Google ADK

Both ship a graph-based workflow engine that composes "agent reasoning **with business
logic**, branch on conditions, fan out to parallel steps, and converge." Google ADK 2.0:
"compose AI-powered agents **and deterministic execution nodes** into an execution graph."
Both treat **fan-out / wave / parallel-step scheduling as engine code**, never as a prompt
instruction. (Phantom's wave assignment is the direct analog — and is currently prose.)

### DSPy — relevant but orthogonal

DSPy treats prompts as **compiled artifacts** optimized against a metric (signatures +
modules + metric → optimizer compiles the prompt). It makes a single node's prompt more
*reliable/portable*, not the *control flow* deterministic. Relevance to Phantom: **low for
orchestration** (Phantom's problem is flow, not prompt wording), **medium-later** for
high-value repeated nodes (e.g. the power-level reviewer) where a compiled, metric-tuned
prompt would beat hand-written prose. Not the first move.

### Guardrails / validators (Guardrails AI, Instructor, Pydantic, Zod)

The "Guard" pattern: a composable pipeline of **deterministic validators** intercepts LLM
output; on failure it **retry / fix / reject**. Instructor feeds the validation error back
into the prompt and re-asks. This is the productionized form of "LLM proposes, code
disposes." Phantom already does the easy half (JSON-schema validation of artifacts via
validate-artifact.js). It does NOT yet do the **gating half** — schema-valid output can still
carry orchestration decisions (route, verdict, wave) that no code checks.

### Router-as-code consensus

> Use a router when you have **clear input categories** and want deterministic/lightweight
> classification. This is a classification problem, not an agent problem.

LLM-judge routing is more accurate on ambiguity but: slower, costlier, and **"if judge
reliability falls below ~80%, performance drops rapidly."** Production answer is **hybrid**:
cheap rules catch obvious cases → embedding/classifier for the general case → LLM only for
borderline → manual overrides for high-value cases.

---

## The principle (the seam)

> **Control flow, gates, state transitions, counters, and topology are CODE
> (deterministic). Reasoning under ambiguity, classification of fuzzy input, synthesis, and
> judgment are LLM (probabilistic). The LLM emits a typed value; CODE reads that value and
> decides what happens next.**

Restated as a test for any orchestration decision:

- Is the output a **bounded enum / number / boolean** AND is the **transition rule fixed**?
  → **CODE.** (route dispatch, gate count, loop ceiling, wave scheduling, blocking)
- Does it require **weighing fuzzy signals** with no closed-form rule? → **LLM.**
  (is this scope ambiguous? is this finding a real P0? did Rival catch a genuine flaw?)
- Both? → **HYBRID:** LLM scores/classifies (judgment), code thresholds/dispatches/counts
  (determinism). This is the dominant production pattern across every framework above.

Cost of over-coding (be honest): rigidity, lost adaptability, and **brittleness when the
hard-coded category set doesn't fit reality** — a coded router with the wrong taxonomy fails
silently where an LLM would have adapted. Anthropic's "simplest thing that works" applies:
only harden a decision once its *non-determinism has actually bitten you*. Don't pre-build a
graph engine.

---

## Phantom code-vs-prompt-vs-hybrid map

| # | Piece | Today | Verdict | Why / framework analog |
|---|-------|-------|---------|------------------------|
| 1 | **Router classification** (uncertainty/scope → route) | prompt-only (router/algorithm.md) | **HYBRID** | The *signal extraction* (domain novelty, ambiguity, competing patterns) is genuine fuzzy judgment → keep LLM. But the **weighted_sum, the 0.2/0.4/0.6 thresholds, the bias arithmetic, and route selection** are a closed-form formula written in prose Claude re-derives each run → move to a deterministic scorer. LLM emits the 4 signal floats + chosen-route reason; **code computes uncertainty/scope, applies learnings bias, picks the route.** Exactly OpenAI's "classify into categories, then code picks the next agent." |
| 2 | **Route → gate count** (DIRECT=0, PLAN=1, BRAINSTORM=2, FULL=3) | prompt (router.md table) | **CODE** | Pure lookup table. Zero judgment. A const map. Today nothing stops Claude from "feeling" a FULL task only needs 1 gate. Anthropic workflow-routing = predefined path. |
| 3 | **Planner↔Rival deliberation rounds** (max 2, never 3) | prompt (deliberation.md) | **HYBRID** | The verdict (PROCEED/REVISE/RETHINK) and the *challenges* are pure reasoning → LLM. The **round counter and the hard "always present after Round 2" stop** are control flow → code-enforced (the loop ceiling must not be a polite suggestion). LangGraph: LLM acts within the loop; the loop bound is the graph's. |
| 4 | **Verify → fix loop (max 3 / "max 2 loops")** + same-finding-class escalation | prompt (verification.md, temperature-review.md) | **CODE** (the loop control) | This is the highest-risk prose rule. A loop ceiling and "same finding class twice → escalate" are **deterministic counters** — precisely what an LLM forgets under context pressure (stacking patches on a wrong hypothesis is the exact failure user's CLAUDE.md warns about). The *fix* and the *re-review* stay LLM; the **iteration count, the stop, the dup-class detector are code.** Evaluator-optimizer is an Anthropic *workflow* pattern = coded loop. NOTE: router.md says "max 3," temperature-review.md says "Max 2 loops" — a prose-drift bug a coded constant eliminates. |
| 5 | **Power-level P0–P3 scoring** | prompt (temperature-review.md) | **LLM (judgment) + CODE (gate)** = HYBRID | "Is this a real P0 vs a P2 I should drop?" is irreducible judgment → LLM, and a *compiled/DSPy-tuned* prompt could later improve it. But **"P0/P1 → block ship; P2/P3 → drop"** is a deterministic gate on the typed output. Guardrails pattern: LLM produces structured findings[], **code enforces the ship/block policy.** Keep scoring LLM; harden the gate. |
| 6 | **Wave assignment in wiring** (topological sort of produces/consumes) | prompt (wiring.md) | **CODE** | Topological sort is a *solved algorithm*. Cycle detection, "Wave N consumes only Wave N-1," parallel grouping — all deterministic graph ops an LLM does slowly and sometimes wrongly. MS Agent Framework / ADK make fan-out/scheduling **engine code**, never a prompt. The produces/consumes *declaration* per task is LLM (reading intent); the **sort + validation is code.** Highest-confidence pure-code win. |
| 7 | **Learnings anti-repetition blocking** (`[failed]` = BLOCKED, `[validated:5+]` = auto-apply) | prompt (learning-system.md) + memory-reader.js | **CODE (the block) + LLM (the match)** = HYBRID | "Does this approach match a `[failed]` learning?" is fuzzy semantic matching → LLM. But once matched, **`[failed]` → hard block** and **`[validated:5+]` → auto-apply** are policy gates that must not be negotiable — this is a *guardrail*, and a guardrail Claude can rationalize past in prose is no guardrail. memory-reader.js already loads them; extend it (or a PreToolUse hook) to **assert** the block rather than narrate it. |

### Summary by verdict

- **Move to CODE (control/gates/topology):** #2 gate-count map, #4 verify/fix loop counter +
  dup-class stop, #6 wave topological sort/validation.
- **HYBRID (LLM scores, code decides):** #1 router (signals=LLM, formula/threshold=code),
  #3 deliberation (verdict=LLM, round ceiling=code), #5 power-level (P0–P3=LLM, ship-gate=code),
  #7 learnings (match=LLM, block=code).
- **Stays LLM:** all the actual reasoning inside nodes — planning content, challenges,
  finding rationale, synthesis, ambiguity calls. Don't touch these.

---

## Single highest-leverage change

**Harden the verify→fix loop control (#4) into code first.** It is the one place where a
prose-only rule directly enables the most damaging failure mode — stacking patches on a wrong
hypothesis past the intended ceiling — *and* it currently carries a live prose-drift bug
(router.md "max 3" vs temperature-review.md "max 2"). A ~30-line loop controller (a hook or a
tiny JS module the verify/fix commands call) that owns the iteration counter, the hard stop,
and the same-finding-class escalation converts the single riskiest probabilistic gate into a
deterministic one — and forces resolution of the contradictory constants. Best
risk-reduction-per-line in the whole map, and fully aligned with Anthropic's "simplest thing
that works": one coded counter, not a graph engine.

The #1 router and #6 wave-sort are the next two (both have a clean LLM-signal / code-decision
seam and #6 is a pure solved algorithm), but neither has #4's "actively enables a known
damaging failure" property.

---

## A note on not over-correcting

Phantom's prose-driven flow is *not* a mistake to erase wholesale — it's why Phantom is
adaptable. The recommendation is surgical: **code the ~7 enumerable control-flow/gate/counter
decisions; leave every reasoning node in Markdown.** Resist building a LangGraph-style engine
— that's the "framework complexity prematurely" Anthropic warns against. Convert a decision to
code only after its non-determinism has actually caused a bad outcome (loop #4 already has).

---

## Sources

- Anthropic, *Building Effective Agents* — https://www.anthropic.com/engineering/building-effective-agents
- LangGraph conditional edges / router design — https://docs.langchain.com/oss/python/langgraph/graph-api , https://stuart.mchattie.net/posts/2025/10/25/flow-control-in-langgraph/
- OpenAI, *A practical guide to building agents* (code vs LLM orchestration; guardrails; handoffs) — https://openai.github.io/openai-agents-python/multi_agent/ , https://openai.github.io/openai-agents-python/guardrails/
- Microsoft Agent Framework workflows — https://learn.microsoft.com/en-us/agent-framework/workflows/
- Google ADK workflows — https://google.github.io/adk-docs/workflows/
- DSPy programmatic prompt optimization — https://towardsdatascience.com/systematic-llm-prompt-engineering-using-dspy-optimization/ , https://www.statsig.com/perspectives/dspy-vs-prompt-tuning
- Guardrails AI / Instructor / Pydantic / Zod validation — https://github.com/guardrails-ai/guardrails , https://python.useinstructor.com/concepts/reask_validation/ , https://futureagi.com/blog/what-is-llm-input-output-validation-2026/
- Router-as-code vs LLM-judge tradeoffs — https://docs.langchain.com/oss/python/langchain/multi-agent/router , https://medium.com/@tannermcrae/rethinking-ai-agents-why-a-simple-router-may-be-all-you-need-c95031c2d397 , https://arize.com/blog/best-practices-for-building-an-ai-agent-router/

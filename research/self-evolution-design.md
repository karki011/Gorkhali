# Phantom Self-Evolution — Design & Rollout Plan

Author: Subash Karki
Date: 2026-06-27
Status: DRAFT — pending human gate
Basis: cross-repo fan-out research (engram, agentic-memory, EvoMap/awesome-agent-evolution, TeleAI/Awesome-Agent-Memory) + internal scout of phantom's current evolution machinery.

---

## Read this first (the governing constraint)

The goal: **phantom evolves itself from experience — autonomously, not via a user-typed `/phantom:evolve`.** The human analogy is the right one: experience during work, consolidation over time, knowledge hardening into instinct, skills refined with a coach checking you didn't get worse.

But the disciplined version of that goal is narrow. Two facts reframe the whole effort:

1. **Phantom is already half-autonomous.** Capture → classify → score → dedup → `[validated:N]` bump → auto-graduate at `[validated:5]` all run today, every session, with **no user action**, via the `Stop` hook (`memory-writer.js`) and `PreCompact` (`memory-consolidator.js`). Injection of relevant learnings into each prompt runs via `UserPromptSubmit` (`memory-reader.js`). **The autonomous loop exists.**

2. **Only three things are NOT autonomous**, and they are not equally safe to automate:
   - **Promotion + distillation** (Tier 1) — additive, reversible. Currently gated behind manual `/phantom:evolve`. **Safe to automate now.**
   - **Skill/agent prompt rewriting** (Tier 2/3) — designed, never built. Mutates the system's own instructions. **Dangerous; must be eval-gated.**
   - **Efficacy signal** — `[validated:N]` means "seen N times," not "helped N times." No fitness function exists. Without it, evolution optimizes popularity, not usefulness.

Governing rule (per phantom's own *Less is More* / *Commit and Iterate*): **automate the additive, reversible step first; eval-gate anything that rewrites instructions; let real session data pick what to evolve next.** Do not build all tiers up front.

---

## Current state (grounded)

| Stage | Mechanism | File | Autonomous? |
|-------|-----------|------|-------------|
| Observe | tool-call logging → `observations/*.jsonl` | memory hooks | ✅ |
| Classify/score/dedup | domain + confidence + dedup_key | `scripts/extract-learnings.js` | ✅ |
| Validate | bump `[validated:N]` on re-observation | `hooks/memory-writer.js` | ✅ |
| Graduate | `[validated:5]` → `learnings/{domain}.md` | `hooks/memory-writer.js` | ✅ |
| Inject | top-5 relevant learnings into prompt | `hooks/memory-reader.js` | ✅ |
| **Promote** | `[validated:5+]` → `reference/global-patterns/` | `scripts/evolution-runner.js` | ❌ **manual `/phantom:evolve`** |
| **Distill** | flag/condense oversized domain files | `scripts/evolution-runner.js` | ❌ **manual** |
| **Skill evolve (T2)** | rewrite `commands/*.md` from repeated `[failed]` | — | ❌ **not built** (`skill-evolution:` prefix reserved) |
| **Skill spawn (T3)** | new `commands/*.md` from recurring patterns | — | ❌ **not built** (`skill-spawn:` reserved) |
| **Agent self-rewrite** | edit `agents/*.md` from outcomes | — | ❌ **not built** |
| **Efficacy** | did an injected learning reduce retries/cost? | — | ❌ **not built** |

Key thresholds (`scripts/lib/constants.js`): `GRADUATION_THRESHOLD=5`, `MAX_AUTO_ENTRIES=80`, `MAX_INDEX_AUTO_LINES=100`, `STALE_DAYS=3` (auto) / `30` (evolution).

---

## The autonomous trigger (the core of "no user invoke")

Claude Code offers exactly two trigger surfaces that fire without the user. Use both, for different cadences:

### 1. Event-driven — `Stop`-hook scheduler (reflex)
Extend the existing `Stop` hook with an `evolve-scheduler.js` step that checks **"is evolution due?"** and, if so, runs `evolution-runner.js` in the background. Due = ANY of:
- `sessions_since_last_evolve ≥ N` (default 5), OR
- `new_graduated_since_last ≥ M` (default 3), OR
- any `learnings/{domain}.md` over its size cap, OR
- any entry past its `review_after` date.

Debounce via `state/last-evolved.json`. This makes promotion + distillation autonomous with near-zero risk (additive, git-tracked, reversible).

### 2. Time-driven — scheduled agent (sleep consolidation)
A nightly/weekly scheduled run (`schedule` skill / CronCreate) for the heavier, tiered pass — contradiction detection, distillation, and (later) eval-gated prompt evolution. This mirrors `agentic-memory`'s **production** model: Raw→Episode (nightly) → Summary (weekly) → Pattern (monthly) → Trait (quarterly), with high-significance entries **immune** from compression. That project ships exactly this through Claude Code hooks — it is proof the scheduled-consolidation model works, not theory.

---

## Tiers by risk (build in this order)

### Tier A — Autonomous promotion + distillation `[APPROVE NOW]`
- Add `hooks/evolve-scheduler.js`, wire into `hooks.json` `Stop`.
- Move Tier 1 promotion off `/phantom:evolve`-only; the command stays as a manual override.
- **Risk:** low. Output is additive (`reference/global-patterns/*`), git-committed, reversible.
- **Auto-Reflexion add-on:** wire every red test/build (Ward / `verify`) to auto-write a `CORRECTION [...]` entry. Format already exists; only the trigger is missing.

### Tier B — Eval-gated agent/skill prompt evolution `[NEXT, after A proves out]`
When `[failed]` corrections for a given agent/skill accumulate across ≥ N sessions:
1. An OPRO/TextGrad-style job proposes an edit to that `.md` (feed it: current prompt + the failures + their fixes).
2. Run `phantom:eval` **champion vs challenger** on a *frozen* set of past sessions.
3. Merge ONLY if challenger wins by margin; else discard. Commit `agent-evolution:` / `skill-evolution:` for audit + one-command rollback.
- **Risk:** high — this rewrites the system's own instructions. The frozen-eval gate is non-negotiable.

### Tier C — Contradiction detection + efficacy scoring `[LATER]`
- **Contradiction (engram + agentic-memory belief revision):** on new learning, grep/BM25 surfaces top candidate conflicts; agent judges `supersedes | conflicts | not_conflict`. agentic-memory goes further — cascade confidence-weakening to dependents and list `invalidated_decisions`. Phantom has **zero** contradiction detection today.
- **Efficacy (Evo-Memory):** track whether an injected learning was used and whether it reduced retries/cost; demote ineffective + `[failed]`. This is the missing fitness function.
- **Significance ranking (agentic-memory 7-factor):** rank by `referential_weight` (how many other learnings cite it) as much as recency. Validate first — a 2-factor model (referential_weight + recency) likely captures most value at a fraction of the complexity.

---

## Guardrails (non-negotiable)

From the convergent "safe evolution" literature across all five sources:

1. **Frozen-eval gating before any prompt promotion** — champion/challenger on held-out past sessions; auto-rollback on regression. Prevents reward-hacking the live task.
2. **Append-don't-overwrite + decay-by-review, not delete** — stamp `review_after` by type (engram: decision 6mo / policy 12mo / preference 3mo); age to `needs_review`, never silent-delete. Preserves audit, fights stale-learning rot.
3. **Conflict check before ingest** — no new learning silently contradicts an existing one.
4. **Efficacy demotion** — popularity ≠ usefulness; demote learnings that don't measurably help.
5. **Human gate retained for base agent-definition edits** (or behind a config flag) — everything additive/reversible stays autonomous; instruction-rewrites stay gated until trusted.
6. **No unbounded self-rewrite** — avoid the Darwin-Gödel extreme. Version + diff every evolution event; bounded scope per run.

---

## Explicitly NOT building yet (Less is More)

- Full 7-factor significance scorer (start with ≤2 factors, validated against real reuse data).
- Vector/embedding retrieval (grep + INDEX is sufficient; no new infra).
- Tier 3 skill spawning (wait for evidence of recurring multi-step patterns).
- Evolving *all* agents at once (let session-eval data pick the first target).

---

## Open questions to settle before coding

1. **Trigger thresholds** — start at `sessions≥5 OR graduated≥3`? Or cadence-only (nightly cron)? Recommend Stop-hook thresholds for Tier A, cron for Tier B/C.
2. **Which agent drifts first?** — don't guess. Pull `[failed]`-by-agent counts from `learnings/` + session evals; evolve the worst offender first.
3. **Eval corpus** — does `phantom:eval` already have a frozen regression set of past sessions, or must we assemble one? Tier B blocks on this.
4. **Autonomy ceiling** — should Tier B auto-merge eval-winning prompt edits, or always open a reviewable diff? Default: reviewable diff until trust is established (config flag to flip).

---

## Recommended first slice (commit-and-iterate)

1. **Tier A**: `evolve-scheduler.js` on `Stop` → autonomous promotion + distillation.
2. **Auto-Reflexion**: failure event → auto `CORRECTION` entry.
3. **Measure** retry/cost reduction for ~2 weeks before touching Tier B.

Ship the smallest autonomous slice that has demonstrated value; let real session failures pull the rest into code.

---

## Source appendix — top steal per repo

- **engram** (4.7k★, MIT, coding-agent memory): BM25-propose / LLM-judge **contradiction pipeline**; `review_after` decay-by-type; `topic_key` upsert + `revision_count` (collapses an evolving decision into one canonical entry — fixes "learnings files get large").
- **agentic-memory** (MIT, Rust + MCP + Claude Code hooks): **scheduled tiered consolidation with significance immunity** (the autonomous model, in production); belief-revision contradiction cascade; 7-factor significance (`referential_weight` highest).
- **EvoMap/awesome-agent-evolution**: OPRO, TextGrad, EvoPrompt, Promptbreeder (evolve prompts without weight training); Reflexion; EvoAgentX (evolve whole workflows); Live-SWE-agent (runtime self-evolution, 77.4% SWE-bench Verified).
- **Awesome-Agent-Memory**: episodic/semantic/procedural taxonomy; Voyager skill-library growth; Generative-Agents reflection trees; A-MEM Zettelkasten linking (→ markdown `[[wikilinks]]`); Evo-Memory (how to *measure* a self-evolving memory).

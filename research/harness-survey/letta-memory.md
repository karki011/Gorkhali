# Letta Memory Architecture — What Phantom Should Steal
**Date:** 2026-06-03  
**Author:** Subash Karki  
**Sources:** letta.com/blog/sleep-time-compute, letta.com/blog/memory-blocks, docs.letta.com/guides/agents/memory, arxiv.org/abs/2504.13171

---

## Letta Memory in One Paragraph

Letta (formerly MemGPT, Berkeley / Letta AI, Apr 2025) organizes agent memory in three tiers:

| Tier | Location | Agent control |
|------|----------|---------------|
| **Core memory blocks** | In-context, character-capped | Agent calls `memory_edit()` tool to rewrite in place |
| **Recall memory** | External store, full conversation history | Agent calls search tools to retrieve |
| **Archival memory** | External vector store, arbitrary facts | Agent calls insert/search tools |

Agents are *active participants* in their own memory — they call explicit tool functions to edit core blocks, push to archival, or pull from recall. Nothing is injected passively. The key primitive is the **memory block**: a named, character-limited text region in-context that the agent can overwrite at any turn. Blocks are shareable across agents (same block object, multiple agents see it live).

---

## Idea 1 to Steal — Sleep-Time Compute (PRIORITY)

### What Letta does

Sleep-time compute (arxiv 2504.13171, Apr 2025) introduces a **dedicated offline agent** that runs *between* user sessions:

- Architecture: two agents under the hood — **primary agent** (handles live interaction, NO memory-edit tools) + **sleep-time agent** (has memory-edit tools, runs async).
- Sleep agent reads primary's conversation history + archival memory, then **rewrites the primary's core memory blocks** with consolidated "learned context."
- Trigger: after each user session ends (or on document upload). Not inference-time — it runs when the primary is idle.
- Output: rewritten memory blocks containing synthesized patterns, not raw transcripts. The primary sees pre-digested insights on next wake.
- Result (paper benchmark): same accuracy with significantly less test-time compute on Stateful GSM-Symbolic and Stateful AIME. Sleep-time compute improves the Pareto frontier — you reach the same accuracy at lower per-query cost because hard reasoning was already done offline.

### What Phantom is doing now

`/phantom:evolve` scans learnings files, promotes patterns, demotes stale entries. `memory-consolidator.js` fires as a PreCompact hook when context approaches limits (reactive). Both are *inline* — they run during the active session and block forward progress.

### The steal

**Run a true offline consolidation pass as a post-session hook** — after Claude Code exits or after `/phantom:wrap`, not during. Concretely:

1. `hooks/session-end.js` (or a new `hooks/sleep-consolidate.js`) fires after session close.
2. It reads the session's transcript + per-repo learnings files.
3. Calls a Claude invocation (non-interactive, cheap Haiku/Sonnet) with a fixed prompt: *"Given these raw learnings entries, synthesize: (a) promoted patterns ready to auto-apply, (b) deprecated entries to mark `[retired]`, (c) new cross-repo patterns."*
4. Writes output back to learnings files before next session starts.

**Key difference from current evolve**: it runs *outside* the active context window so it costs zero inference tokens during the live session. The primary agent (next Claude session) wakes to already-consolidated learnings.

**Mapping:**
- Letta sleep agent ↔ Phantom `sleep-consolidate.js` post-session hook
- Letta primary's core memory blocks ↔ Phantom `learnings/{domain}.md` files
- Letta "learned context" ↔ Phantom promoted `[validated:5+]` entries

---

## Idea 2 to Steal — Self-Editing Memory Blocks with Explicit Rewrite Semantics

### What Letta does

Core memory blocks are not append-only logs — agents *overwrite* them in place via `core_memory_replace()` / `core_memory_append()` tool calls. The agent actively decides what to retain, compress, or discard at each turn. Character limits force lossy compression: when the block is full the agent must rewrite, not just append.

Key property: the agent is prompted to treat memory editing as a first-class responsibility, not a side effect. The "Human" block is a living summary of the user, updated as new facts arrive. Old contradicted facts are removed, not stacked.

### What Phantom is doing now

Phantom's learnings are **append-only** with inline scoring markers. A correction entry like `CORRECTION [foo]: [wrong] — [right] [failed]` never removes the original wrong entry — both sit in the file. Over time, domain files accumulate contradictory stacked patches. The INDEX.md validation count (`[validated:5+]`) signals promotion but the raw entries remain.

### The steal

**Add a rewrite step to the existing evolve/promotion pipeline.** When a `[validated:5+]` pattern is promoted, *replace* the original stacked entries with a single canonical entry. When a `[failed]` correction has a later validated fix, *remove* the original failed entry (don't just add another marker).

Concretely in `phantom:evolve`:
1. On promotion: collapse all entries for the same `[keyword]` into one canonical block.
2. On validation≥5: mark old `CORRECTION` chain as `[consolidated]` and write a new top-level `PATTERN` entry.
3. On conflict: prefer the most-recently-validated entry, strike the older.

This keeps domain files from becoming adversarial soup where `[failed]` and `[validated]` entries for the same keyword coexist and confuse future reads.

**Mapping:**
- Letta `core_memory_replace()` ↔ Phantom evolve collapsing duplicate/contradictory entries
- Letta character limit forcing compression ↔ Phantom enforcing max N entries per keyword

---

## Idea 3 to Steal — Shared Memory Blocks Across Agents

### What Letta does

A memory block is an object (not a file per agent). Multiple agents share the same block instance — edits by the sleep agent are instantly visible to the primary. This enables: background agents enriching shared knowledge bases, team agents maintaining consensus state, sleep agents patching the primary's context without the primary doing anything.

### What Phantom is doing now

Phantom already has per-repo + global learnings files accessible to all spawned subagents. The mechanism is almost identical — a subagent reads `~/.claude/phantom/repos/{REPO}/learnings/` and the global `learnings/` dir. The missing piece: subagents don't *write back* to learnings during their session. Only `/phantom:wrap` or `/phantom:evolve` consolidates.

### The steal (lighter lift)

**Allow subagents to append provisional learnings inline during their session**, tagged `[provisional]`, and have the post-session hook promote or discard them. This mimics Letta's live memory-block writes without requiring subagents to run full consolidation logic.

No new infrastructure needed — just a convention:
- Subagents write `PROVISIONAL [{keyword}]: [{observation}] ({date})` to the domain learnings file during their run.
- `sleep-consolidate.js` post-session hook reviews all `[provisional]` entries, validates against session outcome, promotes to `CORRECTION` or `PATTERN`, or drops.

---

## Where Phantom is Already Doing It Right (Don't Touch)

**Explicit `[failed]` blocking with validation counts is better than Letta's approach.**

Letta's memory blocks are free-form text the agent rewrites. There is no structural mechanism to block re-application of a previously failed approach — the agent might re-derive and re-apply a bad pattern if the memory block was compressed and the failure context lost.

Phantom's `[failed]` tag with keyword indexing and the rule *"if keyword matches a `[failed]` entry, explain why this approach is different before proceeding"* is a **stronger anti-repetition guarantee**. It's procedural enforcement, not hopeful summarization. The validation count (`[validated:5+]` = auto-apply) is also more explicit than Letta's implicit confidence-via-recency.

Letta would need explicit tooling to replicate this. For a plugin (not a stateful server), Phantom's scored-text approach is appropriate and sufficient. Don't replace it with embeddings-based retrieval — the keyword match is fast, zero-dependency, and auditable.

---

## Summary: 3 Things to Steal, 1 Thing to Keep

| # | Idea | Phantom change | Effort |
|---|------|---------------|--------|
| 1 | **Sleep-time compute** — offline consolidation after session ends | New `hooks/sleep-consolidate.js` post-session hook | Medium |
| 2 | **Self-editing memory (rewrite, not append)** — collapse contradictory entries on promotion | Update `phantom:evolve` to rewrite stale/conflicting entries | Low |
| 3 | **Shared blocks / provisional writes** — subagents write provisional learnings live | Convention + sleep hook validates provisionals | Low |
| — | **Keep as-is**: `[failed]` blocking + `[validated:5+]` auto-apply | No change — structurally stronger than Letta's free-form memory | — |

**Highest leverage move: sleep-time consolidation.** It's research-validated (improves Pareto accuracy/compute tradeoff), zero active-session cost, and maps cleanly to Phantom's existing post-session hooks infrastructure. The other two are hygiene improvements that compound on top of it.

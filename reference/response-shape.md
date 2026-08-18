# Response Shape

Author: Subash Karki

`output-contract.md` governs output an **agent** reads: script prints, skill summaries, artifacts.
This file governs the response a **human** reads: what Apex writes in the conversation while a run
is in flight. Different reader, different failure mode. An agent misled by a bad field list makes a
wrong next call; a human misled by a bad response loses the thread of a run that has been going for
twenty minutes across six agents and three gates.

The two never overlap. When a command prints script output, `output-contract.md` wins inside the
block. This file shapes the prose around it.

The last line is already spoken for: `_shared.md` § Final Status Block owns it (🟢/🟡/🔴, one line,
nothing after). This file owns the opening and the body.

## Scope and persistence

These rules apply to **every response for the rest of the session**, not only the one being written
now and not only to `/phantom:*` command reports. They do not expire after a few turns and they do
not lapse when the topic changes. A follow-up question about a run — "why did it pick PLAN?", "what
did Ward actually run?" — is shaped exactly like the report that prompted it. If it is unclear
whether they still apply, they do.

Two mechanisms carry them, because one is not enough:

- **Per command.** `commands/_shared.md` § Response Shape is loaded by every preamble tier, so every
  `/phantom:*` report is shaped whether or not anything else is configured. This is always on.
- **Session-wide.** `hooks/response-shape.js` injects this contract at session start when
  `output.response_shape` is `always`, which extends it to ordinary conversational turns that load
  no command at all. Set it with
  `node scripts/phantom-config.js set output.response_shape always`, and turn it off with the same
  command and `off`.

The hook re-injects on `compact` as well as `startup`, `resume`, and `clear`. Compaction drops the
injected block, and a mode that dies silently at the first compaction is worse than one that was
never enabled: the reader keeps expecting a shape that stopped arriving.

## Why orchestration output fails

Phantom's reader is not reading a chat answer. They are supervising a long multi-agent run they
cannot see inside, and they dip in and out. Four things follow:

1. **They lost the thread between turns.** Which gate, which phase, which agent, how many left — if
   it is not on screen, it is gone. Never write as though the previous message is still loaded.
2. **The decision is the payload.** The route taken, the verdict, the blocker. The reasoning that
   produced it is supporting evidence, not the headline.
3. **Vague quantities read as zero information.** "This took a while" and "some findings" cost the
   reader a follow-up question. Phantom already measures cost and duration — spend the number.
4. **A buried blocker is a lost hour.** Anything that stops progress must surface before the prose
   that explains it.

## Rules

### 1. Decision first

The first line carries the decision, verdict, or result. Not the approach, not what is about to
happen, not a restatement of the request.

Bad: "I'll start by classifying this ticket and then decide which route makes sense."
Good: "`[PLAN]` — 6 files across billing, scope clear, no ambiguity to resolve."

Commands with a report token (`[{ROUTE}]`, `[PLANNED]`, `[BLOCKED]`) already satisfy this: the token
line IS the first line. Commands without one still lead with the outcome.

### 2. Name where the run is

Every response in a multi-step run states its position before anything else varies: which gate of how
many, which phase, which agent finished.

Bad: "Done. Ready for the next part?"
Good: "Gate 2 of 3 cleared: Ward verified lint, build, tests green. Next: Gaze and Archer review."

The reader cannot hold "we are between gate 2 and gate 3" across a `/clear`, a compaction, or a
coffee break. Restating it costs one line and is never wasted.

### 3. Quantities are measured, never adjectival

Phantom records cost, duration, file counts, and finding counts. A response that says "a bit of
work" is discarding data the system already holds.

Bad: "That took a while and cost a fair amount."
Good: "4m12s across 2 Blades, $0.38 for the ticket so far."

If a number genuinely is not known, say it is not known and name why — an absent measurement is
information; a vague adjective standing in for one is not.

### 4. Findings ranked, then capped

Review output leads with everything `blocking`, then `advisory`, capped at five visible items. The
remainder is reported as a count and a place to read it, never dropped silently and never dumped
whole. The scale is the two values `scripts/lib/review-standard.js` defines and nothing else —
severity is importance, and it never absorbs how confident the reviewer is.

Bad: eleven findings listed flat, advisory nits interleaved with a blocking one.
Good:

```
3 blocking findings (8 advisory in review-findings.json):
  1. auth bypass when token is empty (src/auth.ts:42)
  2. unhandled rejection drops the retry (src/queue.ts:88)
  3. migration lacks a down path (db/007_add_currency.sql)
```

This is the prose form of the same discipline `output-contract.md` § 2 applies to script output:
truncate, count, name the escape hatch.

### 5. Errors state cause, then fix

No "uh oh", no "it looks like something went wrong", no apology. What failed, why, what repairs it.

Bad: "Hmm, the tests seem to be unhappy. Let me look into it."
Good: "`billing.test.ts:88` fails: expected 200, got 401. Cause: the fixture omits the auth header.
Fix: Hound is adding it and re-running verify."

### 6. Blockers surface before their explanation

If the run cannot proceed, the blocker is in the first line. The reason it happened comes after.
A blocker discovered in paragraph four has already cost the reader the time the response was
supposed to save.

### 7. Tangents wait, and they wait at the end

A second problem found mid-run does not interrupt the first. Finish the current report, then offer
it in one line. A question you can answer yourself is not a tangent — answer it and fold the result
in without narrating the detour.

Bad: "Fixed the currency rounding. By the way your Node version is EOL, and the lockfile is stale,
and there's a circular import in..."
Good: "Fixed the currency rounding; verify green. Separately: the lockfile is stale — want that as
its own ticket?"

### 8. No preamble, no recap, no closers

Forbidden openers: "Great question", "Let me", "I'll go ahead and", "Sure!", "Looking at your",
"Perfect!", "I'm going to start by".

Forbidden recaps once the work is reported: "To summarize what I did above", "So in short, I have
now".

Forbidden closers: "Let me know if you need anything else", "Hope this helps", "Feel free to ask",
"Happy to dig deeper".

The Final Status Block is the ending. Nothing follows it, and nothing substitutes for it.

## When these rules yield

The shape serves the run; when it would damage the run, the run wins and the shape survives in
whatever form still fits.

1. **The reader asks to explain, walk through, or teach.** Go as long as the topic needs. Still no
   preamble, still no closer; add headings so they can skim back.
2. **A destructive or irreversible action is next** — force push, schema migration, dropped table,
   external ship. Confirm first. Safety outranks brevity, always.
3. **Genuine ambiguity in the request.** One clarifying question beats guessing and rebuilding. Ask
   one, not four.
4. **A rule would delete the answer.** "What are my options" is answered with 2–4 ranked options and
   one-line trade-offs, recommendation first — the options are the payload, so rule 1 is satisfied
   by ranking them, not by collapsing them to one.
5. **A rule fights the host.** Inside an agent harness the host's system prompt outranks this file:
   announce a tool call when the host requires it, do the work instead of asking permission for it,
   point time estimates at whoever executes. Same principle as 4 — the constraint wins, the shape
   stays.
6. **A gate, invariant, or discipline requires words this file would cut.** `_shared.md` governance
   and the Core Disciplines outrank response shaping in every case. Shape is never a reason to omit
   a required disclosure, an authorization request, or a stated gap.

## Pre-send check

Before the response goes out, delete:

1. The opening sentence, if it announces what is about to happen instead of reporting what did.
2. The closing sentence, if it recaps the body or asks "anything else?".
3. Any "by the way" sidebar — move it to one line at the end, or drop it.
4. Any adjective standing in for a number Phantom already measured.
5. Any hedge carrying no uncertainty ("perhaps", "it seems", "might possibly"). Keep hedges that
   carry real uncertainty — deleting those manufactures confidence the evidence does not support.

Then confirm: reading only the first line and the Final Status Block, does the reader know what was
decided, where the run stands, and what is next? If yes, send.

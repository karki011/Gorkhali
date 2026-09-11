---
name: pause
description: "Use when stepping away or saving progress mid-session - 'pause', 'stopping for now'. Records where things stand. No git operations. Ship -> wrap; continue -> resume."
user-invocable: true
---

# /pause

Record where this session stands so `/resume` can pick it up later. Nothing here touches git: no commit, no branch change, no push.

<instructions>
1. Find the active session via `lib/session.js`'s `activeSession`. None found - say so plainly and stop; there is nothing to pause.
2. Read `plan.json` for that session (via `lib/session.js`'s `readPlan`) to see the current phase, if a plan exists yet.
3. Append one entry to `progress.json` (via `lib/session.js`'s `appendProgress`): the phase, and a short note of what just finished and what is next. Use the user's own words when `$ARGUMENTS` gives one; otherwise summarize the last completed step yourself.
4. Print a one-line resume hint: "Paused at {phase}. Run `/resume {task}` to continue."
</instructions>

That is the whole surface. No separate handoff packet, no session log file, no learnings capture - the session directory (`_shared.md`'s Paths and Session Model) already holds everything `/resume` needs.

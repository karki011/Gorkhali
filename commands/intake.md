---
name: intake
description: "Capture originator intent as dual-readable intent.md before planning; NOT start, execute, or wrap."
argument-hint: "<idea, ticket, or incident>"
user-invocable: false
---

> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)

# /gorkhali:intake "$ARGUMENTS"

Write a proto-spec the next stage can act on. Do not plan, mutate product code,
or ship. Session JSON stays canonical once `start` runs; this file is the
human-readable Plan artifact.

1. Take the originator's words as-is. Ask only what an analyst would ask:
   problem, proposed outcome, affected users and systems, constraints, open
   questions. No formal language required.
2. Resolve a task id from `$ARGUMENTS` (`[A-Z][A-Z0-9]+-\d+`), else a slug from
   the title. Locate an existing file first:

   ```text
   node <skill-directory>/scripts/sdlc-chain.mjs locate-intent --workspace <workspace> --task <id>
   ```

   Prefer `.gorkhali/sdlc/<id>/intent.md`, then `intent/<id>.md`.
3. Draft with the organization's template at `templates/sdlc/intent.md` when
   present, otherwise the playbook shape (`Problem`, `Proposed outcome`,
   `Affected users and systems`, `Constraints`, `Open questions`, `Linkage`).
   Status starts `draft`. Do not invent missing fields; write `_Not recorded`.
4. Show the draft. The originator corrects misunderstandings. Product-owner
   accept sets Status to `accepted`. Reject closes it. Do not start
   implementation from a `draft`.
5. Write the file. Do not write session JSON, do not call `start`, and do not
   treat this markdown as a lifecycle gate.
6. Incident or control-band input uses the same template: anomaly, evidence,
   proposed outcome, affected systems, open questions.

Stop with the path and status. Next action is `start` on an `accepted` intent,
or originator edits on `draft`.

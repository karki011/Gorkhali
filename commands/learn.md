---
name: learn
description: "Use when the user states a preference for how agents should work - 'always do X', 'don't do that again'. Appends one line to the preferences file. Task-specific notes go to session scratch, not here."
argument-hint: "<preference or note>"
user-invocable: true
---

# /learn "$ARGUMENTS"

There is no learnings store here - just the capped preferences file `_shared.md`'s User Preferences section describes, plus a scratch note for anything narrower.

<instructions>
1. Decide what `$ARGUMENTS` is:
   - **A general preference** (how the user wants agents to work, not tied to one task) - append it as one caveman-compressed line to the repo-layer preferences file `lib/preferences.js` reads and writes, at the data-root path its `preferencePaths` returns. That path is permitted by `hooks/never-edits.js` even during an active session, because everything under the data root falls outside project code. If the file would exceed the twenty-line cap, drop its oldest line first, then append.
   - **A one-off note** (specific to the task at hand) - append it as one dated line inside that session's scratch folder (`lib/session.js`'s `scratchDir`), not the preferences file. Nothing else reads this automatically.
2. Print what was written and to which file, so the user can see it landed.
</instructions>

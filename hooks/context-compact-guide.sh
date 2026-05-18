#!/usr/bin/env bash
# context-compact-guide.sh
# PreCompact hook — replaces generic messages with actionable compact guidance.
# Author: Subash Karki

set -euo pipefail

INPUT=$(cat)

# Detect compact type from matcher context
# The hook config uses matcher "manual" or "auto" — Claude Code routes accordingly
# We output guidance regardless of type, but tailor the urgency

cat <<'GUIDANCE'
## Context Compact Protocol

**BEFORE compacting, do this:**
1. Identify the ACTIVE TASK — what are you currently working on?
2. Note any UNSAVED DECISIONS — corrections, learnings, approach choices
3. Save critical state: `TaskCreate` for in-progress work, write learnings

**COMPACT WITH A HINT — always pass a focus directive:**
```
/compact focus on [current task], drop [completed/irrelevant work]
```

**Examples:**
- `/compact focus on the auth refactor and failing test in user-service, drop the initial exploration and file reads`
- `/compact focus on CP-41171 implementation — keep contracts, intent, and current spark output`
- `/compact focus on debugging the hydration error, drop the earlier research phase`

**Context budget rules:**
- Under 30% = full capacity, complex reasoning OK
- 30-40% = caution zone, consider compacting proactively
- 40-60% = compact NOW, quality is degrading
- Over 60% = emergency — wrap up or start fresh session

**Prefer /rewind over correction** when the last attempt failed.
Failed corrections pollute context and reduce downstream quality.
"Summarize from here" → /rewind → paste summary = clean restart.

**After compact:** Re-read intent.md and active contracts to restore working context.
GUIDANCE

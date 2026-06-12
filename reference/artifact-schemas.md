# Artifact Schemas

Canonical schemas for all file-based artifacts in Phantom v2.
A validation hook enforces these shapes at write time.

Each artifact has its own schema file:

- [_meta](schemas/_meta.md) --- Required header on every artifact
- [context.json](schemas/context.md) --- Phase A ticket context
- [intent.json](schemas/intent.md) --- Phase B goal contract
- [plan.json](schemas/plan.md) --- Phase B execution plan
- [execution.json](schemas/execution.md) --- Phase C results
- [verification.json](schemas/verification.md) --- Verify gate output
- [wrap.json](schemas/wrap.md) --- Post-merge wrap record
- [pause-state.json](schemas/pause-state.md) --- Pause/resume state
- [review-panel.json](schemas/review-panel.md) --- Pre-ship review panel
- [run-artifacts](schemas/run-artifacts.md) --- Per-run artifact directory layout
- [approval-queue entry](#approval-queue-entry) --- Mission Control queue entry (`--to-plan`)

All artifacts require the `_meta` header. See [_meta](schemas/_meta.md).
(Exception: approval-queue entries live outside `sessions/` and carry no `_meta` header.)

## Approval-Queue Entry

Written by `/phantom:start --to-plan` when parking a plan for human approval.
Lives at `<data>/repos/<repo>/approval-queue/<state>/<ticket>.json` — resolve via
`scripts/lib/phantom-paths.js` → `queueEntryPath(ticket, state)`.

**Directory placement is authoritative.** The entry's lifecycle state is the
directory it sits in — one of the four state dirs: `queued/`, `approved/`,
`running/`, `rejected/`. The `status` field inside the JSON is informational
only and may lag the directory.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ticket | string | yes | Ticket key (e.g., `"ENG-1234"`) |
| repo | string | yes | Repository name |
| worktree | string | yes | Realpath of the planning worktree (cwd) |
| planRef | string | yes | Absolute path to `sessions/<TICKET>/plan.json` |
| summary | string | yes | 1-2 line plan summary for the approver |
| assumptions | string[] | yes | Every assumption made headless (may be empty) |
| selfCheck | string | yes | `"pass"`, `"flagged"`, or `"dirty-worktree"` |
| ts | string | yes | ISO 8601 timestamp of entry write |
| status | string | yes | `"queued"` at write time — informational only; dir placement is authoritative |

**Example:**
```json
{
  "ticket": "ENG-1234",
  "repo": "acme-api",
  "worktree": "/Users/dev/.claude/phantom-data/worktrees/acme-api/ENG-1234",
  "planRef": "/Users/dev/.claude/phantom-data/repos/acme-api/sessions/ENG-1234/plan.json",
  "summary": "Add rate limiting to /v1/ingest; conservative middleware option, alternatives recorded in plan.",
  "assumptions": ["Default window 60s chosen — ticket did not specify"],
  "selfCheck": "pass",
  "ts": "2026-06-12T14:03:22Z",
  "status": "queued"
}
```

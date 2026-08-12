# RPSL Optional Deep-Review Preset

RPSL is an explicit deep-review preset for unusually risky or broad changes. It
is not part of normal verify or wrap, and it never replaces Ward plus Gaze.
Invoke it only when the user explicitly requests deep review.

## Preconditions

- Current portable Ward verification is passed and bound to the current
  worktree fingerprint.
- Current portable Gaze review is passed and newer than that verification.
- The preset's questions and selected perspectives are recorded before spawn.

If either normal gate is missing or stale, stop and rerun verification. RPSL
cannot manufacture or waive normal evidence.

## Non-overlapping perspectives

Select only perspectives that apply. Each reviewer is read-only and must stay
inside its boundary:

| Perspective | Exclusive question | Explicitly out of scope |
|---|---|---|
| `scope` | Does every changed behavior trace to the approved intent and allowed files? | Correctness, style, architecture, production hypotheticals |
| `regression` | Did the diff remove/weaken coverage or break an existing compatibility guarantee? | Scope approval, general code quality, new architecture preferences |
| `architecture` | Does a cross-module/public boundary preserve documented dependency direction and API contracts? | Test execution, product scope, generic edge-case hunting |
| `operations` | For the named runtime risk, is failure safe and observable in production? | Style, repository organization, already-covered scope/compatibility |

Do not spawn four agents by habit. Omit an inapplicable perspective and record
why. If two proposed perspectives would inspect the same question, merge them
into one bounded assignment.

## Artifacts

Clear only the selected perspective files before spawning. Each selected
reviewer writes its own current file under `{SESSION_DIR}/reviews/deep/`:

```json
{
  "role": "scope|regression|architecture|operations",
  "question": "The exact bounded question",
  "verdict": "pass|fail|blocked",
  "findings": [],
  "observationGaps": []
}
```

Read named files, never glob unrelated review artifacts. A missing selected
artifact is `blocked`, not pass and not zero findings. Do not transcribe a chat
message into a verdict.

Merge selected artifacts into `review-panel.json` using
`reference/schemas/review-panel.md`. Any `fail` or `blocked` selected
perspective blocks the deep-review preset. An omitted, non-triggered perspective
does not appear in the panel and does not block normal shipping.

RPSL is read-only. Findings return to the user for a separately authorized fix;
the preset does not start a fix loop or mutate the worktree.

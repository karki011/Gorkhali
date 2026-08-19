# `review-panel.json` Schema

Optional output of the explicitly invoked RPSL deep-review preset. Normal
shipping requires current portable Inspector and Auditor artifacts, not this panel.

| Field | Type | Required | Description |
|---|---|---|---|
| `preset` | `"rpsl"` | yes | Identifies the optional preset |
| `worktreeFingerprint` | string | yes | Portable fingerprint reviewed |
| `perspectives` | object[] | yes | Only explicitly selected perspectives |
| `perspectives[].role` | `"scope"` \| `"regression"` \| `"architecture"` \| `"operations"` | yes | Non-overlapping perspective |
| `perspectives[].question` | string | yes | Bounded question assigned before spawn |
| `perspectives[].verdict` | `"pass"` \| `"fail"` \| `"blocked"` | yes | Observed result |
| `perspectives[].findings` | object[] | yes | Evidence-backed findings; empty only after a clean review |
| `perspectives[].observationGaps` | string[] | yes | Unobserved parts of the assigned question |
| `allPass` | boolean | yes | True only when every selected perspective passed |
| `blockers` | string[] | yes | Failed, blocked, or missing selected evidence |

Rules:

- Select perspectives before spawning and include only those that apply.
- Roles are unique and their questions must not overlap.
- A missing selected artifact is represented as `blocked` with a blocker naming
  the missing evidence. It is never converted to pass.
- `allPass` is true only when `perspectives` is non-empty and every verdict is
  `pass` with no unresolved observation gap.
- Omitted, non-triggered perspectives are not synthetic failures.
- The fingerprint must equal the portable current worktree fingerprint. A
  changed worktree makes the panel stale.

Example:

```json
{
  "preset": "rpsl",
  "worktreeFingerprint": "sha256:...",
  "perspectives": [
    {
      "role": "regression",
      "question": "Does the public parser retain v1 input compatibility?",
      "verdict": "pass",
      "findings": [],
      "observationGaps": []
    },
    {
      "role": "operations",
      "question": "Does an interrupted migration fail safely without data loss?",
      "verdict": "pass",
      "findings": [],
      "observationGaps": []
    }
  ],
  "allPass": true,
  "blockers": []
}
```

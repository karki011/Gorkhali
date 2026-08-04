# `_meta` Header Spec

Every artifact JSON must include a `_meta` object at the top level.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| writtenAt | ISO 8601 string | yes | When artifact was written |
| gitHead | string | yes | Git HEAD sha at write time |
| gitBranch | string | yes | Current branch name |
| phase | string | yes | Phase that wrote this (`A`, `B`, `C`, `D`, `verify`, `wrap`) |
| skill | string | yes | Skill that wrote this (`phantom:start`, `phantom:pause`, etc.) |
| version | number | yes | Schema version (start at `1`) |

**Example:**
```json
{
  "_meta": {
    "writtenAt": "2026-05-22T14:30:00Z",
    "gitHead": "abc1234",
    "gitBranch": "feat/my-ticket",
    "phase": "B",
    "skill": "phantom:start",
    "version": 1
  }
}
```

---

## Schema Versioning

- `version` starts at `1`.
- Increment when fields are added or semantics change.
- Breaking changes (field removal, type change) require a major version bump and migration note here.
- The validation hook reads `_meta.version` to apply the correct validator.

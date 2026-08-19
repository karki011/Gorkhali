# `_meta` Header Spec

Every artifact JSON written by a Phantom SKILL must include a `_meta` object at
the top level. There is exactly one documented exception, below.

## The one exception: reviewer artifacts

`{SESSION_DIR}/reviews/auditor.json` and `{SESSION_DIR}/reviews/specialists/*.json`
carry `_meta` only when they happen to have it. `scripts/validate-artifact.js`
validates it when present and never requires it
([`review.md`](review.md)).

DECIDED in B10, after F9 recorded that this file claimed universality while no
reviewer artifact on disk had ever carried `_meta`. The two options were "make
reviewers emit it" and "stop claiming every artifact has it"; the second is
correct, for three reasons:

1. A reviewer is a SUBAGENT. `phase`, `skill` and `version` describe the session
   that spawned it, not the reviewer, so a reviewer filling them in is guessing
   at values it does not own. A guessed provenance header is worse than an absent
   one: it looks like evidence and is not.
2. The binding `_meta` exists to provide — *which worktree was this written
   against* — is already provided for reviews, and provided more strongly, by the
   portable lifecycle's worktree fingerprint. `_meta.gitHead` would be a second,
   weaker copy of a fact the record already carries.
3. Requiring it would fail every reviewer artifact already on disk for zero
   information gained.

A reviewer artifact that DOES carry `_meta` must still be well-formed — the
exemption is from the requirement, not from the schema.

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

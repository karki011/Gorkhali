# Comment Discipline

> **This file is the single copy of the contract.** `agents/engineer.md`, `agents/steward.md`,
> `agents/auditor.md`, `reference/agent-protocols/engineer-conventions.md`, and `skills/gorkhali/references/roles.md` point here; they never restate it.
> Adapted from `cz-comments` (Cloudzero/ops-claude-marketplace#182).

A write-time gate on **comments written into code** — every `Edit` and `Write`, in every language.
A comment has no compiler and no test forcing it to stay true; it is updated by hand or it rots.
A stale comment misdirects rather than merely failing to help. A bad comment is worse than none.

## 1. The default is no comment

Do not comment because code is new, important, or hard-won. Comment only when
the line carries information **the code cannot express**. The test:

> If this comment were deleted, would a competent developer reading the
> surrounding code lose something they could not recover from the code, the
> signature, or the tests?

If no — don't write it. The urge to explain peaks immediately after
generating a block, while the reasoning is fresh. That feeling is not
evidence the reader needs it.

## 2. Refactor before you explain

About to explain *what* code does or *how* it works? The code is the problem.
Rename the variable, extract the function, collapse the conditional — then
the comment is unnecessary.

**Escape hatch:** complexity *inherent to the domain* — a cryptographic
routine, a consensus protocol, a numerical method — survives refactoring.
Anchor the reader and move on: `# Raft leader election, §5.2 of the extended paper.`

## 3. What earns a comment

Information no refactor can express. One or two lines, never more.

- **Why this approach** — `# Boyer-Moore, not binary search: 3x faster on our keys.`
- **Why *not* the obvious one** — `# No caching: data churns faster than any TTL.`
- **Constraints the types don't enforce** — `# Caller must hold the write lock.`
- **Consequences of change** — `# Below 30s this cascades into the retry layer.`
- **External spec or algorithm** — `# Luhn checksum per ISO/IEC 7812-1.`

## 4. Interface documentation is not narration

Docstrings on public APIs are exempt from §1 and are expected. Document the
**contract** — preconditions, side effects, exceptions, return semantics,
units — so callers never read the implementation. Never the **mechanics** of
the body. A docstring restating an obvious signature is noise:
`get_name() -> str` needs no `"""Returns the name."""`.

## 5. Self-contained, or not at all

A comment must make sense to someone reading **only this file** — no ticket,
no design doc, no author to ask. A durable reference (RFC, CVE, spec, ticket)
may ride along **once the comment already stands without it**:
`# Workaround for CVE-2024-1234; drop after the v3.2 upgrade.` survives a dead
link. `# See CP-12345.` does not. Comments describe the code **immediately
adjacent** to them — not code in another file, not code that used to be here.

## 6. Never write these

- **Narration** — the code restated in English. `# increment the counter`
- **Section banners** — `### HELPERS ###`. A file needing signposts wants splitting.
- **Closing-brace markers** — `} // end for`. The block is too long.
- **Changelog or attribution** — `# 2024-01-15 jsmith: added retry`. That is `git blame`.
- **Commented-out code** — delete it; version control remembers.
- **Step-by-step walkthroughs** — `# Step 1: … # Step 2: …`
- **Generation scaffolding** — `# Here we initialize the client.`
- **Previous-implementation notes** — `# We used to recurse here.` That is the diff.
- **Bare TODOs** — a TODO needs a ticket *and* a trigger:
  `# TODO(CP-12345): comma separator before EU launch.` Lacking both, do the
  work or leave nothing.

## 7. This governs what you write

Apply the gate to comments **you are adding**. Existing comments in a file you are editing are not
yours to strip unless they are provably false, describe code you are deleting, or you are the
Steward removing a §6 violation within code changed in the current session.

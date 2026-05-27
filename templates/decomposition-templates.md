# Subtask Decomposition Templates

Standard subtask graphs for recurring task types. Apex picks the matching template during Phase B and fills in specifics.

## Feature (new functionality)

```
Subtask 1: Gather context — read existing patterns, identify extension points
  Evidence: files identified, patterns documented, approach chosen
Subtask 2: Implement core logic — types, hooks, utilities
  Evidence: files created, exports listed, types defined
  Depends on: 1
Subtask 3: Implement UI/integration — components, routes, wiring
  Evidence: component renders, props typed, states handled
  Depends on: 2
Subtask 4: Add tests — unit + integration for new code
  Evidence: test command output, pass count, key assertions listed
  Depends on: 3
Subtask 5: Self-review — re-read diff, check contract alignment
  Evidence: self-review score, issues found and fixed
  Depends on: 4
```

## Bug Fix

```
Subtask 1: Reproduce — confirm the bug exists, document reproduction steps
  Evidence: reproduction steps listed, error output captured
Subtask 2: Trace root cause — identify exact code path causing the issue
  Evidence: root cause explained (file, line, why it fails)
  Depends on: 1
Subtask 3: Implement fix — change the minimum code needed
  Evidence: files changed, what was changed and why
  Depends on: 2
Subtask 4: Verify fix — confirm reproduction no longer triggers, no regressions
  Evidence: reproduction steps re-run, pass/fail output
  Depends on: 3
```

## Refactor

```
Subtask 1: Inventory — list all files affected, understand current structure
  Evidence: file list, dependency map, current vs target structure
Subtask 2: Implement changes — apply refactoring (rename, extract, restructure)
  Evidence: files changed, before/after summary
  Depends on: 1
Subtask 3: Verify no regression — all existing tests still pass
  Evidence: test command output, no failures
  Depends on: 2
Subtask 4: Cleanup — remove dead code, update imports, fix lint
  Evidence: lint clean, no unused exports
  Depends on: 3
```

## Config / Setup

```
Subtask 1: Identify requirements — what config is needed, where it's consumed
  Evidence: config keys listed, consumers identified
Subtask 2: Implement config — add/modify config files
  Evidence: keys added, values set, format validated
  Depends on: 1
Subtask 3: Wire consumers — update code that reads the config
  Evidence: consumers updated, imports verified
  Depends on: 2
Subtask 4: Verify — config loads correctly, consumers work
  Evidence: app starts, config values propagated
  Depends on: 3
```

## Usage

Apex selects the matching template, adjusts subtask count and specifics for the task, then creates TaskCreate entries for each subtask during Phase D dispatch.

For tasks that don't fit any template, decompose ad-hoc following the same principles:
- One concern per subtask
- Evidence requirement per subtask
- Dependencies declared
- Blocked state is valid (don't skip)

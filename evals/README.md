# Phantom Evals

Phantom's live behavioral evaluations run in independent, materialized case repositories. The evaluated model never inherits this checkout as its working directory. Fixture facts are materialized by the harness and, when model reasoning needs them, supplied through a typed current-case evidence envelope rather than free-form pretend context.

## Structure

```text
evals/
  evals.json          — schema v2 cases: 30 trigger, 6 route, 15 convention
  route-truth.json    — review-attributed route truth bound to case digests
  baselines/          — recorded model outcomes
  README.md           — this contract
```

## Case contract

Every case has an integer `id`, `skill`, realistic `prompt`, and optional declarative `fixture`.

- Trigger cases use `should_trigger`.
- Route cases obtain their expected route from `route-truth.json`.
- Convention cases use a deterministic regex or bounded LLM judge in `expected_check`.
- `expected_behavior` documents the intended behavior but is not itself a judge.

The only fixture keys are:

| Key | Meaning |
|---|---|
| `files` | Relative UTF-8 files materialized in the case repository |
| `data_files` | Relative files materialized below the case-local `PHANTOM_DATA` |
| `env.set` / `env.unset` | Non-sensitive environment facts |
| `git` | Initial/current branch and optional `origin/HEAD` |
| `path.exclude` | Executable basenames removed from the case-local `PATH` |

Absolute paths, traversal, symlinks, arbitrary fixture commands, protected environment overrides, `setup`, and case-local `expected_route` are rejected before any model call.

## Isolation

Each run creates a private temporary root, a sanitized candidate-plugin snapshot, and one `case-<id>` directory per selected case. The snapshot contains only `.claude-plugin` and `skills`; it contains no top-level hooks, evals, route truth, tests, Git metadata, or eval harness. Portable scripts that belong to a skill may be present but cannot execute because the candidate has no process tool. Each case receives independent `workspace`, `PHANTOM_DATA`, judge directory, MCP configuration, temporary directories, and Claude session IDs.

Candidate calls use Claude's bare mode, an empty strict MCP configuration, disabled session persistence, and an exact built-in tool set of `Skill`. `Bash`, file tools, agents, web tools, and plugin hooks are unavailable. Convention cases receive a size-bounded JSON evidence envelope generated only from that case's declarative fixture; file contents are explicitly marked as untrusted data. Route plans are constructed and canonically compiled by the harness from a closed route-recommendation envelope, so the candidate does not need write or process access. Judge calls run in a separate empty directory without the plugin and with the built-in tool set disabled. The runner verifies that the installed Claude CLI supports every required boundary flag before a live call; otherwise it fails closed. Bare mode means live evals require `ANTHROPIC_API_KEY` authentication in the sanitized child environment.

This is a Claude tool-access boundary and process-environment isolation, not an OS filesystem or network sandbox. Safety does not rely on the working directory preventing access: the model has no file, shell, web, network-capable, or delegation tool with which to reach the source checkout or a sibling case.

Temporary workspaces are deleted by default. `--artifacts-dir` creates a collision-resistant run directory containing per-case transcript and result artifacts. `--retain-workspaces failed|all` additionally copies only the requested repositories. There is no implicit retention.

## Route truth

`route-truth.json` is separate from prompts and fixtures. Every route entry records:

- canonical route and structured signals;
- evidence-based rationale;
- declared approved reviewer attribution;
- SHA-256 digest of the exact case ID, skill, prompt, and fixture.

Changing a bound case makes truth validation fail until its review-attributed truth entry is refreshed. Missing, duplicate, extra, stale, malformed, or orchestrator-role review entries fail closed. Reviewer metadata is declared attribution recorded in version control; the harness does not prove the reviewer's identity or that a different human performed the review.

## Baselines

New baselines use schema v2 and bind their outcomes to SHA-256 digests of the complete eval fixture set, route truth, runner, and sanitized candidate plugin. Provenance also records the tool-access contract, requested candidate and judge models, per-case timeout, exact case IDs, complete selection semantics, and observed Claude CLI version. Baseline writes require an unfiltered complete run. Filtered or partial runs are never written as baselines and never compared for drift. Older or changed-provenance baselines are reported as non-comparable and never produce regression or improvement claims.

## Running

```bash
# Contract and selection preview; no model calls
node scripts/run-evals.js --dry-run

# Isolated live route run
node scripts/run-evals.js --filter route --model sonnet

# Complete live run eligible for baseline comparison
node scripts/run-evals.js --model sonnet

# Write a baseline only from the complete, unfiltered case set
node scripts/run-evals.js --baseline --model sonnet

# Keep failed workspaces for diagnosis
node scripts/run-evals.js --filter route \
  --artifacts-dir /tmp/phantom-evals \
  --retain-workspaces failed
```

Live runs spend tokens. `PHANTOM_EVAL_TIMEOUT_S`, `PHANTOM_EVAL_JUDGE_MODEL`, and `PHANTOM_EVAL_CLAUDE_BIN` configure the per-case timeout, judge model, and Claude executable; all three effective values are validated before use, and the model and timeout are bound into baseline provenance.

## Adding a case

1. Write a realistic prompt and the smallest repository evidence needed to decide it.
2. Materialize every environmental claim through `fixture`; do not tell the model to assume facts.
3. Prefer deterministic trigger, route, or regex evidence. Use an LLM judge only for semantic criteria.
4. For a route case, record reviewer attribution and add a digest-bound truth entry.
5. Run `node --test test/run-evals.test.js` and `node scripts/run-evals.js --dry-run` before a live run.

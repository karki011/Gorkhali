# Model and compute policy

The portable skill routes work with semantic profiles. Maintained host mappings
live in `model-presets.json`, the only file in the skill that may contain
host-specific model identifiers. Users do not need to create a model map.

## Profiles

| Profile | Use |
|---|---|
| `inherit` | Keep the active model when selection is unavailable or intentionally omitted. |
| `economy` | Deterministic, mechanical, bounded work with clear inputs and outputs. |
| `balanced` | Scoped implementation, coordination, and ordinary review. This is the default. |
| `deep` | Architecture, forensics, adversarial review, ambiguity, and risky cross-cutting work. |
| `frontier` | Orchestration, decomposition, delegation strategy, and final synthesis. |

Profiles express desired reasoning capacity and cost posture. They never change
artifact schemas, safety rules, verification gates, or acceptance criteria.
Apex requests `frontier` for planning, decomposition, and synthesis.
Delegated work uses the lowest sufficient profile: `economy` for deterministic
mechanical tasks, `balanced` for well-scoped implementation, and `deep` only
for ambiguity, cross-cutting risk, or demanding review.

## Resolve after topology

Apex chooses the execution topology before resolving worker compute. For every
bounded assignment, request the lowest sufficient profile just in time. The
user does not need to configure workers, choose their models, or maintain a
model map. An explicit user choice still wins.

If a selector is unavailable or rejected, retry without model and effort
selectors while preserving the selected task topology. Compute fallback does
not silently turn delegated work into direct work or remove a required review;
only the delegation capability decision may change topology.

## Resolution order

1. Honor an explicit user model choice.
2. Honor an optional external profile map supplied by the user or project.
3. When the current host is known, use its bundled profile from
   `model-presets.json`.
4. Otherwise omit model and effort selectors and inherit the active model.

Identify the host from explicit runtime context, not credentials or guessed
environment variables. Resolve a role with:

```text
node <skill-directory>/scripts/resolve-profile.mjs --role <role> --profile <profile> --host <host-key>
```

Omit `--profile` to use the role default. Apex always resolves to `frontier`;
profile downshifts apply only to delegated work.

Apply the returned model and effort only when the runtime supports per-delegate
selection. Missing and unknown hosts are normal fallbacks. If the runtime
rejects a bundled preset as unavailable, retry once without model and effort
selectors. If it rejects an explicit user choice, report the error rather than
silently replacing that choice.

An optional external override remains supported for compatibility:

```json
{
  "profiles": {
    "balanced": "runtime-defined-value",
    "deep": {
      "model": "runtime-defined-value",
      "effort": "runtime-defined-value"
    }
  }
}
```

Pass that file with `--map <file>`. Record the requested profile and returned
resolution. The resolver also returns `bundle_version` from the canonical
`manifest.json`, so diagnostics identify the exact portable bundle that made
the selection. Never invent a concrete identifier that is absent from an
explicit choice, external override, or bundled preset.

## Outcome diagnostics

For each delegated stage, record a compact provider-neutral routing outcome:

- `requested_profile`: semantic profile selected before execution.
- `actual_profile`: semantic profile actually used when the host reports it;
  otherwise `null`.
- `fallback_reason`: why actual compute differed; otherwise `null`.
- `outcome`: `pending`, `passed`, `failed`, `blocked`, or `skipped`.
- `wall_time_ms`: non-negative elapsed wall time.
- `tool_turns`: non-negative count of tool-using turns when observable.

These fields diagnose routing effectiveness; they do not change acceptance
criteria or permit provider-specific identifiers outside the preset registry.
If the host cannot observe a diagnostic, record that limitation rather than
guessing a value.

## Escalation

Prefer re-scoping a task before escalating compute. Escalate implementation
from `balanced` to `deep` only when ambiguity, cross-cutting risk, or failed
bounded attempts show that the original profile is insufficient. Do not move
implementation to `frontier`; Apex should re-decompose the assignment instead.

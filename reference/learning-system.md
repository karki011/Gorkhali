# Learning System

## Learning Triggers

1. **User corrections** (immediate): User rejects approach → record CORRECTION
2. **Fix loop failures** (at fix time): Same failure class twice → record CORRECTION
3. **Wrap validation** (at wrap): Validate used patterns, record new patterns/habits

## INDEX.md Entry Format

`{one-liner} [{lifecycle-tag}] v:{validations} q:{quality} u:{date}`

Lifecycle tags: `[proposed]` → `[validated:N]` → `[scope:global]` or `[stale]` → pruned

## Scoring & Decay

- Increment `[validated:N]` each session a pattern holds
- Patterns that caused issues → `v:N-1` (min 0), recompute quality
- `v:0` and `q:` < 0.3 → flip to `[failed]`
- 30+ days without validation → `[stale]`
- 60+ days stale → candidate for removal
- `[validated:5+]` and `q:` > 0.6 → promote to `global/patterns/INDEX.md`

## Anti-Repetition

Before any approach: scan `learnings/INDEX.md`

| Tag | Behavior |
|-----|----------|
| `[validated:5+]` | Auto-apply. Follow unless task is fundamentally different. |
| `[validated:1-4]` | Suggest as recommended approach. |
| `[proposed]` | Note only — don't auto-apply. |
| `[failed]` | **BLOCKED** — must explain why current approach differs or choose alternative. |
| `[stale]` | Deprioritized — verify before relying on. |

Corrections always beat patterns. "Don't use X" correction overrides "use X" pattern.

## Domain Routing

| Signal | Domain File |
|--------|-------------|
| *.tsx, *.css, components/ | ui.md |
| *.api.*, hooks/use*, services/ | data.md |
| auth/, session/, permissions/ | auth.md |
| *.test.*, *.spec.*, __tests__/ | testing.md |
| *.config.*, Makefile, .github/ | tooling.md |
| migrations/, schema/, *.sql | migration.md |
| shadows, agent, workflow, skill | shadows.md |

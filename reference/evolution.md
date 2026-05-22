# Self-Evolution Pipeline

## Three Tiers

### Tier 1: Reference Evolution (auto-apply)
Validated learnings (`[validated:5+]`) promote into `reference/` files.
- Append one line to relevant reference file
- Prune original INDEX entry → "absorbed into reference/X.md:LN"
- Low risk — supplementary content, auto-applies

### Tier 2: Skill Directive Evolution (user approval required)
Corrections repeated across 3+ sessions edit skill steps.
- Show proposed diff to user before applying
- Git commit with `skill-evolution:` prefix
- Max 1 directive edit per wrap session

### Tier 3: Skill Spawning (user approval required)
Repeated multi-step patterns (4+ sessions) become new micro-skills.
- Show proposed skill content to user
- Create on approval in `commands/` directory
- Git commit with `skill-spawn:` prefix

## Evolution Check Procedure (runs at wrap time)

1. Haiku agent scans `learnings/INDEX.md`:
   - `[validated:5+]` entries → Tier 1 candidates
   - `[failed]` corrections seen 3+ sessions → Tier 2 candidates
   - Repeated multi-step patterns → Tier 3 candidates
2. Tier 1: auto-apply, log to `state/evolution-log.json`
3. Tier 2-3: present proposals to user, apply on approval, log

## Safety Rails

- Never edit skills during active session — evolution only at wrap time
- Tier 1 auto-applies (low risk). Tier 2-3 require user approval.
- All changes git-committed with `skill-evolution:` or `skill-spawn:` prefix
- `state/evolution-log.json` tracks every change for rollback
- Max 1 directive edit per wrap session

## File Size Caps (triggers Haiku distillation)

| File Type | Cap | Action at Cap |
|-----------|-----|---------------|
| Skill directive | 80 lines | Haiku merges/prunes evolved steps |
| Reference file | 100 lines | Haiku distills, merges duplicates |
| INDEX.md | 80 entries | Haiku prunes absorbed + stale |
| Domain learnings | 50 entries | Haiku condenses verbose entries |

## Distillation Rules

- Merge entries that say the same thing differently
- Remove entries absorbed into reference/ or skill files
- Sharpen: remove session-specific context, keep the rule
- Preserve `[validated:N]` counts (merge = sum counts)
- Never delete `[failed]` entries unless explicitly overridden

# Team Skill Crew -- Auto-Learning System

> Loaded by commands that complete work. Always load `_shared.md` first.

---

## Learning Rules

1. **User corrections are immediate (highest priority).** When user rejects or corrects an approach → STOP, write correction to `learnings/{domain}.md ## Corrections`, update INDEX.md, resume with corrected approach.

2. **Fix loop failures produce corrections.** Each fix loop iteration that fails → write what failed and what fixed it to `learnings/{domain}.md`. Same failure class twice → re-plan, don't patch.

3. **Wrap validates and records.** During `/team:wrap`:
   - Record what worked (approach, files, strategy) to INDEX.md with `[proposed]` tag
   - Increment `[validated:N]` for patterns followed successfully this session
   - Downgrade patterns that caused issues
   - Promote `[validated:5+]` to `global/patterns/INDEX.md`
   - Demote patterns not validated in 30+ days → `[stale]`
   - Append session summary to INDEX.md

---

## INDEX.md Entry Format

```markdown
- [{keyword}] {what worked} — {files} [validated:N] ({date})
- CORRECTION [{keyword}]: {failure} — {alternative} [failed] ({date})
- SESSION {TICKET}: route={SOLO|CREW}, outcome={pass|fail}, fix_loops={N} ({date})
```

---

## Weighted Pattern Retrieval

When anti-repetition scans INDEX.md:

| Tag | Behavior |
|-----|----------|
| `[validated:5+]` | Auto-apply. Follow unless task is fundamentally different. |
| `[validated:1-4]` | Suggest as recommended approach. |
| `[proposed]` | Note only — don't auto-apply. |
| `[failed]` | **BLOCKING** — must explain why current approach differs or choose alternative. |
| `[stale]` | Deprioritized — verify before relying on. |

Corrections always beat patterns. If correction says "don't use X" and pattern says "use X", correction wins.

---

## Semantic Anti-Repetition (Multi-Source)

### Layer 1: Keyword Match (always available)
Scan INDEX.md for exact keyword matches against task files, approach keywords, domain.

### Layer 2: Phantom Semantic (if phantom-ai available)
`phantom_orchestrator_history({ limit: 10 })` — finds conceptually similar past approaches. Only surface confidence > 0.6.

### Layer 3: AgentDB Vector (if claude-flow available)
`memory_search({ query: "{task}", type: "pattern" })` — cross-session retrieval. Lower priority than repo-specific.

Graceful degradation: Layer 1 always works. Layers 2-3 are additive.

# Agents

Multi-agent crew for this repository. Compatible with Claude Code, Cursor, Windsurf.

## Crew

| Agent | Model | Role |
|-------|-------|------|
| Cortex | opus | Orchestrator — plans, decomposes, coordinates, triages failures |
| Spark | sonnet | Implementation — infers specialization from task domain |
| Sentinel | sonnet | Verification — repo-aware lint/build/test |
| Prism | opus | Quality gate — code review, scored 0-10 |
| Oracle | opus | On-demand guidance for stuck agents (<100 words) |
| Lens | sonnet | Visual — Figma extraction + browser-based UI verification |

## Workflow

```
Plan (Cortex) → Challenge (Devil's Advocate) → Build (Spark) → Verify (Sentinel) → Simplify → Review (Prism)
```

## Usage

```bash
/team:start "ticket or description"
```

## Configuration

See `~/.claude/team/` for full skill system.

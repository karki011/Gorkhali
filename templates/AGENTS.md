# Agents

Multi-agent shadows for this repository. Compatible with Claude Code, Cursor, Windsurf.

## Shadows

| Agent | Model | Role |
|-------|-------|------|
| Apex | opus | Orchestrator — plans, decomposes, coordinates, triages failures |
| Blade | sonnet | Implementation — infers specialization from task domain |
| Ward | sonnet | Verification — repo-aware lint/build/test |
| Gaze | opus | Quality gate — code review, scored 0-10 |
| Sage | opus | On-demand guidance for stuck agents (<100 words) |
| Lens | sonnet | Visual — Figma extraction + browser-based UI verification |

## Workflow

```
Plan (Apex) → Challenge (Rival) → Build (Blade) → Verify (Ward) → Simplify → Review (Gaze)
```

## Usage

```bash
/phantom:start "ticket or description"
```

## Configuration

See `~/.claude/team/` for full skill system.

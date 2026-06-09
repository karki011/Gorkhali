# Agents

Multi-agent shadows for this repository. Compatible with Claude Code, Cursor, Windsurf.

## Shadows

| Agent | Model | Role |
|-------|-------|------|
| Apex | inherit (session model) | Orchestrator — plans, decomposes, coordinates, triages failures |
| Blade | inherit (session model; sonnet for small subtasks) | Implementation — infers specialization from task domain |
| Ward | sonnet | Verification — repo-aware lint/build/test |
| Gaze | opus (pinned) | Quality gate — code review, scored 0-10 |
| Sage | fable (pinned) | On-demand guidance for stuck agents (<100 words) |
| Lens | sonnet | Visual — Figma extraction + browser-based UI verification |

Default = inherit: agents run on the session model (Fable 5 recommended). Two deliberate pins:
- Gaze pins opus — review benchmarks (CodeRabbit, 2026-06) show Fable 5 is no better than Opus at code review at 2x the price. Do not "fix" this to fable.
- Sage pins fable so escalations from sonnet Blades reach the top tier. Fable 5 is usage-credit-gated — orgs without entitlement should flip this one line to opus.

## Workflow

```
Plan (Apex) → Challenge (Rival) → Build (Blade) → Verify (Ward) → Simplify → Review (Gaze)
```

## Usage

```bash
/phantom:start "ticket or description"
```

## Configuration

See `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/phantom}/` for full skill system.

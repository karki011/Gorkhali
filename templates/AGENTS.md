# Agents

Multi-agent shadows for this repository. Compatible with Claude Code, Cursor, Windsurf.

## Shadows

| Agent | Model | Role |
|-------|-------|------|
| Apex | inherit (session model) | Orchestrator — plans, decomposes, coordinates, triages failures |
| Blade | inherit (session model; sonnet for small subtasks) | Implementation — infers specialization from task domain |
| Ward | sonnet | Verification — repo-aware lint/build/test |
| Gaze | opus (pinned) | Quality gate — code review, scored 0-10 |
| Sage | fable (pinned; override via config `models.sage`) | On-demand guidance for stuck agents (<100 words) |
| Lens | sonnet | Visual — Figma extraction + browser-based UI verification |

Default = inherit: agents run on the session model (Fable 5 recommended). Two deliberate pins:
- Gaze pins opus — review benchmarks (CodeRabbit, 2026-06) show Fable 5 is no better than Opus at code review at 2x the price. Do not "fix" this to fable.
- Sage pins fable so escalations from sonnet Blades reach the top tier. This pin is the default; no Fable 5 entitlement? Set `models.sage: opus` in `${PHANTOM_DATA:-~/.claude/phantom-data}/config.yaml` — spawners pass it as a model override. No plugin-source edits needed.

## Workflow

```
Plan (Apex) → Challenge (Rival) → Build (Blade) → Verify (Ward) → Simplify → Review (Gaze)
```

## Usage

```bash
/phantom:start "ticket or description"
```

## Configuration

See the installed plugin dir for the full skill system (self-resolve: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -z "$PR" ] && echo "phantom: plugin dir not found — run /plugin to install"`).

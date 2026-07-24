# Agents

Multi-agent shadows for this repository. Compatible with Claude Code, Cursor, Windsurf.

## Shadows

| Agent | Model | Role |
|-------|-------|------|
| Apex | inherit (session model) | Orchestrator — plans, decomposes, coordinates, triages failures |
| Blade | sonnet (pinned); opus hard ceiling - never fable | Implementation — infers specialization from task domain |
| Ward | haiku | Verification — repo-aware lint/build/test |
| Gaze | opus (pinned) | Quality gate — code review, scored 0-10 |
| Sage | opus (pinned — top tier) | On-demand guidance for stuck agents (<100 words) |
| Lens | sonnet | Visual — Figma extraction + browser-based UI verification |

Implementers pin cheap models with an opus hard ceiling; only Apex inherits the session model (Opus 5 recommended). Two deliberate pins beyond Blade's ceiling:
- Gaze pins opus, the top tier now that Fable is retired from Phantom's routing. Do not "fix" this to fable.
- Sage pins opus (Opus 5), the top tier, so escalations from sonnet Blades reach it. No plugin-source edits needed.

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

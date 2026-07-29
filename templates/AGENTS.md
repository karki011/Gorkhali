# Agents

Multi-agent shadows for this repository. Compatible with Claude Code, Cursor, Windsurf.

## Shadows

| Agent | Role |
|-------|------|
| Apex | Orchestrator - plans, decomposes, coordinates, triages failures |
| Blade | Implementation - infers specialization from task domain |
| Ward | Verification - repo-aware lint/build/test |
| Gaze | Quality gate - code review, scored 0-10 |
| Sage | On-demand guidance for stuck agents (<100 words) |
| Lens | Visual - Figma extraction + browser-based UI verification |

Model pins are GENERATED, not hand-maintained: `scripts/gen-agent-frontmatter.js`
stamps each `agents/*.md` `model:` line from the role-to-profile mapping in
`skills/phantom/references/model-policy.json`, resolved to a concrete model per
host by `skills/phantom/references/model-presets.json`. A drift test fails CI
if a pin is hand-edited out of sync with that policy. Do not hand-edit a pin or
restate a concrete model name here - change the policy file instead.

Only Apex inherits the session model (Opus 5 recommended); every other role
pins a profile with an opus hard ceiling. Two roles pin the top tier
deliberately, not as leftover aliases:
- Gaze pins the top tier, now that Fable is retired from Phantom's routing. Do not "fix" this down to a cheaper profile.
- Sage pins the top tier so escalations from a cheaper Blade always reach it. No plugin-source edits needed.

## Workflow

```
Plan (Apex) → Challenge (Rival) → Build (Blade) → Verify (Ward) → Simplify → Review (Gaze)
```

## Usage

```bash
/phantom:start "ticket or description"
```

## Configuration

See the installed plugin dir for the full skill system (self-resolve: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -z "$PR" ] && echo "phantom: plugin dir not found - run /plugin to install"`).

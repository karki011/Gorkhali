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
| Lens | Explicit opt-in visual inspection - advisory only |

Model pins are GENERATED, not hand-maintained: `scripts/gen-agent-frontmatter.js`
stamps each `agents/*.md` `model:` line from the role-to-profile mapping in
`skills/phantom/references/model-policy.json`, resolved to a concrete model per
host by `skills/phantom/references/model-presets.json`. A drift test fails CI
if a pin is hand-edited out of sync with that policy. Do not hand-edit a pin or
restate a concrete model name here - change the policy file instead.

Only Apex inherits the session model (Opus 5 recommended); every other role is
delegated, and on this host every delegated profile resolves to `sonnet`. The
profile a role pins is still meaningful - it sets the seniority Apex briefs that
role at, and it still spreads across models on other hosts - so do not "fix" a
role's profile down (or up) because the resolved pin looks the same either way.
One consequence to keep in mind: there is no richer model to escalate a stuck
assignment into, so re-decompose it instead.

## Workflow

```
Plan (Apex) → Challenge + plan-check (Rival) → Build (Blade) → Verify (Ward) → Simplify → Review (Gaze)
```

## Usage

```bash
/phantom:start "ticket or description"
```

## Configuration

See the installed plugin dir for the full skill system (self-resolve: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -z "$PR" ] && echo "phantom: plugin dir not found - run /plugin to install"`).

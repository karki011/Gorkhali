# Agents

Multi-agent shadows for this repository. Compatible with Claude Code, Codex, Kimi Code, Cursor, Windsurf.

## Shadows

| Agent | Role |
|-------|------|
| Chief | Orchestrator - plans, decomposes, coordinates, triages failures |
| Engineer | Implementation - infers specialization from task domain |
| Inspector | Verification - repo-aware lint/build/test |
| Auditor | Independent review — blocking or advisory |
| Advisor | On-demand guidance for stuck agents (<100 words) |
| Surveyor | Explicit opt-in visual inspection - advisory only |

Model pins are GENERATED, not hand-maintained: `scripts/gen-agent-frontmatter.js`
stamps each `agents/*.md` `model:` line from the role-to-profile mapping in
`skills/gorkhali/references/model-policy.json`, resolved to a concrete model per
host by `skills/gorkhali/references/model-presets.json`. A drift test fails CI
if a pin is hand-edited out of sync with that policy. Do not hand-edit a pin or
restate a concrete model name here - change the policy file instead.

Only Chief inherits the session model (Opus 5 recommended); every other role is
delegated, and on this host the delegated profiles resolve to `haiku` (`economy`)
or `sonnet` (`balanced`/`deep`). The
profile a role pins is still meaningful - it sets the seniority Chief briefs that
role at, and it still spreads across models on other hosts - so do not "fix" a
role's profile down (or up) because two resolved pins look the same on one host.
One consequence to keep in mind: there is no richer model to escalate a stuck
assignment into, so re-decompose it instead.

## Workflow

```
Plan (Chief) → Challenge + plan-check (Opposition) → Build (Engineer) → Verify (Inspector) → Simplify → Review (Auditor)
```

## Usage

```bash
/gorkhali:start "ticket or description"
```

## Configuration

See the installed plugin dir for the full skill system (self-resolve: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/gorkhali/gorkhali/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -z "$PR" ] && echo "gorkhali: plugin dir not found - run /plugin to install"`).

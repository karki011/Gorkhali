# Configuration

The optional layered config file and every user-relevant environment variable.

## Config File

Optional and layered, created lazily - a fresh install needs no setup step.
Two JSON files, per-repo winning over global:

- `<data>/repos/<repo>/config.json` - per-repo
- `<data>/config.json` - global default

Resolution order, first hit wins: explicit override, per-repo, global, detect,
unset. Every resolved value carries provenance, so you can see why a setting
has its value; an unset key reports unset with the layers it searched, never
a fabricated default.

CLI: `node scripts/phantom-config.js get|set|list`, with `--global` on `set`
and `--json` throughout.

Current keys: `tracker.provider` (`jira`|`linear`|`github`|`file`|`none`),
`tracker.ready_signal`, `tracker.label`, `tracker.chosen`, `tracker.chosen_at`,
`jira.auto_transition`, `review.external` (`greptile`|`none`), `spend.ceiling_usd`.

## Environment Variables

The rest of optional behavior is controlled by environment variables. The
user-relevant ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PHANTOM_DATA` | `~/.phantom` | Root for all mutable state (sessions, learnings) |
| `PHANTOM_REPO` | git-root basename | Override the repo name used for state partitioning |
| `PHANTOM_ROUTING_NUDGE` | `1` (on) | Prompt-time routing reminder; set `0` to silence |
| `PHANTOM_ROUTING_ENFORCE` | `0` (off) | When `1`, hard-block implementation edits outside a phantom session |
| `PHANTOM_ROUTING_SCOPE` | Phantom-known repositories | Set `all-git` to extend routing enforcement to Git repositories Phantom has not managed yet |
| `PHANTOM_ADHOC` | unset | Set `1` for logged ad-hoc edits when routing enforcement is on |
| `PHANTOM_PROTECTED_BRANCHES` | `main,master` | Branches Phantom refuses to commit to directly |
| `PHANTOM_GREPTILE_TONE` | `neutral` | Tone for greploop's in-thread review replies |
| `PHANTOM_SPEND_CEILING_USD` | `5` | Unattended-run spend ceiling in USD (`scripts/run-guard.js`); binds only unattended runs - an interactive session is never capped because the watching human is the ceiling |
| `PHANTOM_STUCK_REPEAT_LIMIT` | `2` | Unattended-run stuck detection: same-failure-class repeats that halt the run |
| `PHANTOM_FIX_LOOP_CEILING` / `PHANTOM_GREPLOOP_GATE_MAX` | - | Loop ceilings for fix and greploop workflows |

Many more internal vars exist (eval, migration, learning-decay tuning) - grep `PHANTOM_` across `hooks/` and `reference/` for the full set.

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

CLI: `node scripts/gorkhali-config.js get|set|list`, with `--global` on `set`
and `--json` throughout.

Current keys: `tracker.provider` (`jira`|`linear`|`github`|`file`|`none`),
`tracker.ready_signal`, `tracker.label`, `tracker.chosen`, `tracker.chosen_at`,
`jira.auto_transition`, `review.external` (`greptile`|`none`), `spend.ceiling_usd`.

## Environment Variables

The rest of optional behavior is controlled by environment variables. The
user-relevant ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GORKHALI_DATA` | `~/.gorkhali` | Root for all mutable state (sessions, learnings) |
| `GORKHALI_REPO` | git-root basename | Override the repo name used for state partitioning |
| `GORKHALI_ROUTING_NUDGE` | `1` (on) | Prompt-time routing reminder; set `0` to silence |
| `GORKHALI_ROUTING_ENFORCE` | `0` (off) | When `1`, hard-block implementation edits outside a gorkhali session |
| `GORKHALI_ROUTING_SCOPE` | Gorkhali-known repositories | Set `all-git` to extend routing enforcement to Git repositories Gorkhali has not managed yet |
| `GORKHALI_ADHOC` | unset | Set `1` for logged ad-hoc edits when routing enforcement is on |
| `GORKHALI_PROTECTED_BRANCHES` | `main,master` | Branches Gorkhali refuses to commit to directly |
| `GORKHALI_GREPTILE_TONE` | `neutral` | Tone for greploop's in-thread review replies |
| `GORKHALI_SPEND_CEILING_USD` | `5` | Unattended-run spend ceiling in USD (`scripts/run-guard.js`); binds only unattended runs - an interactive session is never capped because the watching human is the ceiling |
| `GORKHALI_STUCK_REPEAT_LIMIT` | `2` | Unattended-run stuck detection: same-failure-class repeats that halt the run |
| `GORKHALI_FIX_LOOP_CEILING` / `GORKHALI_GREPLOOP_GATE_MAX` | - | Loop ceilings for fix and greploop workflows |
| `GORKHALI_COMPRESS_PROVIDER` | `claude` | Memory-compression backend (`scripts/compress/compress.py`); set `kimi` to route compression to the Kimi API (`MOONSHOT_API_KEY`/`KIMI_API_KEY`, model `kimi-k3`) and make the Anthropic path unreachable |
| `GORKHALI_EVAL_KIMI_BIN` | `kimi` | Kimi Code binary used by `scripts/run-evals.js --host kimi` (judge defaults to `k3`, overridable via `GORKHALI_EVAL_JUDGE_MODEL`) |

Many more internal vars exist (eval, migration, learning-decay tuning) - grep `GORKHALI_` across `hooks/` and `reference/` for the full set.

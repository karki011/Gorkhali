---
name: phantom:setup
description: "Use to initialize or re-initialize Phantom after a plugin install — sets up PHANTOM_DATA dirs and the learnings INDEX. Run once after installing the plugin. Also use when user says 'set up phantom', 'init phantom', 'first-run setup', or 'configure phantom'. Safe to re-run."
---

> **Preamble Tier: T1** — loads '_shared.md' only

# /phantom:setup

Run the setup wizard from the install dir:

```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
[ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install"; exit 1; }
SETUP="$PR/setup.sh"
if [ ! -f "$SETUP" ]; then
  echo "Phantom setup.sh not found at: $SETUP"
  echo "Run /phantom:setup from inside Claude Code with the Phantom plugin installed, or use the git-clone install (see README)."
  exit 1
fi
bash "$SETUP"
```

This (re)initializes the PHANTOM_DATA directories and seeds the learnings `INDEX.md`. Safe and idempotent — re-running only fills in what's missing. Runtime behavior is driven by env vars (e.g. `PHANTOM_DATA`, `PHANTOM_PROTECTED_BRANCHES`), not a config file.

It's the plugin-native replacement for the wizard step that `install.sh` ran for symlink installs: plugins are dropped in place without executing that script, so first-run config needs this explicit entry point.

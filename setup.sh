#!/usr/bin/env bash
# Phantom Works — Setup Wizard
# Author: Subash Karki

set -euo pipefail

# REPO_DIR = where the code lives (this clone / plugin install).
# PHANTOM_DATA = where mutable state lives (survives plugin updates).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$REPO_DIR/scripts/lib/phantom-paths.sh"
COMMANDS_LINK="$HOME/.claude/commands/phantom"

# Test seam: source with PHANTOM_SETUP_SOURCE_ONLY=1 to load functions only.
if [ "${PHANTOM_SETUP_SOURCE_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

echo ""
echo "  Phantom Works — Agent Shadows Setup"
echo "  ─────────────────────────────────"
echo ""

# 1. Symlink
mkdir -p "$HOME/.claude/commands"
if [ -L "$COMMANDS_LINK" ] || [ -d "$COMMANDS_LINK" ]; then
  echo "  ✓ Symlink exists: $COMMANDS_LINK"
else
  ln -s "$REPO_DIR/commands" "$COMMANDS_LINK"
  echo "  ✓ Created symlink: $COMMANDS_LINK → $REPO_DIR/commands"
fi

# 2. Initialize directories (mutable state under PHANTOM_DATA)
for dir in sessions state state/completed learnings global/patterns audit; do
  mkdir -p "$PHANTOM_DATA/$dir"
  if [ ! -f "$PHANTOM_DATA/$dir/.gitkeep" ]; then
    touch "$PHANTOM_DATA/$dir/.gitkeep"
  fi
done
echo "  ✓ Directories initialized (sessions, state, learnings, global/patterns)"

# 3. Initialize learnings INDEX.md if empty
if [ ! -f "$PHANTOM_DATA/learnings/INDEX.md" ]; then
  cat > "$PHANTOM_DATA/learnings/INDEX.md" << 'INDEXEOF'
# Learnings Index

## Patterns

## Corrections

## Sessions
INDEXEOF
  echo "  ✓ Created learnings/INDEX.md"
fi

# 4. Configuration — none required.
# Phantom is config-free. Optional behavior is tuned with env vars at runtime:
#   PHANTOM_ROUTING_ENFORCE, PHANTOM_ROUTING_NUDGE, PHANTOM_PROTECTED_BRANCHES.
#   MCP integrations are auto-detected at use time.
echo ""
echo "  ✓ No configuration file needed (optional env vars: PHANTOM_ROUTING_ENFORCE, PHANTOM_ROUTING_NUDGE, PHANTOM_PROTECTED_BRANCHES)"

# 5. Make all hooks and scripts executable (shipped code — under REPO_DIR)
for hook in "$REPO_DIR"/hooks/*.sh "$REPO_DIR"/hooks/*.js; do
  [ -f "$hook" ] && chmod +x "$hook"
done
echo "  ✓ Hook scripts ready"

for script in "$REPO_DIR"/scripts/*.sh "$REPO_DIR"/scripts/*.js; do
  [ -f "$script" ] && chmod +x "$script"
done
echo "  ✓ Utility scripts ready (evolution-runner, session-cleanup, preamble-tier)"

# 7c. De-dupe legacy phantom hooks from settings.json (PLUGIN installs only).
# The plugin's hooks/hooks.json registers Phantom's 5 hooks via ${CLAUDE_PLUGIN_ROOT}.
# Legacy symlink installs ALSO registered them in settings.json with absolute
# $HOME/.claude/phantom/hooks/ paths — so a plugin-alongside-symlink setup double-fires.
# GUARD: if REPO_DIR IS the legacy symlink dir, those entries are OUR legitimate
# registration — do NOT touch them. Only a plugin install (REPO_DIR elsewhere) treats
# them as stale duplicates. Whole step is non-fatal.
if [ "$REPO_DIR" = "$HOME/.claude/phantom" ]; then
  echo "  ○ Symlink install — leaving settings.json hook entries in place"
else
  SETTINGS="$HOME/.claude/settings.json"
  if [ ! -f "$SETTINGS" ]; then
    : # no settings.json — nothing to de-dupe
  elif ! command -v jq &>/dev/null; then
    echo "  ⚠ jq not found — skipping settings.json legacy-hook de-dupe (remove them manually; see README)"
  else
    PHANTOM_DEDUPE_JQ='
      ($HOME + "/.claude/phantom/hooks/") as $legacy
      | (["memory-writer.js","apex-subagent-driven-law.sh","memory-reader.js","memory-consolidator.js","context-compact-guide.sh"]) as $names
      | def drop_entry($h):
          ($h.command // "") as $c
          | ($c | type == "string") and ($c | contains($legacy)) and (any($names[]; . as $n | $c | contains($n)));
        if (.hooks | type) == "object" then
          .hooks |= with_entries(
            .value |= ( map( .hooks |= map(select(drop_entry(.) | not)) )
                        | map(select((.hooks | length) > 0)) )
          )
        else . end
    '
    PHANTOM_DEDUPE_TMP="$(mktemp "${TMPDIR:-/tmp}/phantom-settings.XXXXXX")"
    if jq --arg HOME "$HOME" "$PHANTOM_DEDUPE_JQ" "$SETTINGS" > "$PHANTOM_DEDUPE_TMP" 2>/dev/null && jq empty "$PHANTOM_DEDUPE_TMP" 2>/dev/null; then
      if [ "$(jq -S . "$SETTINGS" 2>/dev/null)" = "$(jq -S . "$PHANTOM_DEDUPE_TMP" 2>/dev/null)" ]; then
        echo "  ✓ No legacy phantom hook entries to remove"
      else
        PHANTOM_BEFORE=$(jq '[.hooks // {} | to_entries[] | .value[] | .hooks[]] | length' "$SETTINGS" 2>/dev/null || echo 0)
        PHANTOM_AFTER=$(jq '[.hooks // {} | to_entries[] | .value[] | .hooks[]] | length' "$PHANTOM_DEDUPE_TMP" 2>/dev/null || echo 0)
        cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d-%H%M%S)"
        mv "$PHANTOM_DEDUPE_TMP" "$SETTINGS"
        echo "  ✓ Removed $((PHANTOM_BEFORE - PHANTOM_AFTER)) legacy phantom hook entries from settings.json (plugin install)"
      fi
    else
      echo "  ⚠ settings.json de-dupe produced invalid output — left settings.json untouched"
    fi
    rm -f "$PHANTOM_DEDUPE_TMP"
  fi
fi

# 6. Prerequisites check
echo ""
echo "  Prerequisites"
echo "  ─────────────"

if command -v claude &>/dev/null; then
  echo "  ✓ Claude Code CLI"
else
  echo "  ✗ Claude Code CLI — install from https://claude.ai/code"
fi

if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
  echo "  ✓ gh CLI (authenticated)"
else
  echo "  ○ gh CLI — install and run 'gh auth login' for PR features"
fi

# 7. Migrate legacy data into PHANTOM_DATA (one-time, idempotent, non-fatal)
echo ""
node "$REPO_DIR/scripts/migrate-data.js" || echo "  ○ migration skipped/failed (non-fatal)"

echo ""
echo "  ─────────────────────────────────"
echo "  Ready! Run /phantom:start \"your task\" in any repo."
echo ""
echo "  Quick start:"
echo "    /phantom:start \"PROJ-123\"          # with Jira ticket"
echo "    /phantom:start \"fix the auth bug\"  # free text"
echo "    /phantom:brainstorm \"approaches\"   # diverge/converge"
echo "    /phantom:wire                      # dependency topology"
echo "    /phantom:verify                    # run quality gate"
echo "    /phantom:evolve                    # run evolution pipeline"
echo "    /phantom:pause                     # save & step away"
echo ""

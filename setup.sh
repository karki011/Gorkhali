#!/usr/bin/env bash
# Phantom Works — Setup Wizard
# Author: Subash Karki

set -euo pipefail

# REPO_DIR = where the code lives (this clone / plugin install).
# PHANTOM_DATA = where mutable state lives (survives plugin updates).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$REPO_DIR/scripts/lib/phantom-paths.sh"
COMMANDS_LINK="$HOME/.claude/commands/phantom"

# Merge generated config into target. Fresh target gets the full file; an
# existing target keeps every user value — only missing top-level sections
# (and models.sage) are appended.
phantom_merge_config() {
  local generated="$1" target="$2"

  if [ ! -f "$target" ]; then
    cp "$generated" "$target"
    echo "  ✓ Config written to $target"
    return 0
  fi

  local added="" section
  for section in $(grep -E '^[a-z_]+:' "$generated" | cut -d: -f1); do
    if ! grep -q "^${section}:" "$target"; then
      printf '\n' >> "$target"
      awk -v s="$section" '$0 == s":" {p=1} p && $0 ~ /^[a-z_]+:/ && $0 != s":" {exit} p {print}' "$generated" >> "$target"
      added="$added $section"
    fi
  done

  if grep -q '^models:' "$target" && ! grep -qE '^[[:space:]]+sage:' "$target"; then
    local sage_line tmp
    sage_line="$(grep -m1 -E '^[[:space:]]+sage:' "$generated")"
    tmp="$(mktemp "${TMPDIR:-/tmp}/phantom-config.XXXXXX")"
    awk -v line="$sage_line" '{print} /^models:/ {print line}' "$target" > "$tmp"
    mv "$tmp" "$target"
    added="$added models.sage"
  fi

  if [ -n "$added" ]; then
    echo "  ✓ Existing config preserved at $target — added missing:$added"
  else
    echo "  ✓ Existing config preserved at $target — nothing to add"
  fi
}

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

# 4. Configuration
echo ""
echo "  Configuration"
echo "  ─────────────"

# Jira project key
read -rp "  ? Jira project key (e.g., CP) [skip]: " JIRA_PROJECT
JIRA_PROJECT="${JIRA_PROJECT:-}"

# Slack DM channel
read -rp "  ? Slack DM channel ID for notifications [skip]: " SLACK_CHANNEL
SLACK_CHANNEL="${SLACK_CHANNEL:-}"

# Sage escalation model — models.sage is the only live model key; all other
# agents inherit the session model.
read -rp "  ? Do you have Fable 5 model entitlement? (Y/n) [Y]: " FABLE_ENTITLED
case "${FABLE_ENTITLED:-Y}" in
  [Nn]*) SAGE_MODEL="opus" ;;
  *)     SAGE_MODEL="fable" ;;
esac

# Greptile review loop — opt-in (requires the Greptile bot on your repos)
read -rp "  ? Enable Greptile PR review loop? (y/N) [N]: " GREPTILE_ENABLED
case "${GREPTILE_ENABLED:-N}" in
  [Yy]*) GREPTILE_AVAILABLE="true" ;;
  *)     GREPTILE_AVAILABLE="false" ;;
esac

# 5. Auto-detect integrations
echo ""
echo "  Detecting integrations..."

ATLASSIAN_AVAILABLE="false"
if claude --print 2>/dev/null | grep -q "atlassian" 2>/dev/null; then
  ATLASSIAN_AVAILABLE="true"
  echo "  ✓ Atlassian MCP: detected"
else
  echo "  ○ Atlassian MCP: not found (Jira features disabled)"
fi

PHANTOM_AVAILABLE="false"
if claude --print 2>/dev/null | grep -q "phantom" 2>/dev/null; then
  PHANTOM_AVAILABLE="true"
  echo "  ✓ phantom-ai MCP: detected"
else
  echo "  ○ phantom-ai MCP: not found (graph features disabled)"
fi

SLACK_AVAILABLE="false"
if claude --print 2>/dev/null | grep -q "Slack" 2>/dev/null; then
  SLACK_AVAILABLE="true"
  echo "  ✓ Slack MCP: detected"
else
  echo "  ○ Slack MCP: not found (notifications disabled)"
fi

CODE_GRAPH_AVAILABLE="false"
if claude --print 2>/dev/null | grep -q "code-review-graph" 2>/dev/null; then
  CODE_GRAPH_AVAILABLE="true"
  echo "  ✓ code-review-graph MCP: detected"
else
  echo "  ○ code-review-graph MCP: not found (structural analysis disabled)"
fi

CONTEXT_MODE_AVAILABLE="false"
if claude --print 2>/dev/null | grep -q "context-mode" 2>/dev/null; then
  CONTEXT_MODE_AVAILABLE="true"
  echo "  ✓ context-mode MCP: detected"
else
  echo "  ○ context-mode MCP: not found (context window protection disabled)"
fi

CLAUDE_FLOW_AVAILABLE="false"
if claude --print 2>/dev/null | grep -q "claude-flow" 2>/dev/null; then
  CLAUDE_FLOW_AVAILABLE="true"
  echo "  ✓ claude-flow MCP: detected"
else
  echo "  ○ claude-flow MCP: not found (cross-session memory disabled)"
fi

FIGMA_AVAILABLE="false"
if claude --print 2>/dev/null | grep -qi "figma" 2>/dev/null; then
  FIGMA_AVAILABLE="true"
  echo "  ✓ Figma MCP: detected"
else
  echo "  ○ Figma MCP: not found (design extraction falls back to exported screenshots)"
fi

# 6. Write config (mutable — under PHANTOM_DATA); merge-safe on re-run
PHANTOM_GEN_CONFIG="$(mktemp "${TMPDIR:-/tmp}/phantom-config-gen.XXXXXX")"
cat > "$PHANTOM_GEN_CONFIG" << CONFIGEOF
# Phantom Works — User Configuration
# Generated by setup.sh on $(date +%Y-%m-%d)

jira:
  project: "${JIRA_PROJECT}"
  auto_transition: true

git:
  protected_branches: [main, master, develop]

slack:
  dm_channel: "${SLACK_CHANNEL}"
  enabled: ${SLACK_AVAILABLE}

models:
  sage: ${SAGE_MODEL}

integrations:
  atlassian_mcp: ${ATLASSIAN_AVAILABLE}
  phantom_ai: ${PHANTOM_AVAILABLE}
  slack_mcp: ${SLACK_AVAILABLE}
  code_review_graph: ${CODE_GRAPH_AVAILABLE}
  context_mode: ${CONTEXT_MODE_AVAILABLE}
  claude_flow: ${CLAUDE_FLOW_AVAILABLE}
  figma_mcp: ${FIGMA_AVAILABLE}
  greptile: ${GREPTILE_AVAILABLE}

greptile:
  reply_tone: neutral

learning:
  stale_days: 30
  remove_days: 60
  distill_cap: 50

preferences:
  auto_draft_pr: true
  caveman_output: true
  fun_fact_in_pr: false
CONFIGEOF
echo ""
phantom_merge_config "$PHANTOM_GEN_CONFIG" "$PHANTOM_DATA/config.yaml"
rm -f "$PHANTOM_GEN_CONFIG"

# 7. Make all hooks and scripts executable (shipped code — under REPO_DIR)
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

# 8. Prerequisites check
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

# 9. Migrate legacy data into PHANTOM_DATA (one-time, idempotent, non-fatal)
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

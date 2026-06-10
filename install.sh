#!/usr/bin/env bash
# Phantom Works — One-Command Installer
# Author: Subash Karki
#
# Usage:
#   chmod +x install.sh && ./install.sh
#
# Or if you have the repo URL:
#   bash <(curl -sSL https://raw.githubusercontent.com/Cloudzero/research-phantom-skills/main/install.sh)

set -euo pipefail

LEGACY=0
for arg in "$@"; do
  case "$arg" in
    --legacy) LEGACY=1 ;;
  esac
done

TEAM_DIR="${PHANTOM_INSTALL_DIR:-$HOME/.claude/phantom}"
COMMANDS_LINK="$HOME/.claude/commands/phantom"
AGENTS_LINK_DIR="$HOME/.claude/agents/phantom"
REPO_SSH="git@github.com:Cloudzero/research-phantom-skills.git"
REPO_HTTPS="https://github.com/Cloudzero/research-phantom-skills.git"

# Auto-detect legacy mode: a prior symlink install must keep being maintained,
# otherwise a re-run silently drops command/agent registration.
if [ "$LEGACY" -eq 0 ] && { [ -L "$COMMANDS_LINK" ] || [ -d "$COMMANDS_LINK" ] || [ -d "$AGENTS_LINK_DIR" ]; }; then
  LEGACY=1
  echo "  existing legacy symlink install detected — maintaining legacy mode; remove symlinks and use the plugin install to migrate"
fi

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     Phantom Works — Installer         ║"
echo "  ║     Multi-agent shadows for Claude Code   ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

# ─── Prerequisites ───

check_prereq() {
  if command -v "$1" &>/dev/null; then
    echo "  ✓ $1"
    return 0
  else
    echo "  ✗ $1 — $2"
    return 1
  fi
}

echo "  Checking prerequisites..."
MISSING=0
check_prereq git "install from https://git-scm.com" || MISSING=1
check_prereq claude "install from https://claude.ai/code" || true  # warn only

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "  ✗ Missing required prerequisites. Install them and re-run."
  exit 1
fi
echo ""

# ─── Handle Existing Install ───

if [ -d "$TEAM_DIR" ]; then
  echo "  Existing install found at $TEAM_DIR"
  echo ""
  echo "  Options:"
  echo "    u) Update — git pull latest changes"
  echo "    f) Fresh — remove and re-clone (preserves learnings)"
  echo "    q) Quit"
  echo ""
  read -rp "  ? Choose [u/f/q]: " CHOICE

  case "$CHOICE" in
    u|U)
      echo ""
      echo "  Updating..."
      cd "$TEAM_DIR"
      # Legacy clones may have a stale remote name or a dead upstream URL.
      # Repoint origin to the canonical URL, preserving SSH vs HTTPS transport.
      case "$(git remote get-url origin 2>/dev/null)" in
        git@*|ssh://*) REPO_PULL="$REPO_SSH" ;;
        *)             REPO_PULL="$REPO_HTTPS" ;;
      esac
      git remote set-url origin "$REPO_PULL" 2>/dev/null || git remote add origin "$REPO_PULL"
      git pull --ff-only origin main 2>/dev/null || {
        echo "  ✗ Pull failed. Check your git remotes."
        exit 1
      }
      echo "  ✓ Updated to latest"
      echo ""
      echo "  Running setup..."
      exec "$TEAM_DIR/setup.sh"
      ;;
    f|F)
      echo ""
      # Backup learnings
      if [ -d "$TEAM_DIR/learnings" ] && [ "$(ls -A "$TEAM_DIR/learnings" 2>/dev/null)" ]; then
        BACKUP="$HOME/.claude/phantom-learnings-backup-$(date +%Y%m%d-%H%M%S)"
        cp -r "$TEAM_DIR/learnings" "$BACKUP"
        echo "  ✓ Learnings backed up to $BACKUP"
      fi
      # Remove symlink first
      [ -L "$COMMANDS_LINK" ] && rm "$COMMANDS_LINK"
      rm -rf "$TEAM_DIR"
      echo "  ✓ Removed old install"
      ;;
    *)
      echo "  Quit."
      exit 0
      ;;
  esac
fi

# ─── Clone ───

if [ ! -d "$TEAM_DIR" ]; then
  echo "  Cloning Phantom Works..."

  # Try SSH first, fall back to HTTPS
  if git clone "$REPO_SSH" "$TEAM_DIR" 2>/dev/null; then
    echo "  ✓ Cloned via SSH"
  elif git clone "$REPO_HTTPS" "$TEAM_DIR" 2>/dev/null; then
    echo "  ✓ Cloned via HTTPS"
  else
    echo ""
    echo "  ✗ Clone failed. Make sure you have access to:"
    echo "    $REPO_SSH"
    echo "  Or authenticate with: gh auth login"
    exit 1
  fi
fi

# ─── Legacy Symlinks ───
# Native plugin install is preferred. The symlink registration only runs with --legacy.

if [ "$LEGACY" -eq 1 ]; then
  if [ -L "$COMMANDS_LINK" ] || [ -d "$COMMANDS_LINK" ]; then
    echo "  ✓ Symlink exists: $COMMANDS_LINK"
  else
    mkdir -p "$HOME/.claude/commands"
    ln -s "$TEAM_DIR/commands" "$COMMANDS_LINK"
    echo "  ✓ Created symlink: $COMMANDS_LINK"
  fi

  # Claude Code discovers user subagents from ~/.claude/agents/.
  # Symlink each real agent so its model/effort frontmatter takes effect.
  # The *.md glob only matches files directly in agents/ (reference/ is a subdir, not agent files).
  mkdir -p "$AGENTS_LINK_DIR"

  AGENT_COUNT=0
  for agent_file in "$TEAM_DIR"/agents/*.md; do
    [ -f "$agent_file" ] || continue
    agent_name="$(basename "$agent_file")"
    ln -sf "$agent_file" "$AGENTS_LINK_DIR/$agent_name"
    AGENT_COUNT=$((AGENT_COUNT + 1))
  done
  echo "  ✓ Registered $AGENT_COUNT Phantom agents as Claude Code subagents"
else
  echo "  Native plugin install is preferred. In Claude Code, run:"
  echo "    /plugin marketplace add Cloudzero/research-phantom-skills"
  echo "    /plugin install phantom@phantom"
  echo "  Re-run with --legacy to symlink commands and agents instead."
fi

# ─── Run Setup Wizard ───

echo ""
echo "  Running setup wizard..."
echo ""
exec "$TEAM_DIR/setup.sh"

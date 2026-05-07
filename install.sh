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

TEAM_DIR="$HOME/.claude/team"
COMMANDS_LINK="$HOME/.claude/commands/team"
REPO_SSH="git@github.com:Cloudzero/research-phantom-skills.git"
REPO_HTTPS="https://github.com/Cloudzero/research-phantom-skills.git"

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     Phantom Works — Installer         ║"
echo "  ║     Multi-agent crew for Claude Code   ║"
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
      git pull origin main 2>/dev/null || git pull cloudzero main 2>/dev/null || {
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
        BACKUP="$HOME/.claude/team-learnings-backup-$(date +%Y%m%d-%H%M%S)"
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

# ─── Symlink ───

if [ -L "$COMMANDS_LINK" ] || [ -d "$COMMANDS_LINK" ]; then
  echo "  ✓ Symlink exists: $COMMANDS_LINK"
else
  mkdir -p "$HOME/.claude/commands"
  ln -s "$TEAM_DIR/commands" "$COMMANDS_LINK"
  echo "  ✓ Created symlink: $COMMANDS_LINK"
fi

# ─── Run Setup Wizard ───

echo ""
echo "  Running setup wizard..."
echo ""
exec "$TEAM_DIR/setup.sh"

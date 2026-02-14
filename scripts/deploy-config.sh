#!/bin/bash
# deploy-config.sh
# Initializes the config bare repository for kickstart-first bootstrap.
#
# Usage:
#   ./scripts/deploy-config.sh              # default destination
#   ./scripts/deploy-config.sh /custom/path # custom destination

set -euo pipefail

CONFIG_DEST="${1:-/opt/arche/kb-config}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${GREEN}[deploy-config]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[deploy-config]${NC} $1"
}

error() {
  echo -e "${RED}[deploy-config]${NC} $1" >&2
  exit 1
}

is_bare_repo() {
  git --git-dir="$CONFIG_DEST" rev-parse --is-bare-repository >/dev/null 2>&1
}

is_non_bare_repo() {
  [ -d "$CONFIG_DEST/.git" ] && git -C "$CONFIG_DEST" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

ensure_bare_repo() {
  if is_bare_repo; then
    return
  fi

  if is_non_bare_repo; then
    warn "Non-bare repo detected at $CONFIG_DEST. Migrating to bare repo..."
    local backup_dir
    local bare_tmp
    backup_dir="${CONFIG_DEST}.worktree.bak.$(date +%s)"
    bare_tmp="${CONFIG_DEST}.bare"

    git clone --bare "$CONFIG_DEST" "$bare_tmp"
    mv "$CONFIG_DEST" "$backup_dir"
    mv "$bare_tmp" "$CONFIG_DEST"
    log "Previous working tree moved to $backup_dir"
    return
  fi

  if [ -d "$CONFIG_DEST" ] && [ -n "$(ls -A "$CONFIG_DEST" 2>/dev/null)" ]; then
    warn "Directory $CONFIG_DEST is not empty and is not a git repo. Backing it up."
    local backup_dir
    backup_dir="${CONFIG_DEST}.backup.$(date +%s)"
    mv "$CONFIG_DEST" "$backup_dir"
    log "Moved existing directory to $backup_dir"
  fi

  log "Initializing bare Git repository at $CONFIG_DEST"
  mkdir -p "$(dirname "$CONFIG_DEST")"
  git init --bare --initial-branch=main "$CONFIG_DEST" 2>/dev/null || git init --bare "$CONFIG_DEST"
}

ensure_bare_repo

if git --git-dir="$CONFIG_DEST" show-ref --verify --quiet refs/heads/main; then
  git --git-dir="$CONFIG_DEST" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
else
  git --git-dir="$CONFIG_DEST" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
fi

log "Config repository initialized for kickstart-first flow"
log "Bare repo: $CONFIG_DEST"

if git --git-dir="$CONFIG_DEST" rev-parse --verify HEAD >/dev/null 2>&1; then
  log "Recent commits:"
  git --no-pager --git-dir="$CONFIG_DEST" log --oneline -3
else
  log "No commits present (expected until kickstart apply)"
fi

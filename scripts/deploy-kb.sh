#!/bin/bash
# deploy-kb.sh
# Initializes the KB bare repository for kickstart-first bootstrap.
#
# Usage:
#   ./scripts/deploy-kb.sh              # default destination
#   ./scripts/deploy-kb.sh /custom/path # custom destination

set -euo pipefail

KB_DEST="${1:-/opt/arche/kb-content}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
  echo -e "${GREEN}[deploy-kb]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[deploy-kb]${NC} $1"
}

error() {
  echo -e "${RED}[deploy-kb]${NC} $1" >&2
  exit 1
}

is_bare_repo() {
  git --git-dir="$KB_DEST" rev-parse --is-bare-repository >/dev/null 2>&1
}

is_non_bare_repo() {
  [ -d "$KB_DEST/.git" ] && git -C "$KB_DEST" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

normalize_repo_permissions() {
  chmod -R a+rwX "$KB_DEST"
}

ensure_bare_repo() {
  if is_bare_repo; then
    return
  fi

  if is_non_bare_repo; then
    warn "Non-bare repo detected at $KB_DEST. Migrating to bare repo..."
    local backup_dir
    local bare_tmp
    backup_dir="${KB_DEST}.worktree.bak.$(date +%s)"
    bare_tmp="${KB_DEST}.bare"

    git clone --bare "$KB_DEST" "$bare_tmp"
    mv "$KB_DEST" "$backup_dir"
    mv "$bare_tmp" "$KB_DEST"
    log "Previous working tree moved to $backup_dir"
    return
  fi

  if [ -d "$KB_DEST" ] && [ -n "$(ls -A "$KB_DEST" 2>/dev/null)" ]; then
    warn "Directory $KB_DEST is not empty and is not a git repo. Backing it up."
    local backup_dir
    backup_dir="${KB_DEST}.backup.$(date +%s)"
    mv "$KB_DEST" "$backup_dir"
    log "Moved existing directory to $backup_dir"
  fi

  log "Initializing bare Git repository at $KB_DEST"
  mkdir -p "$(dirname "$KB_DEST")"
  git init --bare --initial-branch=main "$KB_DEST" 2>/dev/null || git init --bare "$KB_DEST"
}

ensure_bare_repo

if git --git-dir="$KB_DEST" show-ref --verify --quiet refs/heads/main; then
  git --git-dir="$KB_DEST" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
else
  git --git-dir="$KB_DEST" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
fi

normalize_repo_permissions

log "KB repository initialized for kickstart-first flow"
log "Bare repo: $KB_DEST"

if git --git-dir="$KB_DEST" rev-parse --verify HEAD >/dev/null 2>&1; then
  log "Recent commits:"
  git --no-pager --git-dir="$KB_DEST" log --oneline -3
else
  log "No commits present (expected until kickstart apply)"
fi

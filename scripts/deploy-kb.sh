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
NC='\033[0m'

log() {
  echo -e "${GREEN}[deploy-kb]${NC} $1"
}

error() {
  echo -e "${RED}[deploy-kb]${NC} $1" >&2
  exit 1
}

is_bare_repo() {
  git --git-dir="$KB_DEST" rev-parse --is-bare-repository >/dev/null 2>&1
}

normalize_repo_permissions() {
  chmod -R a+rwX "$KB_DEST"
}

ensure_bare_repo() {
  if is_bare_repo; then
    return
  fi

  if [ -e "$KB_DEST" ] && [ ! -d "$KB_DEST" ]; then
    error "Destination exists and is not a directory: $KB_DEST"
  fi

  if [ -d "$KB_DEST" ] && [ -n "$(ls -A "$KB_DEST" 2>/dev/null)" ]; then
    error "Destination must be an empty directory or a bare repository: $KB_DEST"
  fi

  log "Initializing bare Git repository at $KB_DEST"
  mkdir -p "$(dirname "$KB_DEST")"
  git init --bare --initial-branch=main "$KB_DEST"
}

ensure_bare_repo

git --git-dir="$KB_DEST" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true

normalize_repo_permissions

log "KB repository initialized for kickstart-first flow"
log "Bare repo: $KB_DEST"

if git --git-dir="$KB_DEST" rev-parse --verify HEAD >/dev/null 2>&1; then
  log "Recent commits:"
  git --no-pager --git-dir="$KB_DEST" log --oneline -3
else
  log "No commits present (expected until kickstart apply)"
fi

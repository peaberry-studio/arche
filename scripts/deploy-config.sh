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
NC='\033[0m'

log() {
  echo -e "${GREEN}[deploy-config]${NC} $1"
}

error() {
  echo -e "${RED}[deploy-config]${NC} $1" >&2
  exit 1
}

is_bare_repo() {
  git --git-dir="$CONFIG_DEST" rev-parse --is-bare-repository >/dev/null 2>&1
}

ensure_bare_repo() {
  if is_bare_repo; then
    return
  fi

  if [ -e "$CONFIG_DEST" ] && [ ! -d "$CONFIG_DEST" ]; then
    error "Destination exists and is not a directory: $CONFIG_DEST"
  fi

  if [ -d "$CONFIG_DEST" ] && [ -n "$(ls -A "$CONFIG_DEST" 2>/dev/null)" ]; then
    error "Destination must be an empty directory or a bare repository: $CONFIG_DEST"
  fi

  log "Initializing bare Git repository at $CONFIG_DEST"
  mkdir -p "$(dirname "$CONFIG_DEST")"
  git init --bare --initial-branch=main "$CONFIG_DEST"
}

ensure_bare_repo

git --git-dir="$CONFIG_DEST" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true

log "Config repository initialized for kickstart-first flow"
log "Bare repo: $CONFIG_DEST"

if git --git-dir="$CONFIG_DEST" rev-parse --verify HEAD >/dev/null 2>&1; then
  log "Recent commits:"
  git --no-pager --git-dir="$CONFIG_DEST" log --oneline -3
else
  log "No commits present (expected until kickstart apply)"
fi

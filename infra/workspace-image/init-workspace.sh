#!/bin/sh
# init-workspace.sh
# Initializes workspace with KB if empty or without initialized git.
#
# Behavior:
# - If /workspace has no .git and is empty: clone KB repo and configure remote
# - If /workspace already has .git: do nothing (user already has their repo)
#
# Environment variables:
# - WORKSPACE_DIR: workspace directory (default: /workspace)
# - KB_CONTENT_DIR: mounted bare KB content repo directory (default: /kb-content)
# - KB_REMOTE_NAME: remote name for KB (default: kb)

set -e

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
KB_CONTENT_DIR="${KB_CONTENT_DIR:-/kb-content}"
KB_REMOTE_NAME="${KB_REMOTE_NAME:-kb}"
WORKSPACE_GIT_AUTHOR_NAME="${WORKSPACE_GIT_AUTHOR_NAME:-Arche Workspace}"
WORKSPACE_GIT_AUTHOR_EMAIL="${WORKSPACE_GIT_AUTHOR_EMAIL:-workspace@arche.local}"

# Logging function
log() {
  echo "[init-workspace] $1"
}

fail() {
  echo "[init-workspace] $1" >&2
  exit 1
}

is_bare_kb() {
  git --git-dir="$KB_CONTENT_DIR" rev-parse --is-bare-repository >/dev/null 2>&1
}

set_workspace_git_identity() {
  git config user.email "$WORKSPACE_GIT_AUTHOR_EMAIL"
  git config user.name "$WORKSPACE_GIT_AUTHOR_NAME"
}

ensure_workspace_excludes() {
  if [ ! -d "$WORKSPACE_DIR/.git" ]; then
    return
  fi

  exclude_file="$WORKSPACE_DIR/.git/info/exclude"
  touch "$exclude_file"

  if ! grep -qx "opencode.json" "$exclude_file"; then
    echo "opencode.json" >> "$exclude_file"
  fi

  if ! grep -qx "AGENTS.md" "$exclude_file"; then
    echo "AGENTS.md" >> "$exclude_file"
  fi

  if ! grep -qx "node_modules/" "$exclude_file"; then
    echo "node_modules/" >> "$exclude_file"
  fi
}

if [ ! -d "$KB_CONTENT_DIR" ]; then
  fail "Missing KB content mount at $KB_CONTENT_DIR"
fi

if ! is_bare_kb; then
  fail "KB content repository at $KB_CONTENT_DIR must be a bare Git repo"
fi

# Verify whether workspace already has initialized git
if [ -d "$WORKSPACE_DIR/.git" ]; then
  log "Workspace already has git initialized, skipping KB clone"
  
  # Verify whether KB remote exists, add it if missing
  cd "$WORKSPACE_DIR"
  if ! git remote get-url "$KB_REMOTE_NAME" > /dev/null 2>&1; then
    log "Adding KB remote: $KB_CONTENT_DIR"
    git remote add "$KB_REMOTE_NAME" "$KB_CONTENT_DIR"
  fi
  set_workspace_git_identity
  ensure_workspace_excludes
  exit 0
fi

if [ -n "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ]; then
  log "Workspace is not empty and has no git, initializing git without cloning"
  cd "$WORKSPACE_DIR"
  git init -b main
  set_workspace_git_identity
  if ! git remote get-url "$KB_REMOTE_NAME" > /dev/null 2>&1; then
    log "Adding KB remote for future syncs"
    git remote add "$KB_REMOTE_NAME" "$KB_CONTENT_DIR"
  fi
  ensure_workspace_excludes
  exit 0
fi

log "Cloning KB into workspace..."
git -c safe.directory="$KB_CONTENT_DIR" clone "$KB_CONTENT_DIR" "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"
if git remote get-url origin > /dev/null 2>&1 && [ "$KB_REMOTE_NAME" != "origin" ]; then
  git remote rename origin "$KB_REMOTE_NAME" 2>/dev/null || true
fi
if ! git remote get-url "$KB_REMOTE_NAME" > /dev/null 2>&1; then
  git remote add "$KB_REMOTE_NAME" "$KB_CONTENT_DIR"
fi

set_workspace_git_identity

ensure_workspace_excludes

log "Workspace initialization complete"

#!/bin/sh
# init-workspace.sh
# Inicializa el workspace con el KB si está vacío o no tiene git inicializado.
#
# Comportamiento:
# - Si /workspace no tiene .git y está vacío: clona el repo KB y configura remote
# - Si /workspace ya tiene .git: no hace nada (el usuario ya tiene su repo)
#
# Variables de entorno:
# - WORKSPACE_DIR: directorio del workspace (default: /workspace)
# - KB_CONTENT_DIR: directorio del repo bare de contenido montado (default: /kb-content)
# - KB_REMOTE_NAME: nombre del remote para el KB (default: kb)

set -e

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
KB_CONTENT_DIR="${KB_CONTENT_DIR:-/kb-content}"
KB_REMOTE_NAME="${KB_REMOTE_NAME:-kb}"

# Función para logging
log() {
  echo "[init-workspace] $1"
}

is_bare_kb() {
  git --git-dir="$KB_CONTENT_DIR" rev-parse --is-bare-repository >/dev/null 2>&1
}

is_worktree_kb() {
  git -c safe.directory="$KB_CONTENT_DIR" -C "$KB_CONTENT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1
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
}

kb_available=false
if is_bare_kb || is_worktree_kb; then
  kb_available=true
fi

if [ "$kb_available" = false ]; then
  log "KB content repository not found at $KB_CONTENT_DIR, skipping initialization"
  exit 0
fi

# Verificar si el workspace ya tiene git inicializado
if [ -d "$WORKSPACE_DIR/.git" ]; then
  log "Workspace already has git initialized, skipping KB clone"
  
  # Verificar si el remote del KB existe, si no, añadirlo
  cd "$WORKSPACE_DIR"
  if ! git remote get-url "$KB_REMOTE_NAME" > /dev/null 2>&1; then
    log "Adding KB remote: $KB_CONTENT_DIR"
    git remote add "$KB_REMOTE_NAME" "$KB_CONTENT_DIR"
  fi
  ensure_workspace_excludes
  exit 0
fi

if [ -n "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ]; then
  log "Workspace is not empty and has no git, initializing git without cloning"
  cd "$WORKSPACE_DIR"
  git init -b main
  git config user.email "workspace@arche.local"
  git config user.name "Arche Workspace"
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

git config user.email "workspace@arche.local"
git config user.name "Arche Workspace"

ensure_workspace_excludes

log "Workspace initialization complete"

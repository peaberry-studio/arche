#!/bin/sh
# init-workspace.sh
# Inicializa el workspace con el KB si está vacío o no tiene git inicializado.
#
# Comportamiento:
# - Si /workspace está vacío o no tiene .git: copia KB, inicializa git, configura remote
# - Si /workspace ya tiene .git: no hace nada (el usuario ya tiene su repo)
#
# Variables de entorno:
# - WORKSPACE_DIR: directorio del workspace (default: /workspace)
# - KB_DIR: directorio del KB montado (default: /kb)
# - KB_REMOTE_NAME: nombre del remote para el KB (default: kb)

set -e

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
KB_DIR="${KB_DIR:-/kb}"
KB_REMOTE_NAME="${KB_REMOTE_NAME:-kb}"

# Función para logging
log() {
  echo "[init-workspace] $1"
}

# Verificar que el KB existe
if [ ! -d "$KB_DIR" ]; then
  log "KB directory not found at $KB_DIR, skipping initialization"
  exit 0
fi

# Verificar si el workspace ya tiene git inicializado
if [ -d "$WORKSPACE_DIR/.git" ]; then
  log "Workspace already has git initialized, skipping KB copy"
  
  # Verificar si el remote del KB existe, si no, añadirlo
  cd "$WORKSPACE_DIR"
  if ! git remote get-url "$KB_REMOTE_NAME" > /dev/null 2>&1; then
    if [ -d "$KB_DIR/.git" ]; then
      log "Adding KB remote: $KB_DIR"
      git remote add "$KB_REMOTE_NAME" "$KB_DIR"
    fi
  fi
  exit 0
fi

log "Initializing workspace from KB..."

# Copiar contenido del KB al workspace (excepto .git si existe)
# Usamos cp -rn para no sobrescribir archivos existentes
cd "$KB_DIR"
for item in *; do
  if [ "$item" != ".git" ] && [ -e "$item" ]; then
    if [ ! -e "$WORKSPACE_DIR/$item" ]; then
      log "Copying $item to workspace"
      cp -r "$item" "$WORKSPACE_DIR/"
    else
      log "Skipping $item (already exists in workspace)"
    fi
  fi
done

# Copiar archivos ocultos (excepto .git)
for item in .*; do
  if [ "$item" != "." ] && [ "$item" != ".." ] && [ "$item" != ".git" ] && [ -e "$item" ]; then
    if [ ! -e "$WORKSPACE_DIR/$item" ]; then
      log "Copying $item to workspace"
      cp -r "$item" "$WORKSPACE_DIR/"
    fi
  fi
done

# Inicializar git en el workspace
cd "$WORKSPACE_DIR"
log "Initializing git repository"
git init

# Configurar git (necesario para commits)
git config user.email "workspace@arche.local"
git config user.name "Arche Workspace"

# Crear commit inicial
git add -A
git commit -m "Initial workspace from KB" --allow-empty

# Añadir remote del KB para futuros syncs
if [ -d "$KB_DIR/.git" ]; then
  log "Adding KB remote for future syncs"
  git remote add "$KB_REMOTE_NAME" "$KB_DIR"
fi

log "Workspace initialization complete"

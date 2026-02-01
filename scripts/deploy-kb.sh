#!/bin/bash
# deploy-kb.sh
# Despliega el Knowledge Base al host de producción.
#
# Uso:
#   ./scripts/deploy-kb.sh              # Despliega al path por defecto
#   ./scripts/deploy-kb.sh /custom/path # Despliega a un path custom
#
# El script:
# 1. Copia el contenido de kb/ al destino
# 2. Inicializa un repo Git si no existe
# 3. Crea un commit con los cambios

set -euo pipefail

# Configuración
KB_SOURCE="${KB_SOURCE:-$(dirname "$0")/../kb}"
KB_DEST="${1:-/opt/arche/kb}"
GIT_USER_NAME="${GIT_USER_NAME:-Arche Deploy}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-deploy@arche.local}"

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Verificar que el source existe
if [ ! -d "$KB_SOURCE" ]; then
  error "KB source directory not found: $KB_SOURCE"
fi

log "Deploying KB from $KB_SOURCE to $KB_DEST"

# Crear directorio destino si no existe
if [ ! -d "$KB_DEST" ]; then
  log "Creating destination directory: $KB_DEST"
  mkdir -p "$KB_DEST"
fi

# Copiar contenido (excepto .git del source si existe)
log "Copying KB content..."
rsync -av --delete \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  "$KB_SOURCE/" "$KB_DEST/"

# Inicializar Git si no existe
cd "$KB_DEST"
if [ ! -d ".git" ]; then
  log "Initializing Git repository..."
  git init
  git config user.name "$GIT_USER_NAME"
  git config user.email "$GIT_USER_EMAIL"
  
  # Crear rama main
  git checkout -b main 2>/dev/null || true
fi

# Verificar si hay cambios
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  log "No changes to commit"
else
  log "Committing changes..."
  git add -A
  
  # Crear mensaje de commit con timestamp
  COMMIT_MSG="KB update $(date '+%Y-%m-%d %H:%M:%S')"
  git commit -m "$COMMIT_MSG"
  
  log "Committed: $COMMIT_MSG"
fi

# Mostrar estado final
log "KB deployed successfully!"
log "Location: $KB_DEST"
log "Git status:"
git log --oneline -3

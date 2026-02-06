#!/bin/bash
# deploy-kb.sh
# Despliega el Knowledge Base al host de producción.
#
# Uso:
#   ./scripts/deploy-kb.sh              # Despliega al path por defecto
#   ./scripts/deploy-kb.sh /custom/path # Despliega a un path custom
#
# El script:
# 1. Inicializa un repo Git bare si no existe
# 2. Sincroniza el contenido de kb/ via commit
# 3. Empuja los cambios al repo bare

set -euo pipefail

# Configuración
KB_SOURCE="${KB_SOURCE:-$(dirname "$0")/../kb}"
KB_DEST="${1:-/opt/arche/kb-content}"
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

is_bare_repo() {
  git --git-dir="$KB_DEST" rev-parse --is-bare-repository >/dev/null 2>&1
}

is_non_bare_repo() {
  [ -d "$KB_DEST/.git" ] && git -C "$KB_DEST" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

normalize_repo_permissions() {
  # Podman rootless remaps UIDs/GIDs between host and containers. For bind-mounted
  # bare repos, strict owner/group permissions can block git push from workspace
  # containers even when the mount is rw. Make the repo writable for any mapped ID.
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
normalize_repo_permissions

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

log "Preparing worktree for update..."
git clone "$KB_DEST" "$TMP_DIR/repo" >/dev/null 2>&1
cd "$TMP_DIR/repo"

if git show-ref --verify --quiet refs/heads/main; then
  git checkout main >/dev/null 2>&1
elif git show-ref --verify --quiet refs/heads/master; then
  git branch -M master main >/dev/null 2>&1
  git checkout main >/dev/null 2>&1
else
  git checkout -b main >/dev/null 2>&1
fi

git config user.name "$GIT_USER_NAME"
git config user.email "$GIT_USER_EMAIL"

log "Syncing KB content into worktree..."
rsync -av --delete \
  --exclude='.git' \
  --exclude='.arche' \
  --exclude='AGENTS.md' \
  --exclude='opencode.json' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  "$KB_SOURCE/" "$TMP_DIR/repo/" >/dev/null

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    log "No changes to commit"
  else
    log "Creating initial commit (empty KB)"
    git commit --allow-empty -m "Initial KB" >/dev/null 2>&1
    git push origin main >/dev/null 2>&1
  fi
else
  log "Committing changes..."
  git add -A
  COMMIT_MSG="KB update $(date '+%Y-%m-%d %H:%M:%S')"
  git commit -m "$COMMIT_MSG" >/dev/null 2>&1
  git push origin main >/dev/null 2>&1
  log "Committed: $COMMIT_MSG"
fi

if git --git-dir="$KB_DEST" show-ref --verify --quiet refs/heads/main; then
  git --git-dir="$KB_DEST" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
fi

normalize_repo_permissions

log "KB deployed successfully!"
log "Bare repo: $KB_DEST"
log "Recent commits:"
git --no-pager --git-dir="$KB_DEST" log --oneline -3

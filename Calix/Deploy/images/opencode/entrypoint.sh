#!/bin/sh
# ══════════════════════════════════════════════════════════════════════════════
# CALIX — OpenCode Entrypoint
# ══════════════════════════════════════════════════════════════════════════════
# Configura git local y prepara el workspace antes de iniciar OpenCode.
# ══════════════════════════════════════════════════════════════════════════════
set -e

# ─── Git config global ────────────────────────────────────────────────────────
# safe.directory permite git en /workspace montado como volumen
git config --global safe.directory /workspace

# Identity para commits locales
git config --global user.name "${GIT_USER_NAME:-Calix User}"
git config --global user.email "${GIT_USER_EMAIL:-user@calix.local}"

# ─── Credential helper para GitHub (si hay GH_TOKEN) ──────────────────────────
# Permite git push/pull a GitHub usando el token del usuario
if [ -n "${GH_TOKEN:-}" ]; then
  git config --global credential.https://github.com.helper '!gh auth git-credential'
fi

# ─── Init workspace como repo git si no existe ────────────────────────────────
# Esto habilita versionado local desde el primer momento
if [ -d /workspace ] && [ ! -d /workspace/.git ]; then
  echo "[calix] Initializing git repository in /workspace..."
  cd /workspace
  git init --quiet
  
  # Commit inicial si hay archivos
  if [ -n "$(ls -A 2>/dev/null)" ]; then
    git add -A
    git commit -m "Initial workspace state" --quiet 2>/dev/null || true
  fi
fi

# ─── Ejecutar comando principal ───────────────────────────────────────────────
exec "$@"

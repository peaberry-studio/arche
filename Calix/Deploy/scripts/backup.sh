#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CALIX CONTROL PLANE — Backup
# ══════════════════════════════════════════════════════════════════════════════
# Usage: ./scripts/backup.sh [output_dir]
#
# Crea un backup comprimido de:
# - SQLite databases (panel)
# - User data (workspaces, config, cache)
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
ENV_FILE="${PROJECT_ROOT}/.env"

# Load env
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

PANEL_DATA="${CALIX_PANEL_DATA_ROOT:-/var/lib/calix/panel}"
USER_DATA="${CALIX_USER_DATA_ROOT:-/var/lib/calix/users}"
BACKUP_DIR="${1:-/var/lib/calix/backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/calix-${TIMESTAMP}.tar.gz"

echo "══════════════════════════════════════════════════════════════════════════"
echo " CALIX BACKUP"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""

# Create backup dir
mkdir -p "${BACKUP_DIR}"

echo "[INFO] Creando backup..."
echo "  Panel data: ${PANEL_DATA}"
echo "  User data:  ${USER_DATA}"
echo "  Output:     ${BACKUP_FILE}"
echo ""

# Stop panel-worker to ensure SQLite consistency (optional but recommended)
echo "[INFO] Pausando panel-worker para consistencia..."
docker stop calix-panel-worker 2>/dev/null || true

# Create tarball
tar -czf "${BACKUP_FILE}" \
  -C "$(dirname "${PANEL_DATA}")" "$(basename "${PANEL_DATA}")" \
  -C "$(dirname "${USER_DATA}")" "$(basename "${USER_DATA}")"

# Restart worker
echo "[INFO] Reiniciando panel-worker..."
docker start calix-panel-worker 2>/dev/null || true

# Stats
BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)

echo ""
echo "══════════════════════════════════════════════════════════════════════════"
echo " ✓ Backup completado"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Archivo: ${BACKUP_FILE}"
echo "  Tamaño:  ${BACKUP_SIZE}"
echo ""
echo "Para restaurar:"
echo "  ./scripts/restore.sh ${BACKUP_FILE}"
echo ""

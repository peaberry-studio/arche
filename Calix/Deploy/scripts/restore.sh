#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CALIX CONTROL PLANE — Restore
# ══════════════════════════════════════════════════════════════════════════════
# Usage: ./scripts/restore.sh <backup_file>
#
# Restaura un backup creado con backup.sh
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
ENV_FILE="${PROJECT_ROOT}/.env"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup_file>"
  echo ""
  echo "Example: $0 /var/lib/calix/backups/calix-20260129-120000.tar.gz"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

# Load env
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

PANEL_DATA="${CALIX_PANEL_DATA_ROOT:-/var/lib/calix/panel}"
USER_DATA="${CALIX_USER_DATA_ROOT:-/var/lib/calix/users}"

echo "══════════════════════════════════════════════════════════════════════════"
echo " CALIX RESTORE"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Backup:     ${BACKUP_FILE}"
echo "  Panel data: ${PANEL_DATA}"
echo "  User data:  ${USER_DATA}"
echo ""
echo "⚠️  ADVERTENCIA: Esto sobrescribirá los datos actuales."
echo ""
read -p "¿Continuar? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelado."
  exit 0
fi

echo ""
echo "[INFO] Deteniendo servicios..."
cd "${PROJECT_ROOT}"
docker compose stop panel-web panel-worker 2>/dev/null || true

echo "[INFO] Restaurando datos..."

# Backup current data (just in case)
if [[ -d "${PANEL_DATA}" ]]; then
  mv "${PANEL_DATA}" "${PANEL_DATA}.bak.$(date +%s)"
fi
if [[ -d "${USER_DATA}" ]]; then
  mv "${USER_DATA}" "${USER_DATA}.bak.$(date +%s)"
fi

# Extract
mkdir -p "$(dirname "${PANEL_DATA}")"
mkdir -p "$(dirname "${USER_DATA}")"
tar -xzf "${BACKUP_FILE}" -C "$(dirname "${PANEL_DATA}")"

echo "[INFO] Reiniciando servicios..."
docker compose start panel-web panel-worker

echo ""
echo "══════════════════════════════════════════════════════════════════════════"
echo " ✓ Restore completado"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""
echo "Los datos anteriores se guardaron como backup con extensión .bak.*"
echo "Puedes eliminarlos manualmente cuando confirmes que todo funciona."
echo ""

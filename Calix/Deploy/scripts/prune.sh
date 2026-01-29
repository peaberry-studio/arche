#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CALIX CONTROL PLANE — Prune
# ══════════════════════════════════════════════════════════════════════════════
# Usage: ./scripts/prune.sh [--dry-run]
#
# Limpia contenedores de usuario detenidos (opencode-*).
# Los volúmenes/workspaces NO se eliminan (persisten).
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

echo "══════════════════════════════════════════════════════════════════════════"
echo " CALIX PRUNE"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""

# Find stopped opencode-* containers
stopped=$(docker ps -a --filter "status=exited" --filter "name=opencode-" --format "{{.Names}}" 2>/dev/null || true)

if [[ -z "$stopped" ]]; then
  echo "No hay contenedores de usuario detenidos para limpiar."
  exit 0
fi

count=$(echo "$stopped" | wc -l | tr -d ' ')
echo "Contenedores de usuario detenidos: ${count}"
echo ""

for container in $stopped; do
  if $DRY_RUN; then
    echo "  [DRY-RUN] Eliminaría: ${container}"
  else
    echo "  Eliminando: ${container}"
    docker rm "${container}" >/dev/null
  fi
done

echo ""

if $DRY_RUN; then
  echo "Ejecuta sin --dry-run para eliminar realmente."
else
  echo "✓ ${count} contenedor(es) eliminado(s)"
  echo ""
  echo "Nota: Los workspaces y datos de usuario persisten en disco."
  echo "      Solo se eliminaron los contenedores Docker detenidos."
fi

echo ""

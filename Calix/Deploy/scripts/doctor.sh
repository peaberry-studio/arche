#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CALIX CONTROL PLANE — Health Check (Doctor)
# ══════════════════════════════════════════════════════════════════════════════
# Usage: ./scripts/doctor.sh
#
# Verifica el estado de todos los componentes del sistema.
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
ENV_FILE="${PROJECT_ROOT}/.env"

# ══════════════════════════════════════════════════════════════════════════════
# Colors
# ══════════════════════════════════════════════════════════════════════════════
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; ERRORS=$((ERRORS + 1)); }
warn() { echo -e "  ${YELLOW}!${NC} $*"; WARNINGS=$((WARNINGS + 1)); }
section() { echo -e "\n${BOLD}$*${NC}"; }

ERRORS=0
WARNINGS=0

# Load env if exists
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

echo ""
echo "══════════════════════════════════════════════════════════════════════════"
echo " CALIX DOCTOR"
echo "══════════════════════════════════════════════════════════════════════════"

# ══════════════════════════════════════════════════════════════════════════════
# Docker
# ══════════════════════════════════════════════════════════════════════════════
section "Docker"

if command -v docker &>/dev/null; then
  pass "Docker instalado"
else
  fail "Docker no instalado"
fi

if docker info &>/dev/null; then
  pass "Docker daemon activo"
else
  fail "Docker daemon no responde"
fi

if docker compose version &>/dev/null; then
  pass "Docker Compose disponible"
else
  fail "Docker Compose no disponible"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Servicios
# ══════════════════════════════════════════════════════════════════════════════
section "Servicios Docker"

services=(
  "calix-traefik"
  "calix-cloudflared"
  "calix-panel-web"
  "calix-panel-worker"
  "calix-dsp-traefik"
  "calix-dsp-panel"
)

for svc in "${services[@]}"; do
  if docker ps --format '{{.Names}}' | grep -q "^${svc}$"; then
    pass "${svc} running"
  else
    fail "${svc} not running"
  fi
done

# Contenedores de usuario (opencode-*)
user_containers=$(docker ps --format '{{.Names}}' | grep -c "^opencode-" || true)
if [[ "$user_containers" -gt 0 ]]; then
  pass "${user_containers} instancia(s) de usuario activa(s)"
else
  warn "No hay instancias de usuario activas"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════════════════════
section "Endpoints"

# Panel health
if curl -sf http://127.0.0.1:80/health &>/dev/null; then
  pass "Panel /health respondiendo"
else
  fail "Panel /health no responde"
fi

# ForwardAuth sin JWT debe dar 401
status=$(curl -sf -o /dev/null -w "%{http_code}" http://127.0.0.1:80/auth/traefik 2>/dev/null || echo "000")
case "$status" in
  401)
    pass "ForwardAuth rechaza sin JWT (401)"
    ;;
  000)
    fail "ForwardAuth no responde"
    ;;
  *)
    warn "ForwardAuth respondió $status (esperado 401 sin JWT)"
    ;;
esac

# Traefik dashboard (si está habilitado)
if [[ "${TRAEFIK_API_INSECURE:-false}" == "true" ]]; then
  if curl -sf http://127.0.0.1:8080/api/overview &>/dev/null; then
    pass "Traefik dashboard accesible"
  else
    warn "Traefik dashboard no responde"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Persistencia
# ══════════════════════════════════════════════════════════════════════════════
section "Persistencia"

if [[ -d "${CALIX_PANEL_DATA_ROOT:-/var/lib/calix/panel}" ]]; then
  pass "Panel data dir existe: ${CALIX_PANEL_DATA_ROOT:-/var/lib/calix/panel}"
else
  fail "Panel data dir no existe"
fi

if [[ -d "${CALIX_USER_DATA_ROOT:-/var/lib/calix/users}" ]]; then
  pass "User data dir existe: ${CALIX_USER_DATA_ROOT:-/var/lib/calix/users}"
else
  fail "User data dir no existe"
fi

# SQLite
if [[ -f "${CALIX_PANEL_DATA_ROOT:-/var/lib/calix/panel}/production.sqlite3" ]]; then
  pass "SQLite database existe"
else
  warn "SQLite database no existe (se creará en primer uso)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Configuración
# ══════════════════════════════════════════════════════════════════════════════
section "Configuración"

if [[ -f "${ENV_FILE}" ]]; then
  pass ".env existe"
else
  fail ".env no existe"
fi

if [[ -n "${CALIX_DOMAIN:-}" ]]; then
  pass "CALIX_DOMAIN: ${CALIX_DOMAIN}"
else
  fail "CALIX_DOMAIN no configurado"
fi

if [[ -n "${CF_ACCESS_AUDS:-}" ]]; then
  aud_count=$(echo "${CF_ACCESS_AUDS}" | tr ',' '\n' | wc -l | tr -d ' ')
  pass "CF_ACCESS_AUDS: ${aud_count} aud(s) configurado(s)"
else
  fail "CF_ACCESS_AUDS no configurado"
fi

if [[ -n "${CLOUDFLARED_TOKEN:-}" ]]; then
  pass "CLOUDFLARED_TOKEN configurado"
else
  fail "CLOUDFLARED_TOKEN no configurado"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Red
# ══════════════════════════════════════════════════════════════════════════════
section "Red"

if docker network ls --format '{{.Name}}' | grep -q "^calix$"; then
  pass "Red 'calix' existe"
else
  fail "Red 'calix' no existe"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Resumen
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════════════════════════════════"

if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
  echo -e " ${GREEN}✓ Todo OK${NC}"
elif [[ $ERRORS -eq 0 ]]; then
  echo -e " ${YELLOW}! ${WARNINGS} warning(s)${NC}"
else
  echo -e " ${RED}✗ ${ERRORS} error(s), ${WARNINGS} warning(s)${NC}"
fi

echo "══════════════════════════════════════════════════════════════════════════"
echo ""

exit $ERRORS

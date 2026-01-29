#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# CALIX CONTROL PLANE — One-Click Installer
# ══════════════════════════════════════════════════════════════════════════════
# Usage: ./scripts/install.sh
#
# Este script:
# 1. Valida requisitos (Docker, Docker Compose)
# 2. Valida variables de entorno en .env
# 3. Crea directorios persistentes
# 4. Construye y levanta todos los servicios
# 5. Muestra instrucciones para configurar Cloudflare
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

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()      { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }

# ══════════════════════════════════════════════════════════════════════════════
# Pre-flight checks
# ══════════════════════════════════════════════════════════════════════════════
header "Verificando requisitos"

# Docker
if ! command -v docker &>/dev/null; then
  error "Docker no está instalado."
  echo ""
  echo "Instálalo con:"
  echo "  curl -fsSL https://get.docker.com | sh"
  echo "  sudo usermod -aG docker \$USER"
  echo "  # Cierra sesión y vuelve a entrar"
  exit 1
fi
ok "Docker instalado"

# Docker Compose
if ! docker compose version &>/dev/null; then
  error "Docker Compose plugin no disponible."
  echo ""
  echo "En Ubuntu/Debian:"
  echo "  sudo apt-get update && sudo apt-get install docker-compose-plugin"
  exit 1
fi
ok "Docker Compose disponible"

# Docker daemon running
if ! docker info &>/dev/null; then
  error "Docker daemon no está corriendo."
  echo "  sudo systemctl start docker"
  exit 1
fi
ok "Docker daemon activo"

# ══════════════════════════════════════════════════════════════════════════════
# .env validation
# ══════════════════════════════════════════════════════════════════════════════
header "Validando configuración"

if [[ ! -f "${ENV_FILE}" ]]; then
  warn ".env no encontrado"
  
  if [[ -f "${PROJECT_ROOT}/.env.example" ]]; then
    info "Copiando .env.example a .env..."
    cp "${PROJECT_ROOT}/.env.example" "${ENV_FILE}"
    echo ""
    error "Edita ${ENV_FILE} con tus valores y vuelve a ejecutar:"
    echo "  nano ${ENV_FILE}"
    echo "  ${SCRIPT_DIR}/install.sh"
  else
    error "No se encontró .env ni .env.example"
  fi
  exit 1
fi

# Load env
# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

# Required variables
required_vars=(
  CALIX_DOMAIN
  CALIX_PANEL_DATA_ROOT
  CALIX_USER_DATA_ROOT
  CLOUDFLARED_TOKEN
  CF_ACCESS_AUDS
  RAILS_MASTER_KEY
  SECRET_KEY_BASE
  ALLOWED_GH_ORGS
)

missing=()
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  error "Variables requeridas vacías en .env:"
  for v in "${missing[@]}"; do
    echo "  - $v"
  done
  echo ""
  echo "Edita .env y rellena los valores faltantes."
  exit 1
fi
ok "Variables de entorno validadas"

# Domain format validation
if [[ ! "${CALIX_DOMAIN}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
  error "CALIX_DOMAIN no parece válido: ${CALIX_DOMAIN}"
  exit 1
fi
ok "Dominio: ${CALIX_DOMAIN}"

# ══════════════════════════════════════════════════════════════════════════════
# Create directories
# ══════════════════════════════════════════════════════════════════════════════
header "Creando directorios"

info "Panel data: ${CALIX_PANEL_DATA_ROOT}"
info "User data:  ${CALIX_USER_DATA_ROOT}"

sudo mkdir -p "${CALIX_PANEL_DATA_ROOT}"
sudo mkdir -p "${CALIX_USER_DATA_ROOT}"
sudo chown -R "$(id -u):$(id -g)" "${CALIX_PANEL_DATA_ROOT}" "${CALIX_USER_DATA_ROOT}"

ok "Directorios creados"

# ══════════════════════════════════════════════════════════════════════════════
# Build OpenCode image
# ══════════════════════════════════════════════════════════════════════════════
header "Construyendo imagen OpenCode"

cd "${PROJECT_ROOT}"
docker build -t calix-opencode:latest -f images/opencode/Dockerfile images/opencode/

ok "Imagen calix-opencode:latest construida"

# ══════════════════════════════════════════════════════════════════════════════
# Start services
# ══════════════════════════════════════════════════════════════════════════════
header "Levantando servicios"

cd "${PROJECT_ROOT}"
docker compose --env-file "${ENV_FILE}" up -d --build

ok "Servicios iniciados"

# ══════════════════════════════════════════════════════════════════════════════
# Health check
# ══════════════════════════════════════════════════════════════════════════════
header "Verificando salud"

info "Esperando que el panel esté listo..."

panel_ready=false
for i in {1..30}; do
  if curl -sf http://127.0.0.1:80/health &>/dev/null; then
    panel_ready=true
    break
  fi
  sleep 2
  echo -n "."
done
echo ""

if $panel_ready; then
  ok "Panel respondiendo en http://127.0.0.1:80"
else
  warn "Panel no responde aún (puede tardar más en el primer arranque)"
  echo "  Verifica con: docker compose logs panel-web"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Final instructions
# ══════════════════════════════════════════════════════════════════════════════
header "Instalación completada"

echo -e "${GREEN}✓ Calix Control Plane instalado${NC}"
echo ""
echo "══════════════════════════════════════════════════════════════════════════"
echo " PRÓXIMOS PASOS: Configurar Cloudflare"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""
echo "${BOLD}1. Tunnel Public Hostnames${NC}"
echo "   Zero Trust → Networks → Tunnels → [Tu tunnel] → Public Hostnames"
echo ""
echo "   ┌────────────────────────────────────────────────────────────────────┐"
echo "   │ Hostname: ${CALIX_DOMAIN}                                          │"
echo "   │ Service:  http://localhost:80                                      │"
echo "   ├────────────────────────────────────────────────────────────────────┤"
echo "   │ Hostname: *.${CALIX_DOMAIN}                                        │"
echo "   │ Service:  http://localhost:80                                      │"
echo "   └────────────────────────────────────────────────────────────────────┘"
echo ""
echo "${BOLD}2. Access Applications${NC}"
echo "   Zero Trust → Access → Applications → Add an application"
echo ""
echo "   ${BOLD}App 1: Panel${NC}"
echo "   ┌────────────────────────────────────────────────────────────────────┐"
echo "   │ Type:     Self-hosted                                              │"
echo "   │ Name:     Calix Panel                                              │"
echo "   │ Domain:   ${CALIX_DOMAIN}                                          │"
echo "   │ Policy:   Allow - Emails ending in @tuempresa.com                  │"
echo "   └────────────────────────────────────────────────────────────────────┘"
echo "   → Copia el 'Application Audience (AUD) Tag' a CF_ACCESS_AUDS en .env"
echo ""
echo "   ${BOLD}App 2: Sessions${NC}"
echo "   ┌────────────────────────────────────────────────────────────────────┐"
echo "   │ Type:     Self-hosted                                              │"
echo "   │ Name:     Calix Sessions                                           │"
echo "   │ Domain:   *.${CALIX_DOMAIN}                                        │"
echo "   │ Policy:   Allow - Emails ending in @tuempresa.com                  │"
echo "   └────────────────────────────────────────────────────────────────────┘"
echo "   → Añade el AUD a CF_ACCESS_AUDS (separado por coma)"
echo ""
echo "${BOLD}3. Verificar${NC}"
echo "   ./scripts/doctor.sh"
echo ""
echo "══════════════════════════════════════════════════════════════════════════"
echo ""
echo "URLs:"
echo "  Local:   http://127.0.0.1:80"
echo "  Público: https://${CALIX_DOMAIN}"
echo ""

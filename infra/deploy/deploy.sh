#!/usr/bin/env bash
set -euo pipefail

# Arche One-Click Deployer
# Usage:
#   Remote:    ./deploy.sh --ip <IP> --domain <DOMAIN> --ssh-key <KEY> --acme-email <EMAIL>
#   Local:     ./deploy.sh --local
#   Local dev: ./deploy.sh --local-dev

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
MODE=""
DEPLOY_IP=""
DEPLOY_DOMAIN=""
SSH_KEY=""
SSH_USER="root"
ACME_EMAIL=""
DRY_RUN=false
VERBOSE=false
LOCAL_DOMAIN="arche.lvh.me"

# GHCR defaults
IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/peaberry-studio/arche/}"
WEB_VERSION="${WEB_VERSION:-latest}"
OPENCODE_IMAGE="${OPENCODE_IMAGE:-ghcr.io/anomalyco/opencode:1.1.45}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { printf "${GREEN}[arche]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[arche]${NC} %s\n" "$*" >&2; }
err()   { printf "${RED}[arche]${NC} %s\n" "$*" >&2; }
info()  { printf "${BLUE}[arche]${NC} %s\n" "$*"; }

usage() {
  cat <<'EOF'
Arche One-Click Deployer

REMOTE MODE:
  ./deploy.sh --ip <IP> --domain <DOMAIN> --ssh-key <KEY> --acme-email <EMAIL> [OPTIONS]

  Required:
    --ip            VPS IP address (IPv4 or IPv6)
    --domain        Production domain (e.g. arche.example.com or app.arche.example.com)
    --ssh-key       Path to SSH private key
    --acme-email    Email for Let's Encrypt ACME account

  Optional:
    --version       Web image tag to deploy (default: latest)
    --user          SSH user (default: root)
    --dry-run       Show what would be done without executing
    --verbose       Enable verbose output

  DNS Setup:
    The script will verify your domain points to the VPS IP.
    If not, it will show you exactly which DNS record to add.
    Works with any domain provider (Cloudflare, GoDaddy, Namecheap, etc.)

LOCAL MODE:
  ./deploy.sh --local

  Runs the production stack locally with:
    - Domain: arche.lvh.me (resolves to 127.0.0.1)
    - No TLS (HTTP only on port 8080)
    - No SSH (Ansible still required to render templates)

LOCAL DEV MODE:
  ./deploy.sh --local-dev

  Like --local but mounts source code for hot reload via next dev:
    - App:              http://arche.lvh.me:8080
    - Traefik dashboard: http://localhost:8081
    - Postgres:         localhost:5432
    - Source mounted from apps/web/ with node_modules in a named volume
    - Workspace image built automatically
    - KB content deployed to ~/.arche/kb-content
    - KB config deployed to ~/.arche/kb-config


ENVIRONMENT VARIABLES (via .env or exported):
  POSTGRES_PASSWORD         Database password
  ARCHE_SESSION_PEPPER      Session pepper secret
  ARCHE_ENCRYPTION_KEY      Encryption key
  ARCHE_INTERNAL_TOKEN      Internal API token
  ARCHE_GATEWAY_TOKEN_SECRET Gateway token signing secret
  ARCHE_GATEWAY_TOKEN_TTL_SECONDS Gateway token TTL (seconds, optional)
  ARCHE_GATEWAY_BASE_URL    Gateway base URL (optional)
  ARCHE_SEED_ADMIN_EMAIL    Seed admin email
  ARCHE_SEED_ADMIN_PASSWORD Seed admin password
  ARCHE_SEED_ADMIN_SLUG     Seed admin URL slug
  ARCHE_SEED_TEST_EMAIL     Seed test user email (optional)
  ARCHE_SEED_TEST_SLUG      Seed test user slug (optional)
  ARCHE_USERS_PATH          Host path for persisted user data (optional)
  KB_CONTENT_HOST_PATH      Path del repo bare de contenido KB
  KB_CONFIG_HOST_PATH       Path del repo bare de configuración
EOF
  exit "${1:-0}"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
[[ $# -eq 0 ]] && usage 1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)       MODE="local";      shift ;;
    --local-dev)   MODE="local-dev";   shift ;;
    --ip)          DEPLOY_IP="$2";       shift 2 ;;
    --domain)      DEPLOY_DOMAIN="$2";   shift 2 ;;
    --ssh-key)     SSH_KEY="$2";         shift 2 ;;
    --user)        SSH_USER="$2";        shift 2 ;;
    --acme-email)  ACME_EMAIL="$2";      shift 2 ;;
    --version)     WEB_VERSION="$2";     shift 2 ;;
    --dry-run)     DRY_RUN=true;         shift ;;
    --verbose)     VERBOSE=true;         shift ;;
    -h|--help)     usage 0 ;;
    *)             err "Unknown option: $1"; usage 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Load .env if present
# ---------------------------------------------------------------------------
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  log "Loading .env file"
  set -a
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/.env" || { echo "ERROR: Failed to source .env"; exit 1; }
  set +a
  log ".env file loaded successfully"
fi

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
ERRORS=()

validate_remote() {
  log "Starting validate_remote..."
  [[ -z "$DEPLOY_IP" ]]    && ERRORS+=("--ip is required")
  [[ -z "$DEPLOY_DOMAIN" ]] && ERRORS+=("--domain is required")
  [[ -z "$SSH_KEY" ]]       && ERRORS+=("--ssh-key is required")
  [[ -z "$ACME_EMAIL" ]]    && ERRORS+=("--acme-email is required")

  if [[ -n "$SSH_KEY" && ! -f "$SSH_KEY" ]]; then
    ERRORS+=("SSH key not found: $SSH_KEY")
  fi

  # Validate IP address (IPv4 or IPv6)
  if [[ -n "$DEPLOY_IP" ]]; then
    # Check if IPv4
    if [[ "$DEPLOY_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      IP_TYPE="A"
    # Check if IPv6 (simplified check)
    elif [[ "$DEPLOY_IP" =~ : ]]; then
      IP_TYPE="AAAA"
    else
      ERRORS+=("Invalid IP address: $DEPLOY_IP (must be IPv4 or IPv6)")
    fi
  fi

  # Secrets
  [[ -z "${POSTGRES_PASSWORD:-}" ]]         && ERRORS+=("POSTGRES_PASSWORD is required")
  [[ -z "${ARCHE_SESSION_PEPPER:-}" ]]      && ERRORS+=("ARCHE_SESSION_PEPPER is required")
  [[ -z "${ARCHE_ENCRYPTION_KEY:-}" ]]      && ERRORS+=("ARCHE_ENCRYPTION_KEY is required")
  [[ -z "${ARCHE_INTERNAL_TOKEN:-}" ]]      && ERRORS+=("ARCHE_INTERNAL_TOKEN is required")
  [[ -z "${ARCHE_GATEWAY_TOKEN_SECRET:-}" ]] && ERRORS+=("ARCHE_GATEWAY_TOKEN_SECRET is required")
  [[ -z "${ARCHE_SEED_ADMIN_EMAIL:-}" ]]    && ERRORS+=("ARCHE_SEED_ADMIN_EMAIL is required")
  [[ -z "${ARCHE_SEED_ADMIN_PASSWORD:-}" ]] && ERRORS+=("ARCHE_SEED_ADMIN_PASSWORD is required")
  [[ -z "${ARCHE_SEED_ADMIN_SLUG:-}" ]]     && ERRORS+=("ARCHE_SEED_ADMIN_SLUG is required")

  # GHCR token for remote pulls
  [[ -z "${GHCR_TOKEN:-}" ]] && ERRORS+=("GHCR_TOKEN is required for remote deployment")
  
  log "validate_remote complete, errors: ${#ERRORS[@]}"
}

validate_local() {
  # Local mode needs fewer secrets — use defaults if not set
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
  export ARCHE_SESSION_PEPPER="${ARCHE_SESSION_PEPPER:-local-dev-pepper-not-for-production}"
  # Must be base64 for a 32-byte key (AES-256-GCM). Keep stable across runs.
  export ARCHE_ENCRYPTION_KEY="${ARCHE_ENCRYPTION_KEY:-ZGV2LWluc2VjdXJlLWtleS0zMi1ieXRlcy1sb25nISE=}"
  export ARCHE_INTERNAL_TOKEN="${ARCHE_INTERNAL_TOKEN:-local-dev-internal-token}"
  export ARCHE_GATEWAY_TOKEN_SECRET="${ARCHE_GATEWAY_TOKEN_SECRET:-local-dev-gateway-token-secret-not-for-production}"
  export ARCHE_GATEWAY_TOKEN_TTL_SECONDS="${ARCHE_GATEWAY_TOKEN_TTL_SECONDS:-}"
  export ARCHE_GATEWAY_BASE_URL="${ARCHE_GATEWAY_BASE_URL:-}"
  export ARCHE_SEED_ADMIN_EMAIL="${ARCHE_SEED_ADMIN_EMAIL:-admin@example.com}"
  export ARCHE_SEED_ADMIN_PASSWORD="${ARCHE_SEED_ADMIN_PASSWORD:-change-me}"
  export ARCHE_SEED_ADMIN_SLUG="${ARCHE_SEED_ADMIN_SLUG:-admin}"
  export ARCHE_SEED_TEST_EMAIL="${ARCHE_SEED_TEST_EMAIL:-peter@example.com}"
  export ARCHE_SEED_TEST_SLUG="${ARCHE_SEED_TEST_SLUG:-peter}"
}

log "About to determine mode, current MODE=$MODE"

# Determine mode
if [[ "$MODE" == "local" || "$MODE" == "local-dev" ]]; then
  # Ensure no remote flags were also passed
  if [[ -n "$DEPLOY_IP" || -n "$DEPLOY_DOMAIN" || -n "$SSH_KEY" || -n "$ACME_EMAIL" ]]; then
    ERRORS+=("--${MODE} is mutually exclusive with remote flags (--ip, --domain, etc.)")
  fi
  validate_local
elif [[ -n "$DEPLOY_IP" || -n "$DEPLOY_DOMAIN" || -n "$SSH_KEY" || -n "$ACME_EMAIL" ]]; then
  MODE="remote"
  validate_remote
else
  err "Specify --local, --local-dev, or remote flags (--ip, --domain, etc.)"
  usage 1
fi

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  err "Validation errors:"
  for e in "${ERRORS[@]}"; do
    err "  - $e"
  done
  exit 1
fi

log "Validation passed, MODE=$MODE"

# ---------------------------------------------------------------------------
# DNS Record Management (Simplified - User-guided)
# ---------------------------------------------------------------------------
get_dns_record_name() {
  # Extract subdomain part from domain
  local domain="$1"
  local base_domain="$2"
  
  if [[ "$domain" == "$base_domain" ]]; then
    echo "@"
  else
    # Remove base domain and trailing dot
    echo "$domain" | sed "s/\.${base_domain}$//"
  fi
}

ensure_dns_record() {
  log "Checking DNS configuration for $DEPLOY_DOMAIN..."

  # Check if domain already resolves to the VPS IP
  CURRENT_IP=$(dig +short "$DEPLOY_DOMAIN" 2>/dev/null | head -1)
  if [[ "$CURRENT_IP" == "$DEPLOY_IP" ]]; then
    log "DNS record already points to $DEPLOY_IP ✓"
    return 0
  fi

  # Determine record type based on IP format
  local record_type="A"
  if [[ "$DEPLOY_IP" =~ : ]]; then
    record_type="AAAA"
  fi

  # Show user-friendly instructions
  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║  DNS CONFIGURATION REQUIRED                                    ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  warn "Your domain $DEPLOY_DOMAIN is not pointing to $DEPLOY_IP"
  echo ""
  echo "📋 ADD THIS DNS RECORD TO YOUR DOMAIN PROVIDER:"
  echo ""
  echo "   Type:  $record_type"
  echo "   Name:  $DEPLOY_DOMAIN"
  echo "   Value: $DEPLOY_IP"
  echo "   TTL:   300 (5 minutes)"
  echo ""
  echo "📖 QUICK GUIDES FOR POPULAR PROVIDERS:"
  echo ""
  echo "   Cloudflare:"
  echo "     1. Go to dash.cloudflare.com"
  echo "     2. Select your domain"
  echo "     3. Go to DNS → Records"
  echo "     4. Click 'Add record'"
  echo "     5. Type: $record_type, Name: $DEPLOY_DOMAIN, Content: $DEPLOY_IP"
  echo ""
  echo "   GoDaddy:"
  echo "     1. Go to godaddy.com → My Products"
  echo "     2. Click 'DNS' next to your domain"
  echo "     3. Click 'Add'"
  echo "     4. Type: $record_type, Name: @, Value: $DEPLOY_IP"
  echo ""
  echo "   Namecheap:"
  echo "     1. Go to namecheap.com → Domain List"
  echo "     2. Click 'Manage' → 'Advanced DNS'"
  echo "     3. Click 'Add New Record'"
  echo "     4. Type: $record_type Record, Host: @, Value: $DEPLOY_IP"
  echo ""
  echo "   OVH:"
  echo "     1. Go to ovh.com → Web Cloud"
  echo "     2. Click your domain → DNS zone"
  echo "     3. Click 'Add an entry'"
  echo "     4. Select '$record_type' and fill in the values"
  echo ""
  echo "⏳  After adding the record, press ENTER to continue..."
  echo "    (The script will verify the DNS is working before proceeding)"
  echo ""
  
  read -r

  # Verify DNS with retries
  log "Verifying DNS configuration..."
  local retries=60  # 5 minutes with 5-second intervals
  local attempt=0
  
  while [[ $attempt -lt $retries ]]; do
    CURRENT_IP=$(dig +short "$DEPLOY_DOMAIN" 2>/dev/null | head -1)
    if [[ "$CURRENT_IP" == "$DEPLOY_IP" ]]; then
      log "DNS record verified successfully ✓"
      log "Domain $DEPLOY_DOMAIN now points to $DEPLOY_IP"
      return 0
    fi
    
    attempt=$((attempt + 1))
    if [[ $attempt -lt $retries ]]; then
      echo -n "."
      sleep 5
    fi
  done
  
  echo ""
  warn "DNS verification timed out after 5 minutes"
  warn "Current DNS value: ${CURRENT_IP:-(not set)}"
  warn "Expected value: $DEPLOY_IP"
  echo ""
  echo "This is normal - DNS can take up to 24-48 hours to propagate worldwide."
  echo "However, it usually works within 5-30 minutes."
  echo ""
  read -p "Do you want to continue anyway? The deployment may fail if Let's Encrypt cannot verify your domain. (y/N): " -n 1 -r
  echo
  
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log "Deployment cancelled. Run the script again when DNS is ready."
    exit 0
  fi
  
  warn "Continuing without DNS verification..."
}

# ---------------------------------------------------------------------------
# Remote mode
# ---------------------------------------------------------------------------
deploy_remote() {
  log "Deploying to $DEPLOY_IP ($DEPLOY_DOMAIN) via Ansible"

  # Check prerequisites
  if ! command -v ansible-playbook &>/dev/null; then
    err "ansible-playbook not found. Install Ansible first: pip install ansible"
    exit 1
  fi

  # Test SSH connectivity
  log "Testing SSH connectivity..."
  if ! ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$SSH_KEY" "${SSH_USER}@${DEPLOY_IP}" true 2>/dev/null; then
    err "Cannot connect via SSH to ${SSH_USER}@${DEPLOY_IP} with key $SSH_KEY"
    exit 1
  fi
  log "SSH connection OK"

  # Ensure DNS record points to VPS IP
  ensure_dns_record

  # Generate temporary inventory and extra-vars file
  INVENTORY=$(mktemp)
  EXTRA_VARS_FILE=$(mktemp)
  trap 'rm -f "$INVENTORY" "$EXTRA_VARS_FILE"' EXIT

  cat > "$INVENTORY" <<EOF
[arche]
${DEPLOY_IP} ansible_user=${SSH_USER} ansible_ssh_private_key_file=${SSH_KEY}
EOF

  # Export variables so python3 subprocess can read them
  export DEPLOY_DOMAIN ACME_EMAIL IMAGE_PREFIX WEB_VERSION OPENCODE_IMAGE

  # Build extra vars as JSON (safe for secrets with special characters)
  python3 -c '
import json, os, sys
vars = {
    "domain": os.environ["DEPLOY_DOMAIN"],
    "acme_email": os.environ["ACME_EMAIL"],
    "deploy_mode": "remote",
    "image_prefix": os.environ["IMAGE_PREFIX"],
    "web_version": os.environ["WEB_VERSION"],
    "opencode_image": os.environ["OPENCODE_IMAGE"],
    "postgres_password": os.environ["POSTGRES_PASSWORD"],
    "arche_session_pepper": os.environ["ARCHE_SESSION_PEPPER"],
    "arche_encryption_key": os.environ["ARCHE_ENCRYPTION_KEY"],
    "arche_internal_token": os.environ["ARCHE_INTERNAL_TOKEN"],
    "arche_gateway_token_secret": os.environ["ARCHE_GATEWAY_TOKEN_SECRET"],
    "arche_gateway_token_ttl_seconds": os.environ.get("ARCHE_GATEWAY_TOKEN_TTL_SECONDS", ""),
    "arche_gateway_base_url": os.environ.get("ARCHE_GATEWAY_BASE_URL", ""),
    "arche_seed_admin_email": os.environ["ARCHE_SEED_ADMIN_EMAIL"],
    "arche_seed_admin_password": os.environ["ARCHE_SEED_ADMIN_PASSWORD"],
    "arche_seed_admin_slug": os.environ["ARCHE_SEED_ADMIN_SLUG"],
    "arche_seed_test_email": os.environ.get("ARCHE_SEED_TEST_EMAIL", ""),
    "arche_seed_test_slug": os.environ.get("ARCHE_SEED_TEST_SLUG", ""),
    "kb_content_host_path": os.environ.get("KB_CONTENT_HOST_PATH", "/opt/arche/kb-content"),
    "kb_config_host_path": os.environ.get("KB_CONFIG_HOST_PATH", "/opt/arche/kb-config"),
    "ghcr_token": os.environ["GHCR_TOKEN"],
}
json.dump(vars, open(sys.argv[1], "w"))
' "$EXTRA_VARS_FILE"

  ANSIBLE_ARGS=(
    -i "$INVENTORY"
    --extra-vars "@${EXTRA_VARS_FILE}"
    "$SCRIPT_DIR/ansible/playbooks/site.yml"
  )

  if $VERBOSE; then
    ANSIBLE_ARGS+=(-vvv)
  fi

  if $DRY_RUN; then
    ANSIBLE_ARGS+=(--check)
    warn "DRY RUN — no changes will be made"
  fi

  log "Running Ansible playbook..."
  ANSIBLE_CONFIG="$SCRIPT_DIR/ansible.cfg" ansible-playbook "${ANSIBLE_ARGS[@]}"
}

# ---------------------------------------------------------------------------
# Local mode
# ---------------------------------------------------------------------------
deploy_local() {
  log "Starting local deployment (arche.lvh.me)"

  # Check prerequisites
  if ! command -v podman &>/dev/null; then
    err "Podman not found. Install Podman first."
    exit 1
  fi

  if ! podman compose version &>/dev/null; then
    err "podman-compose not found. Install podman-compose first."
    exit 1
  fi

  # Compute repo root and validate source tree
  REPO_ROOT="$SCRIPT_DIR/../.."
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
  if [[ ! -f "$REPO_ROOT/infra/workspace-image/Containerfile" ]]; then
    err "Cannot find infra/workspace-image/Containerfile in $REPO_ROOT"
    err "Run this script from within the arche repository."
    exit 1
  fi

  LOCAL_WORKSPACE_IMAGE="${LOCAL_WORKSPACE_IMAGE:-arche-workspace:latest}"
  log "Building workspace image: $LOCAL_WORKSPACE_IMAGE"
  podman build -t "$LOCAL_WORKSPACE_IMAGE" "$REPO_ROOT/infra/workspace-image"

  # Ensure local stack uses the workspace image with agent
  export OPENCODE_IMAGE="$LOCAL_WORKSPACE_IMAGE"

  KB_CONTENT_DEST="${KB_CONTENT_HOST_PATH:-$HOME/.arche/kb-content}"
  KB_CONFIG_DEST="${KB_CONFIG_HOST_PATH:-$HOME/.arche/kb-config}"
  USERS_DEST="${ARCHE_USERS_PATH:-$HOME/.arche/users}"
  log "Deploying KB content to: $KB_CONTENT_DEST"
  "$REPO_ROOT/scripts/deploy-kb.sh" "$KB_CONTENT_DEST"
  log "Deploying KB config to: $KB_CONFIG_DEST"
  "$REPO_ROOT/scripts/deploy-config.sh" "$KB_CONFIG_DEST"
  log "Ensuring users data directory exists: $USERS_DEST"
  mkdir -p "$USERS_DEST"

  # Detect Podman socket path (VM-internal path for container mounts)
  PODMAN_SOCKET_PATH="${PODMAN_SOCKET_PATH:-}"
  if [[ -z "$PODMAN_SOCKET_PATH" ]]; then
    if podman machine inspect &>/dev/null; then
      # Podman Machine: choose rootful vs rootless socket inside the VM
      PODMAN_ROOTLESS="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null || echo false)"
      if [[ "$PODMAN_ROOTLESS" == "true" ]]; then
        PODMAN_SOCKET_PATH="/run/user/$(id -u)/podman/podman.sock"
      else
        PODMAN_SOCKET_PATH="/run/podman/podman.sock"
      fi
    else
      # Linux rootful Podman
      PODMAN_SOCKET_PATH="/run/podman/podman.sock"
    fi
  fi
  log "Using Podman socket: $PODMAN_SOCKET_PATH"

  # Render compose from template using Ansible (local)
  COMPOSE_OUT="$SCRIPT_DIR/.compose-local.yml"

  # Use a simple Python/Jinja2 render if ansible is available, otherwise inline
  if command -v ansible &>/dev/null; then
    log "Rendering compose template via Ansible..."

    TEMP_PLAYBOOK=$(mktemp)
    EXTRA_VARS_FILE=$(mktemp)
    trap 'rm -f "$TEMP_PLAYBOOK" "$EXTRA_VARS_FILE"' EXIT

    # Export variables so python3 subprocess can read them
    export LOCAL_DOMAIN PODMAN_SOCKET_PATH IMAGE_PREFIX WEB_VERSION OPENCODE_IMAGE KB_CONTENT_DEST KB_CONFIG_DEST USERS_DEST

    # Build extra vars as JSON (safe for secrets with special characters)
    python3 -c '
import json, os, sys
vars = {
    "deploy_mode": "local",
    "domain": os.environ["LOCAL_DOMAIN"],
    "dns_provider": "",
    "acme_email": "",
    "env_file_name": ".env.local",
    "podman_socket_path": os.environ["PODMAN_SOCKET_PATH"],
    "image_prefix": os.environ["IMAGE_PREFIX"],
    "web_version": os.environ["WEB_VERSION"],
    "opencode_image": os.environ["OPENCODE_IMAGE"],
    "postgres_password": os.environ["POSTGRES_PASSWORD"],
    "arche_session_pepper": os.environ["ARCHE_SESSION_PEPPER"],
    "arche_encryption_key": os.environ["ARCHE_ENCRYPTION_KEY"],
    "arche_internal_token": os.environ["ARCHE_INTERNAL_TOKEN"],
    "arche_gateway_token_secret": os.environ["ARCHE_GATEWAY_TOKEN_SECRET"],
    "arche_gateway_token_ttl_seconds": os.environ.get("ARCHE_GATEWAY_TOKEN_TTL_SECONDS", ""),
    "arche_gateway_base_url": os.environ.get("ARCHE_GATEWAY_BASE_URL", ""),
    "arche_seed_admin_email": os.environ["ARCHE_SEED_ADMIN_EMAIL"],
    "arche_seed_admin_password": os.environ["ARCHE_SEED_ADMIN_PASSWORD"],
    "arche_seed_admin_slug": os.environ["ARCHE_SEED_ADMIN_SLUG"],
    "arche_seed_test_email": os.environ.get("ARCHE_SEED_TEST_EMAIL", ""),
    "arche_seed_test_slug": os.environ.get("ARCHE_SEED_TEST_SLUG", ""),
    "kb_content_host_path": os.environ["KB_CONTENT_DEST"],
    "kb_config_host_path": os.environ["KB_CONFIG_DEST"],
    "users_path": os.environ["USERS_DEST"],
}
json.dump(vars, open(sys.argv[1], "w"))
' "$EXTRA_VARS_FILE"

    # Playbook only contains tasks — all vars come via extra-vars JSON
    cat > "$TEMP_PLAYBOOK" <<'PLAYBOOK'
---
- hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - name: Render compose template
      ansible.builtin.template:
        src: "{{ deploy_dir }}/ansible/roles/app/templates/compose.yml.j2"
        dest: "{{ deploy_dir }}/.compose-local.yml"
    - name: Render env template
      ansible.builtin.template:
        src: "{{ deploy_dir }}/ansible/roles/app/templates/.env.j2"
        dest: "{{ deploy_dir }}/.env.local"
        mode: "0600"
PLAYBOOK

    ANSIBLE_CONFIG="$SCRIPT_DIR/ansible.cfg" ansible-playbook \
      --extra-vars "@${EXTRA_VARS_FILE}" \
      --extra-vars "deploy_dir=${SCRIPT_DIR}" \
      "$TEMP_PLAYBOOK"
  else
    err "Ansible is required to render templates. Install with: pip install ansible"
    exit 1
  fi

  # Ensure arche-internal network exists
  if ! podman network inspect arche-internal &>/dev/null; then
    log "Creating arche-internal network..."
    podman network create arche-internal
  fi

  # Start base services (postgres, traefik, docker-socket-proxy)
  # Web is managed outside compose for blue-green deploys
  log "Starting base services (postgres, traefik, docker-socket-proxy)..."
  podman compose -f "$COMPOSE_OUT" --env-file "$SCRIPT_DIR/.env.local" -p arche up -d

  # Wait for postgres to be healthy
  log "Waiting for postgres..."
  RETRIES=15
  PG_CONTAINER=""
  until PG_CONTAINER=$(podman ps --filter label=com.docker.compose.project=arche --filter name=postgres --format '{{.Names}}' | head -1) && \
        [[ -n "$PG_CONTAINER" ]] && \
        podman exec "$PG_CONTAINER" pg_isready -U postgres 2>/dev/null; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
      warn "Postgres did not become healthy."
      break
    fi
    sleep 2
  done

  # Detect compose default network
  COMPOSE_NETWORK=$(podman network ls --format '{{.Name}}' | grep -E '^arche[_-]default$' | head -1)
  COMPOSE_NETWORK="${COMPOSE_NETWORK:-arche_default}"
  log "Using compose network: $COMPOSE_NETWORK"

  # Find existing web containers (there may be zombies from failed deploys)
  OLD_WEBS=()
  while IFS= read -r c; do
    [[ -n "$c" ]] && OLD_WEBS+=("$c")
  done < <(podman ps --filter label=arche.role=web --format '{{.Names}}')

  if [[ ${#OLD_WEBS[@]} -gt 0 ]]; then
    log "Found existing web container(s): ${OLD_WEBS[*]}"
  fi

  # Build volume args
  VOLUME_ARGS=(-v "${USERS_DEST}:${USERS_DEST}")
  if [[ -n "${KB_CONTENT_DEST:-}" && -n "${KB_CONFIG_DEST:-}" ]]; then
    VOLUME_ARGS+=(-v "${KB_CONTENT_DEST}:/kb-content" -v "${KB_CONFIG_DEST}:/kb-config")
  fi

  # Start NEW web container alongside the old one(s)
  NEW_WEB="arche-web-$(date +%s)-$(openssl rand -hex 2)"
  log "Starting web container: $NEW_WEB"
  podman run -d \
    --name "$NEW_WEB" \
    --env-file "$SCRIPT_DIR/.env.local" \
    -e ARCHE_GATEWAY_TOKEN_SECRET="${ARCHE_GATEWAY_TOKEN_SECRET}" \
    -e ARCHE_GATEWAY_TOKEN_TTL_SECONDS="${ARCHE_GATEWAY_TOKEN_TTL_SECONDS}" \
    -e ARCHE_GATEWAY_BASE_URL="${ARCHE_GATEWAY_BASE_URL}" \
    --network arche-internal \
    --network "$COMPOSE_NETWORK" \
    "${VOLUME_ARGS[@]}" \
    --label traefik.enable=true \
    --label "traefik.http.routers.arche-base.rule=Host(\`${LOCAL_DOMAIN}\`)" \
    --label traefik.http.routers.arche-base.entrypoints=web \
    --label traefik.http.routers.arche-base.service=arche-web \
    --label traefik.http.services.arche-web.loadbalancer.server.port=3000 \
    --label traefik.http.services.arche-web.loadbalancer.healthcheck.path=/api/health \
    --label traefik.http.services.arche-web.loadbalancer.healthcheck.interval=5s \
    --label traefik.http.services.arche-web.loadbalancer.healthcheck.timeout=3s \
    --label "traefik.docker.network=${COMPOSE_NETWORK}" \
    --label arche.role=web \
    --label "arche.version=${WEB_VERSION}" \
    --restart unless-stopped \
    "${IMAGE_PREFIX}web:${WEB_VERSION}"

  # Wait for web to pass health check (migrations and seed run inside start.sh)
  log "Waiting for web service to pass health check..."
  HEALTH_OK=false
  RETRIES=24
  until podman exec "$NEW_WEB" node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))" 2>/dev/null; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
      break
    fi
    sleep 5
  done
  [[ $RETRIES -gt 0 ]] && HEALTH_OK=true

  if [[ "$HEALTH_OK" != "true" ]]; then
    err "Web service did not become healthy after 120 seconds."
    err "Check logs with: podman logs $NEW_WEB"
    err "Removing failed container..."
    podman rm -f "$NEW_WEB" 2>/dev/null || true
    if [[ ${#OLD_WEBS[@]} -gt 0 ]]; then
      err "Old container(s) still serving traffic: ${OLD_WEBS[*]}"
    fi
    exit 1
  fi

  # Health check passed — wait for Traefik to discover the new container
  log "Health check passed. Waiting 15s for Traefik discovery..."
  sleep 15

  # Stop and remove ALL old web containers
  for old in "${OLD_WEBS[@]}"; do
    log "Stopping old web container: $old"
    podman stop -t 10 "$old" 2>/dev/null || true
    podman rm "$old" 2>/dev/null || true
  done

  echo ""
  log "Local deployment ready! (version: ${WEB_VERSION})"
  info "  App:   http://${LOCAL_DOMAIN}"
  info "  Dashboard: http://${LOCAL_DOMAIN}/u/${ARCHE_SEED_ADMIN_SLUG}"
  info "  Workspace: http://${LOCAL_DOMAIN}/w/${ARCHE_SEED_ADMIN_SLUG}"
  echo ""
  info "Useful commands:"
  info "  Logs:       podman logs -f $NEW_WEB"
  info "  Base stack: podman compose -f $COMPOSE_OUT -p arche logs -f"
  info "  Stop web:   podman stop $NEW_WEB && podman rm $NEW_WEB"
  info "  Stop all:   podman stop $NEW_WEB && podman rm $NEW_WEB && podman compose -f $COMPOSE_OUT -p arche down"
}

# ---------------------------------------------------------------------------
# Local dev mode
# ---------------------------------------------------------------------------
deploy_local_dev() {
  log "Starting local dev deployment (arche.lvh.me) with hot reload"

  # Check prerequisites
  if ! command -v podman &>/dev/null; then
    err "Podman not found. Install Podman first."
    exit 1
  fi

  if ! podman compose version &>/dev/null; then
    err "podman-compose not found. Install podman-compose first."
    exit 1
  fi

  # Detect Podman socket path (VM-internal path for container mounts)
  PODMAN_SOCKET_PATH="${PODMAN_SOCKET_PATH:-}"
  if [[ -z "$PODMAN_SOCKET_PATH" ]]; then
    if podman machine inspect &>/dev/null; then
      PODMAN_ROOTLESS="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null || echo false)"
      if [[ "$PODMAN_ROOTLESS" == "true" ]]; then
        PODMAN_SOCKET_PATH="/run/user/$(id -u)/podman/podman.sock"
      else
        PODMAN_SOCKET_PATH="/run/podman/podman.sock"
      fi
    else
      PODMAN_SOCKET_PATH="/run/podman/podman.sock"
    fi
  fi
  log "Using Podman socket: $PODMAN_SOCKET_PATH"

  # Compute repo root and validate source tree
  REPO_ROOT="$SCRIPT_DIR/../.."
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
  if [[ ! -f "$REPO_ROOT/apps/web/package.json" ]]; then
    err "Cannot find apps/web/package.json in $REPO_ROOT"
    err "Run this script from within the arche repository."
    exit 1
  fi

  # Build workspace image
  log "Building workspace image: arche-workspace:latest"
  podman build -t arche-workspace:latest "$REPO_ROOT/infra/workspace-image"

  # Deploy Knowledge Base
  KB_CONTENT_DEST="${KB_CONTENT_HOST_PATH:-$HOME/.arche/kb-content}"
  KB_CONFIG_DEST="${KB_CONFIG_HOST_PATH:-$HOME/.arche/kb-config}"
  USERS_DEST="${ARCHE_USERS_PATH:-$HOME/.arche/users}"
  log "Deploying KB content to: $KB_CONTENT_DEST"
  "$REPO_ROOT/scripts/deploy-kb.sh" "$KB_CONTENT_DEST"
  log "Deploying KB config to: $KB_CONFIG_DEST"
  "$REPO_ROOT/scripts/deploy-config.sh" "$KB_CONFIG_DEST"
  log "Ensuring users data directory exists: $USERS_DEST"
  mkdir -p "$USERS_DEST"

  # Render compose from template using Ansible
  COMPOSE_OUT="$SCRIPT_DIR/.compose-local-dev.yml"

  if ! command -v ansible &>/dev/null; then
    err "Ansible is required to render templates. Install with: pip install ansible"
    exit 1
  fi

  log "Rendering compose template via Ansible..."

  TEMP_PLAYBOOK=$(mktemp)
  EXTRA_VARS_FILE=$(mktemp)
  trap 'rm -f "$TEMP_PLAYBOOK" "$EXTRA_VARS_FILE"' EXIT

  export LOCAL_DOMAIN PODMAN_SOCKET_PATH IMAGE_PREFIX WEB_VERSION REPO_ROOT KB_CONTENT_DEST KB_CONFIG_DEST USERS_DEST

  python3 -c '
import json, os, sys
vars = {
    "deploy_mode": "local-dev",
    "domain": os.environ["LOCAL_DOMAIN"],
    "dns_provider": "",
    "acme_email": "",
    "env_file_name": ".env.local-dev",
    "podman_socket_path": os.environ["PODMAN_SOCKET_PATH"],
    "image_prefix": os.environ["IMAGE_PREFIX"],
    "web_version": os.environ["WEB_VERSION"],
    "opencode_image": "arche-workspace:latest",
    "repo_root": os.environ["REPO_ROOT"],
    "kb_content_host_path": os.environ["KB_CONTENT_DEST"],
    "kb_config_host_path": os.environ["KB_CONFIG_DEST"],
    "postgres_password": os.environ["POSTGRES_PASSWORD"],
    "arche_session_pepper": os.environ["ARCHE_SESSION_PEPPER"],
    "arche_encryption_key": os.environ["ARCHE_ENCRYPTION_KEY"],
    "arche_internal_token": os.environ["ARCHE_INTERNAL_TOKEN"],
    "arche_gateway_token_secret": os.environ["ARCHE_GATEWAY_TOKEN_SECRET"],
    "arche_gateway_token_ttl_seconds": os.environ.get("ARCHE_GATEWAY_TOKEN_TTL_SECONDS", ""),
    "arche_gateway_base_url": os.environ.get("ARCHE_GATEWAY_BASE_URL", ""),
    "arche_seed_admin_email": os.environ["ARCHE_SEED_ADMIN_EMAIL"],
    "arche_seed_admin_password": os.environ["ARCHE_SEED_ADMIN_PASSWORD"],
    "arche_seed_admin_slug": os.environ["ARCHE_SEED_ADMIN_SLUG"],
    "arche_seed_test_email": os.environ.get("ARCHE_SEED_TEST_EMAIL", ""),
    "arche_seed_test_slug": os.environ.get("ARCHE_SEED_TEST_SLUG", ""),
    "users_path": os.environ["USERS_DEST"],
}
json.dump(vars, open(sys.argv[1], "w"))
' "$EXTRA_VARS_FILE"

  cat > "$TEMP_PLAYBOOK" <<'PLAYBOOK'
---
- hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - name: Render compose template
      ansible.builtin.template:
        src: "{{ deploy_dir }}/ansible/roles/app/templates/compose.yml.j2"
        dest: "{{ deploy_dir }}/.compose-local-dev.yml"
    - name: Render env template
      ansible.builtin.template:
        src: "{{ deploy_dir }}/ansible/roles/app/templates/.env.j2"
        dest: "{{ deploy_dir }}/.env.local-dev"
        mode: "0600"
PLAYBOOK

  ANSIBLE_CONFIG="$SCRIPT_DIR/ansible.cfg" ansible-playbook \
    --extra-vars "@${EXTRA_VARS_FILE}" \
    --extra-vars "deploy_dir=${SCRIPT_DIR}" \
    "$TEMP_PLAYBOOK"

  # Ensure arche-internal network exists
  if ! podman network inspect arche-internal &>/dev/null; then
    log "Creating arche-internal network..."
    podman network create arche-internal
  fi

  # Start the stack
  log "Starting Podman Compose stack..."
  podman compose -f "$COMPOSE_OUT" --env-file "$SCRIPT_DIR/.env.local-dev" -p arche up -d

  # Wait for web to be ready (longer timeout — first-run pnpm install is slow)
  log "Waiting for web service to be ready (first run may take a while for pnpm install)..."
  RETRIES=60
  until podman compose -f "$COMPOSE_OUT" -p arche exec -T web sh -c "node -e 'const net=require(\"net\");const s=net.connect(3000,\"127.0.0.1\");s.on(\"connect\",()=>process.exit(0));s.on(\"error\",()=>process.exit(1));'" 2>/dev/null; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
      warn "Web service did not become healthy. Continuing with migrations anyway..."
      break
    fi
    sleep 3
  done

  # In local-dev mode, migrations are NOT run by start.sh (uses pnpm dev, not start.sh)
  log "Running Prisma migrations..."
  podman compose -f "$COMPOSE_OUT" -p arche exec -T web pnpm prisma migrate deploy || {
    warn "Migration failed — check web container logs for details."
  }

  log "Running seed..."
  podman compose -f "$COMPOSE_OUT" -p arche exec -T web pnpm prisma db seed || {
    warn "Seed failed — this may be expected if already seeded."
  }

  echo ""
  log "Local dev deployment ready!"
  info "  App:              http://${LOCAL_DOMAIN}"
  info "  Dashboard:         http://${LOCAL_DOMAIN}/u/${ARCHE_SEED_ADMIN_SLUG}"
  info "  Workspace:         http://${LOCAL_DOMAIN}/w/${ARCHE_SEED_ADMIN_SLUG}"
  info "  Traefik dashboard: http://localhost:8081"
  info "  Postgres:         localhost:5432"
  echo ""
  info "Hot reload is active — edit files in apps/web/src/ and Next.js reloads automatically."
  echo ""
  info "Useful commands:"
  info "  Logs:     podman compose -f $COMPOSE_OUT -p arche logs -f"
  info "  Web logs: podman compose -f $COMPOSE_OUT -p arche logs -f web"
  info "  Stop:     podman compose -f $COMPOSE_OUT -p arche down"
  info "  Restart:  podman compose -f $COMPOSE_OUT -p arche restart"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "$MODE" in
  remote)    deploy_remote ;;
  local)     deploy_local ;;
  local-dev) deploy_local_dev ;;
esac

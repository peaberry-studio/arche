#!/usr/bin/env bash
set -euo pipefail

# Arche One-Click Deployer
# Usage:
#   Remote:    ./deploy.sh --ip <IP> --domain <DOMAIN> --ssh-key <KEY> --acme-email <EMAIL>
#   Local dev: ./deploy.sh --local-dev

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OPENCODE_VERSION_FILE="$REPO_ROOT/versions/opencode.version"

resolve_opencode_version() {
  if [[ -n "${OPENCODE_VERSION:-}" ]]; then
    printf '%s' "$OPENCODE_VERSION"
    return
  fi

  if [[ ! -f "$OPENCODE_VERSION_FILE" ]]; then
    printf 'Missing OpenCode version file: %s\n' "$OPENCODE_VERSION_FILE" >&2
    exit 1
  fi

  local version
  version="$(tr -d '[:space:]' < "$OPENCODE_VERSION_FILE")"
  if [[ -z "$version" ]]; then
    printf 'OpenCode version file is empty: %s\n' "$OPENCODE_VERSION_FILE" >&2
    exit 1
  fi

  printf '%s' "$version"
}

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
SKIP_ENSURE_DNS_RECORD=false
LOCAL_DOMAIN="arche.lvh.me"

# GHCR defaults
IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/peaberry-studio/arche/}"
WEB_VERSION="${WEB_VERSION:-latest}"
OPENCODE_IMAGE="${OPENCODE_IMAGE:-arche-workspace:latest}"
RESOLVED_OPENCODE_VERSION="$(resolve_opencode_version)"

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

prepare_remote_workspace_image() {
  if [[ "$OPENCODE_IMAGE" != "arche-workspace:latest" ]]; then
    log "Skipping remote workspace image build (OPENCODE_IMAGE=$OPENCODE_IMAGE)"
    return
  fi

  if $DRY_RUN; then
    warn "DRY RUN — skipping remote workspace image build"
    return
  fi

  local repo_root="$REPO_ROOT"
  local workspace_src="$repo_root/infra/workspace-image"

  if [[ ! -f "$workspace_src/Containerfile" ]]; then
    err "Cannot find infra/workspace-image/Containerfile in $repo_root"
    err "Run this script from within the arche repository."
    exit 1
  fi

  log "Syncing workspace image sources to remote host..."
  tar -C "$repo_root" -czf - infra/workspace-image | \
    ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$SSH_KEY" "${SSH_USER}@${DEPLOY_IP}" \
      "rm -rf /tmp/arche-workspace-image-src && mkdir -p /tmp/arche-workspace-image-src && tar -xzf - -C /tmp/arche-workspace-image-src --strip-components=2"

  log "Building workspace image on remote host: arche-workspace:latest"
  ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$SSH_KEY" "${SSH_USER}@${DEPLOY_IP}" \
    "cd /tmp/arche-workspace-image-src && podman build --build-arg OPENCODE_VERSION=$RESOLVED_OPENCODE_VERSION -t arche-workspace:latest ."
}

prepare_remote_web_image() {
  if [[ "$WEB_IMAGE" != "arche-web:latest" ]]; then
    log "Skipping remote web image build (WEB_IMAGE=$WEB_IMAGE)"
    return
  fi

  if $DRY_RUN; then
    warn "DRY RUN — skipping remote web image build"
    return
  fi

  local repo_root="$SCRIPT_DIR/../.."
  repo_root="$(cd "$repo_root" && pwd)"
  local web_src="$repo_root/apps/web"

  if [[ ! -f "$web_src/Containerfile" ]]; then
    err "Cannot find apps/web/Containerfile in $repo_root"
    err "Run this script from within the arche repository."
    exit 1
  fi

  log "Syncing web image sources to remote host..."
  tar -C "$repo_root" -czf - apps/web | \
    ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$SSH_KEY" "${SSH_USER}@${DEPLOY_IP}" \
      "rm -rf /tmp/arche-web-src && mkdir -p /tmp/arche-web-src && tar -xzf - -C /tmp/arche-web-src --strip-components=2"

  log "Building web image on remote host: arche-web:latest"
  ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$SSH_KEY" "${SSH_USER}@${DEPLOY_IP}" \
    "cd /tmp/arche-web-src && podman build -t arche-web:latest ."
}

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
    --skip-ensure-dns-record  Skip DNS verification step before deploy
    --dry-run       Show what would be done without executing
    --verbose       Enable verbose output

  DNS Setup:
    The script will verify your domain points to the VPS IP.
    If not, it will show you exactly which DNS record to add.
    Works with any domain provider (Cloudflare, GoDaddy, Namecheap, etc.)

LOCAL DEV MODE:
  ./deploy.sh --local-dev

  Runs the local development stack with hot reload via next dev:
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
  ARCHE_CONNECTOR_OAUTH_STATE_SECRET Connector OAuth state secret
  ARCHE_GATEWAY_TOKEN_SECRET Gateway token signing secret
  ARCHE_GATEWAY_TOKEN_TTL_SECONDS Gateway token TTL (seconds, optional)
  ARCHE_GATEWAY_BASE_URL    Gateway base URL (optional)
  ARCHE_SEED_ADMIN_EMAIL    Seed admin email
  ARCHE_SEED_ADMIN_PASSWORD Seed admin password
  ARCHE_SEED_ADMIN_SLUG     Seed admin URL slug
  ARCHE_SEED_TEST_EMAIL     Seed test user email (optional)
  ARCHE_SEED_TEST_SLUG      Seed test user slug (optional)
  ARCHE_USERS_PATH          Host path for persisted user data (optional)
  OPENCODE_VERSION          OpenCode version override (optional)
  WEB_IMAGE                 Web app image (set arche-web:latest to build on VPS)
  KB_CONTENT_HOST_PATH      Path to the KB content bare repo
  KB_CONFIG_HOST_PATH       Path to the KB config bare repo
EOF
  exit "${1:-0}"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
[[ $# -eq 0 ]] && usage 1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local-dev)   MODE="local-dev";   shift ;;
    --ip)          DEPLOY_IP="$2";       shift 2 ;;
    --domain)      DEPLOY_DOMAIN="$2";   shift 2 ;;
    --ssh-key)     SSH_KEY="$2";         shift 2 ;;
    --user)        SSH_USER="$2";        shift 2 ;;
    --acme-email)  ACME_EMAIL="$2";      shift 2 ;;
    --version)     WEB_VERSION="$2";     shift 2 ;;
    --skip-ensure-dns-record) SKIP_ENSURE_DNS_RECORD=true; shift ;;
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

WEB_IMAGE="${WEB_IMAGE:-${IMAGE_PREFIX}web:${WEB_VERSION}}"

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
ERRORS=()

validate_encryption_key() {
  local key="${ARCHE_ENCRYPTION_KEY:-}"
  local decoded_length

  if [[ -z "$key" ]]; then
    return
  fi

  decoded_length="$(python3 - <<'PY'
import base64
import os

key = os.environ.get("ARCHE_ENCRYPTION_KEY", "")

try:
  decoded = base64.b64decode(key, validate=True)
except Exception:
  print(-1)
else:
  print(len(decoded))
PY
)"

  if [[ "$decoded_length" != "32" ]]; then
    ERRORS+=("ARCHE_ENCRYPTION_KEY must decode from base64 to exactly 32 bytes (example: openssl rand -base64 32)")
  fi
}

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
      true
    # Check if IPv6 (simplified check)
    elif [[ "$DEPLOY_IP" =~ : ]]; then
      true
    else
      ERRORS+=("Invalid IP address: $DEPLOY_IP (must be IPv4 or IPv6)")
    fi
  fi

  # Secrets
  [[ -z "${POSTGRES_PASSWORD:-}" ]]         && ERRORS+=("POSTGRES_PASSWORD is required")
  [[ -z "${ARCHE_SESSION_PEPPER:-}" ]]      && ERRORS+=("ARCHE_SESSION_PEPPER is required")
  [[ -z "${ARCHE_ENCRYPTION_KEY:-}" ]]      && ERRORS+=("ARCHE_ENCRYPTION_KEY is required")
  [[ -z "${ARCHE_INTERNAL_TOKEN:-}" ]]      && ERRORS+=("ARCHE_INTERNAL_TOKEN is required")
  [[ -z "${ARCHE_CONNECTOR_OAUTH_STATE_SECRET:-}" ]] && ERRORS+=("ARCHE_CONNECTOR_OAUTH_STATE_SECRET is required")
  [[ -z "${ARCHE_GATEWAY_TOKEN_SECRET:-}" ]] && ERRORS+=("ARCHE_GATEWAY_TOKEN_SECRET is required")
  [[ -z "${ARCHE_SEED_ADMIN_EMAIL:-}" ]]    && ERRORS+=("ARCHE_SEED_ADMIN_EMAIL is required")
  [[ -z "${ARCHE_SEED_ADMIN_PASSWORD:-}" ]] && ERRORS+=("ARCHE_SEED_ADMIN_PASSWORD is required")
  [[ -z "${ARCHE_SEED_ADMIN_SLUG:-}" ]]     && ERRORS+=("ARCHE_SEED_ADMIN_SLUG is required")

  validate_encryption_key

  log "validate_remote complete, errors: ${#ERRORS[@]}"
}

validate_local() {
  # Local-dev mode needs fewer secrets — use defaults if not set
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
  export ARCHE_SESSION_PEPPER="${ARCHE_SESSION_PEPPER:-local-dev-pepper-not-for-production}"
  # Must be base64 for a 32-byte key (AES-256-GCM). Keep stable across runs.
  export ARCHE_ENCRYPTION_KEY="${ARCHE_ENCRYPTION_KEY:-ZGV2LWluc2VjdXJlLWtleS0zMi1ieXRlcy1sb25nISE=}"
  export ARCHE_INTERNAL_TOKEN="${ARCHE_INTERNAL_TOKEN:-local-dev-internal-token}"
  export ARCHE_CONNECTOR_OAUTH_STATE_SECRET="${ARCHE_CONNECTOR_OAUTH_STATE_SECRET:-local-dev-connector-oauth-state-secret-not-for-production}"
  export ARCHE_GATEWAY_TOKEN_SECRET="${ARCHE_GATEWAY_TOKEN_SECRET:-local-dev-gateway-token-secret-not-for-production}"
  export ARCHE_GATEWAY_TOKEN_TTL_SECONDS="${ARCHE_GATEWAY_TOKEN_TTL_SECONDS:-}"
  export ARCHE_GATEWAY_BASE_URL="${ARCHE_GATEWAY_BASE_URL:-}"
  export ARCHE_SEED_ADMIN_EMAIL="${ARCHE_SEED_ADMIN_EMAIL:-admin@example.com}"
  export ARCHE_SEED_ADMIN_PASSWORD="${ARCHE_SEED_ADMIN_PASSWORD:-change-me}"
  export ARCHE_SEED_ADMIN_SLUG="${ARCHE_SEED_ADMIN_SLUG:-admin}"
  export ARCHE_SEED_TEST_EMAIL="${ARCHE_SEED_TEST_EMAIL:-peter@example.com}"
  export ARCHE_SEED_TEST_SLUG="${ARCHE_SEED_TEST_SLUG:-peter}"

  validate_encryption_key
}

log "About to determine mode, current MODE=$MODE"

# Determine mode
if [[ "$MODE" == "local-dev" ]]; then
  # Ensure no remote flags were also passed
  if [[ -n "$DEPLOY_IP" || -n "$DEPLOY_DOMAIN" || -n "$SSH_KEY" || -n "$ACME_EMAIL" ]]; then
    ERRORS+=("--${MODE} is mutually exclusive with remote flags (--ip, --domain, etc.)")
  fi
  validate_local
elif [[ -n "$DEPLOY_IP" || -n "$DEPLOY_DOMAIN" || -n "$SSH_KEY" || -n "$ACME_EMAIL" ]]; then
  MODE="remote"
  validate_remote
else
  err "Specify --local-dev, or remote flags (--ip, --domain, etc.)"
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

  if [[ ! -t 0 ]]; then
    err "DNS is not configured and this shell is non-interactive."
    err "Set the DNS record, or rerun with --skip-ensure-dns-record."
    exit 1
  fi

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

  if [[ ! -t 0 ]]; then
    err "DNS verification timed out in non-interactive mode."
    err "Set the DNS record, or rerun with --skip-ensure-dns-record."
    exit 1
  fi

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

  if $SKIP_ENSURE_DNS_RECORD; then
    warn "Skipping DNS verification (--skip-ensure-dns-record enabled)"
  else
    # Ensure DNS record points to VPS IP
    ensure_dns_record
  fi

  # Generate temporary inventory and extra-vars file
  INVENTORY=$(mktemp)
  EXTRA_VARS_FILE=$(mktemp)
  trap 'rm -f "$INVENTORY" "$EXTRA_VARS_FILE"' EXIT

  cat > "$INVENTORY" <<EOF
[arche]
${DEPLOY_IP} ansible_user=${SSH_USER} ansible_ssh_private_key_file=${SSH_KEY}
EOF

  # Export variables so python3 subprocess can read them
  export DEPLOY_DOMAIN ACME_EMAIL IMAGE_PREFIX WEB_VERSION WEB_IMAGE OPENCODE_IMAGE

  # Build extra vars as JSON (safe for secrets with special characters)
  python3 -c '
import json, os, sys
vars = {
    "domain": os.environ["DEPLOY_DOMAIN"],
    "acme_email": os.environ["ACME_EMAIL"],
    "deploy_mode": "remote",
    "image_prefix": os.environ["IMAGE_PREFIX"],
    "web_version": os.environ["WEB_VERSION"],
    "web_image": os.environ["WEB_IMAGE"],
    "opencode_image": os.environ["OPENCODE_IMAGE"],
    "postgres_password": os.environ["POSTGRES_PASSWORD"],
    "arche_session_pepper": os.environ["ARCHE_SESSION_PEPPER"],
    "arche_encryption_key": os.environ["ARCHE_ENCRYPTION_KEY"],
    "arche_internal_token": os.environ["ARCHE_INTERNAL_TOKEN"],
    "arche_connector_oauth_state_secret": os.environ["ARCHE_CONNECTOR_OAUTH_STATE_SECRET"],
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
    "ghcr_token": os.environ.get("GHCR_TOKEN", ""),
}
json.dump(vars, open(sys.argv[1], "w"))
' "$EXTRA_VARS_FILE"

  ANSIBLE_ARGS=(
    -i "$INVENTORY"
    --extra-vars "@${EXTRA_VARS_FILE}"
    --extra-vars "bootstrap_only=false"
    "$SCRIPT_DIR/ansible/playbooks/site.yml"
  )

  NEEDS_REMOTE_BUILD=false
  if [[ "$OPENCODE_IMAGE" == "arche-workspace:latest" || "$WEB_IMAGE" == "arche-web:latest" ]]; then
    NEEDS_REMOTE_BUILD=true
  fi

  if $NEEDS_REMOTE_BUILD; then
    log "Ensuring remote host is provisioned before image build..."
    BOOTSTRAP_ARGS=(
      -i "$INVENTORY"
      --extra-vars "@${EXTRA_VARS_FILE}"
      --extra-vars "bootstrap_only=true"
      "$SCRIPT_DIR/ansible/playbooks/site.yml"
    )

    if $VERBOSE; then
      BOOTSTRAP_ARGS+=(-vvv)
    fi

    if $DRY_RUN; then
      BOOTSTRAP_ARGS+=(--check)
    fi

    log "Running Ansible bootstrap playbook..."
    ANSIBLE_CONFIG="$SCRIPT_DIR/ansible.cfg" ansible-playbook "${BOOTSTRAP_ARGS[@]}"
  fi

  # Build workspace image on remote host when using default OPENCODE_IMAGE
  prepare_remote_workspace_image

  # Build web image on remote host when using local WEB_IMAGE
  prepare_remote_web_image

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
    err "podman compose not found. Install Podman with Compose support first."
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
  if [[ ! -f "$REPO_ROOT/apps/web/package.json" ]]; then
    err "Cannot find apps/web/package.json in $REPO_ROOT"
    err "Run this script from within the arche repository."
    exit 1
  fi

  LOCAL_DEV_PROJECT_NAME="arche"
  LOCAL_DEV_NETWORK_NAME="arche-internal"

  # Build workspace image
  log "Building workspace image: arche-workspace:latest"
  podman build --build-arg OPENCODE_VERSION="$RESOLVED_OPENCODE_VERSION" -t arche-workspace:latest "$REPO_ROOT/infra/workspace-image"

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
    "arche_connector_oauth_state_secret": os.environ["ARCHE_CONNECTOR_OAUTH_STATE_SECRET"],
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

  LOCAL_DEV_ENV_FILE="$SCRIPT_DIR/.env.local-dev"
  LOCAL_DEV_COMPOSE_ARGS=(-f "$COMPOSE_OUT" --env-file "$LOCAL_DEV_ENV_FILE" -p "$LOCAL_DEV_PROJECT_NAME")

  # Ensure the local-dev workspace network exists
  if ! podman network inspect "$LOCAL_DEV_NETWORK_NAME" &>/dev/null; then
    log "Creating $LOCAL_DEV_NETWORK_NAME network..."
    podman network create "$LOCAL_DEV_NETWORK_NAME"
  fi

  # Start the stack
  log "Starting Podman Compose stack..."
  podman compose "${LOCAL_DEV_COMPOSE_ARGS[@]}" up -d

  # Wait for web to be ready (longer timeout — first-run pnpm install is slow)
  log "Waiting for web service to be ready (first run may take a while for pnpm install)..."
  RETRIES=60
  until podman compose "${LOCAL_DEV_COMPOSE_ARGS[@]}" exec -T web sh -c "node -e 'const net=require(\"net\");const s=net.connect(3000,\"127.0.0.1\");s.on(\"connect\",()=>process.exit(0));s.on(\"error\",()=>process.exit(1));'" 2>/dev/null; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
      err "Web service did not become healthy in time."
      podman compose "${LOCAL_DEV_COMPOSE_ARGS[@]}" logs --tail 100 web postgres || true
      exit 1
    fi
    sleep 3
  done

  # In local-dev mode, migrations are NOT run by start.sh (uses pnpm dev, not start.sh)
  log "Running Prisma migrations..."
  RETRIES=10
  until podman compose "${LOCAL_DEV_COMPOSE_ARGS[@]}" exec -T web pnpm prisma migrate deploy; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
      err "Prisma migrations failed after repeated attempts."
      podman compose "${LOCAL_DEV_COMPOSE_ARGS[@]}" logs --tail 100 web postgres || true
      exit 1
    fi
    warn "Migration attempt failed. Retrying in 3s..."
    sleep 3
  done

  log "Running seed..."
  RETRIES=10
  until podman compose "${LOCAL_DEV_COMPOSE_ARGS[@]}" exec -T web pnpm prisma db seed; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
      err "Seed failed after repeated attempts."
      podman compose "${LOCAL_DEV_COMPOSE_ARGS[@]}" logs --tail 100 web postgres || true
      exit 1
    fi
    warn "Seed attempt failed. Retrying in 3s..."
    sleep 3
  done

  echo ""
  log "Local dev deployment ready!"
  info "  App:              http://${LOCAL_DOMAIN}"
  info "  Dashboard:         http://${LOCAL_DOMAIN}/u/${ARCHE_SEED_ADMIN_SLUG}"
  info "  Workspace:         http://${LOCAL_DOMAIN}/w/${ARCHE_SEED_ADMIN_SLUG}"
  info "  Traefik dashboard: http://localhost:8081"
  info "  Postgres:         localhost:5432"
  info "  Project:          ${LOCAL_DEV_PROJECT_NAME}"
  info "  Network:          ${LOCAL_DEV_NETWORK_NAME}"
  echo ""
  info "Hot reload is active — edit files in apps/web/src/ and Next.js reloads automatically."
  echo ""
  info "Useful commands:"
  info "  Logs:     podman compose -f $COMPOSE_OUT --env-file $LOCAL_DEV_ENV_FILE -p $LOCAL_DEV_PROJECT_NAME logs -f"
  info "  Web logs: podman compose -f $COMPOSE_OUT --env-file $LOCAL_DEV_ENV_FILE -p $LOCAL_DEV_PROJECT_NAME logs -f web"
  info "  Stop:     podman compose -f $COMPOSE_OUT --env-file $LOCAL_DEV_ENV_FILE -p $LOCAL_DEV_PROJECT_NAME down"
  info "  Restart:  podman compose -f $COMPOSE_OUT --env-file $LOCAL_DEV_ENV_FILE -p $LOCAL_DEV_PROJECT_NAME restart"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "$MODE" in
  remote)    deploy_remote ;;
  local-dev) deploy_local_dev ;;
esac

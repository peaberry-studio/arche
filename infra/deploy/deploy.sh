#!/usr/bin/env bash
set -euo pipefail

# Arche One-Click Deployer
# Usage:
#   Remote:    ./deploy.sh --ip <IP> --domain <DOMAIN> --dns-provider <PROVIDER> --ssh-key <KEY> --acme-email <EMAIL>
#   Local:     ./deploy.sh --local
#   Local dev: ./deploy.sh --local-dev

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
MODE=""
DEPLOY_IP=""
DEPLOY_DOMAIN=""
DNS_PROVIDER=""
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
  ./deploy.sh --ip <IP> --domain <DOMAIN> --dns-provider <PROVIDER> \
              --ssh-key <KEY> --acme-email <EMAIL> [OPTIONS]

  Required:
    --ip            VPS IP address
    --domain        Production domain (e.g. arche.example.com)
    --dns-provider  DNS challenge provider: cloudflare | route53 | digitalocean
    --ssh-key       Path to SSH private key
    --acme-email    Email for Let's Encrypt ACME account

  Optional:
    --user          SSH user (default: root)
    --dry-run       Show what would be done without executing
    --verbose       Enable verbose output

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
    - KB deployed to ~/.arche/kb


ENVIRONMENT VARIABLES (via .env or exported):
  POSTGRES_PASSWORD         Database password
  ARCHE_SESSION_PEPPER      Session pepper secret
  ARCHE_ENCRYPTION_KEY      Encryption key
  ARCHE_INTERNAL_TOKEN      Internal API token
  ARCHE_SEED_ADMIN_EMAIL    Seed admin email
  ARCHE_SEED_ADMIN_PASSWORD Seed admin password
  ARCHE_SEED_ADMIN_SLUG     Seed admin URL slug
  ARCHE_SEED_TEST_EMAIL     Seed test user email (optional)
  ARCHE_SEED_TEST_SLUG      Seed test user slug (optional)

  DNS provider tokens (set the one matching --dns-provider):
    CF_DNS_API_TOKEN          Cloudflare
    AWS_ACCESS_KEY_ID         Route53
    AWS_SECRET_ACCESS_KEY     Route53
    DO_AUTH_TOKEN             DigitalOcean
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
    --dns-provider) DNS_PROVIDER="$2";   shift 2 ;;
    --ssh-key)     SSH_KEY="$2";         shift 2 ;;
    --user)        SSH_USER="$2";        shift 2 ;;
    --acme-email)  ACME_EMAIL="$2";      shift 2 ;;
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
  source "$SCRIPT_DIR/.env"
  set +a
fi

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
ERRORS=()

validate_remote() {
  [[ -z "$DEPLOY_IP" ]]    && ERRORS+=("--ip is required")
  [[ -z "$DEPLOY_DOMAIN" ]] && ERRORS+=("--domain is required")
  [[ -z "$DNS_PROVIDER" ]]  && ERRORS+=("--dns-provider is required")
  [[ -z "$SSH_KEY" ]]       && ERRORS+=("--ssh-key is required")
  [[ -z "$ACME_EMAIL" ]]    && ERRORS+=("--acme-email is required")

  if [[ -n "$SSH_KEY" && ! -f "$SSH_KEY" ]]; then
    ERRORS+=("SSH key not found: $SSH_KEY")
  fi

  case "$DNS_PROVIDER" in
    cloudflare)
      [[ -z "${CF_DNS_API_TOKEN:-}" ]] && ERRORS+=("CF_DNS_API_TOKEN is required for cloudflare provider")
      ;;
    route53)
      [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]     && ERRORS+=("AWS_ACCESS_KEY_ID is required for route53 provider")
      [[ -z "${AWS_SECRET_ACCESS_KEY:-}" ]] && ERRORS+=("AWS_SECRET_ACCESS_KEY is required for route53 provider")
      ;;
    digitalocean)
      [[ -z "${DO_AUTH_TOKEN:-}" ]] && ERRORS+=("DO_AUTH_TOKEN is required for digitalocean provider")
      ;;
    "")
      ;; # already reported above
    *)
      ERRORS+=("Unsupported --dns-provider: $DNS_PROVIDER (use: cloudflare, route53, digitalocean)")
      ;;
  esac

  # Secrets
  [[ -z "${POSTGRES_PASSWORD:-}" ]]         && ERRORS+=("POSTGRES_PASSWORD is required")
  [[ -z "${ARCHE_SESSION_PEPPER:-}" ]]      && ERRORS+=("ARCHE_SESSION_PEPPER is required")
  [[ -z "${ARCHE_ENCRYPTION_KEY:-}" ]]      && ERRORS+=("ARCHE_ENCRYPTION_KEY is required")
  [[ -z "${ARCHE_INTERNAL_TOKEN:-}" ]]      && ERRORS+=("ARCHE_INTERNAL_TOKEN is required")
  [[ -z "${ARCHE_SEED_ADMIN_EMAIL:-}" ]]    && ERRORS+=("ARCHE_SEED_ADMIN_EMAIL is required")
  [[ -z "${ARCHE_SEED_ADMIN_PASSWORD:-}" ]] && ERRORS+=("ARCHE_SEED_ADMIN_PASSWORD is required")
  [[ -z "${ARCHE_SEED_ADMIN_SLUG:-}" ]]     && ERRORS+=("ARCHE_SEED_ADMIN_SLUG is required")

  # GHCR token for remote pulls
  [[ -z "${GHCR_TOKEN:-}" ]] && ERRORS+=("GHCR_TOKEN is required for remote deployment")
}

validate_local() {
  # Local mode needs fewer secrets — use defaults if not set
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
  export ARCHE_SESSION_PEPPER="${ARCHE_SESSION_PEPPER:-local-dev-pepper-not-for-production}"
  # Must be base64 for a 32-byte key (AES-256-GCM). Keep stable across runs.
  export ARCHE_ENCRYPTION_KEY="${ARCHE_ENCRYPTION_KEY:-ZGV2LWluc2VjdXJlLWtleS0zMi1ieXRlcy1sb25nISE=}"
  export ARCHE_INTERNAL_TOKEN="${ARCHE_INTERNAL_TOKEN:-local-dev-internal-token}"
  export ARCHE_SEED_ADMIN_EMAIL="${ARCHE_SEED_ADMIN_EMAIL:-admin@example.com}"
  export ARCHE_SEED_ADMIN_PASSWORD="${ARCHE_SEED_ADMIN_PASSWORD:-change-me}"
  export ARCHE_SEED_ADMIN_SLUG="${ARCHE_SEED_ADMIN_SLUG:-admin}"
  export ARCHE_SEED_TEST_EMAIL="${ARCHE_SEED_TEST_EMAIL:-peter@example.com}"
  export ARCHE_SEED_TEST_SLUG="${ARCHE_SEED_TEST_SLUG:-peter}"
}

# Determine mode
if [[ "$MODE" == "local" || "$MODE" == "local-dev" ]]; then
  # Ensure no remote flags were also passed
  if [[ -n "$DEPLOY_IP" || -n "$DEPLOY_DOMAIN" || -n "$DNS_PROVIDER" || -n "$SSH_KEY" || -n "$ACME_EMAIL" ]]; then
    ERRORS+=("--${MODE} is mutually exclusive with remote flags (--ip, --domain, etc.)")
  fi
  validate_local
elif [[ -n "$DEPLOY_IP" || -n "$DEPLOY_DOMAIN" || -n "$DNS_PROVIDER" || -n "$SSH_KEY" || -n "$ACME_EMAIL" ]]; then
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

  # Generate temporary inventory and extra-vars file
  INVENTORY=$(mktemp)
  EXTRA_VARS_FILE=$(mktemp)
  trap 'rm -f "$INVENTORY" "$EXTRA_VARS_FILE"' EXIT

  cat > "$INVENTORY" <<EOF
[arche]
${DEPLOY_IP} ansible_user=${SSH_USER} ansible_ssh_private_key_file=${SSH_KEY}
EOF

  # Export variables so python3 subprocess can read them
  export DEPLOY_DOMAIN DNS_PROVIDER ACME_EMAIL IMAGE_PREFIX WEB_VERSION OPENCODE_IMAGE

  # Build extra vars as JSON (safe for secrets with special characters)
  python3 -c '
import json, os, sys
vars = {
    "domain": os.environ["DEPLOY_DOMAIN"],
    "dns_provider": os.environ["DNS_PROVIDER"],
    "acme_email": os.environ["ACME_EMAIL"],
    "deploy_mode": "remote",
    "image_prefix": os.environ["IMAGE_PREFIX"],
    "web_version": os.environ["WEB_VERSION"],
    "opencode_image": os.environ["OPENCODE_IMAGE"],
    "postgres_password": os.environ["POSTGRES_PASSWORD"],
    "arche_session_pepper": os.environ["ARCHE_SESSION_PEPPER"],
    "arche_encryption_key": os.environ["ARCHE_ENCRYPTION_KEY"],
    "arche_internal_token": os.environ["ARCHE_INTERNAL_TOKEN"],
    "arche_seed_admin_email": os.environ["ARCHE_SEED_ADMIN_EMAIL"],
    "arche_seed_admin_password": os.environ["ARCHE_SEED_ADMIN_PASSWORD"],
    "arche_seed_admin_slug": os.environ["ARCHE_SEED_ADMIN_SLUG"],
    "arche_seed_test_email": os.environ.get("ARCHE_SEED_TEST_EMAIL", ""),
    "arche_seed_test_slug": os.environ.get("ARCHE_SEED_TEST_SLUG", ""),
    "ghcr_token": os.environ["GHCR_TOKEN"],
}
dns = os.environ["DNS_PROVIDER"]
if dns == "cloudflare":
    vars["cf_dns_api_token"] = os.environ["CF_DNS_API_TOKEN"]
elif dns == "route53":
    vars["aws_access_key_id"] = os.environ["AWS_ACCESS_KEY_ID"]
    vars["aws_secret_access_key"] = os.environ["AWS_SECRET_ACCESS_KEY"]
elif dns == "digitalocean":
    vars["do_auth_token"] = os.environ["DO_AUTH_TOKEN"]
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
    export LOCAL_DOMAIN PODMAN_SOCKET_PATH IMAGE_PREFIX WEB_VERSION OPENCODE_IMAGE

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
    "arche_seed_admin_email": os.environ["ARCHE_SEED_ADMIN_EMAIL"],
    "arche_seed_admin_password": os.environ["ARCHE_SEED_ADMIN_PASSWORD"],
    "arche_seed_admin_slug": os.environ["ARCHE_SEED_ADMIN_SLUG"],
    "arche_seed_test_email": os.environ.get("ARCHE_SEED_TEST_EMAIL", ""),
    "arche_seed_test_slug": os.environ.get("ARCHE_SEED_TEST_SLUG", ""),
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

  # Start the stack
  log "Starting Podman Compose stack..."
  podman compose -f "$COMPOSE_OUT" --env-file "$SCRIPT_DIR/.env.local" -p arche up -d

  # Wait for web to be ready
  log "Waiting for web service to be ready..."
  RETRIES=30
  until podman compose -f "$COMPOSE_OUT" -p arche exec -T web sh -c "node -e 'const net=require(\"net\");const s=net.connect(3000,\"127.0.0.1\");s.on(\"connect\",()=>process.exit(0));s.on(\"error\",()=>process.exit(1));'" 2>/dev/null; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
      warn "Web service did not become healthy. Continuing with migrations anyway..."
      break
    fi
    sleep 2
  done

  # Run migrations
  log "Running Prisma migrations..."
  podman compose -f "$COMPOSE_OUT" -p arche exec -T web pnpm prisma migrate deploy || {
    warn "Migration failed — the web image may not include prisma files."
    warn "Ensure the Containerfile copies the prisma/ directory."
  }

  # Seed
  log "Running seed..."
  podman compose -f "$COMPOSE_OUT" -p arche exec -T web pnpm prisma db seed || {
    warn "Seed failed — this may be expected if already seeded."
  }

  echo ""
  log "Local deployment ready!"
  info "  App:   http://${LOCAL_DOMAIN}"
  info "  Dashboard: http://${LOCAL_DOMAIN}/u/${ARCHE_SEED_ADMIN_SLUG}"
  info "  Workspace: http://${LOCAL_DOMAIN}/w/${ARCHE_SEED_ADMIN_SLUG}"
  echo ""
  info "Useful commands:"
  info "  Logs:     podman compose -f $COMPOSE_OUT -p arche logs -f"
  info "  Stop:     podman compose -f $COMPOSE_OUT -p arche down"
  info "  Restart:  podman compose -f $COMPOSE_OUT -p arche restart"
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
  KB_DEST="${KB_HOST_PATH:-$HOME/.arche/kb}"
  log "Deploying Knowledge Base to: $KB_DEST"
  "$REPO_ROOT/scripts/deploy-kb.sh" "$KB_DEST"

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

  export LOCAL_DOMAIN PODMAN_SOCKET_PATH IMAGE_PREFIX WEB_VERSION REPO_ROOT KB_DEST

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
    "kb_host_path": os.environ["KB_DEST"],
    "postgres_password": os.environ["POSTGRES_PASSWORD"],
    "arche_session_pepper": os.environ["ARCHE_SESSION_PEPPER"],
    "arche_encryption_key": os.environ["ARCHE_ENCRYPTION_KEY"],
    "arche_internal_token": os.environ["ARCHE_INTERNAL_TOKEN"],
    "arche_seed_admin_email": os.environ["ARCHE_SEED_ADMIN_EMAIL"],
    "arche_seed_admin_password": os.environ["ARCHE_SEED_ADMIN_PASSWORD"],
    "arche_seed_admin_slug": os.environ["ARCHE_SEED_ADMIN_SLUG"],
    "arche_seed_test_email": os.environ.get("ARCHE_SEED_TEST_EMAIL", ""),
    "arche_seed_test_slug": os.environ.get("ARCHE_SEED_TEST_SLUG", ""),
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

  # Run migrations
  log "Running Prisma migrations..."
  podman compose -f "$COMPOSE_OUT" -p arche exec -T web pnpm prisma migrate deploy || {
    warn "Migration failed — check web container logs for details."
  }

  # Seed
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

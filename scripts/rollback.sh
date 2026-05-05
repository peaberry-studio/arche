#!/usr/bin/env bash
set -euo pipefail

# Arche Rollback Script
# Usage:
#   ./rollback.sh --version <tag>             Redeploy a previous web image version
#   ./rollback.sh --restore-db <dump-file>    Restore a database backup
#   ./rollback.sh --version <tag> --restore-db <dump-file>  Both

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { printf "${GREEN}[rollback]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[rollback]${NC} %s\n" "$*" >&2; }
err()  { printf "${RED}[rollback]${NC} %s\n" "$*" >&2; }

APP_DIR="${ARCHE_APP_DIR:-/opt/arche}"
DATA_DIR="${ARCHE_DATA_DIR:-/opt/arche/data}"
ENV_FILE="${APP_DIR}/.env"
IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/peaberry-studio/arche/}"

ROLLBACK_VERSION=""
RESTORE_DB=""

usage() {
  cat <<'EOF'
Arche Rollback Script

Usage:
  ./rollback.sh --version <tag>               Redeploy a previous web image version
  ./rollback.sh --restore-db <dump-file>      Restore a database backup
  ./rollback.sh --version <tag> --restore-db <dump-file>  Both
  ./rollback.sh --list-backups                List available database backups
  ./rollback.sh --current                     Show currently deployed version

Options:
  --version       Web image tag to roll back to (e.g., abc1234)
  --restore-db    Path to a pg_dump file to restore
  --list-backups  List available database backups
  --current       Show currently deployed version
EOF
  exit "${1:-0}"
}

# Find a running container by compose label
find_postgres() {
  podman ps --filter label=com.docker.compose.project=arche --filter name=postgres --format '{{.Names}}' | head -1
}

# Find all running web containers (may include zombies from failed deploys)
find_all_webs() {
  {
    podman ps --filter label=arche.role=web --format '{{.Names}}'
    podman ps --filter label=com.docker.compose.project=arche --filter label=com.docker.compose.service=web --format '{{.Names}}'
  } | sed '/^$/d' | sort -u
}

# Detect the compose default network
detect_compose_network() {
  podman network ls --format '{{.Name}}' | grep -E '^arche[_-]default$' | head -1
}

[[ $# -eq 0 ]] && usage 1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)       ROLLBACK_VERSION="$2"; shift 2 ;;
    --restore-db)    RESTORE_DB="$2";       shift 2 ;;
    --list-backups)
      log "Available backups in ${DATA_DIR}/backups/:"
      ls -lht "${DATA_DIR}/backups/arche-"*.dump 2>/dev/null || echo "  (none found)"
      exit 0 ;;
    --current)
      if [[ -f "${APP_DIR}/.current-version" ]]; then
        log "Current version: $(cat "${APP_DIR}/.current-version")"
      else
        warn "No version file found at ${APP_DIR}/.current-version"
      fi
      CURRENT_WEBS=$(find_all_webs)
      if [[ -n "$CURRENT_WEBS" ]]; then
        log "Running container(s):"
        echo "$CURRENT_WEBS" | while read -r c; do log "  $c"; done
      else
        warn "No web container running"
      fi
      exit 0 ;;
    -h|--help)       usage 0 ;;
    *)               err "Unknown option: $1"; usage 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Restore database
# ---------------------------------------------------------------------------
if [[ -n "$RESTORE_DB" ]]; then
  if [[ ! -f "$RESTORE_DB" ]]; then
    err "Backup file not found: $RESTORE_DB"
    exit 1
  fi

  POSTGRES_CONTAINER=$(find_postgres)
  if [[ -z "$POSTGRES_CONTAINER" ]]; then
    err "No postgres container found. Is the stack running?"
    exit 1
  fi

  log "Restoring database from: $RESTORE_DB"
  warn "This will OVERWRITE the current database. Press Ctrl+C within 5 seconds to abort."
  sleep 5

  # Create a safety backup before restoring
  log "Creating safety backup before restore..."
  podman exec "$POSTGRES_CONTAINER" \
    pg_dump -U postgres --format=custom arche \
    > "${DATA_DIR}/backups/arche-pre-restore-$(date +%Y%m%d-%H%M%S).dump" || {
    warn "Safety backup failed — continuing with restore anyway."
  }

  log "Restoring database..."
  podman exec -i "$POSTGRES_CONTAINER" \
    pg_restore -U postgres -d arche --clean --if-exists < "$RESTORE_DB"

  log "Database restored successfully."
fi

# ---------------------------------------------------------------------------
# Rollback web version (blue-green swap)
# ---------------------------------------------------------------------------
if [[ -n "$ROLLBACK_VERSION" ]]; then
  log "Rolling back web to version: $ROLLBACK_VERSION"

  # Pull the target version
  log "Pulling image: ${IMAGE_PREFIX}web:${ROLLBACK_VERSION}"
  podman pull "${IMAGE_PREFIX}web:${ROLLBACK_VERSION}"

  # Find all existing web containers (may include zombies from failed deploys)
  OLD_WEBS=()
  while IFS= read -r c; do
    [[ -n "$c" ]] && OLD_WEBS+=("$c")
  done < <(find_all_webs)

  if [[ ${#OLD_WEBS[@]} -gt 0 ]]; then
    log "Current web container(s): ${OLD_WEBS[*]}"
  else
    warn "No current web container found — doing a fresh start"
  fi

  # Detect networks
  COMPOSE_NETWORK=$(detect_compose_network)
  COMPOSE_NETWORK="${COMPOSE_NETWORK:-arche_default}"
  log "Using compose network: $COMPOSE_NETWORK"

  # Generate a unique name
  NEW_WEB="arche-web-$(date +%s)-$(openssl rand -hex 2)"

  # Read the .env file to determine deploy mode labels
  DOMAIN=$(grep '^ARCHE_DOMAIN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || echo "")
  if [[ -z "$DOMAIN" ]]; then
    err "Cannot determine ARCHE_DOMAIN from $ENV_FILE"
    exit 1
  fi

  # Determine entrypoint - check existing web containers first, then fall back to ARCHE_COOKIE_SECURE
  # If there are running web containers, inspect their labels to match the current configuration
  EXISTING_ENTRYPOINT=$(
    {
      podman ps --filter label=arche.role=web --filter label=traefik.http.routers.arche-base.entrypoints=websecure --format '{{.Names}}'
      podman ps --filter label=com.docker.compose.project=arche --filter label=com.docker.compose.service=web --filter label=traefik.http.routers.arche-base.entrypoints=websecure --format '{{.Names}}'
    } | sed '/^$/d' | head -1
  )
  if [[ -n "$EXISTING_ENTRYPOINT" ]]; then
    ENTRYPOINT="websecure"
    log "Detected TLS mode from existing container: $EXISTING_ENTRYPOINT"
  else
    # Fall back to checking ARCHE_COOKIE_SECURE from .env
    COOKIE_SECURE=$(grep '^ARCHE_COOKIE_SECURE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || echo "false")
    if [[ "$COOKIE_SECURE" == "true" ]]; then
      ENTRYPOINT="websecure"
    else
      ENTRYPOINT="web"
    fi
  fi

  # Build volume args
  VOLUME_ARGS=()
  USERS_PATH=$(grep '^ARCHE_USERS_PATH=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || echo "/opt/arche/users")
  VOLUME_ARGS+=(-v "${USERS_PATH}:${USERS_PATH}")

  KB_CONTENT=$(grep '^KB_CONTENT_HOST_PATH=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || echo "")
  KB_CONFIG=$(grep '^KB_CONFIG_HOST_PATH=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || echo "")
  if [[ -n "$KB_CONTENT" && -n "$KB_CONFIG" ]]; then
    VOLUME_ARGS+=(-v "${KB_CONTENT}:/kb-content" -v "${KB_CONFIG}:/kb-config")
  fi

  # Build Traefik labels
  TRAEFIK_LABELS=(
    --label traefik.enable=true
    --label "traefik.http.routers.arche-base.rule=Host(\`${DOMAIN}\`)"
    --label "traefik.http.routers.arche-base.entrypoints=${ENTRYPOINT}"
    --label traefik.http.routers.arche-base.service=arche-web
    --label traefik.http.services.arche-web.loadbalancer.server.port=3000
    --label traefik.http.services.arche-web.loadbalancer.healthcheck.path=/api/health
    --label traefik.http.services.arche-web.loadbalancer.healthcheck.interval=5s
    --label traefik.http.services.arche-web.loadbalancer.healthcheck.timeout=3s
    --label "traefik.docker.network=${COMPOSE_NETWORK}"
    --label arche.role=web
    --label "arche.version=${ROLLBACK_VERSION}"
  )

  # Add TLS labels for remote/websecure mode
  if [[ "$ENTRYPOINT" == "websecure" ]]; then
    TRAEFIK_LABELS+=(
      --label traefik.http.routers.arche-base.tls=true
      --label traefik.http.routers.arche-base.tls.certresolver=letsencrypt
    )
  fi

  # Start new container (blue-green)
  log "Starting new container: $NEW_WEB"
  podman run -d \
    --name "$NEW_WEB" \
    --env-file "$ENV_FILE" \
    --network arche-internal \
    --network "$COMPOSE_NETWORK" \
    "${VOLUME_ARGS[@]}" \
    "${TRAEFIK_LABELS[@]}" \
    --restart on-failure:5 \
    "${IMAGE_PREFIX}web:${ROLLBACK_VERSION}"

  # Wait for health check
  log "Waiting for new container to pass health check..."
  RETRIES=24
  until podman exec "$NEW_WEB" \
    node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))" 2>/dev/null; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
      err "New container failed health check after 120 seconds."
      err "Removing failed container and keeping old one(s)..."
      podman rm -f "$NEW_WEB" 2>/dev/null || true
      err "Rollback failed. Old container(s) still serving: ${OLD_WEBS[*]:-none}"
      exit 1
    fi
    sleep 5
  done

  # Stop all old containers
  for old in "${OLD_WEBS[@]}"; do
    log "Stopping old container: $old"
    podman stop -t 10 "$old" 2>/dev/null || true
    podman rm "$old" 2>/dev/null || true
  done

  # Record version
  echo "$ROLLBACK_VERSION" > "${APP_DIR}/.current-version"

  log "Rollback to ${ROLLBACK_VERSION} complete. Container: $NEW_WEB"
fi

log "Done."

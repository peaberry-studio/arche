#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: start-stack.sh <runtime-root>" >&2
  exit 1
fi

source "$RUNTIME_ROOT/vm/macos/common.sh"

emit_progress() {
  printf 'ARCHE_PROGRESS|%s|%s\n' "$1" "$2"
}

emit_progress "prepare" "Validating runtime dependencies"
require_tools
ensure_ssh_key
ensure_ignition
emit_progress "vm_disk" "Provisioning VM disk image"
ensure_vm_disk
emit_progress "vm_boot" "Booting virtual machine"
start_gvproxy
start_vfkit
wait_for_ssh

IMAGE_ARTIFACT_DIR="$RUNTIME_ROOT/artifacts/images"
HOST_IMAGE_CACHE_DIR="$VM_DIR/image-cache"
mkdir -p "$HOST_IMAGE_CACHE_DIR"

ensure_host_image_tar() {
  local image="$1"
  local tar_name="$2"
  local tar_path="$HOST_IMAGE_CACHE_DIR/$tar_name"

  if [[ -f "$IMAGE_ARTIFACT_DIR/$tar_name" ]]; then
    local src_size dst_size
    src_size="$(stat -f%z "$IMAGE_ARTIFACT_DIR/$tar_name" 2>/dev/null || echo 0)"
    dst_size="$(stat -f%z "$tar_path" 2>/dev/null || echo -1)"
    if [[ "$src_size" != "$dst_size" ]]; then
      cp "$IMAGE_ARTIFACT_DIR/$tar_name" "$tar_path"
    fi
    echo "$tar_path"
    return
  fi

  if [[ -f "$tar_path" && -s "$tar_path" ]]; then
    echo "$tar_path"
    return
  fi

  if ! command -v podman >/dev/null 2>&1; then
    echo "missing bundled image artifact and podman unavailable: $tar_name" >&2
    return 1
  fi

  if ! podman image exists "$image"; then
    echo "missing local image: $image" >&2
    return 1
  fi

  podman save -o "$tar_path" "$image"
  echo "$tar_path"
}

load_remote_image_if_missing() {
  local image="$1"
  local tar_name="$2"

  if with_vm_ssh "podman image exists $image" >/dev/null 2>&1; then
    return
  fi

  local tar_path=""
  if tar_path="$(ensure_host_image_tar "$image" "$tar_name")"; then
    if scp -i "$SSH_KEY" -P "$SSH_PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
         "$tar_path" core@127.0.0.1:/var/home/core/ \
       && with_vm_ssh "podman load -i /var/home/core/$tar_name"; then
      with_vm_ssh "rm -f /var/home/core/$tar_name" || true
      return
    fi
    with_vm_ssh "rm -f /var/home/core/$tar_name" 2>/dev/null || true
    echo "warning: failed to load bundled image '$tar_name'; falling back to registry pull for $image" >&2
  fi

  with_vm_ssh "podman pull $image"
}

emit_progress "images" "Loading runtime container images"
load_remote_image_if_missing "arche-web:desktop" "arche-web-desktop.tar"
load_remote_image_if_missing "arche-workspace:desktop" "arche-workspace-desktop.tar"
load_remote_image_if_missing "postgres:16" "postgres-16.tar"
load_remote_image_if_missing "docker.io/alpine/socat:1.8.0.3" "alpine-socat-1.8.0.3.tar"

emit_progress "services" "Starting desktop services inside VM"
with_vm_ssh "mkdir -p /var/home/core/arche/data/users /var/home/core/arche/data/kb-content /var/home/core/arche/data/kb-config"

with_vm_ssh "bash -s" <<'EOF'
set -euo pipefail

init_bare_repo() {
  local dest="$1"
  if git --git-dir="$dest" rev-parse --is-bare-repository >/dev/null 2>&1; then
    return
  fi

  mkdir -p "$(dirname "$dest")"
  git init --bare --initial-branch=main "$dest"
  git --git-dir="$dest" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true
}

init_bare_repo /var/home/core/arche/data/kb-content
init_bare_repo /var/home/core/arche/data/kb-config

systemctl --user enable --now podman.socket

podman network exists arche-internal || podman network create arche-internal
podman network exists arche-desktop-default || podman network create arche-desktop-default
podman volume exists arche_desktop_postgres || podman volume create arche_desktop_postgres

podman rm -f arche-desktop-web arche-desktop-postgres arche-desktop-docker-socket-proxy >/dev/null 2>&1 || true

podman run -d --name arche-desktop-docker-socket-proxy \
  --restart unless-stopped \
  --network arche-internal \
  --security-opt label=disable \
  -v /run/user/1000/podman/podman.sock:/var/run/docker.sock:ro \
  docker.io/alpine/socat:1.8.0.3 \
  TCP-LISTEN:2375,reuseaddr,fork \
  UNIX-CONNECT:/var/run/docker.sock

podman run -d --name arche-desktop-postgres \
  --restart unless-stopped \
  --network arche-desktop-default \
  -e POSTGRES_DB=arche \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -v arche_desktop_postgres:/var/lib/postgresql/data \
  postgres:16

for _ in $(seq 1 60); do
  if podman exec arche-desktop-postgres pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

SECRETS_FILE=/var/home/core/arche/data/.desktop-secrets
if [ ! -f "$SECRETS_FILE" ]; then
  cat > "$SECRETS_FILE" <<SECRETS
ARCHE_SESSION_PEPPER=$(openssl rand -base64 32)
ARCHE_ENCRYPTION_KEY=$(openssl rand -base64 32)
ARCHE_CONNECTOR_OAUTH_STATE_SECRET=$(openssl rand -base64 32)
ARCHE_GATEWAY_TOKEN_SECRET=$(openssl rand -base64 32)
SECRETS
  chmod 600 "$SECRETS_FILE"
fi

set -a
. "$SECRETS_FILE"
set +a

podman run -d --name arche-desktop-web \
  --restart unless-stopped \
  --network arche-desktop-default \
  -p 4510:3000 \
  -e DATABASE_URL=postgresql://postgres:postgres@arche-desktop-postgres:5432/arche?schema=public \
  -e ARCHE_DOMAIN=127.0.0.1 \
  -e ARCHE_PUBLIC_BASE_URL=http://127.0.0.1:4510 \
  -e ARCHE_COOKIE_SECURE=false \
  -e ARCHE_SESSION_PEPPER="$ARCHE_SESSION_PEPPER" \
  -e ARCHE_ENCRYPTION_KEY="$ARCHE_ENCRYPTION_KEY" \
  -e ARCHE_CONNECTOR_OAUTH_STATE_SECRET="$ARCHE_CONNECTOR_OAUTH_STATE_SECRET" \
  -e ARCHE_GATEWAY_TOKEN_SECRET="$ARCHE_GATEWAY_TOKEN_SECRET" \
  -e ARCHE_SEED_ADMIN_EMAIL=admin@example.com \
  -e ARCHE_SEED_ADMIN_PASSWORD=change-me \
  -e ARCHE_SEED_ADMIN_SLUG=admin \
  -e CONTAINER_PROXY_HOST=arche-desktop-docker-socket-proxy \
  -e CONTAINER_PROXY_PORT=2375 \
  -e OPENCODE_IMAGE=arche-workspace:desktop \
  -e OPENCODE_NETWORK=arche-internal \
  -e KB_CONTENT_HOST_PATH=/opt/arche/kb-content \
  -e KB_CONFIG_HOST_PATH=/opt/arche/kb-config \
  -e ARCHE_USERS_PATH=/opt/arche/users \
  -v /var/home/core/arche/data/kb-content:/kb-content \
  -v /var/home/core/arche/data/kb-config:/kb-config \
  -v /var/home/core/arche/data/users:/opt/arche/users \
  arche-web:desktop

podman network connect arche-internal arche-desktop-web || true

podman exec arche-desktop-web pnpm prisma migrate deploy
podman exec arche-desktop-web pnpm prisma db seed || true
EOF

ensure_local_tunnel

emit_progress "health" "Waiting for Arche healthcheck"
for _ in {1..90}; do
  if curl -fsS "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1; then
    emit_progress "ready" "Arche runtime is ready"
    echo "{\"ok\":true,\"url\":\"http://127.0.0.1:$WEB_PORT\"}"
    exit 0
  fi
  sleep 2
done

echo "vm started but web healthcheck failed" >&2
exit 1

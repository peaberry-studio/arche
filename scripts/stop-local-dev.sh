#!/usr/bin/env bash
set -euo pipefail

# Stop everything Arche runs locally: the compose stack (project "arche",
# regardless of which compose file started it) and any spawned workspace
# containers (label arche.managed=true).
#
# Less aggressive than "./infra/deploy/deploy.sh --local-dev-down":
#   - keeps named volumes (Postgres data, node_modules, .next, pnpm store)
#   - keeps images (arche-workspace, node, ...)
#   - keeps networks (arche_default, arche-internal)
#
# Usage:
#   scripts/stop-local-dev.sh
#   scripts/stop-local-dev.sh --stop-podman-machine   # also stop the idle Podman machine

if ! command -v podman >/dev/null 2>&1; then
  echo "ERROR: podman not found in PATH." >&2
  exit 1
fi

STOP_PODMAN_MACHINE=false
if [[ "${1:-}" == "--stop-podman-machine" ]]; then
  STOP_PODMAN_MACHINE=true
elif [[ -n "${1:-}" ]]; then
  echo "ERROR: unknown argument: $1" >&2
  echo "Usage: $0 [--stop-podman-machine]" >&2
  exit 1
fi

# Compose stack containers (project "arche"). Match both the docker-compose
# (external provider) and podman-compose label families.
compose_containers=()
while IFS= read -r line; do
  [[ -n "$line" ]] && compose_containers+=("$line")
done < <(podman ps -a --filter label=com.docker.compose.project=arche --format '{{.ID}}' 2>/dev/null || true)
while IFS= read -r line; do
  [[ -n "$line" ]] && compose_containers+=("$line")
done < <(podman ps -a --filter label=io.podman.compose.project=arche --format '{{.ID}}' 2>/dev/null || true)

# Spawned workspace containers (managed by the app spawner).
workspace_containers=()
while IFS= read -r line; do
  [[ -n "$line" ]] && workspace_containers+=("$line")
done < <(podman ps -a --filter label=arche.managed=true --format '{{.ID}}' 2>/dev/null || true)

# Combine and deduplicate (bash 3.2 compatible: no mapfile, guard empty arrays).
containers=()
while IFS= read -r line; do
  [[ -n "$line" ]] && containers+=("$line")
done < <(printf '%s\n' \
  ${compose_containers[@]+"${compose_containers[@]}"} \
  ${workspace_containers[@]+"${workspace_containers[@]}"} \
  | sort -u)

if [[ ${#containers[@]} -eq 0 ]]; then
  echo "No Arche containers running; nothing to stop."
else
  echo "Stopping ${#containers[@]} Arche container(s)..."
  for id in "${containers[@]}"; do
    name="$(podman ps -a --filter id="$id" --format '{{.Names}}' 2>/dev/null || echo "$id")"
    echo "  stopping $name"
    podman stop -t 10 "$id" >/dev/null 2>&1 || true
    podman rm -f "$id" >/dev/null 2>&1 || true
  done
  echo "All Arche containers stopped and removed."
  echo "Volumes, images and networks were kept."
fi

if $STOP_PODMAN_MACHINE; then
  if [[ -z "$(podman ps -q 2>/dev/null || true)" ]] && podman machine inspect &>/dev/null; then
    machine_name="$(podman machine list --format '{{.Name}} {{.Running}}' | awk '$2=="true"{print $1}' | head -n 1)"
    if [[ -n "$machine_name" ]]; then
      echo "Stopping idle podman machine: $machine_name"
      podman machine stop "$machine_name" || true
    fi
  fi
fi

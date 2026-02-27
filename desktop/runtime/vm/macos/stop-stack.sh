#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: stop-stack.sh <runtime-root>" >&2
  exit 1
fi

source "$RUNTIME_ROOT/vm/macos/common.sh"

stop_tunnel

if pid_running "$VFKIT_PID"; then
  with_vm_ssh "podman rm -f arche-desktop-web arche-desktop-postgres arche-desktop-docker-socket-proxy >/dev/null 2>&1 || true" || true
fi

stop_vm

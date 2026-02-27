#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: logs-stack.sh <runtime-root>" >&2
  exit 1
fi

source "$RUNTIME_ROOT/vm/macos/common.sh"

echo "== Host: vfkit =="
tail -n 120 "$VFKIT_LOG" 2>/dev/null || true
echo ""
echo "== Host: gvproxy =="
tail -n 120 "$GVPROXY_LOG" 2>/dev/null || true

if pid_running "$VFKIT_PID"; then
  echo ""
  echo "== Guest: containers =="
  with_vm_ssh "podman ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'" || true
  echo ""
  echo "== Guest: web logs =="
  with_vm_ssh "podman logs --tail 120 arche-desktop-web" || true
fi

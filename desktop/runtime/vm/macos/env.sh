#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${1:-}"

if [[ -z "$RUNTIME_ROOT" ]]; then
  echo "usage: env.sh <runtime-root>" >&2
  exit 1
fi

APP_SUPPORT_DIR="${ARCHE_DESKTOP_APP_SUPPORT:-$HOME/Library/Application Support/ArcheDesktop}"
VM_DIR="${ARCHE_DESKTOP_VM_DIR:-$APP_SUPPORT_DIR/vm}"
DATA_DIR="${ARCHE_DESKTOP_DATA_DIR:-$APP_SUPPORT_DIR/data}"

VM_NAME="arche-desktop"
SSH_PORT="${ARCHE_DESKTOP_VM_SSH_PORT:-22243}"
WEB_PORT="${ARCHE_DESKTOP_WEB_PORT:-4510}"

VM_BASE_ZST="$VM_DIR/podman-machine.aarch64.applehv.raw.zst"
VM_BASE_RAW="$VM_DIR/base.raw"
VM_DISK="$VM_DIR/$VM_NAME.raw"
EFI_STORE="$VM_DIR/$VM_NAME.efi"

# Keep vfkit/gvproxy unix socket paths short and without spaces.
# macOS unix domain sockets have strict path length limits.
NET_DIR="${ARCHE_DESKTOP_VM_NET_DIR:-/tmp/arche-desktop-vm}"
NET_SOCK="$NET_DIR/$VM_NAME.sock"

GVPROXY_LOG="$VM_DIR/gvproxy.log"
GVPROXY_PID="$VM_DIR/gvproxy.pid"
VFKIT_LOG="$VM_DIR/vfkit.log"
VFKIT_PID="$VM_DIR/vfkit.pid"
TUNNEL_PID="$VM_DIR/ssh-tunnel.pid"

SSH_KEY="$VM_DIR/id_ed25519"
SSH_PUB="$VM_DIR/id_ed25519.pub"
IGNITION_FILE="$VM_DIR/ignition.json"

export APP_SUPPORT_DIR
export VM_DIR
export DATA_DIR
export VM_NAME
export SSH_PORT
export WEB_PORT
export VM_BASE_ZST
export VM_BASE_RAW
export VM_DISK
export EFI_STORE
export NET_DIR
export NET_SOCK
export GVPROXY_LOG
export GVPROXY_PID
export VFKIT_LOG
export VFKIT_PID
export TUNNEL_PID
export SSH_KEY
export SSH_PUB
export IGNITION_FILE

mkdir -p "$VM_DIR" "$DATA_DIR" "$DATA_DIR/users"
mkdir -p "$NET_DIR"

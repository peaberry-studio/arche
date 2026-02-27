#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${RUNTIME_ROOT:-}" ]]; then
  echo "RUNTIME_ROOT is required" >&2
  exit 1
fi

source "$RUNTIME_ROOT/vm/macos/env.sh" "$RUNTIME_ROOT"

EMBEDDED_BIN_DIR="$RUNTIME_ROOT/artifacts/bin"

default_vfkit_bin="/opt/podman/bin/vfkit"
default_gvproxy_bin="/opt/podman/bin/gvproxy"

if [[ -x "$EMBEDDED_BIN_DIR/vfkit" ]]; then
  default_vfkit_bin="$EMBEDDED_BIN_DIR/vfkit"
fi

if [[ -x "$EMBEDDED_BIN_DIR/gvproxy" ]]; then
  default_gvproxy_bin="$EMBEDDED_BIN_DIR/gvproxy"
fi

VFKIT_BIN="${ARCHE_DESKTOP_VFKIT_BIN:-$default_vfkit_bin}"
GVPROXY_BIN="${ARCHE_DESKTOP_GVPROXY_BIN:-$default_gvproxy_bin}"

VM_IMAGE_URL_DEFAULT="https://github.com/containers/podman-machine-os/releases/download/v5.8.0/podman-machine.aarch64.applehv.raw.zst"
VM_IMAGE_URL="${ARCHE_DESKTOP_VM_IMAGE_URL:-$VM_IMAGE_URL_DEFAULT}"

pid_running() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  kill -0 "$pid" >/dev/null 2>&1
}

require_tools() {
  local missing=0
  for bin in "$VFKIT_BIN" "$GVPROXY_BIN" ssh ssh-keygen scp curl zstd; do
    if [[ "$bin" == /* ]]; then
      if [[ ! -x "$bin" ]]; then
        echo "missing runtime binary: $bin" >&2
        missing=1
      fi
      continue
    fi
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "missing tool: $bin" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

ensure_ssh_key() {
  if [[ -f "$SSH_KEY" && -f "$SSH_PUB" ]]; then
    return
  fi
  ssh-keygen -t ed25519 -N "" -f "$SSH_KEY" >/dev/null
}

ensure_ignition() {
  local pub
  pub="$(cat "$SSH_PUB")"
  cat > "$IGNITION_FILE" <<EOF
{
  "ignition": { "version": "3.4.0" },
  "passwd": {
    "users": [
      {
        "name": "core",
        "sshAuthorizedKeys": ["$pub"]
      }
    ]
  }
}
EOF
}

locate_seed_zst() {
  if [[ -f "$VM_BASE_ZST" ]]; then
    echo "$VM_BASE_ZST"
    return
  fi

  local cached
  cached="$(ls "$HOME/.local/share/containers/podman/machine/libkrun/cache"/*.raw.zst 2>/dev/null | head -n 1 || true)"
  if [[ -n "$cached" && -f "$cached" ]]; then
    cp "$cached" "$VM_BASE_ZST"
    echo "$VM_BASE_ZST"
    return
  fi

  echo "downloading base VM image..."
  curl -fL --retry 3 --retry-delay 2 "$VM_IMAGE_URL" -o "$VM_BASE_ZST"
  echo "$VM_BASE_ZST"
}

ensure_vm_disk() {
  if [[ -f "$VM_DISK" ]]; then
    return
  fi

  local seed
  seed="$(locate_seed_zst)"

  if [[ ! -f "$VM_BASE_RAW" ]]; then
    echo "decompressing base VM image..."
    zstd -d -f "$seed" -o "$VM_BASE_RAW"
  fi

  cp -c "$VM_BASE_RAW" "$VM_DISK" 2>/dev/null || cp "$VM_BASE_RAW" "$VM_DISK"
}

start_gvproxy() {
  if pid_running "$GVPROXY_PID"; then
    return
  fi

  rm -f "$NET_SOCK"

  nohup "$GVPROXY_BIN" \
    --mtu 1500 \
    --ssh-port "$SSH_PORT" \
    --listen-vfkit "unixgram://$NET_SOCK" \
    --log-file "$GVPROXY_LOG" \
    --pid-file "$GVPROXY_PID" >/dev/null 2>&1 &

  sleep 1
  if ! pid_running "$GVPROXY_PID"; then
    echo "failed to start gvproxy" >&2
    exit 1
  fi
}

start_vfkit() {
  if pid_running "$VFKIT_PID"; then
    return
  fi

  nohup "$VFKIT_BIN" \
    --cpus 4 \
    --memory 6144 \
    --bootloader "efi,variable-store=$EFI_STORE,create" \
    --ignition "$IGNITION_FILE" \
    --device "virtio-blk,path=$VM_DISK" \
    --device "virtio-serial,logFilePath=$VFKIT_LOG" \
    --device "virtio-net,unixSocketPath=$NET_SOCK,mac=5a:94:ef:e4:0c:ee" \
    --device "virtio-rng" >/dev/null 2>&1 &

  echo $! > "$VFKIT_PID"
}

wait_for_ssh() {
  for _ in {1..120}; do
    if ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 -p "$SSH_PORT" core@127.0.0.1 true >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  echo "vm ssh did not become ready" >&2
  exit 1
}

with_vm_ssh() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "$SSH_PORT" core@127.0.0.1 "$@"
}

ensure_local_tunnel() {
  if pid_running "$TUNNEL_PID"; then
    return
  fi

  nohup ssh -i "$SSH_KEY" \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -N \
    -L "$WEB_PORT:127.0.0.1:$WEB_PORT" \
    -p "$SSH_PORT" \
    core@127.0.0.1 >/dev/null 2>&1 &

  echo $! > "$TUNNEL_PID"
}

stop_tunnel() {
  if pid_running "$TUNNEL_PID"; then
    kill "$(cat "$TUNNEL_PID")" >/dev/null 2>&1 || true
  fi
  rm -f "$TUNNEL_PID"
}

stop_vm() {
  if pid_running "$VFKIT_PID"; then
    kill "$(cat "$VFKIT_PID")" >/dev/null 2>&1 || true
  fi
  rm -f "$VFKIT_PID"

  if pid_running "$GVPROXY_PID"; then
    kill "$(cat "$GVPROXY_PID")" >/dev/null 2>&1 || true
  fi
  rm -f "$GVPROXY_PID"
}

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
default_zstd_bin="zstd"

if [[ -x "$EMBEDDED_BIN_DIR/vfkit" ]]; then
  default_vfkit_bin="$EMBEDDED_BIN_DIR/vfkit"
fi

if [[ -x "$EMBEDDED_BIN_DIR/gvproxy" ]]; then
  default_gvproxy_bin="$EMBEDDED_BIN_DIR/gvproxy"
fi

if [[ -x "$EMBEDDED_BIN_DIR/zstd" ]]; then
  if "$EMBEDDED_BIN_DIR/zstd" --version >/dev/null 2>&1; then
    default_zstd_bin="$EMBEDDED_BIN_DIR/zstd"
  fi
fi

VFKIT_BIN="${ARCHE_DESKTOP_VFKIT_BIN:-$default_vfkit_bin}"
GVPROXY_BIN="${ARCHE_DESKTOP_GVPROXY_BIN:-$default_gvproxy_bin}"
ZSTD_BIN="${ARCHE_DESKTOP_ZSTD_BIN:-$default_zstd_bin}"

VM_IMAGE_URL_DEFAULT="https://github.com/containers/podman-machine-os/releases/download/v5.8.0/podman-machine.aarch64.applehv.raw.zst"
VM_IMAGE_URL="${ARCHE_DESKTOP_VM_IMAGE_URL:-$VM_IMAGE_URL_DEFAULT}"

detect_vm_resources() {
  local total_mem_mb
  total_mem_mb="$(( $(sysctl -n hw.memsize) / 1048576 ))"
  local total_cpus
  total_cpus="$(sysctl -n hw.logicalcpu)"

  local default_mem=$((total_mem_mb / 2))
  if (( default_mem < 2048 )); then default_mem=2048
  elif (( default_mem > 8192 )); then default_mem=8192; fi

  local default_cpus=$((total_cpus / 2))
  if (( default_cpus < 2 )); then default_cpus=2; fi

  VM_MEMORY="${ARCHE_DESKTOP_VM_MEMORY:-$default_mem}"
  VM_CPUS="${ARCHE_DESKTOP_VM_CPUS:-$default_cpus}"
}

detect_vm_resources

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

persist_ssh_port() {
  printf '%s\n' "$SSH_PORT" > "$SSH_PORT_FILE"
}

port_is_listening() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -Eq "[\\.:]$port[[:space:]].*LISTEN"
    return
  fi

  return 1
}

next_available_ssh_port() {
  local start_port="$1"
  local candidate="$start_port"
  local upper_bound=$((start_port + 200))

  while (( candidate <= upper_bound )); do
    if ! port_is_listening "$candidate"; then
      echo "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
  done

  return 1
}

start_gvproxy_once() {
  local port="$1"

  rm -f "$NET_SOCK" "$GVPROXY_PID"
  : > "$GVPROXY_LOG"

  nohup "$GVPROXY_BIN" \
    --mtu 1500 \
    --ssh-port "$port" \
    --listen-vfkit "unixgram://$NET_SOCK" \
    --log-file "$GVPROXY_LOG" \
    --pid-file "$GVPROXY_PID" >/dev/null 2>&1 &

  sleep 1
  pid_running "$GVPROXY_PID"
}

require_tools() {
  local missing=0
  for bin in "$VFKIT_BIN" "$GVPROXY_BIN" "$ZSTD_BIN" ssh ssh-keygen scp curl; do
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

copy_seed_from_podman_cache() {
  local cache_dirs=(
    "$HOME/.local/share/containers/podman/machine/applehv/cache"
    "$HOME/.local/share/containers/podman/machine/libkrun/cache"
  )
  local cache_dir
  local candidate

  for cache_dir in "${cache_dirs[@]}"; do
    if [[ ! -d "$cache_dir" ]]; then
      continue
    fi

    for candidate in "$cache_dir"/*.raw.zst; do
      if [[ ! -f "$candidate" ]]; then
        continue
      fi
      cp -c "$candidate" "$VM_BASE_ZST" 2>/dev/null || cp "$candidate" "$VM_BASE_ZST"
      return 0
    done
  done

  return 1
}

copy_base_raw_from_podman_machine() {
  local machine_dirs=(
    "$HOME/.local/share/containers/podman/machine/applehv"
    "$HOME/.local/share/containers/podman/machine/libkrun"
  )
  local machine_dir
  local candidate

  for machine_dir in "${machine_dirs[@]}"; do
    if [[ ! -d "$machine_dir" ]]; then
      continue
    fi

    for candidate in "$machine_dir"/*.raw; do
      if [[ ! -f "$candidate" ]]; then
        continue
      fi
      cp -c "$candidate" "$VM_BASE_RAW" 2>/dev/null || cp "$candidate" "$VM_BASE_RAW"
      return 0
    done
  done

  return 1
}

download_seed_zst() {
  local temp_path="$VM_BASE_ZST.download"

  rm -f "$temp_path"
  if ! curl -fL --retry 10 --retry-delay 2 --retry-all-errors "$VM_IMAGE_URL" -o "$temp_path"; then
    rm -f "$temp_path"
    return 1
  fi

  if [[ ! -s "$temp_path" ]]; then
    rm -f "$temp_path"
    return 1
  fi

  mv "$temp_path" "$VM_BASE_ZST"
}

locate_seed_zst() {
  if [[ -f "$VM_BASE_ZST" && ! -s "$VM_BASE_ZST" ]]; then
    rm -f "$VM_BASE_ZST"
  fi

  if [[ -s "$VM_BASE_ZST" ]]; then
    echo "$VM_BASE_ZST"
    return 0
  fi

  if copy_seed_from_podman_cache; then
    echo "$VM_BASE_ZST"
    return 0
  fi

  echo "downloading base VM image..." >&2
  if ! download_seed_zst; then
    echo "failed to download base VM image from $VM_IMAGE_URL" >&2
    return 1
  fi

  echo "$VM_BASE_ZST"
}

ensure_vm_disk() {
  if [[ -f "$VM_DISK" && -s "$VM_DISK" ]]; then
    return
  fi

  if [[ -f "$VM_BASE_RAW" && ! -s "$VM_BASE_RAW" ]]; then
    rm -f "$VM_BASE_RAW"
  fi

  if [[ ! -s "$VM_BASE_RAW" ]]; then
    if ! copy_base_raw_from_podman_machine; then
      local seed
      if ! seed="$(locate_seed_zst)"; then
        echo "failed to provision base VM image" >&2
        exit 1
      fi

      echo "decompressing base VM image..."
      if ! "$ZSTD_BIN" -d -f "$seed" -o "$VM_BASE_RAW"; then
        rm -f "$VM_BASE_RAW"
        echo "failed to decompress base VM image: $seed" >&2
        exit 1
      fi
    fi
  fi

  cp -c "$VM_BASE_RAW" "$VM_DISK" 2>/dev/null || cp "$VM_BASE_RAW" "$VM_DISK"

  # Clean up decompressed base image (~7-10 GB); the .zst (~700 MB) is
  # kept as a compact recovery source for future re-provisioning.
  rm -f "$VM_BASE_RAW"
}

start_gvproxy() {
  if pid_running "$GVPROXY_PID"; then
    if port_is_listening "$SSH_PORT"; then
      persist_ssh_port
      return
    fi

    kill "$(cat "$GVPROXY_PID")" >/dev/null 2>&1 || true
    rm -f "$GVPROXY_PID"
  fi

  local try_port="$SSH_PORT"
  local max_attempts=8
  local attempt=1

  while (( attempt <= max_attempts )); do
    if start_gvproxy_once "$try_port"; then
      SSH_PORT="$try_port"
      persist_ssh_port
      return
    fi

    if ! grep -q "address already in use" "$GVPROXY_LOG" 2>/dev/null; then
      echo "failed to start gvproxy" >&2
      exit 1
    fi

    local next_port
    if ! next_port="$(next_available_ssh_port "$((try_port + 1))")"; then
      echo "failed to find free SSH port for gvproxy" >&2
      exit 1
    fi

    echo "gvproxy SSH port $try_port is busy; retrying with $next_port" >&2
    try_port="$next_port"
    attempt=$((attempt + 1))
  done

  echo "failed to start gvproxy after retrying alternative SSH ports" >&2
  exit 1
}

start_vfkit() {
  if pid_running "$VFKIT_PID"; then
    return
  fi

  nohup "$VFKIT_BIN" \
    --cpus "$VM_CPUS" \
    --memory "$VM_MEMORY" \
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
  echo "vm ssh did not become ready on port $SSH_PORT" >&2
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

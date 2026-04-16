#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/apps/desktop/bin"
OPENCODE_VERSION_FILE="$ROOT_DIR/versions/opencode.version"
NODE_VERSION_FILE="$ROOT_DIR/.node-version"
OPENCODE_CONFIG_SOURCE_DIR="$ROOT_DIR/infra/workspace-image/opencode-config"
OPENCODE_CONFIG_OUTPUT_DIR="$OUTPUT_DIR/opencode-config"

read_supported_node_major() {
  if [[ ! -f "$NODE_VERSION_FILE" ]]; then
    echo "Error: Missing Node version file at $NODE_VERSION_FILE" >&2
    exit 1
  fi

  local configured_version
  configured_version="$(tr -d '[:space:]' < "$NODE_VERSION_FILE")"

  if [[ "$configured_version" =~ ^([0-9]+)(\..*)?$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi

  echo "Error: Unsupported Node version format in $NODE_VERSION_FILE: $configured_version" >&2
  exit 1
}

if [[ -n "${NODE_RUNTIME_VERSION:-}" ]]; then
  RESOLVED_NODE_RUNTIME_VERSION="$NODE_RUNTIME_VERSION"
else
  SUPPORTED_NODE_MAJOR="$(read_supported_node_major)"
  CURRENT_NODE_VERSION="$(node -p "process.versions.node")"
  CURRENT_NODE_MAJOR="${CURRENT_NODE_VERSION%%.*}"

  if [[ "$CURRENT_NODE_MAJOR" != "$SUPPORTED_NODE_MAJOR" ]]; then
    echo "Error: Active Node.js v$CURRENT_NODE_VERSION does not match supported major $SUPPORTED_NODE_MAJOR.x from $NODE_VERSION_FILE" >&2
    echo "       Switch to Node.js $SUPPORTED_NODE_MAJOR.x or set NODE_RUNTIME_VERSION explicitly." >&2
    exit 1
  fi

  # Desktop runs the packaged Next.js server with the bundled Node binary.
  # Keep that runtime ABI aligned with the Node version used to install native
  # dependencies for the standalone bundle (for example better-sqlite3).
  RESOLVED_NODE_RUNTIME_VERSION="$CURRENT_NODE_VERSION"
fi

if [[ -n "${OPENCODE_VERSION:-}" ]]; then
  RESOLVED_OPENCODE_VERSION="$OPENCODE_VERSION"
else
  if [[ ! -f "$OPENCODE_VERSION_FILE" ]]; then
    echo "Error: Missing OpenCode version file at $OPENCODE_VERSION_FILE" >&2
    exit 1
  fi
  RESOLVED_OPENCODE_VERSION="$(tr -d '[:space:]' < "$OPENCODE_VERSION_FILE")"
fi

if [[ -z "$RESOLVED_OPENCODE_VERSION" ]]; then
  echo "Error: OpenCode version is empty" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

prepare_opencode_config_dir() {
  if [[ ! -d "$OPENCODE_CONFIG_SOURCE_DIR" ]]; then
    echo "Error: Missing OpenCode config source dir at $OPENCODE_CONFIG_SOURCE_DIR" >&2
    exit 1
  fi

  local should_install=0

  if [[ ! -f "$OPENCODE_CONFIG_OUTPUT_DIR/package.json" ]] || \
    ! cmp -s "$OPENCODE_CONFIG_SOURCE_DIR/package.json" "$OPENCODE_CONFIG_OUTPUT_DIR/package.json"; then
    should_install=1
  fi

  mkdir -p "$OPENCODE_CONFIG_OUTPUT_DIR"
  cp "$OPENCODE_CONFIG_SOURCE_DIR/package.json" "$OPENCODE_CONFIG_OUTPUT_DIR/package.json"

  rm -rf "$OPENCODE_CONFIG_OUTPUT_DIR/shared"
  mkdir -p "$OPENCODE_CONFIG_OUTPUT_DIR/shared"
  cp "$OPENCODE_CONFIG_SOURCE_DIR/shared/"*.js "$OPENCODE_CONFIG_OUTPUT_DIR/shared/"

  rm -rf "$OPENCODE_CONFIG_OUTPUT_DIR/tools"
  mkdir -p "$OPENCODE_CONFIG_OUTPUT_DIR/tools"
  cp "$OPENCODE_CONFIG_SOURCE_DIR/tools/"*.js "$OPENCODE_CONFIG_OUTPUT_DIR/tools/"

  if [[ "${FORCE_DOWNLOAD:-0}" == "1" ]]; then
    rm -rf "$OPENCODE_CONFIG_OUTPUT_DIR/node_modules" "$OPENCODE_CONFIG_OUTPUT_DIR/package-lock.json"
    should_install=1
  fi

  if [[ ! -d "$OPENCODE_CONFIG_OUTPUT_DIR/node_modules" ]]; then
    should_install=1
  fi

  if [[ "$should_install" == "1" ]]; then
    (
      cd "$OPENCODE_CONFIG_OUTPUT_DIR"
      npm install --omit=dev
    )
  fi
}

echo "==> Preparing desktop runtime binaries"
echo "==> Using Node.js runtime v$RESOLVED_NODE_RUNTIME_VERSION"
bash "$SCRIPT_DIR/download-node.sh" "$RESOLVED_NODE_RUNTIME_VERSION" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/download-opencode.sh" "$RESOLVED_OPENCODE_VERSION" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/build-workspace-agent.sh" "$OUTPUT_DIR"
prepare_opencode_config_dir

echo "==> Desktop runtime binaries ready in $OUTPUT_DIR"

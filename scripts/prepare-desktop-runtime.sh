#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/apps/desktop/bin"
OPENCODE_VERSION_FILE="$ROOT_DIR/versions/opencode.version"
OPENCODE_V1_VERSION_FILE="$ROOT_DIR/versions/opencode-v1.version"
NODE_VERSION_FILE="$ROOT_DIR/.node-version"
ARCHE_TOOLS_SOURCE_DIR="$ROOT_DIR/infra/workspace-image/arche-tools"
ARCHE_TOOLS_OUTPUT_DIR="$OUTPUT_DIR/arche-tools"

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

if [[ ! -f "$OPENCODE_V1_VERSION_FILE" ]]; then
  echo "Error: Missing legacy OpenCode version file at $OPENCODE_V1_VERSION_FILE" >&2
  exit 1
fi
RESOLVED_OPENCODE_V1_VERSION="$(tr -d '[:space:]' < "$OPENCODE_V1_VERSION_FILE")"

if [[ "$RESOLVED_OPENCODE_VERSION" != 2.* || "$RESOLVED_OPENCODE_V1_VERSION" != "1.18.18" ]]; then
  echo "Error: Desktop requires OpenCode v2 and legacy OpenCode 1.18.18" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

prepare_arche_tools_dir() {
  if [[ ! -f "$ARCHE_TOOLS_SOURCE_DIR/server.js" ]]; then
    echo "Error: Missing Arche tools server at $ARCHE_TOOLS_SOURCE_DIR/server.js" >&2
    exit 1
  fi

  local should_install=0

  if [[ ! -f "$ARCHE_TOOLS_OUTPUT_DIR/package.json" ]] || \
    ! cmp -s "$ARCHE_TOOLS_SOURCE_DIR/package.json" "$ARCHE_TOOLS_OUTPUT_DIR/package.json" || \
    ! cmp -s "$ARCHE_TOOLS_SOURCE_DIR/pnpm-lock.yaml" "$ARCHE_TOOLS_OUTPUT_DIR/pnpm-lock.yaml"; then
    should_install=1
  fi

  mkdir -p "$ARCHE_TOOLS_OUTPUT_DIR"
  cp "$ARCHE_TOOLS_SOURCE_DIR/package.json" "$ARCHE_TOOLS_OUTPUT_DIR/package.json"
  cp "$ARCHE_TOOLS_SOURCE_DIR/pnpm-lock.yaml" "$ARCHE_TOOLS_OUTPUT_DIR/pnpm-lock.yaml"
  cp "$ARCHE_TOOLS_SOURCE_DIR/server.js" "$ARCHE_TOOLS_OUTPUT_DIR/server.js"

  rm -rf "$ARCHE_TOOLS_OUTPUT_DIR/shared"
  mkdir -p "$ARCHE_TOOLS_OUTPUT_DIR/shared"
  cp "$ARCHE_TOOLS_SOURCE_DIR/shared/"*.js "$ARCHE_TOOLS_OUTPUT_DIR/shared/"

  rm -rf "$ARCHE_TOOLS_OUTPUT_DIR/tools"
  mkdir -p "$ARCHE_TOOLS_OUTPUT_DIR/tools"
  cp "$ARCHE_TOOLS_SOURCE_DIR/tools/"*.js "$ARCHE_TOOLS_OUTPUT_DIR/tools/"

  if [[ "${FORCE_DOWNLOAD:-0}" == "1" ]]; then
    rm -rf "$ARCHE_TOOLS_OUTPUT_DIR/node_modules"
    should_install=1
  fi

  if [[ ! -d "$ARCHE_TOOLS_OUTPUT_DIR/node_modules" ]]; then
    should_install=1
  fi

  if [[ "$should_install" == "1" ]]; then
    (
      cd "$ARCHE_TOOLS_OUTPUT_DIR"
      pnpm install --prod --frozen-lockfile --ignore-scripts --node-linker=hoisted --store-dir "$OUTPUT_DIR/.pnpm-store"
    )
  fi
}

echo "==> Preparing desktop runtime binaries"
echo "==> Using Node.js runtime v$RESOLVED_NODE_RUNTIME_VERSION"
bash "$SCRIPT_DIR/download-node.sh" "$RESOLVED_NODE_RUNTIME_VERSION" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/download-opencode.sh" "$RESOLVED_OPENCODE_VERSION" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/download-opencode.sh" "$RESOLVED_OPENCODE_V1_VERSION" "$OUTPUT_DIR" "opencode-v1"
bash "$SCRIPT_DIR/build-workspace-agent.sh" "$OUTPUT_DIR"
prepare_arche_tools_dir

echo "==> Desktop runtime binaries ready in $OUTPUT_DIR"

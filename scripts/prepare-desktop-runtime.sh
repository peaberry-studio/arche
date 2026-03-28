#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/apps/desktop/bin"
OPENCODE_VERSION_FILE="$ROOT_DIR/versions/opencode.version"
OPENCODE_CONFIG_SOURCE_DIR="$ROOT_DIR/infra/workspace-image/opencode-config"
OPENCODE_CONFIG_OUTPUT_DIR="$OUTPUT_DIR/opencode-config"

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
bash "$SCRIPT_DIR/download-node.sh" "${NODE_RUNTIME_VERSION:-24.12.0}" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/download-opencode.sh" "$RESOLVED_OPENCODE_VERSION" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/build-workspace-agent.sh" "$OUTPUT_DIR"
prepare_opencode_config_dir

echo "==> Desktop runtime binaries ready in $OUTPUT_DIR"

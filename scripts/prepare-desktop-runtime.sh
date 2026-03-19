#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/apps/desktop/bin"
OPENCODE_VERSION_FILE="$ROOT_DIR/versions/opencode.version"

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

echo "==> Preparing desktop runtime binaries"
bash "$SCRIPT_DIR/download-node.sh" "${NODE_RUNTIME_VERSION:-24.12.0}" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/download-opencode.sh" "$RESOLVED_OPENCODE_VERSION" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/build-workspace-agent.sh" "$OUTPUT_DIR"

echo "==> Desktop runtime binaries ready in $OUTPUT_DIR"

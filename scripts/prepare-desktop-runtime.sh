#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/apps/desktop/bin"

mkdir -p "$OUTPUT_DIR"

echo "==> Preparing desktop runtime binaries"
bash "$SCRIPT_DIR/download-node.sh" "${NODE_RUNTIME_VERSION:-24.12.0}" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/download-opencode.sh" "${OPENCODE_VERSION:-1.2.24}" "$OUTPUT_DIR"
bash "$SCRIPT_DIR/build-workspace-agent.sh" "$OUTPUT_DIR"

echo "==> Desktop runtime binaries ready in $OUTPUT_DIR"

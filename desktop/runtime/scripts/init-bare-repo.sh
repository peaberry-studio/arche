#!/usr/bin/env bash
set -euo pipefail

DEST="${1:-}"

if [[ -z "$DEST" ]]; then
  echo "usage: init-bare-repo.sh <path>" >&2
  exit 1
fi

if git --git-dir="$DEST" rev-parse --is-bare-repository >/dev/null 2>&1; then
  exit 0
fi

if [[ -e "$DEST" && ! -d "$DEST" ]]; then
  echo "destination exists and is not a directory: $DEST" >&2
  exit 1
fi

if [[ -d "$DEST" ]] && [[ -n "$(ls -A "$DEST" 2>/dev/null)" ]]; then
  echo "destination must be empty or a bare repository: $DEST" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
git init --bare --initial-branch=main "$DEST"
git --git-dir="$DEST" symbolic-ref HEAD refs/heads/main >/dev/null 2>&1 || true

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BIN_DIR="$REPO_ROOT/desktop/runtime/artifacts/bin"
LIB_DIR="$REPO_ROOT/desktop/runtime/artifacts/lib"

mkdir -p "$BIN_DIR"
mkdir -p "$LIB_DIR"
rm -f "$LIB_DIR"/*.dylib

SOURCE_VFKIT="${ARCHE_DESKTOP_SOURCE_VFKIT:-/opt/podman/bin/vfkit}"
SOURCE_GVPROXY="${ARCHE_DESKTOP_SOURCE_GVPROXY:-/opt/podman/bin/gvproxy}"
SOURCE_ZSTD="${ARCHE_DESKTOP_SOURCE_ZSTD:-}"

if [[ -z "$SOURCE_ZSTD" ]]; then
  SOURCE_ZSTD="$(command -v zstd || true)"
fi

HOMEBREW_PREFIX=""
if command -v brew >/dev/null 2>&1; then
  HOMEBREW_PREFIX="$(brew --prefix)"
fi

is_system_dylib() {
  local path="$1"
  case "$path" in
    /usr/lib/*|/System/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_loader_token() {
  local token_path="$1"
  local macho_path="$2"
  local macho_dir
  macho_dir="$(cd "$(dirname "$macho_path")" && pwd)"

  case "$token_path" in
    @loader_path/*)
      printf '%s\n' "$macho_dir/${token_path#@loader_path/}"
      ;;
    @executable_path/*)
      printf '%s\n' "$macho_dir/${token_path#@executable_path/}"
      ;;
    *)
      printf '%s\n' "$token_path"
      ;;
  esac
}

resolve_install_name_path() {
  local install_name="$1"
  local macho_path="$2"

  if [[ "$install_name" == @rpath/* ]]; then
    local suffix
    suffix="${install_name#@rpath/}"

    while IFS= read -r rpath; do
      [[ -z "$rpath" ]] && continue
      local resolved_rpath
      resolved_rpath="$(resolve_loader_token "$rpath" "$macho_path")"
      local candidate
      candidate="$resolved_rpath/$suffix"
      if [[ -f "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done < <(otool -l "$macho_path" | awk '/LC_RPATH/{getline; getline; print $2}')

    local macho_dir
    macho_dir="$(cd "$(dirname "$macho_path")" && pwd)"
    local fallback
    fallback="$macho_dir/../lib/$suffix"
    if [[ -f "$fallback" ]]; then
      printf '%s\n' "$fallback"
      return 0
    fi

    if [[ -n "$HOMEBREW_PREFIX" ]]; then
      fallback="$HOMEBREW_PREFIX/lib/$suffix"
      if [[ -f "$fallback" ]]; then
        printf '%s\n' "$fallback"
        return 0
      fi
    fi

    return 1
  fi

  if [[ "$install_name" == @loader_path/* || "$install_name" == @executable_path/* ]]; then
    local resolved
    resolved="$(resolve_loader_token "$install_name" "$macho_path")"
    if [[ -f "$resolved" ]]; then
      printf '%s\n' "$resolved"
      return 0
    fi
    return 1
  fi

  if [[ -f "$install_name" ]]; then
    printf '%s\n' "$install_name"
    return 0
  fi

  return 1
}

array_contains() {
  local needle="$1"
  shift

  local element
  for element in "$@"; do
    if [[ "$element" == "$needle" ]]; then
      return 0
    fi
  done

  return 1
}

if [[ ! -x "$SOURCE_VFKIT" ]]; then
  echo "vfkit not found at $SOURCE_VFKIT" >&2
  exit 1
fi

if [[ ! -x "$SOURCE_GVPROXY" ]]; then
  echo "gvproxy not found at $SOURCE_GVPROXY" >&2
  exit 1
fi

if [[ -z "$SOURCE_ZSTD" || ! -x "$SOURCE_ZSTD" ]]; then
  echo "zstd not found; install it or set ARCHE_DESKTOP_SOURCE_ZSTD" >&2
  exit 1
fi

cp -f "$SOURCE_VFKIT" "$BIN_DIR/vfkit"
cp -f "$SOURCE_GVPROXY" "$BIN_DIR/gvproxy"
cp -f "$SOURCE_ZSTD" "$BIN_DIR/zstd"
chmod 755 "$BIN_DIR/vfkit" "$BIN_DIR/gvproxy" "$BIN_DIR/zstd"

if ! command -v install_name_tool >/dev/null 2>&1; then
  echo "install_name_tool is required" >&2
  exit 1
fi

if ! command -v codesign >/dev/null 2>&1; then
  echo "codesign is required" >&2
  exit 1
fi

pending=("$BIN_DIR/zstd")
processed=()

while [[ ${#pending[@]} -gt 0 ]]; do
  target="${pending[0]}"
  pending=("${pending[@]:1}")

  if [[ ${#processed[@]} -gt 0 ]] && array_contains "$target" "${processed[@]}"; then
    continue
  fi
  processed+=("$target")

  while IFS= read -r install_name; do
    [[ -z "$install_name" ]] && continue
    if is_system_dylib "$install_name"; then
      continue
    fi

    if ! resolved_path="$(resolve_install_name_path "$install_name" "$target")"; then
      echo "could not resolve dylib dependency '$install_name' for $target" >&2
      exit 1
    fi

    dylib_name="$(basename "$resolved_path")"
    copied_path="$LIB_DIR/$dylib_name"

    if [[ "$target" == "$LIB_DIR/"* && "$(basename "$target")" == "$dylib_name" ]]; then
      continue
    fi

    if [[ ! -f "$copied_path" ]]; then
      cp -f "$resolved_path" "$copied_path"
      chmod 644 "$copied_path"
      pending+=("$copied_path")
    fi

    if [[ "$target" == "$BIN_DIR/"* ]]; then
      rewritten_install_name="@loader_path/../lib/$dylib_name"
    else
      rewritten_install_name="@loader_path/$dylib_name"
    fi

    install_name_tool -change "$install_name" "$rewritten_install_name" "$target"
  done < <(otool -L "$target" | awk 'NR>1 {print $1}')
done

shopt -s nullglob
sign_targets=("$LIB_DIR"/*.dylib "$BIN_DIR/zstd")
shopt -u nullglob

for sign_target in "${sign_targets[@]}"; do
  codesign --force --sign - "$sign_target" >/dev/null
done

if ! "$BIN_DIR/zstd" --version >/dev/null 2>&1; then
  echo "bundled zstd failed to run after dependency rewrite" >&2
  exit 1
fi

echo "runtime binaries copied to $BIN_DIR"

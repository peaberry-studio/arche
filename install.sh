#!/usr/bin/env bash
# Changes:
# - Keeps this file as the stable curl|bash bootstrapper for non-technical users.
# - Downloads the correct archectl binary from the Arche GitHub release assets.
# - Installs archectl into a local bin directory, then runs the requested lifecycle command.
# - Reopens /dev/tty before handing off so archectl prompts work even when this file is piped.
# - Wrapped in main() so the entire script is parsed before execution,
#   preventing stdin conflicts when piped through curl.

set -Eeuo pipefail

main() {
  readonly DEFAULT_RELEASE_BASE_URL="https://github.com/peaberry-studio/arche/releases/latest/download"
  readonly TOOL_NAME="archectl"

  note() { printf '==> %s\n' "$1"; }
  fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }

  extract_release_version_from_url() {
    printf '%s\n' "$1" | sed -nE 's#^.*/releases/download/([^/]+)/[^/]+$#\1#p'
  }

  resolve_release_version() {
    local base_url="$1" artifact_name="$2" download_target="$3" headers location version
    version="$(extract_release_version_from_url "${base_url%/}/${artifact_name}")"
    if [ -n "$version" ]; then
      printf '%s' "$version"
      return
    fi

    headers="$(curl --silent --show-error --head --connect-timeout 10 "$download_target")" || return 1
    location="$(printf '%s\n' "$headers" | awk 'BEGIN { IGNORECASE = 1 } /^location:/ { sub(/\r$/, "", $2); print $2; exit }')"
    version="$(extract_release_version_from_url "$location")"
    [ -n "$version" ] || return 1
    printf '%s' "$version"
  }

  has_explicit_version_flag() {
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --version|--version=*)
          return 0
          ;;
      esac
      shift
    done
    return 1
  }

  require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
  }

  require_tty() {
    { : </dev/tty; } 2>/dev/null || fail "Interactive terminal required. Re-run this from a real shell."
  }

  detect_os() {
    case "$(uname -s)" in
      Darwin) printf 'darwin' ;;
      Linux) printf 'linux' ;;
      *) fail "Unsupported OS. Use macOS or Linux." ;;
    esac
  }

  detect_arch() {
    case "$(uname -m)" in
      x86_64|amd64) printf 'amd64' ;;
      arm64|aarch64) printf 'arm64' ;;
      *) fail "Unsupported architecture. Use x86_64 or arm64." ;;
    esac
  }

  default_bin_dir() {
    if [ -w /usr/local/bin ]; then
      printf '/usr/local/bin'
    else
      [ -n "${HOME:-}" ] || fail "HOME is not set. Set ARCHECTL_BIN_DIR to choose an install directory."
      printf '%s/.local/bin' "$HOME"
    fi
  }

  require_command curl
  require_tty

  local os arch artifact release_base_url release_version download_url bin_dir target tmp_dir tmp_bin
  os="$(detect_os)"
  arch="$(detect_arch)"
  artifact="${TOOL_NAME}_${os}_${arch}"
  release_base_url="${ARCHECTL_RELEASE_BASE_URL:-$DEFAULT_RELEASE_BASE_URL}"
  download_url="${release_base_url%/}/${artifact}"
  bin_dir="${ARCHECTL_BIN_DIR:-$(default_bin_dir)}"
  target="${bin_dir}/${TOOL_NAME}"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/${TOOL_NAME}.XXXXXX")"
  tmp_bin="${tmp_dir}/${TOOL_NAME}"

  cleanup() { rm -rf "$tmp_dir"; }
  trap cleanup EXIT
  trap 'cleanup; exit 130' INT
  trap 'cleanup; exit 143' TERM

  note "Downloading ${artifact}"
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 "$download_url" -o "$tmp_bin" \
    || fail "Could not download ${download_url}"
  [ -s "$tmp_bin" ] || fail "Downloaded binary is empty"

  note "Installing ${TOOL_NAME} to ${target}"
  mkdir -p "$bin_dir" || fail "Could not create ${bin_dir}"
  cp "$tmp_bin" "$target" || fail "Could not write ${target}"
  chmod 755 "$target" || fail "Could not mark ${target} executable"

  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) note "Add ${bin_dir} to PATH to run ${TOOL_NAME} directly" ;;
  esac

  exec </dev/tty
  case "${1:-}" in
    ""|-* )
      if ! has_explicit_version_flag "$@"; then
        if release_version="$(resolve_release_version "$release_base_url" "$artifact" "$download_url")"; then
          note "Installing Arche version ${release_version}"
          exec "$target" install --version "$release_version" "$@"
        fi
        note "Could not resolve the latest GitHub release tag; falling back to Arche version latest"
        exec "$target" install "$@"
      fi
      exec "$target" install "$@"
      ;;
    install)
      shift
      if ! has_explicit_version_flag "$@"; then
        if release_version="$(resolve_release_version "$release_base_url" "$artifact" "$download_url")"; then
          note "Installing Arche version ${release_version}"
          exec "$target" install --version "$release_version" "$@"
        fi
        note "Could not resolve the latest GitHub release tag; falling back to Arche version latest"
        exec "$target" install "$@"
      fi
      exec "$target" install "$@"
      ;;
    update|destroy|help|--help|-h) exec "$target" "$@" ;;
    *) fail "Unknown command: $1" ;;
  esac
}

main "$@"

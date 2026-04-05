#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
RELEASE_DIR="$DESKTOP_DIR/release"
DEFAULT_KEYCHAIN_PROFILE="arche-notary"
VERSION_MODE="patch"
VERSION_MODE_EXPLICIT=0
MANUAL_VERSION=""
RELEASE_VERSION=""
RELEASE_TAG=""
ASSET_DIR=""
SKIP_VALIDATION=0
TAG_CREATED=0
TAG_PUSHED=0

usage() {
  cat <<'EOF'
Usage: bash scripts/create-local-release.sh [--major | --minor | --patch | --version X.Y.Z] [--skip-validation]

Builds the macOS desktop release locally, creates a Git tag, and publishes the
DMG and ZIP assets to a GitHub Release.

Options:
  --major            Bump the latest GitHub release version by major.
  --minor            Bump the latest GitHub release version by minor.
  --patch            Bump the latest GitHub release version by patch (default).
  --version X.Y.Z    Publish an explicit version.
  --skip-validation  Skip final stapler/spctl validation of the generated DMGs.
  --help             Show this help message.
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

validate_version() {
  node -e '
    const version = process.argv[1]
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      process.exit(1)
    }
  ' "$1" || fail "Invalid version: $1"
}

bump_version() {
  node -e '
    const current = process.argv[1]
    const mode = process.argv[2]
    const parts = current.split(".").map(Number)
    if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
      process.exit(1)
    }

    if (mode === "major") {
      parts[0] += 1
      parts[1] = 0
      parts[2] = 0
    } else if (mode === "minor") {
      parts[1] += 1
      parts[2] = 0
    } else if (mode === "patch") {
      parts[2] += 1
    } else {
      process.exit(1)
    }

    process.stdout.write(parts.join("."))
  ' "$1" "$2" || fail "Failed to calculate next version"
}

resolve_latest_release_tag() {
  if gh api repos/:owner/:repo/releases/latest --jq '.tag_name' 2>/dev/null; then
    return
  fi

  printf 'v0.0.0\n'
}

ensure_clean_worktree() {
  git diff --quiet HEAD -- || fail 'Working tree has tracked changes. Commit or stash them before releasing.'
  git diff --cached --quiet || fail 'Index has staged changes. Commit or stash them before releasing.'
}

ensure_signing_identity() {
  if [[ -n "${CSC_LINK:-}" ]]; then
    return
  fi

  security find-identity -v -p codesigning 2>/dev/null | grep -q 'Developer ID Application:' || \
    fail 'No local Developer ID Application signing identity found in the keychain.'
}

resolve_notarization_credentials() {
  local keychain_profile="${APPLE_KEYCHAIN_PROFILE:-$DEFAULT_KEYCHAIN_PROFILE}"

  if xcrun notarytool history --keychain-profile "$keychain_profile" >/dev/null 2>&1; then
    export APPLE_KEYCHAIN_PROFILE="$keychain_profile"
    printf '==> Using notarytool keychain profile %s\n' "$keychain_profile"
    return
  fi

  if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
    printf '==> Using Apple ID notarization credentials from the local environment\n'
    return
  fi

  if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
    printf '==> Using App Store Connect API key notarization credentials from the local environment\n'
    return
  fi

  fail 'No local notarization credentials found. Create the arche-notary keychain profile or export APPLE_* credentials.'
}

sign_runtime_binaries() {
  local bin

  printf '==> Ad-hoc signing bundled runtime binaries\n'
  (
    cd "$DESKTOP_DIR"
    for bin in bin/node bin/opencode bin/workspace-agent; do
      if [[ -f "$bin" ]]; then
        codesign --force --sign - "$bin"
      fi
    done
  )
}

copy_release_assets() {
  local arch="$1"
  local files=()
  local file_path

  case "$arch" in
    arm64)
      files=(
        "$RELEASE_DIR/Arche-$RELEASE_VERSION-arm64.dmg"
        "$RELEASE_DIR/Arche-$RELEASE_VERSION-arm64-mac.zip"
      )
      ;;
    x64)
      files=(
        "$RELEASE_DIR/Arche-$RELEASE_VERSION.dmg"
        "$RELEASE_DIR/Arche-$RELEASE_VERSION-mac.zip"
      )
      ;;
    *)
      fail "Unsupported architecture: $arch"
      ;;
  esac

  for file_path in "${files[@]}"; do
    [[ -f "$file_path" ]] || fail "Expected release asset not found: $file_path"
    cp "$file_path" "$ASSET_DIR/"
  done
}

validate_dmg() {
  local dmg_path="$1"

  xcrun stapler validate "$dmg_path" >/dev/null
  spctl -a -vv -t open --context context:primary-signature "$dmg_path" >/dev/null
}

sync_desktop_dependencies_for_arch() {
  local arch="$1"

  printf '==> Refreshing desktop dependencies for %s\n' "$arch"
  (
    cd "$DESKTOP_DIR"
    npm_config_arch="$arch" pnpm rebuild electron dugite
  )
}

build_arch() {
  local arch="$1"
  local runtime_platform=""
  local goarch=""

  case "$arch" in
    arm64)
      runtime_platform='darwin-arm64'
      goarch='arm64'
      ;;
    x64)
      runtime_platform='darwin-x64'
      goarch='amd64'
      ;;
    *)
      fail "Unsupported architecture: $arch"
      ;;
  esac

  sync_desktop_dependencies_for_arch "$arch"

  printf '==> Preparing runtime binaries for %s\n' "$arch"
  NODE_RUNTIME_PLATFORM="$runtime_platform" \
    OPENCODE_PLATFORM="$runtime_platform" \
    WORKSPACE_AGENT_GOOS='darwin' \
    WORKSPACE_AGENT_GOARCH="$goarch" \
    FORCE_DOWNLOAD='1' \
    bash "$SCRIPT_DIR/prepare-desktop-runtime.sh"

  sign_runtime_binaries

  printf '==> Packaging macOS %s\n' "$arch"
  (
    cd "$DESKTOP_DIR"
    pnpm exec electron-builder --mac --"$arch" --publish never --config electron-builder.config.js \
      -c.extraMetadata.version="$RELEASE_VERSION"
  )

  copy_release_assets "$arch"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --major|--minor|--patch)
        [[ -z "$MANUAL_VERSION" ]] || fail 'Cannot combine --version with an automatic bump mode.'
        [[ "$VERSION_MODE_EXPLICIT" == '0' ]] || fail 'Specify only one of --major, --minor, or --patch.'
        VERSION_MODE="${1#--}"
        VERSION_MODE_EXPLICIT=1
        shift
        ;;
      --version)
        [[ $# -ge 2 ]] || fail 'Missing value for --version'
        [[ "$VERSION_MODE_EXPLICIT" == '0' ]] || fail 'Cannot combine --version with --major, --minor, or --patch.'
        MANUAL_VERSION="$2"
        shift 2
        ;;
      --skip-validation)
        SKIP_VALIDATION=1
        shift
        ;;
      --help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

cleanup() {
  local exit_code="$1"

  if [[ -n "$ASSET_DIR" && -d "$ASSET_DIR" ]]; then
    rm -rf "$ASSET_DIR"
  fi

  if [[ "$exit_code" -eq 0 || "$TAG_CREATED" != '1' ]]; then
    return
  fi

  if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
    printf '==> GitHub release %s exists after failure; leaving Git tag in place\n' "$RELEASE_TAG" >&2
    return
  fi

  printf '==> Cleaning up failed release tag %s\n' "$RELEASE_TAG" >&2

  if [[ "$TAG_PUSHED" == '1' ]]; then
    if ! git push origin ":refs/tags/$RELEASE_TAG" >/dev/null 2>&1; then
      printf 'Warning: failed to delete remote tag %s\n' "$RELEASE_TAG" >&2
    fi
  fi

  if ! git tag -d "$RELEASE_TAG" >/dev/null 2>&1; then
    printf 'Warning: failed to delete local tag %s\n' "$RELEASE_TAG" >&2
  fi
}

create_git_tag() {
  git tag -a "$RELEASE_TAG" -m "Release $RELEASE_TAG"
  TAG_CREATED=1
  git push origin "$RELEASE_TAG"
  TAG_PUSHED=1
}

create_github_release() {
  local assets=()

  shopt -s nullglob
  assets=("$ASSET_DIR"/*.dmg "$ASSET_DIR"/*.zip)
  shopt -u nullglob

  [[ ${#assets[@]} -gt 0 ]] || fail 'No release assets were produced.'

  gh release create "$RELEASE_TAG" "${assets[@]}" --verify-tag --generate-notes
}

main() {
  local latest_tag latest_version

  parse_args "$@"

  require_command git
  require_command gh
  require_command node
  require_command pnpm
  require_command go
  require_command xcrun
  require_command codesign
  require_command security

  [[ "$(uname -s)" == 'Darwin' ]] || fail 'Local desktop releases are only supported on macOS.'

  gh auth status >/dev/null 2>&1 || fail 'GitHub CLI is not authenticated.'
  ensure_clean_worktree
  ensure_signing_identity
  resolve_notarization_credentials

  latest_tag="$(resolve_latest_release_tag)"
  latest_version="${latest_tag#v}"
  validate_version "$latest_version"

  if [[ -n "$MANUAL_VERSION" ]]; then
    RELEASE_VERSION="${MANUAL_VERSION#v}"
    validate_version "$RELEASE_VERSION"
  else
    RELEASE_VERSION="$(bump_version "$latest_version" "$VERSION_MODE")"
  fi

  RELEASE_TAG="v$RELEASE_VERSION"
  ASSET_DIR="$(mktemp -d)"
  trap 'status=$?; cleanup "$status"; trap - EXIT; exit "$status"' EXIT

  printf '==> Latest published release: %s\n' "$latest_tag"
  printf '==> Releasing version: %s\n' "$RELEASE_TAG"

  git fetch --tags origin

  git rev-parse "$RELEASE_TAG" >/dev/null 2>&1 && fail "Git tag already exists locally: $RELEASE_TAG"
  git ls-remote --exit-code --tags origin "refs/tags/$RELEASE_TAG" >/dev/null 2>&1 && \
    fail "Git tag already exists on origin: $RELEASE_TAG"
  gh release view "$RELEASE_TAG" >/dev/null 2>&1 && fail "GitHub release already exists: $RELEASE_TAG"

  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null
  fi

  printf '==> Installing dependencies\n'
  (
    cd "$WEB_DIR"
    pnpm install --frozen-lockfile
  )
  (
    cd "$DESKTOP_DIR"
    pnpm install --frozen-lockfile
  )

  printf '==> Generating Prisma clients\n'
  (
    cd "$WEB_DIR"
    pnpm prisma:generate
    pnpm prisma:generate:desktop
  )

  printf '==> Building Next.js web app\n'
  (
    cd "$WEB_DIR"
    ARCHE_RUNTIME_MODE='desktop' \
      ARCHE_DESKTOP_PLATFORM='darwin' \
      ARCHE_DESKTOP_WEB_HOST='127.0.0.1' \
      pnpm build
  )

  printf '==> Compiling Electron TypeScript\n'
  (
    cd "$DESKTOP_DIR"
    pnpm build
  )

  build_arch 'arm64'
  build_arch 'x64'

  if [[ "$SKIP_VALIDATION" == '1' ]]; then
    printf '==> Skipping DMG validation\n'
  else
    validate_dmg "$ASSET_DIR/Arche-$RELEASE_VERSION-arm64.dmg"
    validate_dmg "$ASSET_DIR/Arche-$RELEASE_VERSION.dmg"
  fi

  printf '==> Creating and pushing Git tag %s\n' "$RELEASE_TAG"
  create_git_tag

  printf '==> Creating GitHub Release %s\n' "$RELEASE_TAG"
  create_github_release

  printf '==> Release complete: %s\n' "$RELEASE_TAG"
}

main "$@"

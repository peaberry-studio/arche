# Arche Desktop

Desktop runs Arche locally by embedding the web app inside Electron and supervising local runtime binaries (`node`, `opencode`, `workspace-agent`).

## Prerequisites

- Node.js 24+
- pnpm 10+
- Go 1.22+ (required to build `workspace-agent`)
- `curl`, `tar`, `unzip`

## Local Development (new machine)

From repository root:

```bash
# 1) Install dependencies
cd apps/web
pnpm install

cd ../desktop
pnpm install

# 2) Optional: initialize local env file for web runtime
cd ../web
cp .env.example .env

# 3) Optional: regenerate desktop Prisma client
pnpm prisma:generate:desktop

# 4) Start desktop app in development mode
cd ../desktop
pnpm dev
```

`pnpm dev` automatically runs `pnpm prepare:runtime` before launching Electron.

## Runtime Preparation

`pnpm prepare:runtime` does four things:

1. Downloads a bundled Node.js runtime into `apps/desktop/bin`
2. Downloads `opencode` into `apps/desktop/bin`
3. Builds `workspace-agent` from `infra/workspace-image/workspace-agent`
4. Prepares `opencode-config` (custom tools + dependencies) in `apps/desktop/bin/opencode-config`

Run it manually when you want to prefetch/update binaries:

```bash
cd apps/desktop
pnpm prepare:runtime
```

Force binary re-download:

```bash
cd apps/desktop
FORCE_DOWNLOAD=1 pnpm prepare:runtime
```

## Tests

```bash
cd apps/desktop
pnpm test
```

## Build a distributable app

From repository root:

```bash
bash scripts/build-desktop.sh
```

## Local GitHub Release

To build the signed/notarized macOS release locally and publish the assets to GitHub:

```bash
bash scripts/create-local-release.sh
```

Default behavior:

1. reads the latest published GitHub release tag
2. bumps the next version as a patch release
3. builds both `arm64` and `x64` macOS artifacts locally
4. creates and pushes the Git tag
5. creates the GitHub Release and uploads the DMG and ZIP assets

Supported version options:

```bash
# default: patch bump
bash scripts/create-local-release.sh

# explicit bump type
bash scripts/create-local-release.sh --minor
bash scripts/create-local-release.sh --major

# explicit version
bash scripts/create-local-release.sh --version 0.7.0

# if local DMG validation is flaky on your machine
bash scripts/create-local-release.sh --skip-validation
```

Signing and notarization resolution:

- signing uses a local `Developer ID Application` identity from the macOS keychain when present
- notarization prefers a local `notarytool` keychain profile named `arche-notary`
- if that profile is not present, the script falls back to the standard local environment variables supported by `electron-builder`
- before packaging each architecture, the script refreshes arch-specific desktop dependencies so bundled binaries match the release target

One-time setup for the default local notary profile:

```bash
xcrun notarytool store-credentials "arche-notary" \
  --apple-id "<your-apple-id>" \
  --team-id "<your-team-id>" \
  --password "<your-app-specific-password>"
```

If you prefer a different profile name, set `APPLE_KEYCHAIN_PROFILE` before running the script.

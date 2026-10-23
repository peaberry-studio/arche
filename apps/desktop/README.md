# Arche Desktop

Desktop runs Arche locally by embedding the web app inside Electron and supervising local runtime binaries (`node`, `opencode`, `opencode-v1`, `workspace-agent`).

## Vaults

Desktop now runs against explicit visible vault folders instead of hidden global directories.

- On startup, Arche opens the last valid vault directly into the workspace.
- If no vault is selected, Arche opens a launcher where you can create or open one.
- Each vault opens in its own Electron process and window.
- The vault name is the folder name.

Vault layout. Internal runtime files are dot-prefixed, so they are hidden on
macOS and Linux by default:

```text
<VaultName>/
  .arche-vault.json
  .arche.db
  workspace/
  .kb-config/
  .kb-content/
  .users/local/
  .runtime/opencode/
  .secrets/encryption.key
```

`.arche-vault.json` is required when opening an existing vault.

Breaking change:

- Desktop no longer reads or migrates legacy `~/.arche` and `~/.arche-opencode` folders.
- Existing desktop data must be opened from a visible Arche vault folder created with the new launcher flow.

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
2. Downloads `opencode` (V2) and pinned `opencode-v1` (1.18.18) into `apps/desktop/bin`, with independent version stamps
3. Builds `workspace-agent` from `infra/workspace-image/workspace-agent`
4. Prepares the `arche-tools` MCP server and dependencies in `apps/desktop/bin/arche-tools`

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

### Runtime

Desktop workspaces run the bundled OpenCode 2 binary. The OpenCode 1 binary is
bundled only to archive the history of vaults created before OpenCode 2: on the
first start of such a vault, the host copies the legacy `.local` data/state tree
(including SQLite WAL/SHM files) to a disposable sibling directory and starts
the helper there on loopback with project config, MCP, plugins and providers
disabled. It exports history into the vault's SQLite
archive, and confirms that the helper exited. An export failure fails the start
and retries on the next one; unconfirmed helper cleanup retains the copy and
blocks startup until exit is confirmed, then the copy is removed.

Original V1 state stays in `.runtime/opencode`; helper startup/SQLite/log writes
go only to the disposable copy. V2 uses
`.runtime/opencode-v2`. An explicit `ARCHE_OPENCODE_DATA_DIR` remains the V1 root,
with `-v2` appended for V2. Development binary overrides: `ARCHE_OPENCODE_BIN` for
OpenCode 2 and `ARCHE_OPENCODE_V1_BIN` for the archive helper. Do not point either
override at the other version.

Manual acceptance: back up an existing vault, then use a copy to verify archive
counts, parent/child conversations and attachments, the read-only archived view,
a new V2 conversation, and a restart without re-export.

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

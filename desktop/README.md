# Arche Desktop (Tauri + Embedded VM)

This directory contains a desktop runtime that runs Arche inside an embedded Linux VM on Apple Silicon Macs, rendered in a Tauri WebView.

## Scope

- Target platform: macOS Apple Silicon (`arm64`)
- UI shell: Tauri (embedded WebView)
- Runtime approach: embedded VM lifecycle managed by scripts under `desktop/runtime/vm/macos/`
- Arche app rendered inside the embedded WebView (`http://127.0.0.1:4510`)

This keeps `apps/web` logic unchanged and adds a desktop runtime layer in `desktop/`.

## Layout

- `desktop/tauri/` - Tauri desktop app
- `desktop/runtime/vm/macos/` - VM runtime scripts used by the Tauri backend
- `desktop/runtime/artifacts/images/` - optional pre-exported container image archives
- `desktop/scripts/build-desktop-images.sh` - builds desktop container images
- `desktop/scripts/export-desktop-images.sh` - exports runtime images as tar archives for offline VM import
- `desktop/scripts/prepare-runtime-binaries.sh` - copies `vfkit` and `gvproxy` into runtime artifacts for distribution
- `desktop/scripts/release-local.sh` - one-command local release that builds the `.dmg`

## One-command local release

```bash
./desktop/scripts/release-local.sh
```

This command builds images, exports offline artifacts, bundles VM runtime binaries, and outputs the final DMG path.

## Quick start (POC)

1. Build runtime images on host:

```bash
./desktop/scripts/build-desktop-images.sh
```

2. Optional (recommended for offline VM startup): export image archives:

```bash
./desktop/scripts/export-desktop-images.sh
```

3. Optional (recommended for distribution without host Podman): bundle runtime binaries:

```bash
./desktop/scripts/prepare-runtime-binaries.sh
```

4. Start the desktop app in dev mode:

```bash
cd desktop/tauri
pnpm install
pnpm tauri dev
```

5. In the app, press **Start Arche**.

On first run, the runtime will:

- initialize `~/Library/Application Support/ArcheDesktop/vm`
- provision a Linux raw disk image (from local cache or download)
- boot the VM with `vfkit` + `gvproxy`
- import container images into the guest
- start Arche inside the guest and expose it to host WebView over a local SSH tunnel

The app initializes local data in:

- `~/Library/Application Support/ArcheDesktop/data`
- `~/Library/Application Support/ArcheDesktop/vm`

## Notes

- Runtime mode defaults to `vm`. You can force the old host-podman mode with `ARCHE_DESKTOP_RUNTIME_MODE=podman` when launching Tauri.
- VM scripts currently default to `/opt/podman/bin/vfkit` and `/opt/podman/bin/gvproxy`; you can override with `ARCHE_DESKTOP_VFKIT_BIN` and `ARCHE_DESKTOP_GVPROXY_BIN`.

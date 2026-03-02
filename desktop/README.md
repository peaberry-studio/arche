# Arche Desktop (Electron, Single-User)

This desktop build runs Arche fully local for a single user.

- No Podman / Docker / VM at runtime.
- Embedded local PostgreSQL.
- Embedded OpenCode + workspace-agent processes.
- Embedded web app in Electron WebView.

## Runtime Layout

User data is stored in:

- `~/Library/Application Support/Arche Desktop/runtime/kb-content`
- `~/Library/Application Support/Arche Desktop/runtime/kb-config`
- `~/Library/Application Support/Arche Desktop/runtime/users`
- `~/Library/Application Support/Arche Desktop/runtime/postgres`
- `~/Library/Application Support/Arche Desktop/runtime/logs`

## One-Click Build (Apple Silicon)

From repo root:

```bash
./desktop/build-dmg.sh
```

The script will:

1. Build `apps/web` in Next.js standalone mode.
2. Prepare desktop runtime assets (`desktop/app/runtime/web`).
3. Install Electron app dependencies.
4. Build runtime binaries (`opencode`, `workspace-agent`).
5. Package `.app` + `.dmg`.

Output:

- `desktop/dist/Arche-Desktop_<version>_arm64.dmg`

## Local Run (dev smoke)

```bash
cd desktop/app
pnpm install
pnpm start
```

## Notes

- This desktop target is currently `darwin/arm64`.
- The DMG includes the standard `Applications` shortcut for drag-and-drop install.

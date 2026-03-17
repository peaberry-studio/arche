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

`pnpm prepare:runtime` does three things:

1. Downloads a bundled Node.js runtime into `apps/desktop/bin`
2. Downloads `opencode` into `apps/desktop/bin`
3. Builds `workspace-agent` from `infra/workspace-image/workspace-agent`

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

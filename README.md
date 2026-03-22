# Arche

Arche is an AI agent platform that lets teams deploy specialized assistants — for support, copywriting, SEO, marketing, and more — each with access to a shared knowledge base and its own isolated workspace.

Define your company's identity, tone, products, and processes once. Arche's agents use that knowledge to help your team work faster and more consistently.

## Desktop App

The easiest way to try Arche is the desktop app. It runs locally on your machine — no server or Docker setup required.

### Download

Head to the [latest release](https://github.com/peaberry-studio/arche/releases/latest) and download the installer for your platform:

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Arche-*-arm64.dmg` |
| macOS (Intel) | `Arche-*-x64.dmg` |
| Linux | `Arche-*-amd64.AppImage` or `.deb` |
| Windows | `Arche-*-Setup.exe` |

### Build from Source

If you prefer to build the desktop app yourself:

```bash
# Prerequisites: Node.js 24+, pnpm 10+, Go 1.22+

# 1. Install dependencies
cd apps/web && pnpm install
cd ../desktop && pnpm install

# 2. Build the distributable
cd ../..
bash scripts/build-desktop.sh
```

The installer will be in `apps/desktop/release/`.

For more details, see [`apps/desktop/README.md`](apps/desktop/README.md).

## Self-Hosting

Arche can be deployed to your own server so your entire team can use it.

### Deploy to a VPS (Ansible)

One-command deployment with automatic TLS, database provisioning, and secrets management.

See the full guide: [`infra/deploy/README.md`](infra/deploy/README.md)

### Deploy with Coolify

If you use [Coolify](https://coolify.io) to manage your infrastructure, Arche has first-class support with zero-downtime rolling updates.

See the full guide: [`infra/coolify/README.md`](infra/coolify/README.md)

## Local Development

Set up the full development stack locally with hot reload:

```bash
# Prerequisites: Node.js 24+, pnpm 10+, Podman (or Docker) with Compose

cd infra/deploy
cp .env.example .env
./deploy.sh --local-dev
```

Open http://arche.lvh.me:8080 and log in with `admin@example.com` / `change-me`.

For step-by-step instructions, see [`infra/compose/README.md`](infra/compose/README.md).

## Documentation

| Document | Description |
|----------|-------------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Technical architecture, tech stack, data model, and source code structure |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution guidelines |
| [`apps/web/README.md`](apps/web/README.md) | Web application setup and internals |
| [`apps/desktop/README.md`](apps/desktop/README.md) | Desktop app development and packaging |
| [`infra/deploy/README.md`](infra/deploy/README.md) | VPS deployment guide (Ansible) |
| [`infra/coolify/README.md`](infra/coolify/README.md) | Coolify deployment guide |
| [`infra/compose/README.md`](infra/compose/README.md) | Local Podman Compose stack |
| [`infra/workspace-image/README.md`](infra/workspace-image/README.md) | Workspace container image |

## License

This project is licensed under the Apache License 2.0. See [`LICENSE`](LICENSE).

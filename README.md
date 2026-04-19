# Arche

Arche is an AI agent platform that lets teams deploy specialized assistants — for support, copywriting, SEO, marketing, and more — each with access to a shared knowledge base and its own isolated workspace.

Define your company's identity, tone, products, and processes once. Arche's agents use that knowledge to help your team work faster and more consistently.

## Desktop App

The easiest way to try Arche locally is the desktop app. It runs on your machine with no server or Docker setup required.

Desktop vault behavior:

- Arche Desktop opens directly into the workspace for the last valid vault.
- If no vault is selected yet, it opens a launcher where you can create or open a vault.
- Each vault is a visible folder that contains its own database, KB repos, runtime state, and secrets.
- Opening another vault launches a separate Electron process and window, similar to Obsidian.

Breaking change:

- Desktop no longer reads or migrates legacy hidden data from `~/.arche` or `~/.arche-opencode`.
- You must create or open a visible Arche vault folder.

### Download

Head to the [latest release](https://github.com/peaberry-studio/arche/releases/latest) and download the installer for your platform:

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Arche-arm64.dmg` or `Arche-<version>-arm64-mac.zip` |
| macOS (Intel) | `Arche-x64.dmg` or `Arche-<version>-mac.zip` |

Official GitHub release assets are currently published for macOS only.

Linux and Windows packaging targets exist in `apps/desktop`, but they are not part of the current release workflow or validation matrix, so they should not be documented as supported release artifacts.

### Build from Source

If you prefer to build the desktop app yourself:

```bash
# Prerequisites: Node.js 24+, pnpm 10+, Go 1.22+

# 1. Install dependencies
cd apps/web && pnpm install
cd ../desktop && pnpm install

# 2. Build a desktop package for your current host platform
cd ../..
bash scripts/build-desktop.sh
```

The packaged desktop artifacts will be in `apps/desktop/release/`.

For more details, see [`apps/desktop/README.md`](apps/desktop/README.md).

## Self-Hosting

Arche can be deployed to your own server so your entire team can use it.

### One-Click DigitalOcean Install

For the narrow-path setup, there is now a one-click installer that creates a fresh DigitalOcean Droplet, configures Docker, deploys the latest Arche images, auto-generates secrets, and exposes the app on a `nip.io` hostname.

```bash
curl -fsSL https://arche.peaberry.studio/install | bash
```

You can also pass inputs up front:

```bash
curl -fsSL https://arche.peaberry.studio/install | bash -s -- --token "$DIGITALOCEAN_TOKEN" --email admin@example.com --version v1.2.3
```

The installer prompts for:

- DigitalOcean API token
- Email address for the initial admin account and Let's Encrypt

You do not provide server, database, or admin passwords. The Go deployer generates a local SSH keypair for the deployment, the Droplet generates the runtime secrets during bootstrap, and `archectl` fetches the recovery details back over pinned SSH into `~/.arche/deployments/`.

The shim installs `archectl` into `/usr/local/bin` when that directory is writable, otherwise into `~/.local/bin`. After installation, use the same binary for lifecycle commands:

```bash
archectl install --token "$DIGITALOCEAN_TOKEN" --email admin@example.com --version v1.2.3
archectl update --token "$DIGITALOCEAN_TOKEN" --version v1.2.4
archectl destroy --token "$DIGITALOCEAN_TOKEN"
```

By default, `archectl` keeps output minimal and shows only lifecycle steps plus in-place progress. Add `-vv` or `--verbose` to show SSH/bootstrap logs.

If the local state file is missing, recovery flags are available:

```bash
archectl update --token "$DIGITALOCEAN_TOKEN" --version v1.2.4 --ip 203.0.113.10 --ssh-key ~/.arche/deployments/arche-20260410-120000-ssh.pem
archectl destroy --token "$DIGITALOCEAN_TOKEN" --droplet-id 123456789 --firewall-id firewall-id --yes
```

Legacy password-based recovery remains available for older deployments with `--ssh-password`.

Assumptions:

- DigitalOcean only
- The shell entrypoint downloads `https://github.com/peaberry-studio/arche/releases/latest/download/archectl_<os>_<arch>` for macOS/Linux on amd64/arm64
- Image tags are derived from `--version`: `latest` by default, or a pinned tag such as `v1.2.3`
- Public URL is derived automatically as `https://arche-<droplet-ip>.nip.io`
- Local deployment state is stored at `~/.arche/deployments/current.json`

Operational caveats:

- The default public URL depends on the third-party `nip.io` DNS service. If `nip.io` is unavailable, point your own DNS name at the Droplet before relying on the deployment.
- `archectl destroy` permanently removes the Droplet and attached data volumes. Create a Droplet snapshot or other backup before destroying a deployment you may need to recover.

To test installer changes locally before publishing a GitHub release, build the matching binary into `/tmp`, point the shim at that directory, and run template validation:

```bash
cd infra/one-click
GOOS="$(go env GOOS)" GOARCH="$(go env GOARCH)" go build -o "/tmp/archectl_$(go env GOOS)_$(go env GOARCH)" .
cd ../..
ARCHECTL_RELEASE_BASE_URL=file:///tmp bash install.sh --validate-only
```

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

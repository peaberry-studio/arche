# Arche One-Click Deployer

Deploy Arche to a VPS or run the local development stack with hot reload.

## Architecture

```
Local Machine
  ./deploy.sh --ip X --domain Y --ssh-key K --acme-email E
              │ SSH (Ansible)
              ▼
Remote VPS (/opt/arche)
  ┌──────────────────────────────────────────────────────────┐
  │ Podman                                                    │
  │  ┌──────────────────┐                                     │
  │  │ Traefik           │ :80 → :443 (TLS/ACME)              │
  │  │ Container provider│──► docker-socket-proxy :2375       │
  │  └────────┬─────────┘                                     │
  │           │                                                │
  │     ┌─────┴──────┐                                        │
  │     │            │                                         │
  │     ▼            ▼                                         │
  │  arche.dom                                                 │
  │  ┌──────────────────────────────────────────┐             │
  │  │ Arche Web (Next.js)                       │             │
  │  │ BFF + spawner                             │             │
  │  └──────────────┬───────────────────────────┘             │
  │                 │                                          │
  │           ┌─────┴─────┐                                    │
  │           ▼           ▼                                    │
  │     ┌──────────┐  ┌──────────────────────┐                │
  │     │ Postgres │  │ OpenCode containers  │ (dynamic)      │
  │     │ :5432    │  │ opencode-<slug>      │                │
  │     └──────────┘  └──────────────────────┘                │
  │                        (arche-internal network)            │
  └──────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Local machine**: Bash, Podman + podman-compose, Ansible (`pip install ansible`)
- **Remote VPS**: Debian/Ubuntu (fresh or existing), SSH access

## Deployment Modes

The deployer has two modes: **local-dev** for active development with hot reload, and **remote** for deploying to a VPS.

### Local dev mode

Mounts your source code for hot reload via `next dev`. Use this for active development against the full stack (Traefik, Postgres, socket proxy).

- **App**: http://arche.lvh.me:8080
- **Traefik dashboard**: http://localhost:8081
- **Postgres**: `localhost:5432`
- Source from `apps/web/` is bind-mounted; `node_modules` lives in a named volume
- Workspace image (`arche-workspace:latest`) is built automatically
- Knowledge Base content is deployed to `~/.arche/kb-content` (repo bare)
- Common config is deployed to `~/.arche/kb-config` (repo bare)

```bash
cd infra/deploy
cp .env.example .env   # edit if needed, defaults work for local
./deploy.sh --local-dev
```

Edit files in `apps/web/src/` and Next.js hot reloads automatically.

> **Note**: `--local-dev` uses project name `arche`. Run `podman compose -f <compose-file> -p arche down` before re-running if a previous stack is still active.

> **macOS**: Podman Machine mounts `$HOME` into the VM by default, so source bind mounts work for repos under `$HOME`. Repos outside `$HOME` need manual Podman Machine volume configuration.


### Remote mode

Deploys to a VPS via SSH using Ansible. The playbook provisions Podman (if missing), renders the compose and env templates, deploys images (from GHCR or local VPS builds), runs migrations, and seeds the database.

- Domain: any single hostname (apex or subdomain), with TLS via ACME HTTP challenge
- HTTPS on port 443, HTTP redirects to HTTPS
- Requires all secrets set in `.env` or exported
- Requires SSH access and open ports 80/443 to complete ACME HTTP challenge

```bash
cd infra/deploy
cp .env.example .env
# Fill in all required values in .env

./deploy.sh \
  --ip 203.0.113.50 \
  --domain arche.example.com \
  --ssh-key ~/.ssh/id_rsa \
  --acme-email admin@example.com \
  --skip-ensure-dns-record
```

## CLI Reference

### Remote flags

| Flag | Required | Description |
|------|----------|-------------|
| `--ip` | Yes | VPS IP address |
| `--domain` | Yes | Production domain |
| `--ssh-key` | Yes | Path to SSH private key |
| `--acme-email` | Yes | Let's Encrypt ACME email |
| `--user` | No | SSH user (default: `root`) |
| `--skip-ensure-dns-record` | No | Skip `ensure_dns_record` verification before running Ansible |
| `--dry-run` | No | Show what would be done |
| `--verbose` | No | Verbose Ansible output |

### Local flags

| Flag | Description |
|------|-------------|
| `--local-dev` | Run dev stack with source-mounted hot reload (mutually exclusive with remote flags) |

## Environment Variables

Set in `.env` or export before running `deploy.sh`.

### Required (remote)

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Database password |
| `ARCHE_SESSION_PEPPER` | Session pepper (`openssl rand -base64 32`) |
| `ARCHE_ENCRYPTION_KEY` | Encryption key (`openssl rand -base64 32`) |
| `ARCHE_INTERNAL_TOKEN` | Internal API token (`openssl rand -base64 32`) |
| `ARCHE_CONNECTOR_OAUTH_STATE_SECRET` | Connector OAuth state secret (`openssl rand -base64 32`) |
| `ARCHE_SEED_ADMIN_EMAIL` | Seed admin email |
| `ARCHE_SEED_ADMIN_PASSWORD` | Seed admin password |
| `ARCHE_SEED_ADMIN_SLUG` | Seed admin URL slug |

### Optional (remote auth)

| Variable | Description |
|----------|-------------|
| `GHCR_TOKEN` | GitHub Container Registry token (optional for public images) |

### Optional (seed test user)

| Variable | Description |
|----------|-------------|
| `ARCHE_SEED_TEST_EMAIL` | Seed test user email |
| `ARCHE_SEED_TEST_SLUG` | Seed test user URL slug |

### ACME notes

No DNS provider token is required. Traefik uses ACME HTTP challenge on entrypoint `web` (port 80).

### Optional overrides

| Variable | Default |
|----------|---------|
| `IMAGE_PREFIX` | `ghcr.io/peaberry-studio/arche/` |
| `WEB_VERSION` | `latest` |
| `WEB_IMAGE` | `<IMAGE_PREFIX>web:<WEB_VERSION>` |
| `OPENCODE_IMAGE` | `arche-workspace:latest` |
| `PODMAN_SOCKET_PATH` | Auto-detected (see below) |

To build the web image directly on the VPS, set `WEB_IMAGE=arche-web:latest`.
To build the workspace image directly on the VPS, set `OPENCODE_IMAGE=arche-workspace:latest`.
Published GHCR tags stay amd64 by default. If you need arm64, use the matching `-arm64` tag explicitly, for example `WEB_IMAGE=ghcr.io/peaberry-studio/arche/web:latest-arm64` and `OPENCODE_IMAGE=ghcr.io/peaberry-studio/arche/workspace:latest-arm64`.

## Podman Socket

The `docker-socket-proxy` container needs access to the Podman socket. The deployer auto-detects the correct path:

| Context | Socket path |
|---------|-------------|
| Linux rootful Podman (VPS) | `/run/podman/podman.sock` |
| macOS Podman Machine (dev) | `/run/user/<uid>/podman/podman.sock` (VM-internal) |

In local-dev mode on macOS, the proxy runs with `user: root` and `security_opt: [label=disable]` to access the rootless socket inside the Podman VM.

To override, set `PODMAN_SOCKET_PATH` before running `deploy.sh`.

## Auto-Detection

On remote deploys, the playbook auto-detects whether Podman and a `deploy` user exist. If either is missing, it runs the `common` and `podman` roles to provision the server. On subsequent deploys, only the `app` role runs.

## ACME Notes

HTTP-01 challenge is used in remote mode. Make sure your domain resolves to the VPS and ports `80/443` are reachable.

## Services

| Service | Image | Purpose |
|---------|-------|---------|
| Traefik | `traefik:v3.6.7` | Reverse proxy, TLS termination, routing |
| docker-socket-proxy | `tecnativa/docker-socket-proxy:0.3` | Secure container API access |
| PostgreSQL | `postgres:16` | Database |
| Web | Configurable (`WEB_IMAGE`) | Next.js app (BFF + spawner) |

## Directory Structure (VPS)

```
/opt/arche/
├── compose.yml
├── .env
└── data/

/var/lib/arche/
└── users/
```

## Maintenance

```bash
# SSH into VPS
ssh -i ~/.ssh/id_rsa root@<IP>

# View logs
cd /opt/arche && podman compose logs -f

# Restart
podman compose restart

# Re-deploy (from local machine)
./deploy.sh --ip <IP> --domain <DOMAIN> --ssh-key <KEY> --acme-email <EMAIL> [--skip-ensure-dns-record]
```

## Troubleshooting

**SSH connection fails**: Ensure the SSH key has access and the user can log in (`ssh -i <key> <user>@<ip>`).

**ACME certificate not issued**: Check Traefik logs (`podman compose logs traefik`). Verify domain A/AAAA records point to the VPS and ports `80/443` are reachable.

**Web service unhealthy**: Check web logs (`podman compose logs web`). Ensure `DATABASE_URL` is correct and Postgres is running.

**Migrations fail**: Ensure the container image includes the `prisma/` directory. The Containerfile should have `COPY --from=build /app/prisma ./prisma`.

# Arche One-Click Deployer

Deploy Arche to a VPS or run the local development stack with hot reload.

## Architecture

```
Local Machine
  ./deploy.sh --ip X --domain Y --ssh-key K --acme-email E
  ./deploy.sh --ip X --domain Y --ssh-key K --cloudflare-tunnel
              │ SSH (Ansible)
              ▼
Remote VPS (/opt/arche)
  ┌──────────────────────────────────────────────────────────┐
  │ Podman                                                    │
  │  ┌──────────────────┐                                     │
  │  │ Traefik           │ :80 → :443 (direct TLS/ACME)       │
  │  │                   │ :80 internal (Cloudflare Tunnel)   │
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

Remote deployments support two exposure modes: direct exposure with Traefik and ACME, or Cloudflare Tunnel with the origin ports closed.

#### Direct exposure (default)

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

#### Cloudflare Tunnel exposure

- Domain: any single hostname routed through a Cloudflare Tunnel public hostname
- No host ports `80/443` are published by Traefik
- No Let's Encrypt ACME runs on the VPS
- Cloudflare terminates public TLS at the edge
- The Cloudflare Tunnel public hostname service must point to `http://traefik:80`
- Remove A/AAAA records that point the hostname directly at the VPS IP
- Requires `CLOUDFLARED_TUNNEL_TOKEN` set in `.env` or exported

```bash
cd infra/deploy
cp .env.example .env
# Fill in all required values in .env, including CLOUDFLARED_TUNNEL_TOKEN

./deploy.sh \
  --ip 203.0.113.50 \
  --domain arche.example.com \
  --ssh-key ~/.ssh/id_rsa \
  --cloudflare-tunnel
```

Create and configure the tunnel in the Cloudflare dashboard before deploying. The deployer starts `cloudflared` with the token, but it does not create the Cloudflare tunnel or DNS routing for you.

## CLI Reference

### Remote flags

| Flag | Required | Description |
|------|----------|-------------|
| `--ip` | Yes | VPS IP address |
| `--domain` | Yes | Production domain |
| `--ssh-key` | Yes | Path to SSH private key |
| `--acme-email` | Direct only | Let's Encrypt ACME email |
| `--cloudflare-tunnel` | No | Use Cloudflare Tunnel instead of public `80/443` and ACME |
| `--version` | No | Web image tag to deploy (default: `latest`) |
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
| `ARCHE_GATEWAY_TOKEN_SECRET` | Gateway token signing secret (`openssl rand -base64 32`) |
| `ARCHE_SEED_ADMIN_EMAIL` | Seed admin email |
| `ARCHE_SEED_ADMIN_PASSWORD` | Seed admin password |
| `ARCHE_SEED_ADMIN_SLUG` | Seed admin URL slug |

### Required (Cloudflare Tunnel)

| Variable | Description |
|----------|-------------|
| `CLOUDFLARED_TUNNEL_TOKEN` | Cloudflare Tunnel token from the Cloudflare dashboard |

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

No DNS provider token is required in direct mode. Traefik uses ACME HTTP challenge on entrypoint `web` (port 80). Cloudflare Tunnel mode skips ACME entirely.

### Optional overrides

| Variable | Default |
|----------|---------|
| `IMAGE_PREFIX` | `ghcr.io/peaberry-studio/arche/` |
| `WEB_VERSION` | `latest` |
| `WEB_IMAGE` | `<IMAGE_PREFIX>web:<WEB_VERSION>` |
| `OPENCODE_IMAGE` | `arche-workspace:latest` |
| `CLOUDFLARED_IMAGE` | `docker.io/cloudflare/cloudflared:2026.5.0` |
| `PODMAN_SOCKET_PATH` | Auto-detected (see below) |
| `ARCHE_PUBLIC_BASE_URL` | Derived from request origin unless set; in tunnel mode defaults to `https://<domain>` |
| `ARCHE_SESSION_TTL_DAYS` | `7` |
| `ARCHE_USERS_PATH` | `/opt/arche/users` remote, `~/.arche/users` local-dev |
| `KB_CONTENT_HOST_PATH` | `/opt/arche/kb-content` remote, `~/.arche/kb-content` local-dev |
| `KB_CONFIG_HOST_PATH` | `/opt/arche/kb-config` remote, `~/.arche/kb-config` local-dev |
| `ARCHE_CONNECTOR_GATEWAY_BASE_URL` | `http://web:3000/api/internal/mcp/connectors` |
| `ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET` | Falls back to `ARCHE_GATEWAY_TOKEN_SECRET` |
| `ARCHE_CONNECTOR_GOOGLE_CLIENT_ID` | Empty |
| `ARCHE_CONNECTOR_GOOGLE_CLIENT_SECRET` | Empty |
| `ARCHE_CONNECTOR_META_ADS_GRAPH_API_VERSION` | `v25.0` |

To build the web image directly on the VPS, set `WEB_IMAGE=arche-web:latest`.
To build the workspace image directly on the VPS, set `OPENCODE_IMAGE=arche-workspace:latest`.
Published GHCR tags stay amd64 by default. If you need arm64, use the matching `-arm64` tag explicitly, for example `WEB_IMAGE=ghcr.io/peaberry-studio/arche/web:latest-arm64` and `OPENCODE_IMAGE=ghcr.io/peaberry-studio/arche/workspace:latest-arm64`.

Connector-specific OAuth and MCP overrides are optional and documented in `.env.example` and `apps/web/.env.example`.

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

HTTP-01 challenge is used in direct remote mode. Make sure your domain resolves to the VPS and ports `80/443` are reachable. Cloudflare Tunnel mode does not use ACME on the VPS.

## Services

| Service | Image | Purpose |
|---------|-------|---------|
| Traefik | `traefik:v3.6.7` | Reverse proxy, direct-mode TLS termination, routing |
| cloudflared | `cloudflare/cloudflared:2026.5.0` | Cloudflare Tunnel client in tunnel mode |
| docker-socket-proxy | `ghcr.io/tecnativa/docker-socket-proxy:latest` | Secure container API access |
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

# Check reboot autostart (bounded to 5 service retries)
systemctl status arche-autostart.service
journalctl -u arche-autostart.service -n 100 --no-pager

# Check current web and workspace containers
podman ps -a --filter label=arche.role=web
podman ps -a --filter label=arche.managed=true

# Re-deploy (from local machine)
./deploy.sh --ip <IP> --domain <DOMAIN> --ssh-key <KEY> --acme-email <EMAIL> [--skip-ensure-dns-record]

# Re-deploy in Cloudflare Tunnel mode (from local machine)
./deploy.sh --ip <IP> --domain <DOMAIN> --ssh-key <KEY> --cloudflare-tunnel
```

## Troubleshooting

**SSH connection fails**: Ensure the SSH key has access and the user can log in (`ssh -i <key> <user>@<ip>`).

**ACME certificate not issued**: Check Traefik logs (`podman compose logs traefik`). Verify domain A/AAAA records point to the VPS and ports `80/443` are reachable.

**Cloudflare Tunnel returns 502/1033**: Check `podman compose logs cloudflared` and verify the Cloudflare public hostname service is `http://traefik:80`.

**Web service unhealthy**: Check web logs (`podman compose logs web`). Ensure `DATABASE_URL` is correct and Postgres is running.

**Container stays stopped after repeated failures**: Arche containers use `on-failure:5`. After five crash restarts, Podman stops retrying until manual intervention or the next reboot autostart. Check `podman ps -a`, `journalctl -u arche-autostart.service`, and the container logs before starting it again.

**Migrations fail**: Ensure the container image includes the `prisma/` directory. The Containerfile should have `COPY --from=build /app/prisma ./prisma`.

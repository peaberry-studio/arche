# Arche One-Click Deployer

Deploy Arche to a VPS or run the production stack locally for testing.

## Architecture

```
Local Machine
  ./deploy.sh --ip X --domain Y --dns-provider Z --ssh-key K --acme-email E
              │ SSH (Ansible)
              ▼
Remote VPS (/opt/arche)
  ┌──────────────────────────────────────────────────────────┐
  │ Podman                                                    │
  │  ┌──────────────────┐                                     │
  │  │ Traefik           │ :80 → :443 (TLS/ACME wildcard)    │
  │  │ Container provider│──► docker-socket-proxy :2375       │
  │  │ forwardAuth       │                                    │
  │  └────────┬─────────┘                                     │
  │           │                                                │
  │     ┌─────┴──────┐                                        │
  │     │            │                                         │
  │     ▼            ▼                                         │
  │  arche.dom    u-<slug>.arche.dom                          │
  │  ┌──────────────────────────────────────────┐             │
  │  │ Arche Web (Next.js)                       │             │
  │  │ BFF + spawner + forwardAuth               │             │
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

The deployer has two modes: **local** for testing the production stack on your machine, and **remote** for deploying to a VPS.

### Local mode

Runs the full production stack (Traefik, Postgres, Web) on your machine using Podman. Useful for testing the production image, Traefik routing, and the complete compose setup without a VPS.

- Domain: `arche.lvh.me` (resolves to `127.0.0.1`, no `/etc/hosts` needed)
- No TLS (HTTP only on port 8080)
- No SSH — Ansible runs locally to render templates
- Secrets default to insecure dev values if not set
- Podman socket is auto-detected (macOS Podman Machine and Linux both supported)

```bash
cd infra/deploy
cp .env.example .env   # edit if needed, defaults work for local
./deploy.sh --local
```

Open http://arche.lvh.me:8080 — login with `admin@example.com` / `change-me`.

### Remote mode

Deploys to a VPS via SSH using Ansible. The playbook provisions Podman (if missing), renders the compose and env templates, pulls images from GHCR, runs migrations, and seeds the database.

- Domain: your production domain with wildcard TLS via ACME DNS challenge
- HTTPS on port 443, HTTP redirects to HTTPS
- Requires all secrets set in `.env` or exported
- Requires SSH access and a DNS provider token for wildcard certs

```bash
cd infra/deploy
cp .env.example .env
# Fill in all required values in .env

./deploy.sh \
  --ip 203.0.113.50 \
  --domain arche.example.com \
  --dns-provider cloudflare \
  --ssh-key ~/.ssh/id_rsa \
  --acme-email admin@example.com
```

## CLI Reference

### Remote flags

| Flag | Required | Description |
|------|----------|-------------|
| `--ip` | Yes | VPS IP address |
| `--domain` | Yes | Production domain |
| `--dns-provider` | Yes | `cloudflare`, `route53`, or `digitalocean` |
| `--ssh-key` | Yes | Path to SSH private key |
| `--acme-email` | Yes | Let's Encrypt ACME email |
| `--user` | No | SSH user (default: `root`) |
| `--dry-run` | No | Show what would be done |
| `--verbose` | No | Verbose Ansible output |

### Local flag

| Flag | Description |
|------|-------------|
| `--local` | Run production stack locally (mutually exclusive with remote flags) |

## Environment Variables

Set in `.env` or export before running `deploy.sh`.

### Required (remote)

| Variable | Description |
|----------|-------------|
| `GHCR_TOKEN` | GitHub Container Registry token |
| `POSTGRES_PASSWORD` | Database password |
| `ARCHE_SESSION_PEPPER` | Session pepper (`openssl rand -base64 32`) |
| `ARCHE_ENCRYPTION_KEY` | Encryption key (`openssl rand -base64 32`) |
| `ARCHE_INTERNAL_TOKEN` | Internal API token (`openssl rand -base64 32`) |
| `ARCHE_SEED_ADMIN_EMAIL` | Seed admin email |
| `ARCHE_SEED_ADMIN_PASSWORD` | Seed admin password |
| `ARCHE_SEED_ADMIN_SLUG` | Seed admin URL slug |

### DNS provider tokens

| Provider | Variable(s) |
|----------|-------------|
| `cloudflare` | `CF_DNS_API_TOKEN` |
| `route53` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| `digitalocean` | `DO_AUTH_TOKEN` |

### Optional overrides

| Variable | Default |
|----------|---------|
| `IMAGE_PREFIX` | `ghcr.io/peaberry-studio/arche/` |
| `WEB_VERSION` | `latest` |
| `OPENCODE_IMAGE` | `ghcr.io/anomalyco/opencode:1.1.45` |
| `PODMAN_SOCKET_PATH` | Auto-detected (see below) |

## Podman Socket

The `docker-socket-proxy` container needs access to the Podman socket. The deployer auto-detects the correct path:

| Context | Socket path |
|---------|-------------|
| Linux rootful Podman (VPS) | `/run/podman/podman.sock` |
| macOS Podman Machine (dev) | `/run/user/<uid>/podman/podman.sock` (VM-internal) |

In local mode on macOS, the proxy runs with `user: root` and `security_opt: [label=disable]` to access the rootless socket inside the Podman VM.

To override, set `PODMAN_SOCKET_PATH` before running `deploy.sh`.

## Auto-Detection

On remote deploys, the playbook auto-detects whether Podman and a `deploy` user exist. If either is missing, it runs the `common` and `podman` roles to provision the server. On subsequent deploys, only the `app` role runs.

## DNS Provider Notes

Only DNS-01 challenge providers are supported. Arche requires **wildcard certs** for dynamic user subdomains (`u-<slug>.<domain>`), which can only be obtained via DNS challenge.

HTTP-01 challenge is **not** supported.

## Services

| Service | Image | Purpose |
|---------|-------|---------|
| Traefik | `traefik:v3.6.7` | Reverse proxy, TLS termination, routing |
| docker-socket-proxy | `tecnativa/docker-socket-proxy:0.3` | Secure container API access |
| PostgreSQL | `postgres:16` | Database |
| Web | GHCR image | Next.js app (BFF + spawner + forwardAuth) |

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
./deploy.sh --ip <IP> --domain <DOMAIN> --dns-provider <PROVIDER> \
            --ssh-key <KEY> --acme-email <EMAIL>
```

## Troubleshooting

**SSH connection fails**: Ensure the SSH key has access and the user can log in (`ssh -i <key> <user>@<ip>`).

**ACME certificate not issued**: Check Traefik logs (`podman compose logs traefik`). Verify DNS provider token is correct and has zone edit permissions.

**Web service unhealthy**: Check web logs (`podman compose logs web`). Ensure `DATABASE_URL` is correct and Postgres is running.

**Migrations fail**: Ensure the container image includes the `prisma/` directory. The Containerfile should have `COPY --from=build /app/prisma ./prisma`.

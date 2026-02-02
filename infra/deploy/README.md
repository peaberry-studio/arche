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

## Quick Start

### Local mode (test the production stack)

```bash
cd infra/deploy
cp .env.example .env   # edit if needed, defaults work for local
./deploy.sh --local
```

Local mode requires Ansible to render templates (`pip install ansible`), but does not need SSH.

Open http://arche.lvh.me — login with `admin@example.com` / `change-me`.

### Remote mode (deploy to VPS)

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
├── docker-compose.yml
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

# Arche — Dokploy Template

This directory contains a Dokploy blueprint-ready template for Arche.

## Included files

- `arche/docker-compose.yml`: runtime stack (`web`, `postgres`, `docker-socket-proxy`)
- `arche/template.toml`: Dokploy variables, domain wiring, and env mapping
- `arche/instructions.md`: deployment prerequisites, deploy steps, and troubleshooting

## Local import into Dokploy

1. In Dokploy, create/import a template using these files.
2. Use `arche/template.toml` and `arche/docker-compose.yml`.
3. Follow `arche/instructions.md`.

## Required variable groups

- Domain and app:
  - `ARCHE_DOMAIN`
  - `WEB_IMAGE`
- Secrets:
  - `POSTGRES_PASSWORD`
  - `ARCHE_SESSION_PEPPER`
  - `ARCHE_ENCRYPTION_KEY`
  - `ARCHE_INTERNAL_TOKEN`
  - `ARCHE_GATEWAY_TOKEN_SECRET`
  - `ARCHE_CONNECTOR_OAUTH_STATE_SECRET`
- Admin bootstrap:
  - `ARCHE_SEED_ADMIN_EMAIL`
  - `ARCHE_SEED_ADMIN_PASSWORD`
- Spawner/runtime:
  - `OPENCODE_IMAGE`
  - `OPENCODE_NETWORK`
  - `KB_CONTENT_HOST_PATH`
  - `KB_CONFIG_HOST_PATH`

## Secret generation (optional manual override)

If you prefer setting your own secrets instead of Dokploy-generated defaults:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "ARCHE_SESSION_PEPPER=$(openssl rand -base64 32)"
echo "ARCHE_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "ARCHE_INTERNAL_TOKEN=$(openssl rand -base64 32)"
echo "ARCHE_GATEWAY_TOKEN_SECRET=$(openssl rand -base64 32)"
echo "ARCHE_CONNECTOR_OAUTH_STATE_SECRET=$(openssl rand -base64 32)"
echo "ARCHE_SEED_ADMIN_PASSWORD=$(openssl rand -base64 18)"
```

## Validation checklist

- `web` health endpoint returns 200 at `/api/health`.
- Admin login works with seeded credentials.
- New workspace can be created and started.
- Postgres has persistent data after stack restart.

## Rollback

- Redeploy the previous successful deployment in Dokploy.
- If image tags changed, roll back `WEB_IMAGE` and/or `OPENCODE_IMAGE` to prior known-good tags.

## Publish to Dokploy templates repository

Use the same structure as Dokploy blueprint examples (e.g. Ackee):
- `blueprints/<template-name>/docker-compose.yml`
- `blueprints/<template-name>/template.toml`
- `blueprints/<template-name>/instructions.md`
- `blueprints/<template-name>/logo.png` (optional but recommended)

Suggested publish flow:
1. Copy `infra/dokploy/arche/*` to `blueprints/arche/`.
2. Add a `logo.png`.
3. Validate by deploying from a clean Dokploy project.
4. Open PR with:
   - short description
   - deploy screenshots/logs
   - test notes for health, login, and workspace spawn

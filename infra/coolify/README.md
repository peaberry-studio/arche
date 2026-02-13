# Arche — Coolify Deployment

Deploy Arche on a Coolify-managed VPS.

## Deployment Options

There are two ways to deploy Arche on Coolify:

| Approach | Zero-Downtime | DB Backups | Complexity |
|----------|--------------|------------|------------|
| **Recommended: Separate resources** | Yes (native rolling updates) | Yes (Coolify managed) | Medium |
| Legacy: Docker Compose | No (recreate strategy) | Manual | Simple |

---

## Recommended: Separate Coolify Resources

This approach deploys each service as a separate Coolify resource, enabling **native zero-downtime rolling updates** for the web app.

### Architecture

```
Coolify Proxy (Traefik)
       |
       v routes to :3000
+----------------------------------------------+
|  web (Coolify Application)                   |
|  - GitHub repo, Dockerfile build pack        |
|  - Rolling updates via HEALTHCHECK           |
|  - Migrations run at startup (start.sh)      |
+------+---------------------------------------+
       |
       v
+------+-------+  +----------------------------+
| postgres     |  | docker-socket-proxy        |
| (Coolify DB) |  | (Coolify Service)          |
+--------------+  +----------------------------+
                         |
                         v spawns
                  +----------------------------+
                  | OpenCode containers        |
                  | (on arche_internal network) |
                  +----------------------------+
```

### Step 1: Create PostgreSQL Database

1. In Coolify, create a **Database** resource (PostgreSQL 16)
2. Note the connection string Coolify generates
3. Configure automated backups in the database settings

### Step 2: Deploy docker-socket-proxy

1. Create a **Service** or **Application** resource
2. Use Docker Image: `ghcr.io/tecnativa/docker-socket-proxy:master`
3. Set environment variables:
   ```
   CONTAINERS=1
   NETWORKS=1
   IMAGES=1
   INFO=1
   POST=1
   VOLUMES=1
   ```
4. Mount volume: `/var/run/docker.sock:/var/run/docker.sock:ro`
5. Enable **"Connect to Predefined Network"** and set the network to `arche_internal`
6. No domain needed (internal only)

### Step 3: Create the arche_internal network

On the VPS:
```bash
docker network create arche_internal
```

### Step 4: Deploy web application

1. Create an **Application** resource
2. Source: **GitHub repository** (`peaberry-studio/arche`)
3. Branch: `main`
4. Build pack: **Dockerfile**
5. Dockerfile path: `apps/web/Containerfile`
6. Build context: `apps/web`
7. Enable **"Connect to Predefined Network"** and set to `arche_internal`
8. Set domain in Coolify's domain settings

### Step 5: Configure environment variables

Set these in the web application's environment variables in Coolify:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string from Step 1 |
| `ARCHE_DOMAIN` | Yes | Your domain (e.g., `arche.example.com`) |
| `ARCHE_SESSION_PEPPER` | Yes | `openssl rand -base64 32` |
| `ARCHE_ENCRYPTION_KEY` | Yes | `openssl rand -base64 32` |
| `ARCHE_INTERNAL_TOKEN` | Yes | `openssl rand -base64 32` |
| `ARCHE_GATEWAY_TOKEN_SECRET` | Yes | `openssl rand -base64 32` |
| `ARCHE_GATEWAY_TOKEN_TTL_SECONDS` | No | Default: `86400` (24h) |
| `ARCHE_GATEWAY_BASE_URL` | No | Default: `http://localhost:3000` |
| `ARCHE_COOKIE_SECURE` | No | Default: `true` |
| `ARCHE_SEED_ADMIN_EMAIL` | Yes | Initial admin email |
| `ARCHE_SEED_ADMIN_PASSWORD` | Yes | Initial admin password |
| `ARCHE_SEED_ADMIN_SLUG` | No | Default: `admin` |
| `CONTAINER_PROXY_HOST` | Yes | Hostname of docker-socket-proxy (use the Coolify service name) |
| `CONTAINER_PROXY_PORT` | Yes | `2375` |
| `OPENCODE_IMAGE` | No | Default: `ghcr.io/anomalyco/opencode:1.1.45` |
| `OPENCODE_NETWORK` | Yes | `arche_internal` |

### Step 6: Deploy

Click **Deploy** in Coolify. The web app will:
1. Build from the Dockerfile
2. Start the container
3. Run database migrations automatically (`start.sh`)
4. Begin serving once the health check passes

### How updates work

1. Push changes to the GitHub repository
2. In Coolify, click **Redeploy** (or configure auto-deploy via webhook)
3. Coolify builds the new image
4. Starts a new container alongside the old one
5. Waits for the `HEALTHCHECK` to pass (health check hits `GET /api/health`)
6. Switches Traefik routing to the new container
7. Stops the old container

**Zero downtime.** If the new container fails to become healthy, the old one keeps serving.

### Rollback

1. In Coolify, go to **Deployments** for the web application
2. Find the previous successful deployment
3. Click **Redeploy** on that deployment

---

## Legacy: Docker Compose

For simpler setups where brief downtime during deploys is acceptable.

> **Note:** Docker Compose resources in Coolify do NOT support rolling updates.
> Each deploy causes a brief restart (~10-30s downtime).

### Setup

1. Create a **Docker Compose** resource in Coolify
2. Source: GitHub repository (`peaberry-studio/arche`)
3. Docker Compose Location: `infra/coolify/docker-compose.yml`
4. Configure environment variables in Coolify UI (same as table above, plus `SERVICE_PASSWORD_POSTGRES` is auto-generated by Coolify)
5. Set domain for the `web` service
6. Deploy

### Updates

1. Push changes to GitHub
2. Click **Redeploy** in Coolify
3. Coolify rebuilds and restarts the stack (brief downtime)

---

## Knowledge Base Setup (Optional)

On the VPS:
```bash
mkdir -p /opt/arche
git init --bare --initial-branch=main /opt/arche/kb-content
git init --bare --initial-branch=main /opt/arche/kb-config
```

Set `KB_HOST_PATH=/opt/arche/kb` in the web app environment variables.

## Custom Workspace Image (Optional)

```bash
git clone https://github.com/peaberry-studio/arche.git /tmp/arche
docker build -t arche-workspace:latest /tmp/arche/infra/workspace-image
```

Set `OPENCODE_IMAGE=arche-workspace:latest` in the web app environment variables.

## Troubleshooting

### Health check failing
```bash
# Check web container logs
docker logs <web-container-id>

# Test health endpoint manually
curl http://localhost:3000/api/health
```

### Database connection errors
```bash
# Verify PostgreSQL is accessible
docker exec <postgres-container> pg_isready -U postgres
```

### Network issues between services
```bash
# Verify the arche_internal network exists
docker network ls | grep arche_internal

# Verify containers are connected
docker network inspect arche_internal
```

# Spawner + Runtime OpenCode - Diseño

**Issue:** https://github.com/peaberry-studio/arche/issues/3
**Fecha:** 2026-01-31
**Asignado a:** José Miguel Hernández

## Objetivo

Implementar el Spawner para crear/parar instancias `opencode-<slug>` por usuario, con credenciales y networking interno seguro.

## Scope MVP

**Incluido:**
- Core: `start(slug)`, `stop(slug)`, `status(slug)`
- Lifecycle: Idle reaper basado en `lastActivityAt`
- Modelo de datos `Instance`
- UI básica con controles start/stop y estado

**Fuera de scope (para después):**
- MCP Server (preparado para añadir)
- 2FA en instancias
- Multi-host / clustering

## Decisiones técnicas

| Aspecto | Decisión | Razón |
|---------|----------|-------|
| Docker client | `dockerode` | Estándar, mantenido, escalable para equipos |
| Imagen OpenCode | `ghcr.io/anomalyco/opencode:1.1.45` | Oficial, multi-arch |
| API interna | Server Actions | UI-first, core agnóstico para MCP futuro |
| Networking | Docker network interno, puerto fijo 4096 | Simple, sin gestión de puertos |
| Encriptación passwords | AES-256-GCM, clave en env | Seguro, sin dependencias externas |
| Idle detection | OCPROXY actualiza `lastActivityAt` | No depende de OpenCode |

## Dependencias

| Qué | Quién | Estado |
|-----|-------|--------|
| Schema Prisma (`User`, `Session`) | Iñaki | PR `issue-2-auth-sesiones-forwardauth` pendiente de merge |
| `docker-socket-proxy` en compose | Alberto | Por hacer |
| Red Docker `arche-internal` | Alberto | Por hacer |

**Bloqueante:** Esperar merge del PR de Iñaki antes de añadir modelo `Instance` al schema.

## Modelo de datos

Añadir a `apps/web/prisma/schema.prisma`:

```prisma
enum InstanceStatus {
  starting
  running
  stopped
  error
}

model Instance {
  id              String         @id @default(cuid())
  slug            String         @unique

  status          InstanceStatus @default(stopped)

  createdAt       DateTime       @default(now()) @map("created_at")
  startedAt       DateTime?      @map("started_at")
  stoppedAt       DateTime?      @map("stopped_at")
  lastActivityAt  DateTime?      @map("last_activity_at")

  containerId     String?        @map("container_id")
  serverPassword  String         @map("server_password")  // AES-256-GCM

  user            User           @relation(fields: [slug], references: [slug])

  @@index([status])
  @@map("instances")
}
```

Añadir a `User`:
```prisma
model User {
  // ... campos existentes ...
  instance    Instance?
}
```

## Transiciones de estado

```
stopped ──start()──► starting ──healthy──► running
                         │                    │
                         │ timeout(120s)      │ crash/stop()
                         ▼                    ▼
                       error ◄───crash───── stopped
                         │
                         │ stop()
                         ▼
                      stopped
```

**Tiempos de start:**
- `< 15s`: Normal
- `15s - 120s`: "Tardando más de lo esperado..." (warning en UI, sigue intentando)
- `> 120s`: Timeout real → estado `error`

## Estructura de archivos

```
apps/web/src/
├── lib/spawner/
│   ├── config.ts       # Getters de configuración
│   ├── crypto.ts       # AES-256-GCM encrypt/decrypt
│   ├── docker.ts       # Wrapper dockerode
│   ├── core.ts         # start, stop, status
│   ├── reaper.ts       # Idle reaper
│   └── index.ts        # Re-exports
├── actions/
│   └── spawner.ts      # Server Actions
├── app/api/instances/[slug]/activity/
│   └── route.ts        # PATCH lastActivityAt (para OCPROXY)
└── components/
    └── instance-controls.tsx  # UI controles
```

## Variables de entorno

```bash
# === Spawner ===

# Encriptación (REQUERIDO en producción)
# Generar: openssl rand -base64 32
ARCHE_ENCRYPTION_KEY=

# Container socket proxy
CONTAINER_PROXY_HOST=docker-socket-proxy
CONTAINER_PROXY_PORT=2375

# Imagen OpenCode
OPENCODE_IMAGE=ghcr.io/anomalyco/opencode:1.1.45

# Red interna de contenedores
OPENCODE_NETWORK=arche-internal

# Tiempos de start (ms)
ARCHE_START_EXPECTED_MS=15000
ARCHE_START_TIMEOUT_MS=120000

# Idle reaper (minutos)
ARCHE_IDLE_TIMEOUT_MINUTES=30

# Token interno para OCPROXY
# Generar: openssl rand -base64 32
ARCHE_INTERNAL_TOKEN=
```

## Implementación

### `lib/spawner/config.ts`

```typescript
export function getEncryptionKey(): Buffer {
  const key = process.env.ARCHE_ENCRYPTION_KEY
  if (key) return Buffer.from(key, 'base64')
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ARCHE_ENCRYPTION_KEY is required in production')
  }
  return Buffer.from('dev-insecure-key-32-bytes-long!!')
}

export function getContainerProxyUrl(): string {
  const host = process.env.CONTAINER_PROXY_HOST || 'docker-socket-proxy'
  const port = process.env.CONTAINER_PROXY_PORT || '2375'
  return `http://${host}:${port}`
}

export function getOpencodeImage(): string {
  return process.env.OPENCODE_IMAGE || 'ghcr.io/anomalyco/opencode:1.1.45'
}

export function getOpencodeNetwork(): string {
  return process.env.OPENCODE_NETWORK || 'arche-internal'
}

export function getStartExpectedMs(): number {
  const raw = process.env.ARCHE_START_EXPECTED_MS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000
}

export function getStartTimeoutMs(): number {
  const raw = process.env.ARCHE_START_TIMEOUT_MS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000
}

export function getIdleTimeoutMinutes(): number {
  const raw = process.env.ARCHE_IDLE_TIMEOUT_MINUTES
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30
}
```

### `lib/spawner/crypto.ts`

```typescript
import crypto from 'node:crypto'
import { getEncryptionKey } from './config'

const ALGORITHM = 'aes-256-gcm'

export function generatePassword(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function encryptPassword(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptPassword(encoded: string): string {
  const key = getEncryptionKey()
  const [ivB64, authTagB64, encryptedB64] = encoded.split(':')
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const encrypted = Buffer.from(encryptedB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8')
}
```

### `lib/spawner/docker.ts`

```typescript
import Docker from 'dockerode'
import { getDockerProxyUrl, getOpencodeImage, getOpencodeNetwork } from './config'

function getDockerClient(): Docker {
  const url = new URL(getDockerProxyUrl())
  return new Docker({
    host: url.hostname,
    port: parseInt(url.port),
  })
}

export async function createContainer(slug: string, password: string) {
  const docker = getDockerClient()
  const containerName = `opencode-${slug}`

  return docker.createContainer({
    Image: getOpencodeImage(),
    name: containerName,
    Cmd: ['opencode', 'serve', '--hostname', '0.0.0.0', '--port', '4096'],
    Env: [
      `OPENCODE_SERVER_PASSWORD=${password}`,
      `OPENCODE_SERVER_USERNAME=opencode`,
    ],
    HostConfig: {
      NetworkMode: getOpencodeNetwork(),
      RestartPolicy: { Name: 'unless-stopped' },
    },
    Labels: {
      'arche.managed': 'true',
      'arche.user.slug': slug,
    },
  })
}

export async function startContainer(containerId: string): Promise<void> {
  const docker = getDockerClient()
  const container = docker.getContainer(containerId)
  await container.start()
}

export async function stopContainer(containerId: string): Promise<void> {
  const docker = getDockerClient()
  const container = docker.getContainer(containerId)
  await container.stop({ t: 10 })
}

export async function removeContainer(containerId: string): Promise<void> {
  const docker = getDockerClient()
  const container = docker.getContainer(containerId)
  await container.remove({ force: true })
}

export async function inspectContainer(containerId: string) {
  const docker = getDockerClient()
  const container = docker.getContainer(containerId)
  return container.inspect()
}

export async function isContainerRunning(containerId: string): Promise<boolean> {
  try {
    const info = await inspectContainer(containerId)
    return info.State.Running
  } catch {
    return false
  }
}
```

### `lib/spawner/core.ts`

```typescript
import { prisma } from '@/lib/prisma'
import { auditEvent } from '@/lib/auth'
import * as docker from './docker'
import { generatePassword, encryptPassword, decryptPassword } from './crypto'
import { getStartExpectedMs, getStartTimeoutMs } from './config'

export type StartResult =
  | { ok: true; status: 'running' }
  | { ok: false; error: 'already_running' | 'start_failed' | 'timeout' }

export type StopResult =
  | { ok: true; status: 'stopped' }
  | { ok: false; error: 'not_running' | 'stop_failed' }

export async function startInstance(slug: string, userId: string): Promise<StartResult> {
  const existing = await prisma.instance.findUnique({ where: { slug } })

  if (existing?.status === 'running') {
    return { ok: false, error: 'already_running' }
  }

  const password = generatePassword()
  const encryptedPassword = encryptPassword(password)

  await prisma.instance.upsert({
    where: { slug },
    create: {
      slug,
      status: 'starting',
      serverPassword: encryptedPassword,
      startedAt: new Date(),
    },
    update: {
      status: 'starting',
      serverPassword: encryptedPassword,
      startedAt: new Date(),
      stoppedAt: null,
      containerId: null,
    },
  })

  try {
    const container = await docker.createContainer(slug, password)
    await docker.startContainer(container.id)

    await prisma.instance.update({
      where: { slug },
      data: { containerId: container.id },
    })

    const healthy = await waitForHealthy(container.id)

    if (!healthy) {
      await docker.stopContainer(container.id).catch(() => {})
      await docker.removeContainer(container.id).catch(() => {})
      await prisma.instance.update({
        where: { slug },
        data: { status: 'error', containerId: null },
      })
      return { ok: false, error: 'timeout' }
    }

    await prisma.instance.update({
      where: { slug },
      data: { status: 'running', lastActivityAt: new Date() },
    })

    await auditEvent({
      actorUserId: userId,
      action: 'instance.started',
      metadata: { slug },
    })

    return { ok: true, status: 'running' }
  } catch (err) {
    await prisma.instance.update({
      where: { slug },
      data: { status: 'error' },
    }).catch(() => {})

    return { ok: false, error: 'start_failed' }
  }
}

export async function stopInstance(slug: string, userId: string): Promise<StopResult> {
  const instance = await prisma.instance.findUnique({ where: { slug } })

  if (!instance || instance.status === 'stopped') {
    return { ok: false, error: 'not_running' }
  }

  try {
    if (instance.containerId) {
      await docker.stopContainer(instance.containerId).catch(() => {})
      await docker.removeContainer(instance.containerId).catch(() => {})
    }

    await prisma.instance.update({
      where: { slug },
      data: {
        status: 'stopped',
        stoppedAt: new Date(),
        containerId: null,
      },
    })

    await auditEvent({
      actorUserId: userId,
      action: 'instance.stopped',
      metadata: { slug },
    })

    return { ok: true, status: 'stopped' }
  } catch {
    return { ok: false, error: 'stop_failed' }
  }
}

export async function getInstanceStatus(slug: string) {
  return prisma.instance.findUnique({
    where: { slug },
    select: {
      status: true,
      startedAt: true,
      stoppedAt: true,
      lastActivityAt: true,
    },
  })
}

export function isSlowStart(instance: { status: string; startedAt: Date | null } | null): boolean {
  if (!instance || instance.status !== 'starting' || !instance.startedAt) {
    return false
  }
  const elapsed = Date.now() - instance.startedAt.getTime()
  return elapsed > getStartExpectedMs()
}

async function waitForHealthy(containerId: string): Promise<boolean> {
  const timeout = getStartTimeoutMs()
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const running = await docker.isContainerRunning(containerId)
    if (running) return true
    await new Promise(r => setTimeout(r, 1000))
  }

  return false
}
```

### `lib/spawner/reaper.ts`

```typescript
import { prisma } from '@/lib/prisma'
import { getIdleTimeoutMinutes } from './config'
import * as docker from './docker'
import { auditEvent } from '@/lib/auth'

let reaperInterval: NodeJS.Timeout | null = null

export async function reapIdleInstances(): Promise<number> {
  const timeoutMinutes = getIdleTimeoutMinutes()
  const threshold = new Date(Date.now() - timeoutMinutes * 60 * 1000)

  const idleInstances = await prisma.instance.findMany({
    where: {
      status: 'running',
      lastActivityAt: { lt: threshold },
    },
  })

  let reapedCount = 0

  for (const instance of idleInstances) {
    try {
      if (instance.containerId) {
        await docker.stopContainer(instance.containerId).catch(() => {})
        await docker.removeContainer(instance.containerId).catch(() => {})
      }

      await prisma.instance.update({
        where: { id: instance.id },
        data: {
          status: 'stopped',
          stoppedAt: new Date(),
          containerId: null,
        },
      })

      await auditEvent({
        actorUserId: null,
        action: 'instance.reaped_idle',
        metadata: {
          slug: instance.slug,
          lastActivityAt: instance.lastActivityAt,
          idleMinutes: timeoutMinutes,
        },
      })

      reapedCount++
    } catch {
      // best-effort
    }
  }

  return reapedCount
}

export function startReaper(): void {
  if (reaperInterval) return
  const REAPER_INTERVAL_MS = 5 * 60 * 1000

  reaperInterval = setInterval(async () => {
    try {
      const count = await reapIdleInstances()
      if (count > 0) {
        console.error(`[reaper] Stopped ${count} idle instance(s)`)
      }
    } catch (err) {
      console.error('[reaper] Error:', err)
    }
  }, REAPER_INTERVAL_MS)

  reapIdleInstances().catch(() => {})
}

export function stopReaper(): void {
  if (reaperInterval) {
    clearInterval(reaperInterval)
    reaperInterval = null
  }
}
```

## Plan de implementación

### Fase 1: Setup (sin dependencia de merge)

1. Instalar dependencia `dockerode`
2. Crear `lib/spawner/config.ts`
3. Crear `lib/spawner/crypto.ts`
4. Crear `lib/spawner/docker.ts`
5. Tests unitarios para crypto y config

### Fase 2: Post-merge de Iñaki

1. Añadir modelo `Instance` a Prisma schema
2. Ejecutar migración
3. Crear `lib/spawner/core.ts`
4. Crear `lib/spawner/reaper.ts`
5. Crear Server Actions
6. Crear UI `instance-controls.tsx`
7. Tests de integración

### Fase 3: Integración con Infra (Alberto)

1. Verificar `docker-socket-proxy` funciona
2. Verificar red `arche-internal`
3. Test end-to-end: start → running → idle → reaped

## Contratos a respetar

- Estados de instancia: `starting` / `running` / `stopped` / `error`
- El BFF nunca habla con Docker directo: usa `docker-socket-proxy`
- Container naming: `opencode-{slug}`
- Network: `arche-internal`
- Puerto interno: `4096` (fijo)

## Consideraciones futuras

- **MCP:** El core es agnóstico, se puede añadir Route Handler `/mcp` después
- **Encriptación:** Migrar de env var a archivo en disco si se necesita más seguridad
- **Multi-host:** Requeriría orquestador (Kubernetes/Nomad), rewrite significativo

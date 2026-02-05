# MCP Connectors Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generar configuración MCP desde conectores habilitados y cargarla en OpenCode al iniciar la instancia.

**Architecture:** Construir config MCP en backend (`mcp-config.ts`), inyectarla con `OPENCODE_CONFIG_CONTENT` en `createContainer`, y asegurar que la imagen tenga `nodejs`/`npm` para MCPs locales.

**Tech Stack:** Next.js (app router), Prisma, Vitest, Dockerode, Alpine (Containerfile).

---

### Task 1: Requerir `teamId` en el conector Slack

**Files:**
- Modify: `apps/web/tests/connectors.test.ts`
- Modify: `apps/web/src/lib/connectors/validators.ts`

**Step 1: Write the failing test**

```ts
it('validates required fields for slack', () => {
  const valid = validateConnectorConfig('slack', { botToken: 'xoxb-xxx', teamId: 'T123' })
  expect(valid).toEqual({ valid: true })

  const invalid = validateConnectorConfig('slack', { botToken: 'xoxb-xxx' })
  expect(invalid.valid).toBe(false)
  expect(invalid.missing).toContain('teamId')
})
```

**Step 2: Run test to verify it fails**

Run (from `apps/web`): `pnpm test -- tests/connectors.test.ts`

Expected: FAIL con missing `teamId` para Slack.

**Step 3: Write minimal implementation**

```ts
slack: { required: ['botToken', 'teamId'], optional: ['appToken'] },
```

**Step 4: Run test to verify it passes**

Run (from `apps/web`): `pnpm test -- tests/connectors.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/tests/connectors.test.ts apps/web/src/lib/connectors/validators.ts
git commit -m "feat: require slack teamId in connector validation"
```

### Task 2: Construir configuración MCP desde conectores

**Files:**
- Create: `apps/web/src/lib/spawner/mcp-config.ts`
- Create: `apps/web/tests/mcp-config.test.ts`
- Modify: `apps/web/src/lib/spawner/index.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { encryptConfig } from '@/lib/connectors/crypto'
import { buildMcpConfigFromConnectors } from '@/lib/spawner/mcp-config'

it('builds MCP config for enabled connectors', () => {
  const connectors = [
    {
      id: 'c1',
      type: 'github',
      name: 'GitHub',
      enabled: true,
      config: encryptConfig({ token: 'ghp_123' }),
    },
    {
      id: 'c2',
      type: 'slack',
      name: 'Slack',
      enabled: true,
      config: encryptConfig({ botToken: 'xoxb-1', teamId: 'T123', appToken: 'xapp-1' }),
    },
    {
      id: 'c3',
      type: 'custom',
      name: 'Custom',
      enabled: true,
      config: encryptConfig({
        endpoint: 'https://api.example.com/mcp',
        headers: { 'X-Token': 'abc' },
        auth: 'secret',
      }),
    },
  ]

  const result = buildMcpConfigFromConnectors(connectors)

  expect(result.mcp.arche_github_c1).toEqual({
    type: 'local',
    command: ['npx', '-y', '@modelcontextprotocol/server-github'],
    enabled: true,
    environment: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_123' },
  })

  expect(result.mcp.arche_slack_c2).toEqual({
    type: 'local',
    command: ['npx', '-y', '@modelcontextprotocol/server-slack'],
    enabled: true,
    environment: {
      SLACK_BOT_TOKEN: 'xoxb-1',
      SLACK_TEAM_ID: 'T123',
      SLACK_APP_TOKEN: 'xapp-1',
    },
  })

  expect(result.mcp.arche_custom_c3).toEqual({
    type: 'remote',
    url: 'https://api.example.com/mcp',
    enabled: true,
    oauth: false,
    headers: {
      'X-Token': 'abc',
      Authorization: 'Bearer secret',
    },
  })
})
```

**Step 2: Run test to verify it fails**

Run (from `apps/web`): `pnpm test -- tests/mcp-config.test.ts`

Expected: FAIL (módulo/función no existe).

**Step 3: Write minimal implementation**

```ts
const OPENCODE_CONFIG_SCHEMA = 'https://opencode.ai/config.json'

export type McpServerConfig = {
  type: 'local' | 'remote'
  command?: string[]
  url?: string
  enabled?: boolean
  environment?: Record<string, string>
  headers?: Record<string, string>
  oauth?: false
}

export type McpConfig = {
  $schema: string
  mcp: Record<string, McpServerConfig>
}

export function buildMcpConfigFromConnectors(connectors: ConnectorRecord[]): McpConfig {
  const mcp: Record<string, McpServerConfig> = {}

  for (const connector of connectors) {
    if (!connector.enabled) continue
    if (!validateConnectorType(connector.type)) continue

    let config: Record<string, unknown>
    try {
      config = decryptConfig(connector.config)
    } catch {
      continue
    }

    if (!validateConnectorConfig(connector.type, config)) continue

    const key = `arche_${connector.type}_${connector.id.slice(0, 8)}`

    switch (connector.type) {
      case 'github':
        mcp[key] = {
          type: 'local',
          command: ['npx', '-y', '@modelcontextprotocol/server-github'],
          enabled: true,
          environment: { GITHUB_PERSONAL_ACCESS_TOKEN: String(config.token) },
        }
        break
      // ... resto de tipos ...
    }
  }

  return { $schema: OPENCODE_CONFIG_SCHEMA, mcp }
}

export async function buildMcpConfigForSlug(slug: string): Promise<McpConfig | null> {
  const user = await prisma.user.findUnique({ where: { slug }, select: { id: true } })
  if (!user) return null

  const connectors = await prisma.connector.findMany({
    where: { userId: user.id, enabled: true },
    select: { id: true, type: true, name: true, config: true, enabled: true },
  })

  const config = buildMcpConfigFromConnectors(connectors)
  return Object.keys(config.mcp).length ? config : null
}
```

**Step 4: Run test to verify it passes**

Run (from `apps/web`): `pnpm test -- tests/mcp-config.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/lib/spawner/mcp-config.ts apps/web/tests/mcp-config.test.ts apps/web/src/lib/spawner/index.ts
git commit -m "feat: build MCP config from connectors"
```

### Task 3: Inyectar MCP en el arranque del contenedor

**Files:**
- Modify: `apps/web/src/lib/spawner/core.ts`
- Modify: `apps/web/src/lib/spawner/docker.ts`
- Modify: `apps/web/src/lib/spawner/__tests__/core.test.ts`
- Modify: `apps/web/src/lib/spawner/__tests__/docker.test.ts`
- Modify: `apps/web/src/lib/spawner/__tests__/docker.e2e.test.ts`

**Step 1: Write the failing test**

```ts
// docker.test.ts
await createContainer('user-slug', 'secret-password', '{"$schema":"https://opencode.ai/config.json","mcp":{}}')

expect(mockDockerInstance.createContainer).toHaveBeenCalledWith(
  expect.objectContaining({
    Env: expect.arrayContaining([
      'OPENCODE_CONFIG_CONTENT={"$schema":"https://opencode.ai/config.json","mcp":{}}',
    ]),
  })
)
```

```ts
// core.test.ts
vi.mock('../mcp-config', () => ({
  buildMcpConfigForSlug: vi.fn().mockResolvedValue({
    $schema: 'https://opencode.ai/config.json',
    mcp: {},
  }),
}))

expect(mockDocker.createContainer).toHaveBeenCalledWith(
  'alice',
  'test-password-123',
  '{"$schema":"https://opencode.ai/config.json","mcp":{}}'
)
```

**Step 2: Run test to verify it fails**

Run (from `apps/web`): `pnpm test -- src/lib/spawner/__tests__/docker.test.ts src/lib/spawner/__tests__/core.test.ts`

Expected: FAIL (firma no coincide, env no incluye `OPENCODE_CONFIG_CONTENT`).

**Step 3: Write minimal implementation**

```ts
// core.ts
let opencodeConfigContent: string | undefined
try {
  const mcpConfig = await buildMcpConfigForSlug(slug)
  if (mcpConfig) {
    opencodeConfigContent = JSON.stringify(mcpConfig)
  }
} catch (err) {
  console.warn('[spawner] MCP config build failed')
}

const container = await docker.createContainer(slug, password, opencodeConfigContent)
```

```ts
// docker.ts
export async function createContainer(slug: string, password: string, opencodeConfigContent?: string) {
  const env = [
    `OPENCODE_SERVER_PASSWORD=${password}`,
    'OPENCODE_SERVER_USERNAME=opencode',
    `WORKSPACE_AGENT_PORT=${getWorkspaceAgentPort()}`,
  ]

  if (opencodeConfigContent) {
    env.push(`OPENCODE_CONFIG_CONTENT=${opencodeConfigContent}`)
  }

  return docker.createContainer({
    // ...
    Env: env,
  })
}
```

**Step 4: Run test to verify it passes**

Run (from `apps/web`): `pnpm test -- src/lib/spawner/__tests__/docker.test.ts src/lib/spawner/__tests__/core.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add \
  apps/web/src/lib/spawner/core.ts \
  apps/web/src/lib/spawner/docker.ts \
  apps/web/src/lib/spawner/__tests__/core.test.ts \
  apps/web/src/lib/spawner/__tests__/docker.test.ts \
  apps/web/src/lib/spawner/__tests__/docker.e2e.test.ts
git commit -m "feat: inject MCP config into workspace containers"
```

### Task 4: Asegurar `nodejs` y `npm` en la imagen de workspace

**Files:**
- Create: `apps/web/tests/workspace-image.test.ts`
- Modify: `infra/workspace-image/Containerfile`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

it('installs nodejs and npm in workspace image', () => {
  const containerfile = readFileSync(
    resolve(process.cwd(), '..', '..', 'infra', 'workspace-image', 'Containerfile'),
    'utf8'
  )

  expect(containerfile).toMatch(/apk add --no-cache .*nodejs.*npm/)
})
```

**Step 2: Run test to verify it fails**

Run (from `apps/web`): `pnpm test -- tests/workspace-image.test.ts`

Expected: FAIL (no `nodejs`/`npm`).

**Step 3: Write minimal implementation**

```Dockerfile
RUN apk add --no-cache git nodejs npm
```

**Step 4: Run test to verify it passes**

Run (from `apps/web`): `pnpm test -- tests/workspace-image.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add infra/workspace-image/Containerfile apps/web/tests/workspace-image.test.ts
git commit -m "chore: install nodejs and npm in workspace image"
```

import { readFileSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, it } from 'vitest'

type PackageJson = {
  scripts?: Record<string, string>
}

describe('web dev scripts', () => {
  it('generates both Prisma clients before pnpm dev starts Next.js', () => {
    const packageJsonPath = resolve(process.cwd(), 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson

    expect(packageJson.scripts?.predev).toContain('pnpm prisma:generate')
    expect(packageJson.scripts?.predev).toContain('pnpm prisma:generate:desktop')
  })

  it('keeps local-dev compose generating the desktop Prisma client before webpack dev starts', () => {
    const composeTemplatePath = resolve(
      process.cwd(),
      '..',
      '..',
      'infra',
      'deploy',
      'ansible',
      'roles',
      'app',
      'templates',
      'compose.yml.j2',
    )
    const composeTemplate = readFileSync(composeTemplatePath, 'utf8')

    expect(composeTemplate).toContain('pnpm prisma generate')
    expect(composeTemplate).toContain('pnpm prisma:generate:desktop')
    expect(composeTemplate).toContain('pnpm next dev --webpack -H 0.0.0.0 -p 3000')
    expect(composeTemplate).toContain('NODE_COMPILE_CACHE: "/tmp/node-compile-cache"')
    expect(composeTemplate).toContain('restart: "unless-stopped"')
    expect(composeTemplate).toContain('name: arche')
    expect(composeTemplate).toContain('arche-internal')
  })

  it('keeps webpack watch ignores compatible with the webpack schema', () => {
    const nextConfigPath = resolve(process.cwd(), 'next.config.ts')
    const nextConfigSource = readFileSync(nextConfigPath, 'utf8')

    expect(nextConfigSource).toContain('"**/node-compile-cache/**"')
    expect(nextConfigSource).toContain('existingIgnored.filter((ignored) => typeof ignored === "string")')
  })

  it('keeps local-dev env generation pinned to the shared workspace network', () => {
    const envTemplatePath = resolve(
      process.cwd(),
      '..',
      '..',
      'infra',
      'deploy',
      'ansible',
      'roles',
      'app',
      'templates',
      '.env.j2',
    )
    const envTemplate = readFileSync(envTemplatePath, 'utf8')

    expect(envTemplate).toContain('OPENCODE_NETWORK=arche-internal')
  })

  it('keeps deploy templates propagating connector and persistence overrides', () => {
    const repoRoot = resolve(process.cwd(), '..', '..')
    const envTemplate = readFileSync(
      resolve(repoRoot, 'infra', 'deploy', 'ansible', 'roles', 'app', 'templates', '.env.j2'),
      'utf8',
    )
    const deployScript = readFileSync(resolve(repoRoot, 'infra', 'deploy', 'deploy.sh'), 'utf8')
    const coolifyCompose = readFileSync(resolve(repoRoot, 'infra', 'coolify', 'docker-compose.yml'), 'utf8')

    for (const variable of [
      'ARCHE_PUBLIC_BASE_URL',
      'ARCHE_CONNECTOR_GATEWAY_BASE_URL',
      'ARCHE_CONNECTOR_GATEWAY_TOKEN_SECRET',
      'ARCHE_CONNECTOR_GOOGLE_CLIENT_ID',
      'ARCHE_CONNECTOR_GOOGLE_GMAIL_MCP_URL',
      'ARCHE_CONNECTOR_META_ADS_GRAPH_API_VERSION',
      'ARCHE_USERS_PATH',
    ]) {
      expect(envTemplate).toContain(variable)
      expect(coolifyCompose).toContain(variable)
    }

    expect(deployScript).toContain('arche_connector_gateway_base_url')
    expect(deployScript).toContain('ARCHE_CONNECTOR_GOOGLE_CLIENT_ID')
    expect(deployScript).toContain('ARCHE_CONNECTOR_META_ADS_GRAPH_API_VERSION')
    expect(deployScript).toContain('ARCHE_USERS_PATH')
  })

  it('keeps Cloudflare Tunnel exposure mode wired through deploy templates', () => {
    const repoRoot = resolve(process.cwd(), '..', '..')
    const composeTemplate = readFileSync(
      resolve(repoRoot, 'infra', 'deploy', 'ansible', 'roles', 'app', 'templates', 'compose.yml.j2'),
      'utf8',
    )
    const envTemplate = readFileSync(
      resolve(repoRoot, 'infra', 'deploy', 'ansible', 'roles', 'app', 'templates', '.env.j2'),
      'utf8',
    )
    const appTasks = readFileSync(
      resolve(repoRoot, 'infra', 'deploy', 'ansible', 'roles', 'app', 'tasks', 'main.yml'),
      'utf8',
    )
    const commonTasks = readFileSync(
      resolve(repoRoot, 'infra', 'deploy', 'ansible', 'roles', 'common', 'tasks', 'main.yml'),
      'utf8',
    )
    const autostartTemplate = readFileSync(
      resolve(repoRoot, 'infra', 'deploy', 'ansible', 'roles', 'app', 'templates', 'arche-autostart.sh.j2'),
      'utf8',
    )
    const deployScript = readFileSync(resolve(repoRoot, 'infra', 'deploy', 'deploy.sh'), 'utf8')

    const tunnelEntrypointStart = composeTemplate.indexOf(
      "{% elif deploy_mode == 'remote' and exposure_mode == 'cloudflare-tunnel' %}",
    )
    const tunnelEntrypointEnd = composeTemplate.indexOf('{% else %}', tunnelEntrypointStart)
    const tunnelEntrypointBlock = composeTemplate.slice(tunnelEntrypointStart, tunnelEntrypointEnd)

    expect(tunnelEntrypointStart).toBeGreaterThan(-1)
    expect(tunnelEntrypointEnd).toBeGreaterThan(tunnelEntrypointStart)
    expect(deployScript).toContain('--cloudflare-tunnel')
    expect(deployScript).toContain('CLOUDFLARED_TUNNEL_TOKEN is required when --cloudflare-tunnel is used')
    expect(deployScript).toContain('export ARCHE_PUBLIC_BASE_URL="https://${DEPLOY_DOMAIN}"')
    expect(deployScript).toContain('REMOTE_FLAGS_SET=false')
    expect(deployScript).toContain('REMOTE_FLAGS_SET=true')
    expect(deployScript).toContain('elif $REMOTE_FLAGS_SET; then')
    expect(deployScript).toContain('"exposure_mode": os.environ["EXPOSURE_MODE"]')
    expect(deployScript).toContain(
      '"cloudflared_tunnel_token": os.environ.get("CLOUDFLARED_TUNNEL_TOKEN", "")',
    )
    expect(envTemplate).toContain('CLOUDFLARED_TUNNEL_TOKEN={{ cloudflared_tunnel_token }}')
    expect(composeTemplate).toContain('cloudflared:')
    expect(composeTemplate).toContain('image: {{ cloudflared_image }}')
    expect(composeTemplate).toContain('TUNNEL_TOKEN: "${CLOUDFLARED_TUNNEL_TOKEN}"')
    expect(composeTemplate).toContain("{% if deploy_mode == 'remote' and exposure_mode == 'direct' %}")
    expect(tunnelEntrypointBlock).not.toContain('letsencrypt')
    expect(tunnelEntrypointBlock).not.toContain('websecure')
    expect(appTasks).toContain("deploy_mode == 'remote' and exposure_mode == 'direct'")
    expect(appTasks).toContain('traefik.http.routers.arche-base.entrypoints=web')
    expect(appTasks).toContain("cloudflared{% endif %}")
    expect(commonTasks).toContain("when: exposure_mode == 'direct'")
    expect(autostartTemplate).toContain("cloudflared{% endif %}")
  })
})

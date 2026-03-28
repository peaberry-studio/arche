const WORKSPACE_EDIT_DENY_RULES: Record<string, 'deny'> = {
  '.gitignore': 'deny',
  '.gitkeep': 'deny',
  '**/.gitkeep': 'deny',
  'opencode.json': 'deny',
  'AGENTS.md': 'deny',
  'agents.md': 'deny',
  'node_modules': 'deny',
  'node_modules/*': 'deny',
  '*/node_modules': 'deny',
  '*/node_modules/*': 'deny',
}

const WORKSPACE_BASH_DENY_RULES: Record<string, 'deny'> = {
  '*.gitignore*': 'deny',
  '*.gitkeep*': 'deny',
  '*opencode.json*': 'deny',
  '*AGENTS.md*': 'deny',
  '*agents.md*': 'deny',
  'npm install*': 'deny',
  'npm i*': 'deny',
  'npm ci*': 'deny',
  'npm init*': 'deny',
  'npm create*': 'deny',
  'pnpm install*': 'deny',
  'pnpm add*': 'deny',
  'pnpm init*': 'deny',
  'pnpm create*': 'deny',
  'yarn install*': 'deny',
  'yarn add*': 'deny',
  'yarn init*': 'deny',
  'yarn create*': 'deny',
  'bun install*': 'deny',
  'bun add*': 'deny',
  'bun init*': 'deny',
  'bun create*': 'deny',
}

type PermissionRule = Record<string, 'allow' | 'ask' | 'deny'>

function mergePermissionRule(current: unknown, enforced: PermissionRule): Record<string, unknown> {
  if (typeof current === 'string') {
    return { '*': current, ...enforced }
  }

  if (current && typeof current === 'object') {
    return { ...(current as Record<string, unknown>), ...enforced }
  }

  return { ...enforced }
}

export function withWorkspacePermissionGuards(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config }
  const permission =
    next.permission && typeof next.permission === 'object'
      ? { ...(next.permission as Record<string, unknown>) }
      : {}

  permission.edit = mergePermissionRule(permission.edit, WORKSPACE_EDIT_DENY_RULES)
  permission.bash = mergePermissionRule(permission.bash, WORKSPACE_BASH_DENY_RULES)

  next.permission = permission
  return next
}

export function withWorkspaceIdentity(
  agentsMd: string,
  identity: { slug: string; email?: string | null },
): string {
  const emailLine = identity.email ? `- Email: ${identity.email}\n` : ''
  const block =
    `\n\n## Workspace User Identity\n\n` +
    `Use this identity as the primary user context for this workspace session.\n\n` +
    `- Slug: ${identity.slug}\n` +
    emailLine

  return agentsMd + block
}

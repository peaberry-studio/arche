import { prisma } from '@/lib/prisma'

const MCP_SETTINGS_ID = 'global'

export type McpUserAccess = {
  id: string
  email: string
  slug: string
  role: string
  mcpAllowed: boolean
}

export async function getSettings(): Promise<{ enabled: boolean }> {
  const settings = await prisma.mcpSettings.findUnique({
    where: { id: MCP_SETTINGS_ID },
    select: { enabled: true },
  })

  return { enabled: settings?.enabled ?? false }
}

export async function setEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  const settings = await prisma.mcpSettings.upsert({
    where: { id: MCP_SETTINGS_ID },
    update: { enabled },
    create: { id: MCP_SETTINGS_ID, enabled },
    select: { enabled: true },
  })

  return settings
}

export function listUserAccess(): Promise<McpUserAccess[]> {
  return prisma.user.findMany({
    where: { kind: 'HUMAN' },
    select: { id: true, email: true, slug: true, role: true, mcpAllowed: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
  })
}

export function setUserAllowed(userId: string, mcpAllowed: boolean): Promise<McpUserAccess> {
  return prisma.user.update({
    where: { id: userId },
    data: { mcpAllowed },
    select: { id: true, email: true, slug: true, role: true, mcpAllowed: true },
  })
}

export async function isUserAllowed(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mcpAllowed: true },
  })

  return user?.mcpAllowed === true
}

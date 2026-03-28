import { prisma } from '@/lib/prisma'
import { getContainerProxyUrl } from '@/lib/spawner/config'

export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

export async function checkContainerProxy(): Promise<boolean> {
  try {
    const response = await fetch(`${getContainerProxyUrl()}/_ping`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

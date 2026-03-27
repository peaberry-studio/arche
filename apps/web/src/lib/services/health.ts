import { prisma } from '@/lib/prisma'

export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

export async function checkContainerProxy(): Promise<boolean> {
  const host = process.env.CONTAINER_PROXY_HOST || 'docker-socket-proxy'
  const port = process.env.CONTAINER_PROXY_PORT || '2375'
  try {
    const response = await fetch(`http://${host}:${port}/_ping`, {
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

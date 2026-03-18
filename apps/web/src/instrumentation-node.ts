export async function registerNodeInstrumentation() {
  const { isDesktop } = await import('@/lib/runtime/mode')

  if (isDesktop()) {
    return
  }

  const { initWebPrisma } = await import('@/lib/prisma')
  await initWebPrisma()
}

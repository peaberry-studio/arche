export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { isDesktop } = await import('@/lib/runtime/mode')

  if (isDesktop()) {
    const { initDesktopPrisma } = await import('@/lib/prisma')
    await initDesktopPrisma()
  } else {
    const { startReaper } = await import('@/lib/spawner/reaper')
    startReaper()
  }
}

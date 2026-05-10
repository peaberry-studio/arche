declare global {
  var archeWebCleanupRegistered: boolean | undefined
}

async function gracefulShutdown(): Promise<void> {
  console.log('[shutdown] Graceful shutdown initiated')

  if (process.env.NODE_ENV === 'production') {
    try {
      const { stopAutopilotScheduler } = await import('@/lib/autopilot/scheduler')
      stopAutopilotScheduler()
      console.log('[shutdown] Autopilot scheduler stopped')
    } catch (err) {
      console.error('[shutdown] Failed to stop autopilot scheduler:', err)
    }
  }

  try {
    const { stopSlackSocketManager } = await import('@/lib/slack/socket-mode')
    stopSlackSocketManager()
    console.log('[shutdown] Slack socket manager stopped')
  } catch (err) {
    console.error('[shutdown] Failed to stop Slack socket manager:', err)
  }

  try {
    const { stopReaper } = await import('@/lib/spawner/reaper')
    stopReaper()
    console.log('[shutdown] Reaper stopped')
  } catch (err) {
    console.error('[shutdown] Failed to stop reaper:', err)
  }

  try {
    const { prisma } = await import('@/lib/prisma')
    await prisma.$disconnect()
    console.log('[shutdown] Prisma disconnected')
  } catch (err) {
    console.error('[shutdown] Failed to disconnect Prisma:', err)
  }

  console.log('[shutdown] Graceful shutdown complete')
}

function registerShutdownHooks(): void {
  if (globalThis.archeWebCleanupRegistered) return
  globalThis.archeWebCleanupRegistered = true

  process.once('SIGTERM', () => {
    void gracefulShutdown().finally(() => process.kill(process.pid, 'SIGTERM'))
  })

  process.once('SIGINT', () => {
    void gracefulShutdown().finally(() => process.kill(process.pid, 'SIGINT'))
  })

  process.once('beforeExit', () => {
    void gracefulShutdown()
  })
}

export async function registerNodeInstrumentation() {
  const { isDesktop } = await import('@/lib/runtime/mode')

  if (isDesktop()) {
    return
  }

  const { initWebPrisma } = await import('@/lib/prisma')
  await initWebPrisma()

  if (process.env.NODE_ENV === 'production') {
    try {
      const { shouldStartInlineAutopilotScheduler, startAutopilotScheduler } = await import('@/lib/autopilot/scheduler')
      if (shouldStartInlineAutopilotScheduler()) {
        startAutopilotScheduler()
      }
    } catch (error) {
      console.error('[autopilot] Failed to start scheduler', error)
    }
  }

  const { startSlackSocketManager } = await import('@/lib/slack/socket-mode')
  startSlackSocketManager()

  registerShutdownHooks()
}

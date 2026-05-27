declare global {
  var archeWebCleanupRegistered: boolean | undefined
}

async function gracefulShutdown(): Promise<void> {
  console.log('[shutdown] Graceful shutdown initiated')

  try {
    const { stopFlowScheduler } = await import('@/lib/flows/scheduler')
    stopFlowScheduler()
    console.log('[shutdown] Flow scheduler stopped')
  } catch (err) {
    console.error('[shutdown] Failed to stop flow scheduler:', err)
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

function hasActiveDesktopVault(): boolean {
  return Boolean(process.env.ARCHE_DATA_DIR?.trim())
}

async function startInlineFlowSchedulerBestEffort(): Promise<void> {
  try {
    const { shouldStartInlineFlowScheduler, startFlowScheduler } = await import('@/lib/flows/scheduler')
    if (shouldStartInlineFlowScheduler()) {
      startFlowScheduler()
    }
  } catch (error) {
    console.error('[flows] Failed to start scheduler', error)
  }
}

export async function registerNodeInstrumentation() {
  const { isDesktop } = await import('@/lib/runtime/mode')

  if (isDesktop()) {
    if (!hasActiveDesktopVault()) {
      return
    }

    const { initDesktopPrisma } = await import('@/lib/prisma-desktop-init')
    await initDesktopPrisma()
    await startInlineFlowSchedulerBestEffort()
    registerShutdownHooks()
    return
  }

  const { initWebPrisma } = await import('@/lib/prisma')
  await initWebPrisma()

  if (process.env.NODE_ENV === 'production') {
    await startInlineFlowSchedulerBestEffort()
  }

  const { startSlackSocketManager } = await import('@/lib/slack/socket-mode')
  startSlackSocketManager()

  registerShutdownHooks()
}

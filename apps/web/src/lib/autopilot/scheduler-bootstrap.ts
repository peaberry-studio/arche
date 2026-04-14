import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

export async function ensureAutopilotSchedulerStarted(): Promise<void> {
  if (!getRuntimeCapabilities().autopilot) {
    return
  }

  try {
    const { startAutopilotScheduler } = await import('@/lib/autopilot/scheduler')
    startAutopilotScheduler()
  } catch (error) {
    console.error('[autopilot] Failed to start scheduler', error)
  }
}

import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

export async function ensureAutopilotSchedulerStarted(): Promise<void> {
  if (!getRuntimeCapabilities().autopilot) {
    return
  }

  try {
    const { shouldStartInlineAutopilotScheduler, startAutopilotScheduler } = await import('@/lib/autopilot/scheduler')
    if (!shouldStartInlineAutopilotScheduler()) {
      return
    }

    startAutopilotScheduler()
  } catch (error) {
    console.error('[autopilot] Failed to start scheduler', error)
  }
}

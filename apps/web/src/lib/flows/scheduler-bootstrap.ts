import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

export async function ensureFlowSchedulerStarted(): Promise<void> {
  if (!getRuntimeCapabilities().flows) {
    return
  }

  try {
    const { shouldStartInlineFlowScheduler, startFlowScheduler } = await import('@/lib/flows/scheduler')
    if (!shouldStartInlineFlowScheduler()) {
      return
    }

    startFlowScheduler()
  } catch (error) {
    console.error('[flows] Failed to start scheduler', error)
  }
}

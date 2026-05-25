import type { FlowRunTrigger } from '@prisma/client'

export type FlowExecutionDispatchTask = {
  flowId: string
  runId: string
  trigger: FlowRunTrigger
  type: 'run' | 'retry' | 'resume'
}

export function dispatchFlowExecution(task: FlowExecutionDispatchTask, execute: () => Promise<void>): void {
  void execute().catch((error) => {
    console.error('[flows] Failed to execute dispatched flow task', {
      error,
      flowId: task.flowId,
      runId: task.runId,
      trigger: task.trigger,
      type: task.type,
    })
  })
}

import type { HarnessOperationOptions } from '@/lib/harness/contract'
import type { HarnessResult } from '@/lib/harness/errors'
import { withRuntimeOperationLock } from '@/lib/harness/operation-lock'

export async function withSessionSubmissionLock<T>(
  slug: string,
  sessionId: string,
  options: HarnessOperationOptions | undefined,
  submit: (options: HarnessOperationOptions) => Promise<HarnessResult<T>>,
): Promise<HarnessResult<T>> {
  const controller = new AbortController()
  const timeout = AbortSignal.timeout(60_000)
  const signal = AbortSignal.any([controller.signal, timeout, ...(options?.signal ? [options.signal] : [])])
  const key = JSON.stringify(['harness-prompt', slug, sessionId])
  try {
    return await withRuntimeOperationLock(key, (lockSignal) => {
      const operationSignal = AbortSignal.any([signal, lockSignal])
      operationSignal.throwIfAborted()
      return submit({ signal: operationSignal })
    })
  } finally {
    controller.abort()
  }
}

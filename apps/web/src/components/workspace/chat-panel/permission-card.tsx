'use client'

import { useCallback, useState } from 'react'

import { CheckCircle, Info, XCircle } from '@phosphor-icons/react'

import type { MessagePart, PermissionResponse } from '@/lib/opencode/types'

type PermissionPart = Extract<MessagePart, { type: 'permission' }>

type PermissionCardProps = {
  onAnswerPermission?: (
    sessionId: string,
    permissionId: string,
    response: PermissionResponse,
  ) => Promise<boolean>
  part: PermissionPart
}

const getString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

export function PermissionCard({ onAnswerPermission, part }: PermissionCardProps) {
  const [submittingResponse, setSubmittingResponse] = useState<PermissionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toolName = getString(part.metadata?.tool) ?? getString(part.metadata?.toolName) ?? part.pattern
  const isPending = part.state === 'pending'
  const isSubmitting = Boolean(submittingResponse)

  const handleAnswer = useCallback(
    async (response: PermissionResponse) => {
      if (!onAnswerPermission || submittingResponse) return

      setSubmittingResponse(response)
      setError(null)
      const ok = await onAnswerPermission(part.sessionId, part.permissionId, response)
      if (!ok) {
        setError('Could not send permission response.')
      }
      setSubmittingResponse(null)
    },
    [onAnswerPermission, part.permissionId, part.sessionId, submittingResponse],
  )

  return (
    <div className="my-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        {isPending ? (
          <Info size={16} weight="fill" className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
        ) : part.state === 'approved' ? (
          <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" />
        ) : (
          <XCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-destructive" />
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-foreground">
            {isPending ? 'Tool approval required' : part.state === 'approved' ? 'Tool approved' : 'Tool rejected'}
          </p>
          <p className="text-xs text-muted-foreground">{part.title}</p>
          {toolName ? <p className="break-all text-xs text-muted-foreground">{toolName}</p> : null}
        </div>
      </div>

      {isPending ? (
        <div className="mt-3 flex flex-wrap gap-2 pl-7">
          <button
            type="button"
            disabled={!onAnswerPermission || isSubmitting}
            onClick={() => void handleAnswer('once')}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {submittingResponse === 'once' ? 'Sending...' : 'Allow'}
          </button>
          <button
            type="button"
            disabled={!onAnswerPermission || isSubmitting}
            onClick={() => void handleAnswer('reject')}
            className="rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {submittingResponse === 'reject' ? 'Sending...' : 'Reject'}
          </button>
          <button
            type="button"
            disabled={!onAnswerPermission || isSubmitting}
            onClick={() => void handleAnswer('always')}
            className="rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {submittingResponse === 'always' ? 'Sending...' : 'Always allow for this session'}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 pl-7 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

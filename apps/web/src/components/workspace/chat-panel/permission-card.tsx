'use client'

import { useCallback, useState } from 'react'

import { CheckCircle, Warning, XCircle } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import type { MessagePart, PermissionResponse, PermissionState } from '@/lib/opencode/types'
import { cn } from '@/lib/utils'

type PermissionPart = Extract<MessagePart, { type: 'permission' }>

type PermissionCardProps = {
  onAnswerPermission?: (
    sessionId: string,
    permissionId: string,
    response: PermissionResponse,
  ) => Promise<boolean>
  part: PermissionPart
}

const STATE_STYLES: Record<PermissionState, { container: string; chip: string; title: string }> = {
  pending: {
    container: 'border-warning/25 bg-warning/5',
    chip: 'bg-warning/15 text-warning',
    title: 'Approval required',
  },
  approved: {
    container: 'border-primary/25 bg-primary/5',
    chip: 'bg-primary/15 text-primary',
    title: 'Permission granted',
  },
  rejected: {
    container: 'border-destructive/25 bg-destructive/5',
    chip: 'bg-destructive/15 text-destructive',
    title: 'Permission rejected',
  },
}

const getString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

export function PermissionCard({ onAnswerPermission, part }: PermissionCardProps) {
  const [submittingResponse, setSubmittingResponse] = useState<PermissionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toolName = getString(part.metadata?.tool) ?? getString(part.metadata?.toolName) ?? part.pattern
  const isPending = part.state === 'pending'
  const isSubmitting = Boolean(submittingResponse)
  const styles = STATE_STYLES[part.state]
  const StateIcon = part.state === 'pending' ? Warning : part.state === 'approved' ? CheckCircle : XCircle

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
    <div className={cn('@container my-2 rounded-xl border px-4 py-3 text-sm', styles.container)}>
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', styles.chip)}>
          <StateIcon size={13} weight="fill" aria-hidden />
        </span>
        <p className="font-medium text-foreground">{styles.title}</p>
      </div>

      <p
        className="mt-2 truncate text-xs text-foreground/80"
        title={toolName ? `${toolName}: ${part.title}` : part.title}
      >
        {toolName ? (
          <span className="chat-text-micro font-mono text-muted-foreground">{`${toolName}: `}</span>
        ) : null}
        {part.title}
      </p>

      {isPending ? (
        <div className="mt-3" aria-busy={isSubmitting}>
          <div className="flex flex-col gap-2 @md:flex-row @md:items-center">
            <Button
              type="button"
              size="sm"
              className="w-full bg-warning text-foreground hover:bg-warning/90 active:bg-warning/85 @md:w-auto dark:bg-[hsl(38_92%_50%)] dark:text-background"
              disabled={!onAnswerPermission || isSubmitting}
              onClick={() => void handleAnswer('once')}
            >
              {submittingResponse === 'once' ? 'Sending...' : 'Allow once'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full bg-primary-foreground/60 hover:bg-primary-foreground/80 active:bg-primary-foreground/90 @md:w-auto dark:bg-foreground/5 dark:hover:bg-foreground/10 dark:active:bg-foreground/15"
              disabled={!onAnswerPermission || isSubmitting}
              onClick={() => void handleAnswer('always')}
            >
              {submittingResponse === 'always' ? 'Sending...' : 'Allow for this session'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="w-full @md:ml-auto @md:w-auto dark:bg-destructive/15 dark:text-destructive dark:hover:bg-destructive/20 dark:active:bg-destructive/25"
              disabled={!onAnswerPermission || isSubmitting}
              onClick={() => void handleAnswer('reject')}
            >
              {submittingResponse === 'reject' ? 'Sending...' : 'Reject'}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

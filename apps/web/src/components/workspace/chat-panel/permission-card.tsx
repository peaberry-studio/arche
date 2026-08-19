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

const STATE_COPY: Record<PermissionState, { iconClass: string; title: string }> = {
  pending: {
    iconClass: 'text-warning',
    title: 'Approval required',
  },
  approved: {
    iconClass: 'text-primary',
    title: 'Permission granted',
  },
  rejected: {
    iconClass: 'text-destructive',
    title: 'Permission rejected',
  },
}

const ACTION_SIZE_CLASS = 'h-7 w-auto px-2.5 text-xs'
const SECONDARY_ACTION_CLASS =
  `${ACTION_SIZE_CLASS} bg-primary-foreground/60 hover:bg-primary-foreground/80 active:bg-primary-foreground/90 dark:bg-foreground/5 dark:hover:bg-foreground/10 dark:active:bg-foreground/15`

const getString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

function getPermissionSubtitle(part: PermissionPart): string | undefined {
  const command = getString(part.metadata?.command)
  if (command) return command

  const toolName = getString(part.metadata?.tool) ?? getString(part.metadata?.toolName)
  if (part.title && part.title !== toolName) return part.title

  return part.pattern
}

export function PermissionCard({ onAnswerPermission, part }: PermissionCardProps) {
  const [submittingResponse, setSubmittingResponse] = useState<PermissionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isPending = part.state === 'pending'
  const isSubmitting = Boolean(submittingResponse)
  const copy = STATE_COPY[part.state]
  const subtitle = getPermissionSubtitle(part)
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
    <div className="my-2 rounded-lg border border-border/40 bg-muted/20 text-xs">
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StateIcon size={12} weight="fill" className={cn('shrink-0', copy.iconClass)} aria-hidden />
            <span className="shrink-0 whitespace-nowrap font-medium">{copy.title}</span>
          </div>
          {subtitle ? (
            <p className="mt-0.5 truncate pl-5 text-muted-foreground" title={subtitle}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {isPending ? (
        <div className="flex flex-wrap items-center justify-start gap-2 px-3 pb-3" aria-busy={isSubmitting}>
          <Button
            type="button"
            size="sm"
            className={`${ACTION_SIZE_CLASS} bg-warning text-foreground hover:bg-warning/90 active:bg-warning/85 dark:bg-[hsl(38_92%_50%)] dark:text-background`}
            disabled={!onAnswerPermission || isSubmitting}
            onClick={() => void handleAnswer('once')}
          >
            {submittingResponse === 'once' ? 'Sending...' : 'Allow once'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={SECONDARY_ACTION_CLASS}
            disabled={!onAnswerPermission || isSubmitting}
            onClick={() => void handleAnswer('always')}
          >
            {submittingResponse === 'always' ? 'Sending...' : 'Allow for this session'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={SECONDARY_ACTION_CLASS}
            disabled={!onAnswerPermission || isSubmitting}
            onClick={() => void handleAnswer('reject')}
          >
            {submittingResponse === 'reject' ? 'Sending...' : 'Reject'}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

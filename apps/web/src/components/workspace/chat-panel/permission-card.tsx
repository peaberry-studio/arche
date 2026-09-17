'use client'

import { useCallback, useState } from 'react'

import { SpinnerGap, Warning } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { buildZendeskPermissionPreview, matchZendeskActionName, type ZendeskPermissionPreview } from '@/lib/connectors/zendesk-permission-preview'
import type { WorkspacePermission } from '@/lib/opencode/permission'
import type { ResolvedPermissionToolPart } from '@/lib/opencode/permission-tool-parts'
import type { PermissionResponse } from '@/lib/opencode/types'
import { cn } from '@/lib/utils'

type PermissionCardProps = {
  onAnswerPermission?: (
    sessionId: string,
    permissionId: string,
    response: PermissionResponse,
  ) => Promise<boolean>
  permission: WorkspacePermission
  toolPart?: ResolvedPermissionToolPart
}

const ACTION_SIZE_CLASS = 'h-7 w-auto px-2.5 text-xs'
const SECONDARY_ACTION_CLASS =
  `${ACTION_SIZE_CLASS} bg-primary-foreground/60 hover:bg-primary-foreground/80 active:bg-primary-foreground/90 dark:bg-foreground/5 dark:hover:bg-foreground/10 dark:active:bg-foreground/15`

const getString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)

function getPermissionSubtitle(permission: WorkspacePermission): string | undefined {
  const command = getString(permission.metadata?.command)
  if (command) return command

  const toolName = getString(permission.metadata?.tool) ?? getString(permission.metadata?.toolName)
  if (permission.title && permission.title !== toolName) return permission.title

  return permission.pattern
}

type ZendeskPreviewState =
  | { kind: 'preview'; preview: ZendeskPermissionPreview }
  | { kind: 'loading' }
  | { kind: 'unavailable' }

// Resolves the Zendesk approval preview for a recognized atomic action,
// recognizing the connector from the permission text itself so controls can
// stay disabled before the tool part arrives. A recognized action with no
// tool part yet stays in the loading state; a session whose messages are
// loaded without the referenced tool call fails retrieval instead of allowing
// a blind approval. Returns null for non-Zendesk permissions.
function resolveZendeskPreview(
  permission: WorkspacePermission,
  toolPart: ResolvedPermissionToolPart
): ZendeskPreviewState | null {
  const textAction =
    matchZendeskActionName(getString(permission.metadata?.tool)) ??
    matchZendeskActionName(permission.title) ??
    matchZendeskActionName(permission.pattern)

  if (toolPart === undefined) {
    return textAction ? { kind: 'loading' } : null
  }

  if (toolPart === null) {
    return textAction ? { kind: 'unavailable' } : null
  }

  const partAction = matchZendeskActionName(toolPart.toolName)
  if (!textAction && !partAction) {
    return null
  }

  const preview = buildZendeskPermissionPreview(toolPart.toolName, toolPart.input)
  if (!preview) {
    return { kind: 'unavailable' }
  }

  return { kind: 'preview', preview }
}

function ZendeskPreviewBody({ state }: { state: ZendeskPreviewState }) {
  if (state.kind === 'loading') {
    return (
      <p
        role="status"
        className="flex items-center gap-2 border-t border-border/30 px-3 py-2 text-xs text-muted-foreground"
      >
        <SpinnerGap size={12} className="animate-spin" aria-hidden />
        Loading approval details...
      </p>
    )
  }

  if (state.kind === 'unavailable') {
    return (
      <p role="alert" className="border-t border-border/30 px-3 py-2 text-xs text-destructive">
        Could not load the details of this Zendesk action.
      </p>
    )
  }

  const { preview } = state
  const visibilityLabel = preview.visibility === 'public' ? 'Public' : preview.visibility === 'internal' ? 'Internal' : null
  const comment = preview.fields.find((field) => field.label === 'Comment')
  const otherFields = preview.fields.filter((field) => field !== comment)

  return (
    <div className="space-y-2 border-t border-border/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
          {preview.connectorName}
        </span>
        <span className="text-xs font-medium text-foreground">{preview.actionLabel}</span>
        {visibilityLabel ? (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] font-medium',
              preview.visibility === 'public'
                ? 'bg-warning/15 text-warning'
                : 'bg-muted/60 text-muted-foreground',
            )}
          >
            {visibilityLabel}
          </span>
        ) : null}
      </div>

      {otherFields.length > 0 ? (
        <dl className="space-y-1">
          {otherFields.map((field) => (
            <div key={field.label} className="flex gap-2 text-xs">
              <dt className="shrink-0 font-medium text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0 break-words text-foreground">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {comment ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{comment.label}</p>
          <pre className="scrollbar-custom max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2 py-1.5 font-sans text-xs text-foreground">
            {comment.value}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

export function PermissionCard({ onAnswerPermission, permission, toolPart }: PermissionCardProps) {
  const [submittingResponse, setSubmittingResponse] = useState<PermissionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isSubmitting = Boolean(submittingResponse)
  const subtitle = getPermissionSubtitle(permission)
  const previewState = resolveZendeskPreview(permission, toolPart)
  const isZendeskAction = previewState !== null
  const disableZendeskResponses = previewState !== null && previewState.kind !== 'preview'

  const handleAnswer = useCallback(
    async (response: PermissionResponse) => {
      if (!onAnswerPermission || submittingResponse) return

      setSubmittingResponse(response)
      setError(null)
      const ok = await onAnswerPermission(permission.sessionId, permission.id, response)
      if (!ok) {
        setError('Could not send permission response.')
      }
      setSubmittingResponse(null)
    },
    [onAnswerPermission, permission.id, permission.sessionId, submittingResponse],
  )

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/20 text-xs">
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Warning size={12} weight="fill" className={cn('shrink-0', 'text-warning')} aria-hidden />
            <span className="shrink-0 whitespace-nowrap font-medium">Approval required</span>
          </div>
          {subtitle && !isZendeskAction ? (
            <p className="mt-0.5 truncate pl-5 text-muted-foreground" title={subtitle}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {previewState ? <ZendeskPreviewBody state={previewState} /> : null}

      <div className="flex flex-wrap items-center justify-start gap-2 px-3 pb-3" aria-busy={isSubmitting}>
        <Button
          type="button"
          size="sm"
          className={`${ACTION_SIZE_CLASS} bg-warning text-foreground hover:bg-warning/90 active:bg-warning/85 dark:bg-[hsl(38_92%_50%)] dark:text-background`}
          disabled={!onAnswerPermission || isSubmitting || disableZendeskResponses}
          onClick={() => void handleAnswer('once')}
        >
          {submittingResponse === 'once' ? 'Sending...' : 'Allow once'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={SECONDARY_ACTION_CLASS}
          disabled={!onAnswerPermission || isSubmitting || disableZendeskResponses}
          onClick={() => void handleAnswer('always')}
        >
          {submittingResponse === 'always' ? 'Sending...' : 'Allow for this session'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={SECONDARY_ACTION_CLASS}
          disabled={!onAnswerPermission || isSubmitting || disableZendeskResponses}
          onClick={() => void handleAnswer('reject')}
        >
          {submittingResponse === 'reject' ? 'Sending...' : 'Reject'}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

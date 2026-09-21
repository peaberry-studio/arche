'use client'

import { useEffect, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DEFAULT_ZENDESK_ACTION_PERMISSIONS,
  type ZendeskActionName,
  type ZendeskActionPermissions,
  type ZendeskActionPolicy,
} from '@/lib/connectors/zendesk-types'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'
import { cn } from '@/lib/utils'

type ZendeskConnectorSettingsDialogProps = {
  open: boolean
  slug: string
  connectorId: string | null
  connectorName: string | null
  onOpenChange: (open: boolean) => void
}

type ZendeskSettingsResponse = {
  permissions: Record<string, unknown>
  zendeskActionPermissions: {
    version: number
    actions: ZendeskActionPermissions
  }
}

const ACTION_POLICY_LABELS: Record<ZendeskActionPolicy, string> = {
  deny: 'Deny',
  ask: 'Ask',
  allow: 'Allow',
}

const ZENDESK_ACTION_GROUPS: Array<{
  title: string
  description: string
  actions: Array<{ name: ZendeskActionName; label: string; description: string }>
}> = [
  {
    title: 'Ticket reading',
    description: 'Control whether the agent can inspect tickets and their comments.',
    actions: [
      {
        name: 'search_tickets',
        label: 'Search tickets',
        description: 'Search tickets with Zendesk search queries.',
      },
      {
        name: 'get_ticket',
        label: 'Read ticket details',
        description: 'Fetch a single ticket by ID.',
      },
      {
        name: 'list_ticket_comments',
        label: 'List ticket comments',
        description: 'Read the comments on a ticket, public and internal.',
      },
    ],
  },
  {
    title: 'Ticket updates',
    description: 'Change ticket fields without adding a comment.',
    actions: [
      {
        name: 'update_ticket_fields',
        label: 'Update ticket fields',
        description: 'Change subject, status, priority, type, or assignee without a comment.',
      },
    ],
  },
  {
    title: 'Public communication',
    description: 'Public comments can notify the requester by email.',
    actions: [
      {
        name: 'create_ticket_public',
        label: 'Create tickets with a public comment',
        description: 'Open a new ticket whose initial comment is public.',
      },
      {
        name: 'update_ticket_with_public_comment',
        label: 'Update tickets with a public comment',
        description: 'Add a public comment and optionally change fields in one update.',
      },
    ],
  },
  {
    title: 'Internal communication',
    description: 'Internal notes stay visible only to Zendesk agents.',
    actions: [
      {
        name: 'create_ticket_internal',
        label: 'Create tickets with an internal note',
        description: 'Open a new ticket whose initial comment is internal.',
      },
      {
        name: 'update_ticket_with_internal_note',
        label: 'Update tickets with an internal note',
        description: 'Add an internal note and optionally change fields in one update.',
      },
    ],
  },
]

type ActionPolicySelectorProps = {
  action: ZendeskActionName
  description: string
  disabled: boolean
  label: string
  value: ZendeskActionPolicy
  onChange: (policy: ZendeskActionPolicy) => void
}

function ActionPolicySelector({ action, description, disabled, label, value, onChange }: ActionPolicySelectorProps) {
  const labelId = `${action}-policy-label`

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p id={labelId} className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div
          role="group"
          aria-labelledby={labelId}
          className="grid shrink-0 grid-cols-3 overflow-hidden rounded-lg border border-border/60 text-xs"
        >
          {(['deny', 'ask', 'allow'] as const).map((policy) => (
            <button
              key={policy}
              type="button"
              disabled={disabled}
              aria-pressed={value === policy}
              onClick={() => onChange(policy)}
              className={cn(
                'px-3 py-1.5 transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 disabled:opacity-50',
                value === policy
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted',
              )}
            >
              {ACTION_POLICY_LABELS[policy]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ZendeskConnectorSettingsDialog({
  open,
  slug,
  connectorId,
  connectorName,
  onOpenChange,
}: ZendeskConnectorSettingsDialogProps) {
  const [actions, setActions] = useState<ZendeskActionPermissions>(DEFAULT_ZENDESK_ACTION_PERMISSIONS)
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLoading = open && Boolean(connectorId) && !hasLoadedSettings && error === null
  const canEditActions = hasLoadedSettings && !isLoading && !isSaving

  function resetDialogState() {
    setActions(DEFAULT_ZENDESK_ACTION_PERMISSIONS)
    setHasLoadedSettings(false)
    setError(null)
    setIsSaving(false)
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDialogState()
    }
    onOpenChange(nextOpen)
  }

  useEffect(() => {
    if (!open || !connectorId) {
      return
    }

    let cancelled = false

    async function loadSettings() {
      try {
        const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/zendesk-settings`, {
          cache: 'no-store',
        })
        const data = (await response.json().catch(() => null)) as
          | (ZendeskSettingsResponse & { error?: string; message?: string })
          | null

        if (cancelled) return

        if (!response.ok || !data?.zendeskActionPermissions?.actions) {
          setError(getConnectorErrorMessage(data, 'load_settings_failed'))
          return
        }

        setActions(data.zendeskActionPermissions.actions)
        setHasLoadedSettings(true)
        setError(null)
      } catch {
        if (!cancelled) {
          setError(getConnectorErrorMessage(null, 'network_error'))
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [connectorId, open, slug])

  function updateAction(action: ZendeskActionName, policy: ZendeskActionPolicy) {
    setActions((current) => ({
      ...current,
      [action]: policy,
    }))
  }

  async function handleSave() {
    if (!connectorId || !hasLoadedSettings || isLoading || isSaving) {
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/zendesk-settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          zendeskActionPermissions: {
            version: 1,
            actions,
          },
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (ZendeskSettingsResponse & { error?: string; message?: string })
        | null

      if (!response.ok || !data?.zendeskActionPermissions?.actions) {
        setError(getConnectorErrorMessage(data, 'save_failed'))
        return
      }

      setActions(data.zendeskActionPermissions.actions)
      notifyWorkspaceConfigChanged()
      handleDialogOpenChange(false)
    } catch {
      setError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="scrollbar-custom max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Zendesk settings</DialogTitle>
          <DialogDescription>
            Restrict what {connectorName ?? 'this connector'} can do. Deny is enforced by Arche before
            any Zendesk request is sent, and Ask requires approval in the workspace before the action runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <SpinnerGap size={16} className="animate-spin" />
              Loading settings...
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {!isLoading
            ? ZENDESK_ACTION_GROUPS.map((group) => (
                <section className="space-y-3" key={group.title}>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
                    <p className="text-xs text-muted-foreground">{group.description}</p>
                  </div>

                  <div className="space-y-3">
                    {group.actions.map((action) => (
                      <ActionPolicySelector
                        key={action.name}
                        action={action.name}
                        description={action.description}
                        disabled={!canEditActions}
                        label={action.label}
                        value={actions[action.name]}
                        onChange={(policy) => updateAction(action.name, policy)}
                      />
                    ))}
                  </div>
                </section>
              ))
            : null}

          <div className="flex justify-end gap-2">
            <Button disabled={isSaving} variant="ghost" onClick={() => handleDialogOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={isLoading || isSaving || !connectorId || !hasLoadedSettings}
              onClick={() => void handleSave()}
            >
              {isSaving ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

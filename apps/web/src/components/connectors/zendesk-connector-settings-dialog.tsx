'use client'

import { useEffect, useState } from 'react'

import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import {
  DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS,
  type ZendeskConnectorPermissions,
} from '@/lib/connectors/zendesk-types'

type ZendeskConnectorSettingsDialogProps = {
  open: boolean
  slug: string
  connectorId: string | null
  connectorName: string | null
  onOpenChange: (open: boolean) => void
}

type ZendeskSettingsResponse = {
  permissions: ZendeskConnectorPermissions
}

type PermissionFieldProps = {
  checked: boolean
  description: string
  disabled: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}

function PermissionField({ checked, description, disabled, label, onCheckedChange }: PermissionFieldProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-card/40 px-4 py-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
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
  const [permissions, setPermissions] = useState<ZendeskConnectorPermissions>(DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !connectorId) {
      setPermissions(DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS)
      setError(null)
      setIsLoading(false)
      setIsSaving(false)
      return
    }

    let cancelled = false

    async function loadSettings() {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/zendesk-settings`, {
          cache: 'no-store',
        })
        const data = (await response.json().catch(() => null)) as
          | (ZendeskSettingsResponse & { error?: string; message?: string })
          | null

        if (cancelled) return

        if (!response.ok || !data?.permissions) {
          setError(getConnectorErrorMessage(data, 'load_failed'))
          return
        }

        setPermissions(data.permissions)
      } catch {
        if (!cancelled) {
          setError(getConnectorErrorMessage(null, 'network_error'))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [connectorId, open, slug])

  function updatePermission<K extends keyof ZendeskConnectorPermissions>(key: K, value: boolean) {
    setPermissions((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function handleSave() {
    if (!connectorId || isLoading || isSaving) return

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/zendesk-settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permissions }),
      })
      const data = (await response.json().catch(() => null)) as
        | (ZendeskSettingsResponse & { error?: string; message?: string })
        | null

      if (!response.ok || !data?.permissions) {
        setError(getConnectorErrorMessage(data, 'save_failed'))
        return
      }

      setPermissions(data.permissions)
      onOpenChange(false)
    } catch {
      setError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Zendesk settings</DialogTitle>
          <DialogDescription>
            Restrict what {connectorName ?? 'this connector'} can do. These limits are enforced by Arche before any Zendesk request is sent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <section className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Ticket access</h3>
              <p className="text-xs text-muted-foreground">
                Control whether the agent can inspect tickets or perform write operations.
              </p>
            </div>

            <div className="space-y-3">
              <PermissionField
                checked={permissions.allowRead}
                description="Allow searching tickets, reading ticket details and listing comments."
                disabled={isLoading || isSaving}
                label="Read tickets"
                onCheckedChange={(checked) => updatePermission('allowRead', checked)}
              />
              <PermissionField
                checked={permissions.allowCreateTickets}
                description="Allow creating new tickets in Zendesk."
                disabled={isLoading || isSaving}
                label="Create tickets"
                onCheckedChange={(checked) => updatePermission('allowCreateTickets', checked)}
              />
              <PermissionField
                checked={permissions.allowUpdateTickets}
                description="Allow changing ticket fields and adding comments to existing tickets."
                disabled={isLoading || isSaving}
                label="Update tickets"
                onCheckedChange={(checked) => updatePermission('allowUpdateTickets', checked)}
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Comment visibility</h3>
              <p className="text-xs text-muted-foreground">
                Apply these limits to both ticket creation and updates. Requests outside this policy fail explicitly.
              </p>
            </div>

            <div className="space-y-3">
              <PermissionField
                checked={permissions.allowInternalComments}
                description="Allow private internal notes that stay visible only to Zendesk agents."
                disabled={isLoading || isSaving}
                label="Internal notes"
                onCheckedChange={(checked) => updatePermission('allowInternalComments', checked)}
              />
              <PermissionField
                checked={permissions.allowPublicComments}
                description="Allow public comments that can notify the requester by email."
                disabled={isLoading || isSaving}
                label="Public comments"
                onCheckedChange={(checked) => updatePermission('allowPublicComments', checked)}
              />
            </div>
          </section>

          <div className="flex justify-end gap-2">
            <Button disabled={isSaving} variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={isLoading || isSaving || !connectorId} onClick={() => void handleSave()}>
              {isSaving ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

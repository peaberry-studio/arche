'use client'

import { useEffect, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import { ConnectorToolPermissionsSection } from '@/components/connectors/connector-tool-permissions-section'
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
  getZendeskConnectorPermissionsConstraintMessage,
} from '@/lib/connectors/zendesk'
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
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasCommentVisibility = permissions.allowPublicComments || permissions.allowInternalComments
  const permissionsConstraintMessage = getZendeskConnectorPermissionsConstraintMessage(permissions)
  const canEditPermissions = hasLoadedSettings && !isLoading && !isSaving
  const createTicketsDisabled =
    !canEditPermissions || (!hasCommentVisibility && !permissions.allowCreateTickets)
  const internalCommentsDisabled =
    !canEditPermissions ||
    (permissions.allowCreateTickets && permissions.allowInternalComments && !permissions.allowPublicComments)
  const publicCommentsDisabled =
    !canEditPermissions ||
    (permissions.allowCreateTickets && permissions.allowPublicComments && !permissions.allowInternalComments)

  useEffect(() => {
    if (!open || !connectorId) {
      setPermissions(DEFAULT_ZENDESK_CONNECTOR_PERMISSIONS)
      setHasLoadedSettings(false)
      setError(null)
      setIsLoading(false)
      setIsSaving(false)
      return
    }

    let cancelled = false

    async function loadSettings() {
      setHasLoadedSettings(false)
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
          setError(getConnectorErrorMessage(data, 'load_settings_failed'))
          return
        }

        setPermissions(data.permissions)
        setHasLoadedSettings(true)
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
    if (!connectorId || !hasLoadedSettings || isLoading || isSaving || permissionsConstraintMessage) {
      return
    }

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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Zendesk settings</DialogTitle>
          <DialogDescription>
            Restrict what {connectorName ?? 'this connector'} can do. These limits are enforced by Arche before any Zendesk request is sent.
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

          {permissionsConstraintMessage ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {permissionsConstraintMessage}
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
                disabled={!canEditPermissions}
                label="Read tickets"
                onCheckedChange={(checked) => updatePermission('allowRead', checked)}
              />
              <PermissionField
                checked={permissions.allowCreateTickets}
                description="Allow creating new tickets in Zendesk."
                disabled={createTicketsDisabled}
                label="Create tickets"
                onCheckedChange={(checked) => updatePermission('allowCreateTickets', checked)}
              />
              <PermissionField
                checked={permissions.allowUpdateTickets}
                description="Allow changing ticket fields and adding comments to existing tickets."
                disabled={!canEditPermissions}
                label="Update tickets"
                onCheckedChange={(checked) => updatePermission('allowUpdateTickets', checked)}
              />

              {!hasCommentVisibility && !permissions.allowCreateTickets ? (
                <p className="text-xs text-muted-foreground">
                  Enable public comments or internal notes before allowing ticket creation.
                </p>
              ) : null}
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
                disabled={internalCommentsDisabled}
                label="Internal notes"
                onCheckedChange={(checked) => updatePermission('allowInternalComments', checked)}
              />
              <PermissionField
                checked={permissions.allowPublicComments}
                description="Allow public comments that can notify the requester by email."
                disabled={publicCommentsDisabled}
                label="Public comments"
                onCheckedChange={(checked) => updatePermission('allowPublicComments', checked)}
              />

              {permissions.allowCreateTickets && permissions.allowPublicComments !== permissions.allowInternalComments ? (
                <p className="text-xs text-muted-foreground">
                  Ticket creation needs at least one comment option. Disable ticket creation first to turn off the last enabled comment type.
                </p>
              ) : null}
            </div>
          </section>

          <ConnectorToolPermissionsSection connectorId={connectorId} enabled={open && hasLoadedSettings} slug={slug} />

          <div className="flex justify-end gap-2">
            <Button disabled={isSaving} variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={isLoading || isSaving || !connectorId || !hasLoadedSettings || Boolean(permissionsConstraintMessage)}
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

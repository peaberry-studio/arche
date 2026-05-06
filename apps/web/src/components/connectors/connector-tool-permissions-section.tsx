'use client'

import { useEffect, useMemo, useState } from 'react'
import { SpinnerGap } from '@phosphor-icons/react'

import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import { Button } from '@/components/ui/button'
import {
  CONNECTOR_TOOL_PERMISSION_ACTIONS,
  type ConnectorToolPermission,
  type ConnectorToolPermissionEntry,
} from '@/lib/connectors/tool-permissions'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'
import { cn } from '@/lib/utils'

type ConnectorToolPermissionsSectionProps = {
  connectorId: string | null
  enabled: boolean
  slug: string
}

type ConnectorToolPermissionsResponse = {
  tools: ConnectorToolPermissionEntry[]
  policyConfigured: boolean
  inventoryError?: string
}

const PERMISSION_LABELS: Record<ConnectorToolPermission, string> = {
  deny: 'Deny',
  ask: 'Ask',
  allow: 'Allow',
}

function toPermissionsPayload(
  tools: ConnectorToolPermissionEntry[],
): Record<string, ConnectorToolPermission> {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool.permission] as const))
}

function arePermissionsEqual(
  left: Record<string, ConnectorToolPermission>,
  right: Record<string, ConnectorToolPermission>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

export function ConnectorToolPermissionsSection({
  connectorId,
  enabled,
  slug,
}: ConnectorToolPermissionsSectionProps) {
  const [tools, setTools] = useState<ConnectorToolPermissionEntry[]>([])
  const [initialPermissions, setInitialPermissions] = useState<Record<string, ConnectorToolPermission>>({})
  const [policyConfigured, setPolicyConfigured] = useState(false)
  const [inventoryError, setInventoryError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !connectorId) {
      setTools([])
      setInitialPermissions({})
      setPolicyConfigured(false)
      setInventoryError(null)
      setError(null)
      setIsLoading(false)
      setIsSaving(false)
      return
    }

    let cancelled = false

    async function loadToolPermissions() {
      setIsLoading(true)
      setError(null)
      setInventoryError(null)

      try {
        const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/tool-permissions`, {
          cache: 'no-store',
        })
        const data = (await response.json().catch(() => null)) as
          | (ConnectorToolPermissionsResponse & { error?: string; message?: string })
          | null

        if (cancelled) return

        if (!response.ok || !data?.tools) {
          setError(getConnectorErrorMessage(data, 'load_settings_failed'))
          return
        }

        setTools(data.tools)
        setInitialPermissions(toPermissionsPayload(data.tools))
        setPolicyConfigured(data.policyConfigured)
        setInventoryError(data.inventoryError ?? null)
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

    void loadToolPermissions()

    return () => {
      cancelled = true
    }
  }, [connectorId, enabled, slug])

  const currentPermissions = useMemo(() => toPermissionsPayload(tools), [tools])
  const hasChanges = !arePermissionsEqual(currentPermissions, initialPermissions)
  const canEdit = enabled && Boolean(connectorId) && !isLoading && !isSaving && tools.length > 0

  function updatePermission(name: string, permission: ConnectorToolPermission) {
    setTools((current) =>
      current.map((tool) =>
        tool.name === name
          ? { ...tool, permission }
          : tool,
      ),
    )
  }

  async function handleSave() {
    if (!connectorId || !canEdit || !hasChanges) return

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors/${connectorId}/tool-permissions`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permissions: currentPermissions }),
      })
      const data = (await response.json().catch(() => null)) as
        | (ConnectorToolPermissionsResponse & { error?: string; message?: string })
        | null

      if (!response.ok || !data?.tools) {
        setError(getConnectorErrorMessage(data, 'save_failed'))
        return
      }

      setTools(data.tools)
      setInitialPermissions(toPermissionsPayload(data.tools))
      setPolicyConfigured(data.policyConfigured)
      setInventoryError(data.inventoryError ?? null)
      notifyWorkspaceConfigChanged()
    } catch {
      setError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Tool permissions</h3>
        <p className="text-xs text-muted-foreground">
          Choose whether each MCP tool is denied, allowed, or asks for approval before it runs.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          Loading tools...
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {inventoryError ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {inventoryError}
        </p>
      ) : null}

      {!isLoading && !error && tools.length === 0 ? (
        <p className="rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm text-muted-foreground">
          No MCP tools are available for this connector yet.
        </p>
      ) : null}

      <div className="space-y-3">
        {tools.map((tool) => (
          <div key={tool.name} className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-foreground">{tool.title}</p>
                <p className="break-all text-xs text-muted-foreground">{tool.name}</p>
                {tool.description ? (
                  <p className="text-xs text-muted-foreground">{tool.description}</p>
                ) : null}
              </div>

              <div className="grid shrink-0 grid-cols-3 overflow-hidden rounded-lg border border-border/60 text-xs">
                {CONNECTOR_TOOL_PERMISSION_ACTIONS.map((permission) => (
                  <button
                    key={permission}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => updatePermission(tool.name, permission)}
                    className={cn(
                      'px-3 py-1.5 transition-colors disabled:opacity-50',
                      tool.permission === permission
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {PERMISSION_LABELS[permission]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {policyConfigured ? 'Custom tool policy is configured.' : 'Default policy allows all connector tools.'}
        </p>
        <Button
          disabled={!canEdit || !hasChanges}
          size="sm"
          variant="outline"
          onClick={() => void handleSave()}
        >
          {isSaving ? 'Saving...' : 'Save tool permissions'}
        </Button>
      </div>
    </section>
  )
}

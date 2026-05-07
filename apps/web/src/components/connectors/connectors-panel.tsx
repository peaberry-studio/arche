'use client'

import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from 'react'

import { AddConnectorModal } from '@/components/connectors/add-connector-modal'
import { ConnectorList } from '@/components/connectors/connector-list'
import { ConnectorToolPermissionsDialog } from '@/components/connectors/connector-tool-permissions-dialog'
import { getConnectorErrorMessage } from '@/components/connectors/error-messages'
import { MetaAdsConnectorSettingsDialog } from '@/components/connectors/meta-ads-connector-settings-dialog'
import { ZendeskConnectorSettingsDialog } from '@/components/connectors/zendesk-connector-settings-dialog'
import type {
  ConnectorListItem,
  ConnectorTestResult,
  ConnectorTestState,
} from '@/components/connectors/types'
import { notifyWorkspaceConfigChanged } from '@/lib/runtime/config-status-events'

type SettingsDialogVariant = 'generic' | 'meta-ads' | 'zendesk'

export type ConnectorsPanelHandle = {
  openAddModal: () => void
}

type ConnectorsPanelProps = {
  slug: string
  oauthReturnTo?: string
  ref?: Ref<ConnectorsPanelHandle>
}

function toConnectorsPayload(value: unknown): {
  connectors: ConnectorListItem[]
} {
  if (!value || typeof value !== 'object') {
    return { connectors: [] }
  }

  const data = value as {
    connectors?: ConnectorListItem[]
  }

  return {
    connectors: Array.isArray(data.connectors) ? data.connectors : [],
  }
}

function formatTestResult(result: ConnectorTestResult): ConnectorTestState {
  if (result.ok) {
    return { status: 'success', message: result.message ?? 'Connection verified.' }
  }

  if (!result.tested) {
    return {
      status: 'error',
      message: result.message ?? 'Connection was not tested against the external service.',
    }
  }

  return { status: 'error', message: result.message ?? 'Connection test failed.' }
}

function getSettingsDialogVariant(connector: ConnectorListItem | null): SettingsDialogVariant | null {
  switch (connector?.type) {
    case 'zendesk':
      return 'zendesk'
    case 'meta-ads':
      return 'meta-ads'
    case undefined:
      return null
    default:
      return 'generic'
  }
}

export function ConnectorsPanel({ slug, oauthReturnTo, ref }: ConnectorsPanelProps) {
  const [connectors, setConnectors] = useState<ConnectorListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyConnectorIds, setBusyConnectorIds] = useState<Record<string, boolean>>({})
  const [testStates, setTestStates] = useState<Record<string, ConnectorTestState>>({})
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [settingsConnector, setSettingsConnector] = useState<ConnectorListItem | null>(null)
  const settingsDialogVariant = getSettingsDialogVariant(settingsConnector)

  useImperativeHandle(
    ref,
    () => ({
      openAddModal: () => setIsModalOpen(true),
    }),
    [],
  )

  const markConnectorBusy = useCallback((id: string, busy: boolean) => {
    setBusyConnectorIds((current) => {
      if (!busy) {
        const next = { ...current }
        delete next[id]
        return next
      }
      return { ...current, [id]: true }
    })
  }, [])

  const loadConnectors = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await fetch(`/api/u/${slug}/connectors`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as unknown

      if (!response.ok) {
        setLoadError(getConnectorErrorMessage(data, 'load_failed'))
        return
      }

      const payload = toConnectorsPayload(data)
      setConnectors(payload.connectors)
      setActionError(null)
    } catch {
      setLoadError(getConnectorErrorMessage(null, 'network_error'))
    } finally {
      setIsLoading(false)
    }
  }, [slug])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthStatus = params.get('oauth')
    const message = params.get('message')

    if (oauthStatus === 'error') {
      setActionError(getConnectorErrorMessage({ error: message ?? 'oauth_error' }, 'oauth_error'))
    }

    if (oauthStatus === 'success') {
      setActionError(null)
      void loadConnectors()
    }

    if (oauthStatus || message) {
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('oauth')
      cleanUrl.searchParams.delete('message')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}`)
    }
  }, [loadConnectors])

  useEffect(() => {
    void loadConnectors()
  }, [loadConnectors])

  const handleDelete = useCallback(
    async (id: string) => {
      markConnectorBusy(id, true)
      setActionError(null)

      try {
        const response = await fetch(`/api/u/${slug}/connectors/${id}`, {
          method: 'DELETE',
        })
        const data = (await response.json().catch(() => null)) as unknown

        if (!response.ok) {
          setActionError(getConnectorErrorMessage(data, 'delete_failed'))
          return
        }

        setConnectors((current) => current.filter((connector) => connector.id !== id))
        setTestStates((current) => {
          const next = { ...current }
          delete next[id]
          return next
        })
        notifyWorkspaceConfigChanged()
      } catch {
        setActionError(getConnectorErrorMessage(null, 'network_error'))
      } finally {
        markConnectorBusy(id, false)
      }
    },
    [markConnectorBusy, slug],
  )

  const handleToggleEnabled = useCallback(
    async (id: string, currentEnabled: boolean) => {
      markConnectorBusy(id, true)
      setActionError(null)

      try {
        const response = await fetch(`/api/u/${slug}/connectors/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: !currentEnabled }),
        })
        const data = (await response.json().catch(() => null)) as
          | { enabled?: boolean; error?: string; message?: string }
          | null

        if (!response.ok) {
          setActionError(getConnectorErrorMessage(data, 'update_failed'))
          return
        }

        setConnectors((current) =>
          current.map((connector) =>
            connector.id === id
              ? { ...connector, enabled: data?.enabled ?? !currentEnabled }
              : connector,
          ),
        )
        notifyWorkspaceConfigChanged()
      } catch {
        setActionError(getConnectorErrorMessage(null, 'network_error'))
      } finally {
        markConnectorBusy(id, false)
      }
    },
    [markConnectorBusy, slug],
  )

  const handleTestConnection = useCallback(
    async (id: string) => {
      markConnectorBusy(id, true)

      try {
        const response = await fetch(`/api/u/${slug}/connectors/${id}/test`, {
          method: 'POST',
        })
        const data = (await response.json().catch(() => null)) as
          | (ConnectorTestResult & { error?: string; message?: string })
          | null

        if (!response.ok || !data) {
          setTestStates((current) => ({
            ...current,
            [id]: {
              status: 'error',
              message: getConnectorErrorMessage(data, 'test_failed'),
            },
          }))
          return
        }

        setTestStates((current) => ({ ...current, [id]: formatTestResult(data) }))
      } catch {
        setTestStates((current) => ({
          ...current,
          [id]: { status: 'error', message: getConnectorErrorMessage(null, 'network_error') },
        }))
      } finally {
        markConnectorBusy(id, false)
      }
    },
    [markConnectorBusy, slug],
  )

  const handleConnectOAuth = useCallback(
    async (id: string) => {
      markConnectorBusy(id, true)
      setActionError(null)

      try {
        const requestUrl = new URL(`/api/u/${slug}/connectors/${id}/oauth/start`, window.location.origin)
        if (oauthReturnTo) {
          requestUrl.searchParams.set('returnTo', oauthReturnTo)
        }

        const response = await fetch(`${requestUrl.pathname}${requestUrl.search}`, {
          method: 'POST',
          headers: { accept: 'application/json' },
        })
        const data = (await response.json().catch(() => null)) as
          | { authorizeUrl?: string; error?: string }
          | null

        if (!response.ok || !data?.authorizeUrl) {
          setActionError(getConnectorErrorMessage(data, 'oauth_start_failed'))
          return
        }

        window.location.href = data.authorizeUrl
      } catch {
        setActionError(getConnectorErrorMessage(null, 'network_error'))
      } finally {
        markConnectorBusy(id, false)
      }
    },
    [markConnectorBusy, oauthReturnTo, slug],
  )

  return (
    <div className="space-y-4">
      {actionError ? (
        <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-destructive">
          The action could not be completed: {actionError}
        </div>
      ) : null}

      <ConnectorList
        connectors={connectors}
        loadError={loadError}
        isLoading={isLoading}
        busyConnectorIds={busyConnectorIds}
        testStates={testStates}
        onRetry={loadConnectors}
        onCreateFirst={() => setIsModalOpen(true)}
        onDelete={handleDelete}
        onOpenSettings={setSettingsConnector}
        onToggleEnabled={handleToggleEnabled}
        onTestConnection={handleTestConnection}
        onConnectOAuth={handleConnectOAuth}
      />

        <AddConnectorModal
          slug={slug}
          existingConnectors={connectors}
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          onSaved={() => {
          notifyWorkspaceConfigChanged()
          void loadConnectors()
        }}
      />

      <ZendeskConnectorSettingsDialog
        open={settingsDialogVariant === 'zendesk'}
        slug={slug}
        connectorId={settingsConnector?.id ?? null}
        connectorName={settingsConnector?.name ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setSettingsConnector(null)
          }
        }}
      />

      <MetaAdsConnectorSettingsDialog
        open={settingsDialogVariant === 'meta-ads'}
        slug={slug}
        connectorId={settingsConnector?.id ?? null}
        connectorName={settingsConnector?.name ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setSettingsConnector(null)
          }
        }}
      />

      <ConnectorToolPermissionsDialog
        open={settingsDialogVariant === 'generic'}
        slug={slug}
        connectorId={settingsConnector?.id ?? null}
        connectorName={settingsConnector?.name ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setSettingsConnector(null)
          }
        }}
      />
    </div>
  )
}

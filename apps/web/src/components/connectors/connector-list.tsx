import { Plugs } from '@phosphor-icons/react'

import { ConnectorCard } from '@/components/connectors/connector-card'
import type { ConnectorListItem, ConnectorTestState } from '@/components/connectors/types'
import { DashboardEmptyState } from '@/components/dashboard/dashboard-empty-state'
import { Button } from '@/components/ui/button'

type ConnectorListProps = {
  connectors: ConnectorListItem[]
  loadError: string | null
  isLoading: boolean
  busyConnectorIds: Record<string, boolean>
  testStates: Record<string, ConnectorTestState>
  onRetry: () => void
  onCreateFirst: () => void
  onDelete: (id: string, name: string) => void
  onOpenSettings: (connector: ConnectorListItem) => void
  onToggleEnabled: (id: string, enabled: boolean) => void
  onTestConnection: (id: string) => void
  onConnectOAuth: (id: string) => void
}

export function ConnectorList({
  connectors,
  loadError,
  isLoading,
  busyConnectorIds,
  testStates,
  onRetry,
  onCreateFirst,
  onDelete,
  onOpenSettings,
  onToggleEnabled,
  onTestConnection,
  onConnectOAuth,
}: ConnectorListProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border/60 bg-card/70 p-6">
            <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="mb-6 h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-9 w-full animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/50 p-6">
        <p className="text-sm text-destructive">Failed to load connectors: {loadError}</p>
        <div className="mt-4">
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (connectors.length === 0) {
    return (
      <DashboardEmptyState
        icon={Plugs}
        title="No connectors configured"
        description="Connectors link external services like Gmail, Slack, or Google Drive to your workspace so agents can read and act on real data."
        primaryAction={{ label: 'Add your first connector', onClick: onCreateFirst }}
      />
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {connectors.map((connector) => (
        <ConnectorCard
          key={connector.id}
          connector={connector}
          testState={testStates[connector.id]}
          isBusy={Boolean(busyConnectorIds[connector.id])}
          onDelete={onDelete}
          onOpenSettings={onOpenSettings}
          onToggleEnabled={onToggleEnabled}
          onTestConnection={onTestConnection}
          onConnectOAuth={onConnectOAuth}
        />
      ))}
    </div>
  )
}

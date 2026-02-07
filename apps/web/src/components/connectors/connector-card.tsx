import { BookText, Boxes, Globe } from 'lucide-react'

import type { ConnectorListItem, ConnectorTestState } from '@/components/connectors/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type ConnectorCardProps = {
  connector: ConnectorListItem
  testState?: ConnectorTestState
  isBusy: boolean
  onEdit: (id: string) => void
  onDelete: (id: string, name: string) => void
  onToggleEnabled: (id: string, enabled: boolean) => void
  onTestConnection: (id: string) => void
  onConnectOAuth: (id: string) => void
}

function getTypeIcon(type: ConnectorListItem['type']) {
  switch (type) {
    case 'linear':
      return <Boxes className="h-4 w-4" />
    case 'notion':
      return <BookText className="h-4 w-4" />
    case 'custom':
      return <Globe className="h-4 w-4" />
    default:
      return <Globe className="h-4 w-4" />
  }
}

function getTypeLabel(type: ConnectorListItem['type']): string {
  switch (type) {
    case 'linear':
      return 'Linear'
    case 'notion':
      return 'Notion'
    case 'custom':
      return 'Custom'
    default:
      return type
  }
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function getStatusMeta(connector: ConnectorListItem): { label: string; className: string } {
  if (connector.status === 'disabled') {
    return {
      label: 'Not working',
      className: 'bg-rose-100 text-rose-700 border-rose-200',
    }
  }

  if (connector.status === 'pending') {
    return {
      label: 'Pending setup',
      className: 'bg-amber-100 text-amber-700 border-amber-200',
    }
  }

  return {
    label: 'Working',
    className: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  }
}

export function ConnectorCard({
  connector,
  testState,
  isBusy,
  onEdit,
  onDelete,
  onToggleEnabled,
  onTestConnection,
  onConnectOAuth,
}: ConnectorCardProps) {
  const usesOAuth = connector.authType === 'oauth'
  const statusMeta = getStatusMeta(connector)

  return (
    <Card className="border-border/60 bg-card/70 transition-colors hover:border-border">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
              {getTypeIcon(connector.type)}
            </div>
            <div>
              <CardTitle className="text-base font-semibold">{connector.name}</CardTitle>
              <p className="text-xs text-muted-foreground">{getTypeLabel(connector.type)}</p>
            </div>
          </div>
          <Badge variant="outline" className={statusMeta.className}>
            {statusMeta.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Created: {formatDate(connector.createdAt)}</p>
          {usesOAuth ? (
            <p>
              OAuth: {connector.oauthConnected ? 'Connected' : 'Pending connection'}
            </p>
          ) : null}
          {!connector.enabled ? <p>Enable this connector to run a connection test.</p> : null}
          {testState ? (
            <p className={testState.status === 'success' ? 'text-emerald-600' : 'text-destructive'}>
              Test: {testState.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onEdit(connector.id)} disabled={isBusy}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onToggleEnabled(connector.id, connector.enabled)}
            disabled={isBusy}
          >
            {connector.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTestConnection(connector.id)}
            disabled={isBusy || !connector.enabled || (usesOAuth && !connector.oauthConnected)}
          >
            Test connection
          </Button>
          {usesOAuth ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onConnectOAuth(connector.id)}
              disabled={isBusy}
            >
              {connector.oauthConnected ? 'Reconnect OAuth' : 'Connect OAuth'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onDelete(connector.id, connector.name)}
            disabled={isBusy}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

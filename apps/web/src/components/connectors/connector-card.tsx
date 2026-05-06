import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'

import { ConnectorTypeIcon } from '@/components/connectors/connector-type-icon'
import type { ConnectorListItem, ConnectorTestState } from '@/components/connectors/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { getLinearOAuthModeLabel } from '@/lib/connectors/linear'

type ConnectorCardProps = {
  connector: ConnectorListItem
  testState?: ConnectorTestState
  isBusy: boolean
  onDelete: (id: string, name: string) => void
  onOpenSettings: (connector: ConnectorListItem) => void
  onToggleEnabled: (id: string, enabled: boolean) => void
  onTestConnection: (id: string) => void
  onConnectOAuth: (id: string) => void
}

type ConnectorStatusMeta = {
  label: string
  variant: 'success' | 'warning' | 'outline'
}

function getStatusMeta(connector: ConnectorListItem): ConnectorStatusMeta {
  if (connector.status === 'disabled') {
    return { label: 'Not working', variant: 'outline' }
  }
  if (connector.status === 'pending') {
    return { label: 'Pending setup', variant: 'warning' }
  }
  return { label: 'Working', variant: 'success' }
}

type ConnectorCardHeaderProps = {
  connector: ConnectorListItem
  isBusy: boolean
  onToggleEnabled: (id: string, enabled: boolean) => void
}

function ConnectorCardHeader({ connector, isBusy, onToggleEnabled }: ConnectorCardHeaderProps) {
  const statusMeta = getStatusMeta(connector)
  const linearOAuthModeLabel = getLinearOAuthModeLabel(connector)

  return (
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
            <ConnectorTypeIcon type={connector.type} className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{connector.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
              {linearOAuthModeLabel ? <Badge variant="outline">{linearOAuthModeLabel}</Badge> : null}
            </div>
          </div>
        </div>

        <Switch
          checked={connector.enabled}
          onCheckedChange={() => onToggleEnabled(connector.id, connector.enabled)}
          disabled={isBusy}
        />
      </div>
    </CardHeader>
  )
}

type ConnectorTestResultProps = {
  testState?: ConnectorTestState
}

function ConnectorTestResult({ testState }: ConnectorTestResultProps) {
  if (!testState) return null

  return (
    <p className={`text-xs ${testState.status === 'success' ? 'text-emerald-600' : 'text-destructive'}`}>
      Test: {testState.message}
    </p>
  )
}

type ConnectorActionsProps = {
  connector: ConnectorListItem
  isBusy: boolean
  onOpenSettings: (connector: ConnectorListItem) => void
  onTestConnection: (id: string) => void
  onConnectOAuth: (id: string) => void
  deleteAction: ReactNode
}

function ConnectorActions({
  connector,
  isBusy,
  onOpenSettings,
  onTestConnection,
  onConnectOAuth,
  deleteAction,
}: ConnectorActionsProps) {
  const usesOAuth = connector.authType === 'oauth'

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        onClick={() => onTestConnection(connector.id)}
        disabled={isBusy || !connector.enabled || (usesOAuth && !connector.oauthConnected)}
      >
        Test connection
      </button>

      {usesOAuth ? (
        <button
          type="button"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          onClick={() => onConnectOAuth(connector.id)}
          disabled={isBusy}
        >
          {connector.oauthConnected ? 'Reconnect OAuth' : 'Connect OAuth'}
        </button>
      ) : null}

      <button
        type="button"
        className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        onClick={() => onOpenSettings(connector)}
        disabled={isBusy}
      >
        Settings
      </button>

      <div className="relative ml-auto">{deleteAction}</div>
    </div>
  )
}

type ConnectorDeleteActionProps = {
  isBusy: boolean
  showConfirm: boolean
  onOpenConfirm: () => void
  onCancel: () => void
  onConfirm: () => void
}

function ConnectorDeleteAction({
  isBusy,
  showConfirm,
  onOpenConfirm,
  onCancel,
  onConfirm,
}: ConnectorDeleteActionProps) {
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={onOpenConfirm}
        disabled={isBusy}
        aria-label="Delete connector"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>

      {showConfirm ? (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-52 rounded-xl border border-border bg-popover p-4 shadow-lg">
          <p className="text-center text-sm font-medium text-popover-foreground">Delete this connector?</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="destructive" className="h-8 flex-1 text-xs" onClick={onConfirm}>
              Delete
            </Button>
            <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function ConnectorCard({
  connector,
  testState,
  isBusy,
  onDelete,
  onOpenSettings,
  onToggleEnabled,
  onTestConnection,
  onConnectOAuth,
}: ConnectorCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showDeleteConfirm) return

    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setShowDeleteConfirm(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDeleteConfirm])

  const handleConfirmDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    onDelete(connector.id, connector.name)
  }, [connector.id, connector.name, onDelete])

  return (
    <Card className="border-border/60 bg-card/70 transition-colors hover:border-border">
      <ConnectorCardHeader connector={connector} isBusy={isBusy} onToggleEnabled={onToggleEnabled} />

      <CardContent className="space-y-3 pt-0">
        <ConnectorTestResult testState={testState} />
        <div ref={popoverRef}>
          <ConnectorActions
            connector={connector}
            isBusy={isBusy}
            onOpenSettings={onOpenSettings}
            onTestConnection={onTestConnection}
            onConnectOAuth={onConnectOAuth}
            deleteAction={
              <ConnectorDeleteAction
                isBusy={isBusy}
                showConfirm={showDeleteConfirm}
                onOpenConfirm={() => setShowDeleteConfirm(true)}
                onCancel={() => setShowDeleteConfirm(false)}
                onConfirm={handleConfirmDelete}
              />
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

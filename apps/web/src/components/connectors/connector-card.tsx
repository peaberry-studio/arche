import { useCallback, useEffect, useRef, useState } from 'react'
import { BookText, Boxes, Globe, Ticket, Trash2 } from 'lucide-react'

import type { ConnectorListItem, ConnectorTestState } from '@/components/connectors/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

type ConnectorCardProps = {
  connector: ConnectorListItem
  testState?: ConnectorTestState
  isBusy: boolean
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
    case 'zendesk':
      return <Ticket className="h-4 w-4" />
    case 'custom':
      return <Globe className="h-4 w-4" />
    default:
      return <Globe className="h-4 w-4" />
  }
}

function getStatusMeta(connector: ConnectorListItem): {
  label: string
  variant: 'success' | 'warning' | 'outline'
} {
  if (connector.status === 'disabled') {
    return { label: 'Not working', variant: 'outline' }
  }
  if (connector.status === 'pending') {
    return { label: 'Pending setup', variant: 'warning' }
  }
  return { label: 'Working', variant: 'success' }
}

export function ConnectorCard({
  connector,
  testState,
  isBusy,
  onDelete,
  onToggleEnabled,
  onTestConnection,
  onConnectOAuth,
}: ConnectorCardProps) {
  const usesOAuth = connector.authType === 'oauth'
  const statusMeta = getStatusMeta(connector)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
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
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          {/* Left: icon + name + status */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground">
              {getTypeIcon(connector.type)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{connector.name}</p>
              <Badge variant={statusMeta.variant} className="mt-1">
                {statusMeta.label}
              </Badge>
            </div>
          </div>

          {/* Right: toggle — flush with top-right corner */}
          <Switch
            checked={connector.enabled}
            onCheckedChange={() =>
              onToggleEnabled(connector.id, connector.enabled)
            }
            disabled={isBusy}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {/* Test result */}
        {testState ? (
          <p
            className={`text-xs ${
              testState.status === 'success'
                ? 'text-emerald-600'
                : 'text-destructive'
            }`}
          >
            Test: {testState.message}
          </p>
        ) : null}

        {/* Actions row */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            onClick={() => onTestConnection(connector.id)}
            disabled={
              isBusy ||
              !connector.enabled ||
              (usesOAuth && !connector.oauthConnected)
            }
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

          {/* Delete — pushed to the right */}
          <div className="relative ml-auto" ref={popoverRef}>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isBusy}
              aria-label="Delete connector"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>

            {showDeleteConfirm ? (
              <div className="absolute bottom-full right-0 z-50 mb-2 w-52 rounded-xl border border-border bg-popover p-4 shadow-lg">
                <p className="text-center text-sm font-medium text-popover-foreground">
                  Delete this connector?
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 flex-1 text-xs"
                    onClick={handleConfirmDelete}
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 text-xs"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

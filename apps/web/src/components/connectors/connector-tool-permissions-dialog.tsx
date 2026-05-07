'use client'

import { ConnectorToolPermissionsSection } from '@/components/connectors/connector-tool-permissions-section'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ConnectorToolPermissionsDialogProps = {
  connectorId: string | null
  connectorName: string | null
  onOpenChange: (open: boolean) => void
  open: boolean
  slug: string
}

export function ConnectorToolPermissionsDialog({
  connectorId,
  connectorName,
  onOpenChange,
  open,
  slug,
}: ConnectorToolPermissionsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scrollbar-custom max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connector settings</DialogTitle>
          <DialogDescription>
            Configure tool-level MCP permissions for {connectorName ?? 'this connector'}.
          </DialogDescription>
        </DialogHeader>

        <ConnectorToolPermissionsSection connectorId={connectorId} enabled={open} slug={slug} />
      </DialogContent>
    </Dialog>
  )
}

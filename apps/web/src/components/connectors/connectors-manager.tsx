'use client'

import { useRef } from 'react'

import { ConnectorsPanel, type ConnectorsPanelHandle } from '@/components/connectors/connectors-panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ConnectorsManagerProps = {
  slug: string
  embedded?: boolean
  title?: string
  description?: string
  oauthReturnTo?: string
}

export function ConnectorsManager({
  slug,
  embedded = false,
  title = 'Connectors',
  description = 'Configure integrations for your workspace.',
  oauthReturnTo,
}: ConnectorsManagerProps) {
  const panelRef = useRef<ConnectorsPanelHandle>(null)

  const content = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {embedded ? (
            <h2 className="text-lg font-medium">{title}</h2>
          ) : (
            <h1 className="type-display text-3xl font-semibold tracking-tight">{title}</h1>
          )}
          <p className={cn(embedded ? 'text-sm text-muted-foreground' : 'text-muted-foreground')}>
            {description}
          </p>
        </div>
        <Button variant="outline" onClick={() => panelRef.current?.openAddModal()}>
          Add connector
        </Button>
      </div>

      <ConnectorsPanel ref={panelRef} slug={slug} oauthReturnTo={oauthReturnTo} />
    </>
  )

  if (embedded) {
    return <div className="space-y-6">{content}</div>
  }

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">{content}</div>
    </main>
  )
}

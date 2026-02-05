import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type AgentCardProps = {
  displayName: string
  agentId: string
  description?: string
  model?: string
  isPrimary: boolean
  isAdmin: boolean
  editHref?: string
}

export function AgentCard({
  displayName,
  agentId,
  description,
  model,
  isPrimary,
  isAdmin,
  editHref
}: AgentCardProps) {
  return (
    <Card className="group relative border-border/60 bg-card/70">
      {isAdmin && editHref && (
        <Link
          href={editHref}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
        </Link>
      )}

      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/70 text-sm font-semibold text-muted-foreground">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="space-y-0.5">
            <CardTitle className="text-base font-semibold">{displayName}</CardTitle>
            <p className="text-xs text-muted-foreground">ID: {agentId}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {description && (
          <p className="text-sm text-muted-foreground">
            {description}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Badge variant={isPrimary ? 'default' : 'secondary'}>
            {isPrimary ? 'Primary' : 'Secondary'}
          </Badge>
          {model && (
            <span className="text-xs text-muted-foreground">
              {model}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

import { BarChart3, BookText, Boxes, Globe, Search, Ticket } from 'lucide-react'

import type { ConnectorType } from '@/lib/connectors/types'

type ConnectorTypeIconProps = {
  type: ConnectorType
  className?: string
}

export function ConnectorTypeIcon({ type, className }: ConnectorTypeIconProps) {
  switch (type) {
    case 'linear':
      return <Boxes className={className} />
    case 'notion':
      return <BookText className={className} />
    case 'zendesk':
      return <Ticket className={className} />
    case 'ahrefs':
      return <Search className={className} />
    case 'umami':
      return <BarChart3 className={className} />
    case 'custom':
      return <Globe className={className} />
    default:
      return <Globe className={className} />
  }
}

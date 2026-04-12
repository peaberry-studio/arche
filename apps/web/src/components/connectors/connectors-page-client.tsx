'use client'

import { ConnectorsManager } from '@/components/connectors/connectors-manager'

type ConnectorsPageClientProps = {
  slug: string
}

export function ConnectorsPageClient({ slug }: ConnectorsPageClientProps) {
  return <ConnectorsManager slug={slug} />
}

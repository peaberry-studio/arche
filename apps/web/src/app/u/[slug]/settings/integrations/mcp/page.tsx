import { redirect } from 'next/navigation'

import { getWorkspaceIntegrationHref } from '@/lib/workspace-hrefs'

export default async function McpIntegrationSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(getWorkspaceIntegrationHref(slug, 'mcp'))
}

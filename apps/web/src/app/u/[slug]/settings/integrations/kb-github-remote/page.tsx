import { redirect } from 'next/navigation'

import { getWorkspaceIntegrationHref } from '@/lib/workspace-hrefs'

export default async function KbGithubRemoteSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(getWorkspaceIntegrationHref(slug, 'kb-github-remote'))
}

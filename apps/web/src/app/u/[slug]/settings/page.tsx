import { redirect } from 'next/navigation'

import { getWorkspaceHref } from '@/lib/workspace-hrefs'
import { isWorkspaceSettingsSection } from '@/lib/workspace-settings'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ section?: string | string[] }>
}) {
  const { slug } = await params
  const search = await searchParams
  const sectionValue = Array.isArray(search.section) ? search.section[0] : search.section
  const section = sectionValue && isWorkspaceSettingsSection(sectionValue) ? sectionValue : 'general'
  redirect(getWorkspaceHref(slug, { settings: section }))
}

import { redirect } from 'next/navigation'

export default async function LegacySecuritySettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/u/${slug}/settings?section=security`)
}

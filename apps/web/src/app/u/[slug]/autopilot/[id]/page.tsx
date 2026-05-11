import { redirect } from 'next/navigation'

export default async function LegacyEditFlowRedirectPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>
}) {
  const { id, slug } = await params

  redirect(`/u/${slug}/flows/${id}`)
}

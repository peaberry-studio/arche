import { redirect } from 'next/navigation'

export default async function LegacyNewFlowRedirectPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  redirect(`/u/${slug}/flows/new`)
}

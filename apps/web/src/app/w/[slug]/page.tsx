import { WorkspaceShell } from '@/components/workspace/workspace-shell'

export default async function WorkspaceHostPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ path?: string }>
}) {
  const { slug } = await params
  const search = await searchParams

  return (
    <WorkspaceShell
      slug={slug}
      initialFilePath={search?.path ?? null}
    />
  )
}

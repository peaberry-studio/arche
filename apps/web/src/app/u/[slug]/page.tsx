import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export default function WorkspacePage({
  params,
  searchParams
}: {
  params: { slug: string };
  searchParams?: { path?: string };
}) {
  return (
    <WorkspaceShell
      slug={params.slug}
      initialFilePath={searchParams?.path ?? null}
    />
  );
}

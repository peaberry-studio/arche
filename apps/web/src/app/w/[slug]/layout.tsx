import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <WorkspaceThemeProvider key={slug} storageScope={slug}>
      {children}
    </WorkspaceThemeProvider>
  );
}

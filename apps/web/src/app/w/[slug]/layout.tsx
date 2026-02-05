import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceThemeProvider>
      {children}
    </WorkspaceThemeProvider>
  );
}

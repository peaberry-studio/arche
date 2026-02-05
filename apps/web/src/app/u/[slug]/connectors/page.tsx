export default async function ConnectorsPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  await params

  return (
    <main className="relative mx-auto max-w-6xl px-6 py-10">
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              Connectors
            </h1>
            <p className="text-muted-foreground">
              Manage your workspace integrations and data sources.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center">
          <p className="text-muted-foreground">
            Connectors configuration coming soon.
          </p>
        </div>
      </div>
    </main>
  )
}

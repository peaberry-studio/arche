import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from "next/link";

import { getSessionFromToken, SESSION_COOKIE_NAME } from '@/lib/auth'
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navigation = [
  { label: "Overview", href: "#", active: true },
  { label: "Agents", href: "#" },
  { label: "Connectors", href: "#" },
  { label: "Playbooks", href: "#" },
  { label: "Team", href: "#" },
  { label: "Settings", href: "#" },
];

const stats = [
  { label: "Active processes", value: "24" },
  { label: "Sub-agents", value: "4" },
  { label: "Connectors", value: "9" },
];

const agents = [
  {
    name: "Sales",
    status: "Active",
    description: "Pipeline, follow-ups, and pricing.",
  },
  {
    name: "Support",
    status: "Active",
    description: "Triage and escalation with context.",
  },
  {
    name: "Operations",
    status: "Training",
    description: "SOPs, logistics, and SLA management.",
  },
  {
    name: "Finance",
    status: "Queued",
    description: "Reconciliation and risk alerts.",
  },
];

const connectors = [
  { name: "HubSpot", status: "Daily sync" },
  { name: "Linear", status: "Real-time" },
  { name: "Notion", status: "Daily sync" },
  { name: "Slack", status: "Real-time" },
];

const activity = [
  { time: "Today 09:42", text: "Support resolved 18 tickets with context." },
  { time: "Today 08:10", text: "Sales updated 6 opportunities." },
  { time: "Yesterday 19:30", text: "Operations internalized a new playbook." },
];

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Verificar autenticación
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  
  if (!token) {
    redirect('/login')
  }

  const session = await getSessionFromToken(token)
  if (!session) {
    redirect('/login')
  }

  // Verificar autorización
  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    redirect(`/u/${session.user.slug}`)
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 organic-background" />

      {/* Header */}
      <header className="relative border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="font-[family-name:var(--font-display)] text-lg font-semibold"
            >
              Arche
            </Link>
            <span className="text-sm text-muted-foreground">{slug}</span>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {navigation.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                  item.active
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-6 py-10">
        {/* Page header */}
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <Badge variant="outline">Proposed layout</Badge>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
              Dashboard
            </h1>
            <p className="text-muted-foreground">
              Workspace overview and agent status.
            </p>
          </div>
          <div className="flex gap-3">
            <Button asChild>
              <Link href={`/w/${slug}`}>Open workspace</Link>
            </Button>
            <Button variant="outline">Add connector</Button>
          </div>
        </div>

        {/* Stats */}
        <section className="mb-10 grid gap-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border/60 bg-card/50 p-5"
            >
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">
                {stat.value}
              </p>
            </div>
          ))}
        </section>

        {/* Main grid */}
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* Agents */}
          <section>
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">
              Sub-agents
            </h2>
            <div className="space-y-3">
              {agents.map((agent) => (
                <div
                  key={agent.name}
                  className="flex items-start justify-between rounded-xl border border-border/60 bg-card/50 p-5"
                >
                  <div>
                    <h3 className="font-medium text-foreground">{agent.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {agent.description}
                    </p>
                  </div>
                  <Badge
                    variant={agent.status === "Active" ? "default" : "secondary"}
                  >
                    {agent.status}
                  </Badge>
                </div>
              ))}
            </div>
          </section>

          {/* Sidebar */}
          <aside className="space-y-8">
            {/* Connectors */}
            <section>
              <h2 className="mb-4 text-sm font-medium text-muted-foreground">
                Connectors
              </h2>
              <div className="space-y-2">
                {connectors.map((connector) => (
                  <div
                    key={connector.name}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-4 py-3"
                  >
                    <span className="text-sm text-foreground">
                      {connector.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {connector.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Activity */}
            <section>
              <h2 className="mb-4 text-sm font-medium text-muted-foreground">
                Recent activity
              </h2>
              <div className="space-y-3">
                {activity.map((item, i) => (
                  <div key={i} className="space-y-1">
                    <p className="text-xs text-muted-foreground">{item.time}</p>
                    <p className="text-sm text-foreground">{item.text}</p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

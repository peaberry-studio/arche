import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InstanceControls } from "@/components/instance-controls";

const navigation = [
  { label: "Resumen", href: "#", active: true },
  { label: "Agentes", href: "#" },
  { label: "Conectores", href: "#" },
  { label: "Playbooks", href: "#" },
  { label: "Equipo", href: "#" },
  { label: "Configuración", href: "#" },
];

const stats = [
  { label: "Procesos activos", value: "24" },
  { label: "Subagentes", value: "4" },
  { label: "Conectores", value: "9" },
];

const agents = [
  {
    name: "Ventas",
    status: "Activo",
    description: "Pipeline, follow-ups y pricing.",
  },
  {
    name: "Soporte",
    status: "Activo",
    description: "Diagnóstico y escalado con contexto.",
  },
  {
    name: "Operaciones",
    status: "Entrenando",
    description: "SOPs, logística y control de SLA.",
  },
  {
    name: "Finanzas",
    status: "En cola",
    description: "Conciliación y alertas de riesgo.",
  },
];

const connectors = [
  { name: "HubSpot", status: "Sync diaria" },
  { name: "Linear", status: "Realtime" },
  { name: "Notion", status: "Sync diaria" },
  { name: "Slack", status: "Realtime" },
];

const activity = [
  { time: "Hoy 09:42", text: "Soporte resolvió 18 tickets con contexto." },
  { time: "Hoy 08:10", text: "Ventas actualizó 6 oportunidades." },
  { time: "Ayer 19:30", text: "Operaciones interiorizó un nuevo playbook." },
];

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

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
            <span className="text-sm text-muted-foreground">
              {slug}
            </span>
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
            <Badge variant="outline">Layout propuesto</Badge>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
              Dashboard
            </h1>
            <p className="text-muted-foreground">
              Vista general del workspace y estado de los agentes.
            </p>
          </div>
          <div className="flex gap-3">
            <Button>Crear subagente</Button>
            <Button variant="outline">Agregar conector</Button>
          </div>
        </div>

        {/* Instance controls */}
        <section className="mb-10">
          <InstanceControls slug={slug} />
        </section>

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
              Subagentes
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
                    variant={agent.status === "Activo" ? "default" : "secondary"}
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
                Conectores
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
                Actividad reciente
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

import type {
  ChatMessage,
  ChatSession,
  WorkspaceDiff,
  WorkspaceFile,
  WorkspaceNode
} from "@/types/workspace";

export const workspaceTree: WorkspaceNode[] = [
  {
    id: "root-readme",
    name: "README.md",
    path: "README.md",
    type: "file"
  },
  {
    id: "root-company",
    name: "Company",
    path: "Company",
    type: "folder",
    children: [
      {
        id: "company-overview",
        name: "Product",
        path: "Company/Product",
        type: "folder",
        children: [
          {
            id: "company-product-overview",
            name: "00 - Overview.md",
            path: "Company/Product/00 - Overview.md",
            type: "file"
          },
          {
            id: "company-product-docs",
            name: "docs",
            path: "Company/Product/docs",
            type: "folder",
            children: [
              {
                id: "company-product-docs-index",
                name: "index.md",
                path: "Company/Product/docs/index.md",
                type: "file"
              },
              {
                id: "company-product-docs-guidelines",
                name: "design-guidelines.md",
                path: "Company/Product/docs/design-guidelines.md",
                type: "file"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: "root-outputs",
    name: "Outputs",
    path: "Outputs",
    type: "folder",
    children: [
      {
        id: "outputs-comms",
        name: "Comunicaciones",
        path: "Outputs/Comunicaciones",
        type: "folder",
        children: [
          {
            id: "outputs-comms-index",
            name: "00 - Comunicaciones - Indice.md",
            path: "Outputs/Comunicaciones/00 - Comunicaciones - Indice.md",
            type: "file"
          }
        ]
      }
    ]
  }
];

export const workspaceFiles: Record<string, WorkspaceFile> = {
  "README.md": {
    path: "README.md",
    title: "README",
    updatedAt: "Hoy 09:18",
    size: "2.1 KB",
    kind: "markdown",
    content: "# Arche Workspace\n\nEste workspace es el centro operativo para agentes y conocimiento.\n\n## Objetivos del día\n- Revisar el mapa de pantallas\n- Validar el flujo de sesiones\n- Definir el contrato de eventos\n\n## Notas\nEl agente principal opera en modo chat-first y aplica cambios directos con revisión en diff."
  },
  "Company/Product/00 - Overview.md": {
    path: "Company/Product/00 - Overview.md",
    title: "Overview del producto",
    updatedAt: "Ayer 18:40",
    size: "3.4 KB",
    kind: "markdown",
    content: "# Arche - Overview\n\nArche es un sistema multiusuario que levanta instancias aisladas de OpenCode bajo demanda.\n\n## Piezas del sistema\n- App web (Next.js)\n- BFF + Postgres + Prisma\n- Spawner con Docker\n\n## Funcionalidades actuales\n- Login local y sesiones seguras\n- Aislamiento por subdominio\n- Provisionamiento on-demand\n\n## Pendientes\n- UX del workspace\n- Integración con runtime\n- Contrato de eventos"
  },
  "Company/Product/docs/index.md": {
    path: "Company/Product/docs/index.md",
    title: "Centro de ayuda",
    updatedAt: "Ayer 12:05",
    size: "1.2 KB",
    kind: "markdown",
    content: "# Centro de ayuda\n\n## Secciones\n- Preguntas frecuentes\n- Planes: Free vs Pro\n- Gestionar suscripción\n- Contacto\n\n## Guías internas\n- Guía de estilo UI\n- Checklist de soporte"
  },
  "Company/Product/docs/design-guidelines.md": {
    path: "Company/Product/docs/design-guidelines.md",
    title: "Guía de estilo UI",
    updatedAt: "Hoy 08:02",
    size: "1.8 KB",
    kind: "markdown",
    content: "# Guía de estilo UI\n\n## Principios\n- Modo claro como base, con calidez orgánica\n- Acento mandarina para acciones\n- Contenedores con bordes sutiles\n\n## Tipografía\n- Titulares: Fraunces\n- Texto base: Geist Sans\n- UI caps: mono + tracking\n\n## Motion\n- Entrada suave\n- Stagger leve en grids"
  },
  "Outputs/Comunicaciones/00 - Comunicaciones - Indice.md": {
    path: "Outputs/Comunicaciones/00 - Comunicaciones - Indice.md",
    title: "Comunicaciones",
    updatedAt: "Hoy 10:20",
    size: "800 B",
    kind: "markdown",
    content: "# Comunicaciones\n\n## Canales\n- Blog\n- Newsletter\n- Discord\n\n## Estado\nEn revisión por el equipo de contenido."
  }
};

export const defaultFilePath = "README.md";

export const chatSessions: ChatSession[] = [
  {
    id: "session-01",
    title: "Plan de trabajo workspace",
    status: "active",
    updatedAt: "Hace 2 min",
    agent: "Agente principal"
  },
  {
    id: "session-02",
    title: "Revisión de arquitectura UI",
    status: "idle",
    updatedAt: "Hoy 08:30",
    agent: "Agente principal"
  },
  {
    id: "session-03",
    title: "Notas de integración",
    status: "archived",
    updatedAt: "Ayer 19:10",
    agent: "Agente principal"
  }
];

export const chatMessages: ChatMessage[] = [
  {
    id: "msg-01",
    sessionId: "session-01",
    role: "system",
    content: "Sesión creada automáticamente.",
    timestamp: "Hoy 09:02"
  },
  {
    id: "msg-02",
    sessionId: "session-01",
    role: "assistant",
    content:
      "Ya tengo el layout chat-first. Voy a preparar paneles redimensionables y una pestaña de review con diff.",
    timestamp: "Hoy 09:03",
    attachments: [
      { type: "file", label: "README.md", path: "README.md" }
    ]
  },
  {
    id: "msg-03",
    sessionId: "session-01",
    role: "user",
    content:
      "Prioriza el chat y añade review de cambios con diff. Mantén paneles colapsables.",
    timestamp: "Hoy 09:04"
  },
  {
    id: "msg-04",
    sessionId: "session-01",
    role: "assistant",
    content:
      "He aplicado cambios a dos archivos y he generado el diff para revisión.",
    timestamp: "Hoy 09:06",
    attachments: [
      {
        type: "file",
        label: "Company/Product/docs/design-guidelines.md",
        path: "Company/Product/docs/design-guidelines.md"
      },
      {
        type: "file",
        label: "Company/Product/00 - Overview.md",
        path: "Company/Product/00 - Overview.md"
      }
    ]
  },
  {
    id: "msg-05",
    sessionId: "session-02",
    role: "assistant",
    content:
      "Checklist de UX mínima: archivos, chat, review, estados vacíos.",
    timestamp: "Hoy 08:30"
  },
  {
    id: "msg-06",
    sessionId: "session-03",
    role: "assistant",
    content:
      "Notas de integración con runtime y spawner para la siguiente fase.",
    timestamp: "Ayer 19:10"
  }
];

export const workspaceDiffs: WorkspaceDiff[] = [
  {
    path: "Company/Product/docs/design-guidelines.md",
    status: "modified",
    additions: 12,
    deletions: 4,
    diff: "diff --git a/Company/Product/docs/design-guidelines.md b/Company/Product/docs/design-guidelines.md\nindex 4ab2..9d7c 100644\n--- a/Company/Product/docs/design-guidelines.md\n+++ b/Company/Product/docs/design-guidelines.md\n@@ -1,6 +1,8 @@\n # Guía de estilo UI\n \n ## Principios\n-- Modo claro como base, con calidez orgánica\n-- Acento mandarina para acciones\n+- Modo claro como base, con calidez orgánica y superficies suaves\n+- Acento mandarina para acciones y highlights\n+- Paneles con bordes visibles y radios contenidos\n@@ -12,6 +14,10 @@\n ## Tipografía\n - Titulares: Fraunces\n - Texto base: Geist Sans\n+- Micro etiquetas: tracking amplio\n+- UI caps: mono + tracking\n \n ## Motion\n - Entrada suave\n - Stagger leve en grids"
  },
  {
    path: "Company/Product/00 - Overview.md",
    status: "modified",
    additions: 6,
    deletions: 2,
    diff: "diff --git a/Company/Product/00 - Overview.md b/Company/Product/00 - Overview.md\nindex 2a09..6f2b 100644\n--- a/Company/Product/00 - Overview.md\n+++ b/Company/Product/00 - Overview.md\n@@ -10,7 +10,11 @@\n ## Funcionalidades actuales\n - Login local y sesiones seguras\n - Aislamiento por subdominio\n - Provisionamiento on-demand\n+\n+## UX workspace\n+- Layout chat-first con paneles redimensionables\n+- Review con diff de cambios\n+- Estados vacíos y errores mínimos"
  }
];

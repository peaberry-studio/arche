# Linear MCP (legacy)

Nota: este documento queda como referencia histórica. La gestión de tareas del equipo se hace ahora en GitHub (issues + Projects). Ver: [[Company/06 - Herramientas - GitHub Issues y Projects]].

El servidor MCP (Model Context Protocol) de Linear permite que clientes compatibles (Claude, Cursor, etc.) accedan de forma segura a datos de Linear (issues, proyectos, comentarios) para crear/actualizar trabajo desde un agente.

Docs oficiales: https://linear.app/docs/mcp

## Endpoints

- HTTP (recomendado): `https://mcp.linear.app/mcp`
- SSE: `https://mcp.linear.app/sse`

## Setup rápido

### Cursor

- En Cursor: MCP tools -> buscar "Linear" e instalar.
- Alternativa (deeplink): https://cursor.com/docs/context/mcp/directory

### Claude (desktop)

Editar `~/Library/Application Support/Claude/claude_desktop_config.json` y agregar:

```json
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.linear.app/mcp"]
    }
  }
}
```

Reiniciar Claude Desktop y completar el flujo de autenticación.

### Claude Code

```json
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
```

Luego, dentro de la sesión, ejecutar `/mcp` para autenticar.

### OpenCode

Nota: actualmente este vault ya no habilita Linear en `opencode.json` (ni existe el subagente `linear`). Lo siguiente queda solo como referencia por si se quisiera reactivar.

1. Crear/editar `opencode.json` en el root del proyecto y agregar:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "tools": {
    "linear_*": false
  },
  "mcp": {
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "enabled": true
    }
  }
}
```

Nota: este fragmento corresponde a una configuración anterior donde se deshabilitaba `linear_*` por defecto y se habilitaba solo en un subagente dedicado.

2. Autenticar (abre el navegador):

```bash
opencode mcp auth linear
```

## Troubleshooting

- Si falla la autenticación o aparece "internal server error": borrar cache `rm -rf ~/.mcp-auth` y reintentar.
- Si `npx` falla: actualizar Node a una versión más nueva.

## Limitaciones conocidas (menciones y seguidores)

- Menciones: al crear comentarios vía MCP, escribir `@handle` puede quedarse como texto plano (no enlazado) y no notificar como una mención creada desde la UI.
- Seguidores: por lo anterior, la mención puede no añadir automáticamente a la persona como follower del issue.
- Recomendación: si la mención debe ser "clickable" y quieres asegurar notificación/follow:
  - En la UI de Linear, escribe `@` y selecciona la persona desde el desplegable (eso inserta la mención como entidad).
  - Alternativa: pega el `@handle` igualmente (para contexto), pero asume que puede no enlazar.

## Convenciones (legacy)

Para evitar que tengas que especificar siempre equipo/estado/labels al crear issues, una configuración anterior del subagente `linear` seguía estas reglas:

- Confirmación previa: antes de crear o modificar, muestra un "Borrador de issue" (equipo, estado, asignatario, labels, proyecto, due date) y pide confirmación.
- Estado por defecto: intenta usar `Triage` (o el estado de tipo `triage` si el nombre difiere).
- Autoselección de equipo: infiere el team en función del texto (desarrollo/contenido/creativo/gestión) y, si hay ambigüedad real, pregunta lo mínimo.
- Autolabeling: lista labels del team elegido y asigna solo las que existan y encajen por keywords (no inventa labels).
- Autasignación: si el orquestador proporciona la identidad del requester (nombre/email), asigna por defecto al requester cuando no se indique otra cosa.

Nota: el agente puede hacer un "refresh" de equipos/proyectos/labels al inicio de una creación; si notas que algo cambió en Linear (nuevo equipo/label), basta con pedir de nuevo la creación y el agente lo reconsultará.

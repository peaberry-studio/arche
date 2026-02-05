# Issue 22 MCP Connectors Design

## Objetivo

Habilitar que las instancias de OpenCode arranquen con MCPs configurados a partir de los conectores habilitados del usuario, usando el contrato oficial de OpenCode y sin depender de mounts o archivos manuales dentro del workspace.

## Contexto actual

- Los conectores viven en `connectors` (Prisma) con `config` cifrado, `enabled`, `type` y `name`.
- `startInstance` crea el contenedor vía `createContainer` e inyecta sólo credenciales del servidor y `WORKSPACE_AGENT_PORT`.
- La imagen `infra/workspace-image/Containerfile` deriva de OpenCode e instala únicamente `git`; no hay `nodejs`/`npm`, por lo que `npx` no está disponible.

## Propuesta

Generar la configuración MCP en el backend y pasarla a OpenCode mediante `OPENCODE_CONFIG_CONTENT`, que es el mecanismo oficial para overrides en runtime. Se agrega un módulo dedicado en `apps/web/src/lib/spawner/mcp-config.ts` que lee conectores habilitados del usuario (resolviendo `slug → userId`), descifra `config`, valida requisitos por tipo y construye el objeto `mcp` con entradas por conector. El resultado se serializa a JSON y se inyecta como env al crear el contenedor. Si un conector está inválido o el descifrado falla, se omite sin bloquear el arranque (se loguea de forma genérica, sin secretos). Esta vía evita mounts y permite que el contenedor se mantenga agnóstico de los detalles del workspace. Para MCPs locales se necesita `npx`, por lo que la imagen `arche-workspace` incorporará `nodejs` y `npm` vía `apk add`. Con esto, la instancia puede iniciar servidores MCP locales según los conectores configurados.

## Mapeo de conectores a MCP

- `github` → local: `@modelcontextprotocol/server-github`, env `GITHUB_PERSONAL_ACCESS_TOKEN`.
- `notion` → local: `@suekou/mcp-notion-server`, env `NOTION_API_TOKEN`.
- `slack` → local: `@modelcontextprotocol/server-slack`, env `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, y opcional `SLACK_APP_TOKEN`.
- `linear` → local: `linear-mcp-server`, env `LINEAR_API_KEY` (aceptando que el paquete está deprecado por ahora).
- `custom` → remoto: `url` desde `endpoint`, `headers` desde `config.headers`, `Authorization: Bearer <auth>` si `auth` existe y no sobrescribe headers existentes; `oauth: false` cuando se usa `auth`.

## Flujo de arranque

1. `startInstance(slug, actorUserId)` resuelve el usuario dueño del `slug`.
2. Se arma `OPENCODE_CONFIG_CONTENT` con MCPs a partir de conectores habilitados.
3. `createContainer` recibe el JSON serializado y lo agrega a `Env`.
4. OpenCode arranca y registra los MCPs como herramientas disponibles.

## Trade-offs

- `OPENCODE_CONFIG_CONTENT` evita mounts, pero concentra secretos en env y puede crecer si hay muchos conectores.
- MCPs locales con `npx` simplifican instalación, pero añaden latencia al arranque y requieren `nodejs`/`npm` en la imagen.
- `linear-mcp-server` está deprecado; se acepta deuda técnica temporal para desbloquear el flujo.

## Edge cases

- Usuario sin conectores habilitados → `mcp` vacío, arranque normal.
- Conector con `config` corrupto → se omite y se registra aviso genérico.
- `custom.headers` no es objeto → se ignora; `auth` no pisa `Authorization` existente.
- `slack` sin `teamId` → inválido (se ajusta la validación para exigirlo).

## Pruebas

- Unit tests de mapeo MCP (`apps/web/tests/mcp-config.test.ts`).
- Actualización de tests de validación de conectores (`apps/web/tests/connectors.test.ts`).
- Tests de spawner para asegurar inyección de `OPENCODE_CONFIG_CONTENT` en `createContainer`.
- Test simple de `Containerfile` para garantizar instalación de `nodejs` y `npm`.

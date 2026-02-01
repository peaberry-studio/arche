# Workspace web (visor + chat + sesiones múltiples)

- Asignado a: [[Company/People/Inaki Tajes|Iñaki Tajes]]
- Estado: En progreso

- Issue: https://github.com/peaberry-studio/arche/issues/9

## Objetivo

Construir la web app del workspace de usuario:

- Visor de documentos tipo Obsidian (simplificado): árbol de archivos, navegación y render de Markdown.
- Chat integrado para interactuar con ficheros y agentes.
- Múltiples sesiones en paralelo dentro de un mismo workspace (crear/cambiar/retener historial por sesión).

## Checklist (alto nivel)

- [ ] Definir UX mínima (pantallas, navegación, estados vacíos/error)
- [x] Visor: listado + navegación + render Markdown
- [x] Chat: UI + gestión de sesiones múltiples + persistencia de historial
- [x] Definir contrato API/eventos para chats y sesiones
- [ ] Integración progresiva con infra/edge (#4) en dominio real (routing + forwardAuth)

## Evidencia (implementación actual)

- Workspace UI: `apps/web/src/components/workspace/`
- Estado y API: `apps/web/src/hooks/use-workspace.ts`
- Integración OpenCode: `apps/web/src/actions/opencode.ts`
- Auto-start instancia (Spawner): `apps/web/src/components/workspace/workspace-shell.tsx`

## Pendiente para “cerrar” en entorno real

- Completar infra de subdominios + `forwardAuth` (ver [[Arche/Tasks/Alberto Perdomo - Infra y edge|Infra/edge]]).
- Revisar DX/UX mínima y estados vacíos/error (incluye copia y mensajes accionables).

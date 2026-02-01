# Knowledge Base Architecture

Este documento describe la arquitectura del Knowledge Base (KB) compartido en Arche.

## Objetivo

Proveer una base de conocimiento común a todos los workspaces de usuario que incluye:

- Documentación de producto
- Guías de estilo y brand
- Configuración de agentes (OpenCode)
- Plantillas operativas

## Componentes

### 1. Directorio `kb/`

Contiene el contenido maestro del KB:

```
kb/
├── Company/           # Identidad, voz, glosario, docs de producto
├── Templates/         # Plantillas operativas (PRD, KB entry, etc.)
├── System Prompts/    # Prompts de agentes OpenCode
├── opencode.json      # Configuración de agentes
├── AGENTS.md          # Instrucciones para agentes de código
├── .gitignore         # Excluye me.txt, .obsidian/, etc.
└── README.md          # Documentación del KB
```

### 2. Imagen `arche-workspace`

Imagen Docker derivada de OpenCode que incluye:

- Git (para sync)
- Script de inicialización del workspace

Ubicación: `infra/workspace-image/`

### 3. Script `deploy-kb.sh`

Despliega el KB al host de producción:

```bash
./scripts/deploy-kb.sh /opt/arche/kb
```

El script:
1. Copia el contenido de `kb/` al destino
2. Inicializa un repo Git si no existe
3. Crea un commit con los cambios

### 4. Spawner modificado

El spawner (`apps/web/src/lib/spawner/`) monta el KB en cada container:

```typescript
// docker.ts
const binds = [`${volumeName}:/workspace`]
if (kbHostPath) {
  binds.push(`${kbHostPath}:/kb:ro`)  // readonly
}
```

### 5. Endpoint de sync

`POST /api/instances/[slug]/sync-kb`

Ejecuta en el container:
```bash
git fetch kb
git merge kb/main
```

Respuestas posibles:
- `{ status: 'synced' }` - Merge exitoso
- `{ status: 'conflicts', conflicts: [...] }` - Hay conflictos
- `{ status: 'error', message: '...' }` - Error

### 6. UI de sync

Botón "Sync KB" en el workspace header que:
- Llama al endpoint de sync
- Muestra estado (syncing, synced, conflicts, error)
- Lista archivos en conflicto si los hay

## Flujo de datos

```
┌─────────────────┐
│   Monorepo      │
│   kb/           │ ─── deploy-kb.sh ──▶ /opt/arche/kb (Host)
└─────────────────┘                           │
                                              │ mount :ro
                                              ▼
┌─────────────────────────────────────────────────────────┐
│  Container (workspace usuario)                          │
│  ┌──────────────┐    init     ┌──────────────────────┐ │
│  │  /kb         │ ──────────▶ │  /workspace          │ │
│  │  (readonly)  │   copy      │  (read-write)        │ │
│  └──────────────┘             │  ├── .git/           │ │
│                               │  │   remote: kb=/kb  │ │
│                               │  ├── Company/        │ │
│                               │  └── ...             │ │
│                               └──────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Inicialización del workspace

Al crear un container nuevo (`init-workspace.sh`):

1. Si `/workspace/.git` **no existe**:
   - Copia todo el contenido de `/kb` a `/workspace`
   - Ejecuta `git init`
   - Crea commit inicial
   - Añade remote `kb` apuntando a `/kb`

2. Si `/workspace/.git` **ya existe**:
   - No copia nada (respeta el trabajo del usuario)
   - Añade remote `kb` si no existe

## Sincronización

El usuario puede sincronizar su workspace con el KB central de dos formas:

### Desde la UI

Clic en el botón "Sync KB" en el header del workspace.

### Manualmente (terminal)

```bash
cd /workspace
git fetch kb
git merge kb/main
```

### Resolución de conflictos

Si el merge genera conflictos:

1. La UI muestra la lista de archivos en conflicto
2. El usuario abre cada archivo en el editor
3. Resuelve los conflictos (marcados con `<<<<<<<`, `=======`, `>>>>>>>`)
4. Guarda los archivos
5. Ejecuta `git add <archivo>` y `git commit` (o repite el sync)

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `KB_HOST_PATH` | - | Path al KB en el host (ej: `/opt/arche/kb`) |
| `OPENCODE_IMAGE` | `ghcr.io/anomalyco/opencode:1.1.45` | Imagen de workspace (usar `arche-workspace:latest`) |

## Consideraciones de seguridad

- El KB se monta como **readonly** (`:ro`) en los containers
- Los usuarios no pueden modificar el KB central
- Los cambios locales quedan en el volumen del usuario
- El endpoint de sync requiere autenticación

## Actualización del KB

Para actualizar el KB en producción:

1. Edita los archivos en `kb/`
2. Haz commit y push al monorepo
3. En el servidor, ejecuta `deploy-kb.sh`
4. Los usuarios sincronizan manualmente (botón "Sync KB")

## Troubleshooting

### El workspace no tiene el KB

Verifica que:
- `KB_HOST_PATH` está configurado
- El directorio existe y tiene contenido
- El container se creó después de configurar el KB

### Sync falla con "no_remote"

El workspace no se inicializó con el KB. Opciones:
- Recrear el workspace (eliminar volumen)
- Añadir el remote manualmente: `git remote add kb /kb`

### Conflictos persistentes

Si el usuario quiere descartar sus cambios y aceptar el KB:
```bash
git checkout --theirs <archivo>
git add <archivo>
git commit -m "Accept KB version"
```

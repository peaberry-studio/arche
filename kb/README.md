# Knowledge Base (KB)

Este directorio contiene el Knowledge Base compartido que se inyecta en cada workspace de usuario.

## Contenido

| Directorio/Archivo | Descripción |
|--------------------|-------------|
| `Company/` | Identidad de marca, voz y tono, glosario, documentación de producto |
| `Templates/` | Plantillas operativas (PRD, KB entry, informes, etc.) |
| `System Prompts/` | Prompts de los agentes de OpenCode |
| `opencode.json` | Configuración de agentes |
| `AGENTS.md` | Instrucciones para agentes de código |

## Flujo de despliegue

1. **Deploy inicial**: El script `scripts/deploy-kb.sh` copia este directorio a `/opt/arche/kb` en el VPS host e inicializa un repo Git.

2. **Creación de workspace**: Al crear un container para un usuario, se monta `/opt/arche/kb` como volumen readonly en `/kb`. El script de init copia el contenido al workspace del usuario.

3. **Sincronización**: Los usuarios pueden actualizar su KB local ejecutando:
   ```bash
   git fetch kb
   git merge kb/main
   ```

## Actualización del KB

Para actualizar el KB en producción:

1. Edita los archivos en este directorio
2. Haz commit y push al repo principal
3. Ejecuta `scripts/deploy-kb.sh` en el VPS (o deja que CI/CD lo haga)
4. Los usuarios sincronizan manualmente o mediante el botón "Sync KB" en la UI

## Estructura esperada en el host

```
/opt/arche/
└── kb/
    ├── .git/              # Repo Git para versionado
    ├── Company/
    ├── Templates/
    ├── System Prompts/
    ├── opencode.json
    └── AGENTS.md
```

## Notas

- El KB es de **solo lectura** para los containers (montado como `:ro`)
- Cada usuario tiene una **copia independiente** en su workspace
- Los cambios del usuario no afectan al KB central
- El KB central se actualiza solo mediante deploy

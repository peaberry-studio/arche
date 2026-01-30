# GitHub Issues y Projects (gestión de tareas)

Este vault gestiona el trabajo como tareas en GitHub:

- Cada tarea se crea como un issue.
- Cada issue se añade al GitHub Project del equipo y se gestiona por estados.

## Convenciones

- Tarea nueva: se crea como issue y entra por defecto en `Backlog`.
- Cuando alguien se pone con ella: mover a `To do` o `In progress`.
- Cuando está lista: mover a `Done` (o equivalente) y cerrar el issue si procede.

Nota: los nombres exactos de estados/campos dependen del proyecto (por ejemplo, el campo `Status`). Si cambian en GitHub, el agente los consulta y propone el mapeo.

## Agente de gestión

- Para crear/actualizar tareas, usa el subagente `github-issues`.
- Si pides "crear una tarea" o "abrir un ticket", el orquestador debe derivar al subagente para que la acción quede registrada en GitHub.

## Buenas prácticas (contenido del issue)

- Título: verbo + objeto + contexto (ej. "Arreglar error al iniciar sesión en iOS").
- Cuerpo: contexto breve + criterio de hecho + checklist si aplica.
- Enlace al vault: enlazar la nota relevante (ruta del archivo) cuando haya un documento de soporte/PRD.

## Nota sobre YAML/frontmatter

- En issues de GitHub, evitar pegar frontmatter YAML como cabecera.
- Si hace falta incluirlo por contexto, ponerlo como bloque de código (```yaml) o, mejor, solo enlazar la nota del vault.

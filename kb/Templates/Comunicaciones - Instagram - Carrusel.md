# Comunicaciones - Instagram - Carrusel (plantilla)

Usar esta plantilla para crear notas en `Outputs/Comunicaciones/` cuando el entregable sea un carrusel de Instagram.

## Frontmatter (mínimo y estable)

Pegar este bloque al principio de la nota:

```yaml
---
title: "[título corto]"
canal: Instagram
formato: "Carrusel (9 slides)"
estado: borrador
owner: "{{OWNER_NAME}}"
---
```

Reglas:

- `title`: título corto; idealmente consistente con el H1.
- `canal`: nombre del canal (p. ej. `Instagram`) o `Multi` si se reutiliza en varios.
- `formato`: formato editorial (p. ej. `Carrusel (9 slides)`); mantenerlo literal para poder filtrar.
- `estado` (recomendado): `borrador` | `listo` | `publicado`.
- `owner` (opcional): responsable del entregable.

## Convenciones

- Nombre de archivo: `YYYY-MM-DD - Instagram - <Nombre semantico>.md`.
- No duplicar URLs/CTAs/firma en cada nota si ya están en [[Company/05 - Canales y contacto]]. En la nota, referenciar ese documento.

## Nota sobre GitHub (issues)

- En issues de GitHub, no pegar el frontmatter YAML como cabecera.
- Si hace falta incluirlo por contexto, ponerlo como bloque de código (```yaml) o, mejor, solo enlazar la nota del vault en `Outputs/Comunicaciones/`.

## Estructura recomendada (9 slides)

```markdown
# Carrusel: [título]

Objetivo: [una línea]

## Slide 1

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## Slide 2

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## Slide 3

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## Slide 4

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## Slide 5

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## Slide 6

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## Slide 7

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## Slide 8

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## Slide 9

Copy (título):

Copy (cuerpo):

Visual:

Elemento clave:

## CTA

Pegar un CTA y/o firma desde [[Company/05 - Canales y contacto]].
```

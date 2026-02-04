# Guía de estilo UI

## Principios

- Modo claro como base, con calidez orgánica (marfiles y naranjas suaves).
- Acento mandarina para acciones y highlights; sombras muy sutiles.
- Contenedores con bordes visibles y radios contenidos (no excesivamente redondos).

## Lenguaje

- Toda la interfaz (workspace, dashboard y landing) se mantiene en inglés para consistencia de producto.

## Paleta y tokens

- `--primary`: mandarina (botones y acentos).
- `--accent`: melocotón claro para fondos suaves.
- `--background` / `--card`: marfil cálido.
- Tokens en HSL (`hsl(var(--token))`) para compatibilidad.

Uso recomendado:

- `bg-primary` + `text-primary-foreground` para CTAs principales.
- `bg-primary/15` + `border-primary/30` + `text-primary` para CTAs secundarios.
- `text-primary` para palabras destacadas o micro etiquetas.

## Tipografía

- Titulares: `Fraunces` (`font-[family:var(--font-fraunces)]`).
- Texto base: `Geist Sans` (default global).
- Micro etiquetas: mayúsculas + tracking amplio (`tracking-[0.35em]`).
- UI caps (botones y badges): `font-mono` + mayúsculas + tracking (`tracking-[0.2em]` a `tracking-[0.35em]`).

## Contenedores

- Contenedores principales: `Card` con `rounded-lg`, `border` sutil y `bg-card/70`.
- Bloques comparativos tipo tabla: contenedor `border-dashed` y divisores `divide-dashed`.
- Inputs: `rounded-md`, bordes `border-border/60`, fondos `bg-card/90`.

## Botones

- Primario: `rounded-full`, `bg-primary`, `text-primary-foreground`, tracking alto.
- Secundario: `rounded-full`, `bg-primary/15`, `border-primary/30`, `text-primary`.
- Evitar botones outline grises sin acento cromático.

## Iconografía

- Librería: Phosphor Icons (`@phosphor-icons/react`).
- Peso por defecto: `bold` en controles de UI; `regular` en iconos informativos.
- Tamaño recomendado: `18-20px` en botones e inputs, `24px` en highlights.
- Color: `text-muted-foreground` por defecto, `text-primary` para estados activos.

## Contraste y color

- Texto principal en `text-foreground`; usar `text-primary` para jerarquía.
- Evitar negros puros y sombras duras.

## Motion

- Entrada suave: `animate-in fade-in-0 slide-in-from-bottom-4 duration-700`.
- Stagger leve en grids con `animationDelay` escalonado.

## Referencias en código

- `apps/web/src/app/globals.css` (tokens y paleta).
- `apps/web/src/app/page.tsx` (layout base y ejemplos de componentes).
- `apps/web/src/components/ui/card.tsx` (radio de cards).

# Contratos de dominios, cookies y routing (v0)

Objetivo: documentar el contrato “mínimo” para que edge (Traefik), BFF y UI hablen el mismo idioma.

## Dominios (nomenclatura recomendada)

- `ARCHE_DOMAIN`: host base del producto (ejemplo: `arche.example.com`).
- Host de usuario: `<slug>.<ARCHE_DOMAIN>` (ejemplo: `inaki.arche.example.com`).

Nota: en documentación, evitar mezclar `<domain>` y `ARCHE_DOMAIN` si se refieren al mismo valor.

## DNS requerido

- `ARCHE_DOMAIN` apuntando al VPS.
- Wildcard `*.ARCHE_DOMAIN` apuntando al VPS (requisito para subdominios de usuario).

## Routing (edge)

- `ARCHE_DOMAIN` enruta a la app web (Next.js).
- `<slug>.<ARCHE_DOMAIN>` enruta a la misma app (distinta superficie), pero debe aplicar autorización por sesión.

## Autorización por host (`forwardAuth`)

- El edge debe llamar al BFF para autorizar:
  - Endpoint: `GET /auth/traefik`.
  - Header requerido: `X-Forwarded-Host` con el host original.

## Cookie de sesión (contrato)

- Nombre: `arche_session`.
- Dominio:
  - Preferido: `ARCHE_COOKIE_DOMAIN` (cuando exista).
  - Fallback documentado: `.${ARCHE_DOMAIN}`.
- Propiedades: `HttpOnly`, `SameSite=Lax`, `Secure` en producción.

## Compatibilidad / cambios futuros

- Cualquier cambio del formato de host (por ejemplo, introducir prefijos tipo `u-<slug>`) se considera breaking: requeriría migración de slugs, routing y validación de `forwardAuth`.

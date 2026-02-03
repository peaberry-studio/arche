# Contratos de dominios, cookies y routing (v0)

Objetivo: documentar el contrato “mínimo” para que edge (Traefik), BFF y UI hablen el mismo idioma.

## Dominios (nomenclatura recomendada)

- `ARCHE_DOMAIN`: hostname donde vive la app (ejemplo: `example.com` o `arche.example.com`).

Nota: no existen subdominios por usuario. Si se quiere separar por empresa, se hace a nivel de hostname (por ejemplo, `arche.<empresa>.<dominio-principal>`).

Nota: en documentación, evitar mezclar `<domain>` y `ARCHE_DOMAIN` si se refieren al mismo valor.

## DNS requerido

- `ARCHE_DOMAIN` apuntando al VPS.

## Routing (edge)

- `ARCHE_DOMAIN` enruta a la app web (Next.js).

## Cookie de sesión (contrato)

- Nombre: `arche_session`.
- Dominio:
  - Preferido: `ARCHE_COOKIE_DOMAIN` (cuando exista).
  - Fallback documentado: `.${ARCHE_DOMAIN}`.
- Propiedades: `HttpOnly`, `SameSite=Lax`, `Secure` en producción.

## Compatibilidad / cambios futuros

- Cualquier cambio del contrato de hostname se considera breaking (por ejemplo, introducir subdominios por usuario): requeriría migración de URLs y de cookies.

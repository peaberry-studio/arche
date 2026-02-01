# Arche - Overview

## Qué es

- Arche es un sistema multiusuario que levanta instancias aisladas de OpenCode bajo demanda en un VPS.

## Piezas del sistema (alto nivel)

- App (plataformas): Web (Next.js)
- Backend/API: Next.js (BFF) + Postgres + Prisma + Docker + Traefik
- Pagos/Suscripciones: Por definir
- Analítica/Tracking: Por definir

## Funcionalidades actuales (lista viva)

- Login local y sesiones seguras (cookie httpOnly + sesiones en DB)
- Aislamiento por usuario (subdominio `<slug>.<domain>` + contenedor dedicado)
- Provisionamiento on-demand y lifecycle (start/stop, idle/TTL)

## Documentación (centro de ayuda)

- [[Company/Product/docs/index|Docs - Centro de ayuda (inicio)]]
- [[Company/Product/docs/faqs|FAQs]]
- [[Company/Product/docs/manage-subscription|Gestionar suscripción]]
- [[Company/Product/docs/delete-account|Eliminar cuenta]]
- [[Company/Product/docs/contact|Contacto soporte]]

## Enlaces

- [[Company/Product/01 - Soporte - Indice KB]]
- [[Company/Product/02 - Changelog de la app|Changelog de la app]]
- [[Outputs/Comunicaciones/00 - Comunicaciones - Indice|Comunicaciones (blog/newsletter/Discord)]]
- [[Arche/Architecture|Arquitectura (Arche)]]
- [[Arche/Tasks/00 - Indice|Tareas (Arche)]]

# Docker: versiones y flavors de imágenes

- Asignado a: [[Company/People/Alberto Perdomo|Alberto Perdomo]]
- Estado: Por hacer

- Issue: https://github.com/peaberry-studio/arche/issues/8

## Objetivo

Definir estrategia de imágenes (versionado, pinning y variantes) para runtime/spawner e infra.

## Checklist

- [ ] Inventario de imágenes actuales/propuestas (runtime, edge, auxiliares)
- [ ] Decidir pinning (tags vs digests), cadencia de updates y multi-arch si aplica
- [ ] Definir flavors (dev/prod, slim/alpine/distroless, root vs rootless) según necesidades reales
- [ ] Seguridad: base images, vulnerabilidades y mínimos permisos/capabilities
- [ ] Documentar decisiones y cómo construir/publicar

## Relación

- Alinear con [[Arche/Tasks/Jose Miguel Hernandez - Spawner y runtime|Spawner/runtime]] y [[Arche/Tasks/Alberto Perdomo - Infra y edge|Infra/edge]].

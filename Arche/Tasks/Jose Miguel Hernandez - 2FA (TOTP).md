# 2FA (TOTP)

- Asignado a: [[Company/People/Jose Miguel Hernandez|José Miguel Hernández]]
- Estado: En progreso (PR abierto)

- Issue: https://github.com/peaberry-studio/arche/issues/7
- PR: https://github.com/peaberry-studio/arche/pull/11

## Objetivo

Habilitar 2FA para cuentas con un flujo completo (activar/desactivar/recuperación) y guardado seguro.

## Checklist

- [ ] Decidir método(s) soportado(s) y UX mínima
- [ ] Modelo de datos y almacenamiento seguro (secret/estado)
- [ ] Flujos: enroll/verify, recovery, disable, regeneración de recovery codes
- [ ] Validaciones + rate limiting (si aplica)
- [ ] Tests + documentación de uso

## Notas

- Esto cruza con la capa de sesiones/auth existente.
- Ver contrato de dominios/cookies/routing: [[Arche/KB - Contratos de dominios, cookies y routing|Contratos (v0)]].

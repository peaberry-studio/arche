# Configuración de Cloudflare

Esta guía detalla cómo configurar Cloudflare Zero Trust para Calix.

## Requisitos previos

- Dominio gestionado en Cloudflare
- Cuenta de Cloudflare con Zero Trust (el plan gratuito es suficiente)

## 1. Crear el Tunnel

1. Ve a **Zero Trust → Networks → Tunnels**
2. Clic en **Create a tunnel**
3. Selecciona **Cloudflared**
4. Nombre: `calix` (o el que prefieras)
5. **Guarda el token** que aparece (lo necesitarás para `CLOUDFLARED_TOKEN`)

## 2. Configurar Public Hostnames

En el tunnel recién creado, añade dos hostnames:

### Hostname 1: Panel

| Campo | Valor |
|-------|-------|
| Subdomain | `calix` (o tu subdomain elegido) |
| Domain | `tudominio.com` |
| Service Type | HTTP |
| URL | `localhost:80` |

### Hostname 2: Sesiones (wildcard)

| Campo | Valor |
|-------|-------|
| Subdomain | `*` (wildcard) |
| Domain | `calix.tudominio.com` |
| Service Type | HTTP |
| URL | `localhost:80` |

> **Nota**: El wildcard va en el subdominio del subdominio. Si tu dominio es `calix.example.com`, el wildcard será `*.calix.example.com`.

## 3. Crear Access Applications

Ve a **Zero Trust → Access → Applications**

### App 1: Panel

1. Clic en **Add an application**
2. Tipo: **Self-hosted**
3. Configuración:

| Campo | Valor |
|-------|-------|
| Application name | Calix Panel |
| Session Duration | 24 hours |
| Application domain | `calix.tudominio.com` |

4. Añade una **Policy**:

| Campo | Valor |
|-------|-------|
| Policy name | Allow employees |
| Action | Allow |
| Include: Emails ending in | `@tuempresa.com` |

5. Guarda y **copia el Application Audience (AUD) Tag**

### App 2: Sessions

1. Clic en **Add an application**
2. Tipo: **Self-hosted**
3. Configuración:

| Campo | Valor |
|-------|-------|
| Application name | Calix Sessions |
| Session Duration | 24 hours |
| Application domain | `*.calix.tudominio.com` |

4. Añade la misma **Policy**:

| Campo | Valor |
|-------|-------|
| Policy name | Allow employees |
| Action | Allow |
| Include: Emails ending in | `@tuempresa.com` |

5. Guarda y **copia el Application Audience (AUD) Tag**

## 4. Configurar .env

Ahora tienes todo lo necesario para configurar `.env`:

```bash
# El dominio que configuraste
CALIX_DOMAIN=calix.tudominio.com

# El token del tunnel (paso 1)
CLOUDFLARED_TOKEN=eyJ...

# Los AUDs de las dos apps, separados por coma
CF_ACCESS_AUDS=aud-del-panel,aud-de-sessions
```

## 5. Verificar

Después de ejecutar `./scripts/install.sh`:

1. Accede a `https://calix.tudominio.com`
2. Deberías ver la página de login de Cloudflare Access
3. Autentícate con tu email corporativo
4. Deberías ver el panel de Calix

Si hay problemas:

```bash
# Verificar estado
./scripts/doctor.sh

# Ver logs de cloudflared
docker compose logs cloudflared

# Ver logs del panel
docker compose logs panel-web
```

## Notas de seguridad

- **Owner isolation**: Aunque Access permite a todos los empleados, el panel verifica que cada usuario solo pueda acceder a su propia sesión.
- **JWT validation**: El panel valida la firma del JWT usando las JWKS públicas de Cloudflare, y verifica que el `aud` coincida con los configurados.
- **Sin cookies de sesión**: El panel no mantiene sesiones propias; cada request valida el JWT de Access.

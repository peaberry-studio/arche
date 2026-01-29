# Operaciones

Guía de operaciones diarias para Calix Control Plane.

## Comandos básicos

### Ver estado

```bash
# Health check completo
./scripts/doctor.sh

# Estado de servicios
docker compose ps

# Logs de todos los servicios
docker compose logs -f

# Logs de un servicio específico
docker compose logs -f panel-web
docker compose logs -f traefik
docker compose logs -f cloudflared
```

### Reiniciar servicios

```bash
# Reiniciar todo
docker compose restart

# Reiniciar solo el panel
docker compose restart panel-web panel-worker

# Rebuild y restart (si cambiaste código)
docker compose up -d --build
```

### Parar/arrancar

```bash
# Parar todo
docker compose down

# Arrancar todo
docker compose up -d

# Parar sin eliminar containers
docker compose stop
```

## Gestión de usuarios

### Ver usuarios activos

```bash
# Ver containers de usuario
docker ps --filter "name=opencode-"

# Listar usuarios en la DB
docker compose exec panel-web bin/rails runner "puts User.pluck(:email, :slug)"
```

### Forzar stop de una sesión

```bash
# Encontrar el slug del usuario
docker compose exec panel-web bin/rails runner "puts User.find_by(email: 'user@email.com').slug"

# Parar el container
docker stop opencode-<slug>
docker rm opencode-<slug>
```

## Backup y restore

### Backup manual

```bash
./scripts/backup.sh

# Output: /var/lib/calix/backups/calix-YYYYMMDD-HHMMSS.tar.gz
```

### Backup programado (cron)

```bash
# Editar crontab
crontab -e

# Añadir (backup diario a las 3am)
0 3 * * * /opt/calix/scripts/backup.sh >> /var/log/calix-backup.log 2>&1
```

### Restore

```bash
./scripts/restore.sh /path/to/backup.tar.gz
```

## Limpieza

### Containers parados

```bash
# Ver qué se eliminaría
./scripts/prune.sh --dry-run

# Eliminar
./scripts/prune.sh
```

### Imágenes Docker no usadas

```bash
docker image prune -a
```

### Logs antiguos

```bash
# Truncar logs de containers
docker compose logs --since 24h > /tmp/recent-logs.txt
```

## Monitoreo

### Recursos

```bash
# CPU/memoria de containers
docker stats

# Espacio en disco
df -h /var/lib/calix
du -sh /var/lib/calix/*
du -sh /var/lib/calix/users/*
```

### Traefik dashboard

Si habilitaste `TRAEFIK_API_INSECURE=true`:

```bash
# Acceder desde tu máquina local (vía SSH tunnel)
ssh -L 8080:localhost:8080 user@vps

# Abrir en navegador
open http://localhost:8080
```

## Troubleshooting

### El panel no arranca

```bash
# Ver logs
docker compose logs panel-web

# Verificar variables de entorno
docker compose config

# Entrar al container
docker compose exec panel-web sh
```

### Container de usuario no arranca

```bash
# Ver logs del container
docker logs opencode-<slug>

# Verificar que existe la imagen
docker images | grep calix-opencode

# Rebuild de la imagen
docker build -t calix-opencode:latest -f images/opencode/Dockerfile images/opencode/
```

### Cloudflare no conecta

```bash
# Ver logs de cloudflared
docker compose logs cloudflared

# Verificar token
echo $CLOUDFLARED_TOKEN | head -c 50

# Verificar conectividad
docker compose exec cloudflared cloudflared tunnel info
```

### ForwardAuth falla

```bash
# Test directo (debe dar 401 sin JWT)
curl -I http://localhost/auth/traefik

# Ver logs del panel
docker compose logs panel-web | grep -i auth
```

## Actualización

### Actualizar Calix

```bash
cd /opt/calix

# Backup primero
./scripts/backup.sh

# Pull cambios (si usas git)
git pull

# Rebuild y restart
docker compose up -d --build

# Verificar
./scripts/doctor.sh
```

### Actualizar imágenes base

```bash
# Pull nuevas versiones
docker compose pull

# Rebuild con nuevas bases
docker compose build --pull

# Restart
docker compose up -d
```

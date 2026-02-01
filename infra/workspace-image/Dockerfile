# Imagen derivada de OpenCode con git y script de inicialización
# Uso: docker build -t arche-workspace .

ARG OPENCODE_VERSION=1.1.45
FROM ghcr.io/anomalyco/opencode:${OPENCODE_VERSION}

# Instalar git (necesario para sync de KB)
USER root
RUN apk add --no-cache git

# Script de inicialización del workspace
COPY init-workspace.sh /usr/local/bin/init-workspace.sh
RUN chmod +x /usr/local/bin/init-workspace.sh

# Entrypoint wrapper que inicializa el workspace antes de arrancar OpenCode
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

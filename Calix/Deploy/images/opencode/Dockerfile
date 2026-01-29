# ══════════════════════════════════════════════════════════════════════════════
# CALIX — OpenCode User Instance
# ══════════════════════════════════════════════════════════════════════════════
# Imagen base de OpenCode + herramientas para git local y GitHub CLI.
# Cada usuario tiene su propio contenedor basado en esta imagen.
# ══════════════════════════════════════════════════════════════════════════════

FROM ghcr.io/anomalyco/opencode:latest

# Instalar git y gh para:
# - Versionado local (git commit sin remote)
# - Opcional: push a GitHub cuando el usuario quiera publicar
RUN apk add --no-cache \
    git \
    github-cli \
    ca-certificates

# Entrypoint que configura git identity y workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
CMD ["web", "--hostname", "0.0.0.0", "--port", "4096"]

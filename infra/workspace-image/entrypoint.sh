#!/bin/sh
set -e

# Inicializar workspace con KB si es necesario
if [ -d "/kb" ]; then
  /usr/local/bin/init-workspace.sh
fi

# Ejecutar OpenCode con los argumentos originales
exec opencode "$@"

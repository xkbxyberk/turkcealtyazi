#!/bin/bash
# .command wrapper — macOS Terminal'de çift tıkla veya open komutuyla çalışır
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/start-server.sh"

#!/bin/bash
# TürkçeAltyazı whisper-server durdurma scripti
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/server.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "whisper-server durduruldu (PID: $PID)"
  fi
  rm -f "$PID_FILE"
else
  # PID dosyası yoksa port'tan bul
  PID=$(lsof -ti :8787 -sTCP:LISTEN)
  if [ -n "$PID" ]; then
    kill "$PID"
    echo "whisper-server durduruldu (PID: $PID)"
  fi
fi

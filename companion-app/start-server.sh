#!/bin/bash
# TürkçeAltyazı whisper-server başlatma scripti
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WHISPER_DIR="$SCRIPT_DIR/whisper.cpp"
SERVER="$WHISPER_DIR/build/bin/whisper-server"
MODEL="$WHISPER_DIR/models/ggml-large-v3.bin"
VAD_MODEL="$WHISPER_DIR/models/ggml-silero-v6.2.0.bin"
PORT=8787

# Zaten çalışıyorsa tekrar başlatma
if lsof -i :$PORT -sTCP:LISTEN > /dev/null 2>&1; then
  echo "whisper-server zaten port $PORT'da çalışıyor."
  exit 0
fi

# Arka planda başlat, logları dosyaya yaz
# --dtw large.v3: Cross-attention matrislerinden DTW ile kesin token zamanlamaları
# --no-flash-attn: DTW tam attention matrislerine ihtiyaç duyar, flash attention bunu bozar
nohup "$SERVER" -m "$MODEL" -l tr --port $PORT --convert \
  --beam-size 1 \
  --dtw large.v3 --no-flash-attn \
  --vad --vad-model "$VAD_MODEL" > "$SCRIPT_DIR/server.log" 2>&1 &
echo $! > "$SCRIPT_DIR/server.pid"
echo "whisper-server başlatıldı (PID: $!)"

#!/bin/bash
set -euo pipefail

# Com network_mode: host o bind acontece no ULTIMO passo. Um listener esquecido
# na mesma porta mata o servico no fim e o restart automatico repete tudo em
# laco — por isso a porta e conferida ANTES de subir qualquer coisa.
if (exec 3<>/dev/tcp/127.0.0.1/"${PORT}") 2>/dev/null; then
  echo "FATAL: alguem ja ouve em 127.0.0.1:${PORT}. Listeners:" >&2
  ss -ltnp 2>/dev/null || true
  exit 1
fi

mkdir -p "${DATA_DIR}"

echo "iniciando Xvfb em ${DISPLAY}"
Xvfb "${DISPLAY}" -screen 0 1280x900x24 -nolisten tcp &
for i in $(seq 1 50); do [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break; sleep 0.1; done

if [ "${VNC:-0}" = "1" ]; then
  # Ver a sessao com os proprios olhos (parear QR, entender tela travada).
  # SEMPRE no loopback: com rede de host, 0.0.0.0 exporia a tela na internet.
  echo "x11vnc em 127.0.0.1:5900 (tunele por ssh para ver)"
  x11vnc -display "${DISPLAY}" -localhost -nopw -forever -shared -quiet &
fi

# O gerente sobe uma instancia (Chrome) por canal cadastrado em ${DATA_DIR}/instances.json.
exec node src/manager.mjs

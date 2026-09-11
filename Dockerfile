# Imagem SOMENTE linux/amd64: o Chrome estavel nao tem build para Linux arm64,
# e Chromium de distro vem sem os codecs proprietarios — sem H.264 no
# WebCodecs nao ha video.
FROM --platform=linux/amd64 node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    CHROME_PATH=/usr/bin/google-chrome \
    CHROME_NO_SANDBOX=1 \
    DISPLAY=:99 \
    DATA_DIR=/data \
    INSTANCE_PORT_BASE=18500 \
    HOST=127.0.0.1 \
    PORT=18475

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates wget gnupg dumb-init xvfb x11vnc iproute2 procps \
      fonts-liberation fonts-noto-color-emoji libasound2 libnss3 libatk-bridge2.0-0 \
      libgtk-3-0 libgbm1 libxss1 libxshmfence1 \
 && wget -qO /etc/apt/keyrings/google.asc https://dl.google.com/linux/linux_signing_key.pub \
 && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google.asc] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
COPY docs ./docs
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/entrypoint.sh"]

# Docker

A imagem traz Node 22, Google Chrome estável, Xvfb e o gerente. Só `linux/amd64` — o Chrome não tem build para Linux arm64, e o Chromium das distribuições não tem o codec H.264 de que o vídeo precisa.

## Compose

```yaml
services:
  zapcall:
    image: ghcr.io/usermontalvao/zapcall:latest   # ou: build: .
    network_mode: host          # veja abaixo
    restart: unless-stopped
    shm_size: 1gb               # o Chrome precisa de um /dev/shm grande
    environment:
      HOST: 127.0.0.1
      PORT: 18475
      DATA_DIR: /data
      ZAPCALL_API_KEY: ${ZAPCALL_API_KEY:-}
      INSTANCE_PORT_BASE: 18500
      DEFAULT_COUNTRY_CODE: ${DEFAULT_COUNTRY_CODE:-}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS:-}
      VERBOSE: 1
    volumes:
      - zapcall_data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
volumes:
  zapcall_data:
```

```bash
docker compose up -d
docker compose logs -f zapcall
```

## Por que rede de host

Cada instância é um processo filho escutando na própria porta do loopback (a partir de `INSTANCE_PORT_BASE`), e a página do WhatsApp dentro do Chrome fala com ela em `127.0.0.1`. A rede de host mantém isso simples e deixa um proxy reverso na mesma máquina alcançar `127.0.0.1:18475`. Como as interfaces do host ficam visíveis, **mantenha `HOST=127.0.0.1`**.

Se preferir uma rede bridge, defina `HOST=0.0.0.0`, publique só a `18475` e coloque o container numa rede interna com o seu proxy.

## O volume

`/data` guarda `manager.json` (chave global), `instances.json` (cadastro e tokens) e `instances/<nome>/profile` (as sessões pareadas). Perder o volume significa parear todos os números de novo. Faça backup; nunca compartilhe.

## Proxy reverso (TLS)

Exemplo com Caddy — os upgrades de WebSocket passam automaticamente:

```
zapcall.exemplo.com {
  reverse_proxy 127.0.0.1:18475
}
```

O nginx precisa dos headers de upgrade:

```nginx
location / {
  proxy_pass http://127.0.0.1:18475;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;
}
```

Se possível, deixe o painel de administração atrás de um túnel autenticado ou de uma lista de IPs.

## Vendo a sessão

Defina `VNC=1` para subir o `x11vnc` em `127.0.0.1:5900` (só loopback) e tunele por SSH para ver as janelas do Chrome. Útil para entender uma tela travada; não é necessário para parear (o painel mostra o QR).

## Construindo localmente

```bash
docker build -t zapcall .
docker run --rm --network host --shm-size 1g -v zapcall_data:/data -e ZAPCALL_API_KEY=troque-isto zapcall
```

## Recursos

Planeje ~1 GB de RAM por instância mais 200 MB para o gerente, e um núcleo de CPU a cada duas ou três chamadas simultâneas (H.264 por software no Chrome). A aba **Diagnóstico** do painel mostra o peso real.

# Docker

The image bundles Node 22, Google Chrome stable, Xvfb and the manager. `linux/amd64` only — Chrome has no Linux arm64 build, and distro Chromium lacks the H.264 codec that video needs.

## Compose

```yaml
services:
  zapcall:
    image: ghcr.io/usermontalvao/zapcall:latest   # or: build: .
    container_name: zapcall
    network_mode: host          # see below
    restart: unless-stopped
    shm_size: 1gb               # Chrome needs a large /dev/shm
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

## Why host networking

Each instance is a child process listening on its own loopback port (`INSTANCE_PORT_BASE` upwards), and the WhatsApp page inside Chrome talks to it on `127.0.0.1`. Host networking keeps that simple and lets a reverse proxy on the same machine reach `127.0.0.1:18475`. Because the host's interfaces are visible, **keep `HOST=127.0.0.1`**.

If you prefer a bridge network, set `HOST=0.0.0.0`, publish only `18475`, and put the container on an internal network with your proxy.

## The volume

`/data` holds `manager.json` (global key), `instances.json` (registry and tokens) and `instances/<name>/profile` (the paired sessions). Losing it means pairing every number again. Back it up; never share it.

## Reverse proxy (TLS)

Caddy example — WebSocket upgrades are proxied automatically:

```
zapcall.example.com {
  reverse_proxy 127.0.0.1:18475
}
```

nginx needs the upgrade headers:

```nginx
location / {
  proxy_pass http://127.0.0.1:18475;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;
}
```

Keep the administration panel behind an authenticated tunnel or IP allow-list if possible.

## Seeing the session

Set `VNC=1` to start `x11vnc` on `127.0.0.1:5900` (loopback only) and tunnel it with SSH to watch the Chrome windows. Useful to understand a stuck screen; not needed for pairing (the panel shows the QR).

## Building locally

```bash
docker build -t zapcall .
docker run --rm --network host --shm-size 1g -v zapcall_data:/data -e ZAPCALL_API_KEY=change-me zapcall
```

## Resources

Plan ~1 GB RAM per instance plus 200 MB for the manager, and a CPU core per two or three simultaneous calls (software H.264 in Chrome). The panel's **Diagnostics** tab shows the real footprint.

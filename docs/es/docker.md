# Docker

La imagen incluye Node 22, Google Chrome estable, Xvfb y el gestor. Solo `linux/amd64` — Chrome no tiene build para Linux arm64, y el Chromium de las distribuciones carece del códec H.264 que necesita el video.

## Compose

```yaml
services:
  zapcall:
    image: ghcr.io/usermontalvao/zapcall:latest   # o: build: .
    container_name: zapcall
    network_mode: host          # ver abajo
    restart: unless-stopped
    shm_size: 1gb               # Chrome necesita un /dev/shm grande
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

## Por qué red de host

Cada instancia es un proceso hijo que escucha en su propio puerto del loopback (desde `INSTANCE_PORT_BASE`), y la página de WhatsApp dentro de Chrome habla con él en `127.0.0.1`. La red de host mantiene eso simple y permite que un proxy inverso en la misma máquina alcance `127.0.0.1:18475`. Como las interfaces del host quedan visibles, **mantén `HOST=127.0.0.1`**.

Si prefieres una red bridge, define `HOST=0.0.0.0`, publica solo el `18475` y pon el contenedor en una red interna con tu proxy.

## El volumen

`/data` guarda `manager.json` (clave global), `instances.json` (registro y tokens) e `instances/<nombre>/profile` (las sesiones vinculadas). Perderlo significa vincular todos los números de nuevo. Haz copias; nunca lo compartas.

## Proxy inverso (TLS)

Ejemplo con Caddy — los upgrades de WebSocket se reenvían automáticamente:

```
zapcall.ejemplo.com {
  reverse_proxy 127.0.0.1:18475
}
```

nginx necesita las cabeceras de upgrade:

```nginx
location / {
  proxy_pass http://127.0.0.1:18475;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;
}
```

Si es posible, deja el panel de administración detrás de un túnel autenticado o una lista de IPs.

## Ver la sesión

Define `VNC=1` para arrancar `x11vnc` en `127.0.0.1:5900` (solo loopback) y tunélalo por SSH para ver las ventanas de Chrome. Útil para entender una pantalla atascada; no hace falta para vincular (el panel muestra el QR).

## Construir localmente

```bash
docker build -t zapcall .
docker run --rm --network host --shm-size 1g -v zapcall_data:/data -e ZAPCALL_API_KEY=cambia-esto zapcall
```

## Recursos

Calcula ~1 GB de RAM por instancia más 200 MB para el gestor, y un núcleo de CPU por cada dos o tres llamadas simultáneas (H.264 por software en Chrome). La pestaña **Diagnóstico** del panel muestra el consumo real.

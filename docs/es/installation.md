# Instalación

ZapCall ejecuta el **WhatsApp Web oficial** dentro de un Chrome controlado y expone una API HTTP + WebSocket para llamadas de voz y video y para mensajes. Un proceso — el **gestor** — supervisa cualquier número de **instancias** (un número de WhatsApp vinculado cada una).

## Requisitos

| Requisito | Notas |
|---|---|
| Node.js ≥ 22.12 | `node --version` |
| Google Chrome (estable) | Debe ser **Chrome**, no el Chromium de la distribución: el video necesita el códec propietario H.264 en WebCodecs. |
| Linux amd64 o macOS | La imagen Docker es solo `linux/amd64` (Chrome no tiene build para Linux arm64). |
| ~1 GB de RAM por instancia | Cada Chrome pesa entre 400 y 900 MB. |

## Opción A — Docker (recomendado)

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
cp .env.example .env            # define ZAPCALL_API_KEY (opcional; se genera si queda vacía)
docker compose up -d
docker compose logs -f zapcall   # el gestor indica dónde guardó la clave global
```

El servicio escucha en `http://127.0.0.1:18475` (solo loopback). Ábrelo en el navegador para llegar al panel. Consulta [Docker](#docker) para volúmenes, red de host y proxy inverso.

## Opción B — Local (Node + Chrome)

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
npm install
npm start
```

`npm start` levanta el gestor (`src/manager.mjs`). En el primer arranque, si `ZAPCALL_API_KEY` está vacía, se genera una clave global y se guarda en `data/manager.json` (permiso `0600`). El log muestra solo una versión enmascarada — lee el archivo para obtener la clave completa.

## Primeros pasos

1. Abre `http://127.0.0.1:18475/` y entra con la clave global.
2. Pulsa **Nueva instancia** y dale un nombre (`ventas`, `soporte`…).
3. Pulsa **Vincular** y escanea el QR con el teléfono (*WhatsApp › Dispositivos vinculados › Vincular un dispositivo*).
4. Copia el **token de la instancia** en la pestaña **API** y empieza a integrar — consulta [Autenticación](#authentication) y [API REST](#rest-api).

## Verificando la instalación

```bash
npm run check    # verificación de sintaxis de todos los módulos
npm test         # pruebas unitarias y de integración (la del marcador necesita Chrome; sin él se omite)
npm run probe    # autotest de media en un Chrome real, sin sesión de WhatsApp
```

La pestaña **Diagnóstico** del panel ejecuta el mismo autotest por instancia (proceso, API, latencia, sesión, ganchos de media, puente, adaptador nativo, memoria de Chrome).

## Actualización

```bash
git pull && npm install && npm start          # local
docker compose pull && docker compose up -d   # Docker
```

Las sesiones vinculadas viven en `DATA_DIR` (`data/` en local, el volumen `zapcall_data` en Docker). Conserva ese directorio entre actualizaciones y ninguna instancia tendrá que vincularse de nuevo.

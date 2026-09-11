# Installation

ZapCall runs the **official WhatsApp Web** inside a controlled Chrome and exposes an HTTP + WebSocket API for voice and video calls and for messages. One process — the **manager** — supervises any number of **instances** (one paired WhatsApp number each).

## Requirements

| Requirement | Notes |
|---|---|
| Node.js ≥ 22.12 | `node --version` |
| Google Chrome (stable) | Must be **Chrome**, not a distro Chromium: video needs the proprietary H.264 codec in WebCodecs. |
| Linux amd64 or macOS | The Docker image is `linux/amd64` only (Chrome has no Linux arm64 build). |
| ~1 GB RAM per instance | Each Chrome weighs 400–900 MB. |

## Option A — Docker (recommended)

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
cp .env.example .env            # set ZAPCALL_API_KEY (optional; generated if empty)
docker compose up -d
docker compose logs -f zapcall   # the manager prints where the global key is stored
```

The service listens on `http://127.0.0.1:18475` (loopback only). Open it in a browser to reach the panel. See [Docker](#docker) for volumes, host networking and reverse proxies.

## Option B — Local (Node + Chrome)

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
npm install
npm start
```

`npm start` runs the manager (`src/manager.mjs`). On first boot, if `ZAPCALL_API_KEY` is empty, a global key is generated and stored in `data/manager.json` (file mode `0600`). The log shows only a masked version — read the file to get the full key.

## First steps

1. Open `http://127.0.0.1:18475/` and sign in with the global key.
2. Click **New instance**, give it a name (`sales`, `support`…).
3. Click **Pair** and scan the QR with the phone (*WhatsApp › Linked devices › Link a device*).
4. Copy the **instance token** from the **API** tab and start integrating — see [Authentication](#authentication) and [REST API](#rest-api).

## Verifying the installation

```bash
npm run check    # syntax check of every module
npm test         # unit + integration tests (the dialer test needs Chrome; it is skipped otherwise)
npm run probe    # media self-test in a real Chrome, no WhatsApp session needed
```

The panel's **Diagnostics** tab runs the same self-test per instance (process, API, latency, session, media hooks, bridge, native adapter, Chrome memory).

## Updating

```bash
git pull && npm install && npm start          # local
docker compose pull && docker compose up -d   # Docker
```

Paired sessions live in `DATA_DIR` (`data/` locally, the `zapcall_data` volume in Docker). Keep that directory across updates and no instance needs to be paired again.

# ZapCall

**Voice and video calls over WhatsApp, as an API.**

ZapCall turns a WhatsApp number into a programmable phone line. It runs the official WhatsApp Web inside a controlled Chrome and exposes an HTTP + WebSocket interface to place, answer, reject and end calls — with the raw call audio and video flowing through the same socket, so your system can play it to an agent, record it, transcribe it or forward it — plus messages, contacts and webhooks in the Evolution API format. Many numbers, one service, no WhatsApp Business API contract.

Built for CRMs, help desks and call centres that already talk to customers on WhatsApp and want calls to live in the same place as the conversation: click-to-call from a customer card, incoming calls ringing on the right agent, recordings attached to the ticket.

[![CI](https://github.com/usermontalvao/ZapCall/actions/workflows/ci.yml/badge.svg)](https://github.com/usermontalvao/ZapCall/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.12-339933)](package.json)
[![Docs](https://img.shields.io/badge/docs-PT%20%C2%B7%20EN%20%C2%B7%20ES-0969da)](docs/)

[![Buy us a coffee](https://img.shields.io/badge/%E2%98%95_Buy_us_a_coffee-R%24_50-ffdd00?labelColor=1f2328)](https://mpago.la/1sba1dw)
[![Supporters](https://img.shields.io/badge/supporters-see_the_wall-8250df?labelColor=1f2328)](SUPPORTERS.md)

[Português](README.pt-BR.md) · [Español](README.es.md)

> ☕ **ZapCall is free and independent.** No company behind it, no paid tier. If it replaces a per-minute call contract or saves you a week of reverse-engineering, [buy the team a coffee](#support-the-project) — every cup pays for test numbers and the nightly real-call tests that keep it working after each WhatsApp update. Supporters are listed in [SUPPORTERS.md](SUPPORTERS.md).

> **Status: experimental.** Real voice and video calls work today. Return media depends on private WhatsApp Web interfaces that Meta can change without notice, and automating WhatsApp Web is against its terms of service. Use a number you can afford to lose and read [Limitations](#limitations) before relying on it in production.

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Docker](#docker)
- [API at a glance](#api-at-a-glance)
- [Documentation](#documentation)
- [Security](#security)
- [Screenshots](#screenshots)
- [Development](#development)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Support the project](#support-the-project)
- [Limitations](#limitations)
- [License](#license)

## Overview

| | |
|---|---|
| **Instances** | One paired WhatsApp number per instance, each in its own Chrome process, profile and port. A single manager supervises them all. |
| **Calls** | `POST /call/offer` → `callId` → events (`incoming_call`, `call_active`, `call_ended`…) and media on one WebSocket. One call per instance, enforced with `409 channel_busy`. |
| **Media** | Open format: PCM 16 kHz mono (60 ms frames) and H.264 Annex-B with a 4-byte header. Play it, record it, transcribe it, forward it. |
| **Messages** | `/message/*`, `/chat/*`, `/webhook/*` with Evolution / Baileys payloads — existing integrations reuse their handlers. |
| **Panel** | Built-in administration UI: instances, pairing by QR, live call state, webhooks, logs, diagnostics, self-tests. PT / EN / ES, light / dark. |
| **Docs** | Full manual served by the service itself at `/docs`, in three languages, no external site required. |

## Features

- Voice and video calls, inbound and outbound, with mute and a reference dialer (`/instances/:name/dialer`).
- Multiple instances with independent tokens; a global key for administration.
- Webhooks with retries, WebSocket with reconnection-friendly `hello` handshake.
- Automatic restart of crashed Chrome processes with back-off; orphan cleanup; parent-death watchdog.
- Security by default: loopback bind, constant-time credential checks, brute-force limiter, `Referrer-Policy: no-referrer`, CSP without CDNs, origin allow-list, secrets never printed in full.
- Diagnostics: per-instance self-test, media counters, Chrome footprint, live logs.

## Architecture

```
                 ┌──────────────────────────── ZapCall manager (:18475) ────────────────────────────┐
  your backend   │  panel · docs · /instance/* · /call/* · /message/* · /webhook/* · /instances/:n/ws │
  or browser ───▶│                                                                                    │
                 │   proxy ──▶ instance "sales"   (127.0.0.1:18500) ──▶ Chrome ──▶ WhatsApp Web      │
                 │   proxy ──▶ instance "support" (127.0.0.1:18501) ──▶ Chrome ──▶ WhatsApp Web      │
                 └────────────────────────────────────────────────────────────────────────────────────┘
```

Each instance is `src/app.mjs`: an HTTP/WS server (`src/server.mjs`) plus a Chrome driven by `puppeteer-core` (`src/browser.mjs`). Scripts injected into the WhatsApp Web page (`src/page/`) replace the microphone and camera with virtual devices fed by your media, capture the contact's audio/video, and drive calls through WA-JS. The manager (`src/manager.mjs`) owns the registry, tokens, proxying, webhooks and the one-call-per-instance rule. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Requirements: Node.js ≥ 22.12 and Google Chrome (not a distro Chromium — video needs its H.264 codec).

```bash
git clone https://github.com/usermontalvao/ZapCall && cd ZapCall
npm install
npm start
```

1. Open `http://127.0.0.1:18475/` and sign in with the global key (`ZAPCALL_API_KEY`, or the one generated into `data/manager.json` on first boot — the log shows only a masked version).
2. **New instance** → name it → **Pair** → scan the QR with the phone (*WhatsApp › Linked devices › Link a device*).
3. Open the instance's **API** tab: it shows the instance token and ready-made `curl` commands.

## Docker

```bash
cp .env.example .env      # set ZAPCALL_API_KEY, DEFAULT_COUNTRY_CODE, ALLOWED_ORIGINS as needed
docker compose up -d
docker compose logs -f zapcall
```

The image is `linux/amd64` only and uses host networking with the service bound to `127.0.0.1`. Paired sessions live in the `zapcall_data` volume. See [docs/en/docker.md](docs/en/docker.md) for reverse proxies and TLS.

## API at a glance

```bash
# create an instance (global key) → its token is hash.apikey
curl -X POST http://127.0.0.1:18475/instance/create \
  -H "apikey: GLOBAL_KEY" -H "Content-Type: application/json" \
  -d '{"instanceName":"sales","webhook":"https://example.com/zapcall"}'

# pairing QR (base64 PNG + terminal art)
curl http://127.0.0.1:18475/instance/connect/sales -H "apikey: INSTANCE_TOKEN"

# place a call
curl -X POST http://127.0.0.1:18475/call/offer/sales \
  -H "apikey: INSTANCE_TOKEN" -H "x-client-id: my-backend" -H "Content-Type: application/json" \
  -d '{"number":"15551234567","isVideo":false}'
# → {"callId":"…"}   or   409 {"error":"channel_busy","call":{…}}

# events + media
ws://127.0.0.1:18475/instances/sales/ws?clientId=my-backend&token=INSTANCE_TOKEN
```

| Route family | Purpose |
|---|---|
| `/instance/*` | create, list, connect (QR), state, update, token rotation, restart, logout, delete |
| `/call/*` | offer, accept, reject, hangup, mute, status |
| `/message/*`, `/chat/*` | text, media, audio, stickers, contacts, reactions, presence, profile, history |
| `/webhook/*` | per-instance webhook with delivery log |
| `/instances/:name/ws` | events (JSON) and call media (binary) |
| `/manager/*` | what the panel uses: instances, logs, QR, system, self-tests |

## Documentation

Served by the running service at **`/docs`** (PT / EN / ES, searchable) and kept as Markdown in [`docs/`](docs/): installation, instances, authentication, REST API, WebSocket, events, status, errors, audio calls, video calls, curl and JavaScript examples, CRM integration, security, Docker, environment variables.

## Security

Read [SECURITY.md](SECURITY.md) for the threat model, built-in controls, your responsibilities and how to report a vulnerability. Short version: keep instance tokens in your backend, keep `DATA_DIR` private, terminate TLS in front, and never expose the service beyond the loopback without an authenticated proxy.

## Screenshots

The panel follows the system theme (light / dark) and speaks Portuguese, English and Spanish.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-instances.png" alt="Instances (light)" width="420"><br><sub>Instances — light</sub></td>
    <td align="center"><img src="docs/screenshots/panel-instances-dark.png" alt="Instances (dark)" width="420"><br><sub>Instances — dark</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-pairing.png" alt="Pairing by QR" width="420"><br><sub>Pairing by QR</sub></td>
    <td align="center"><img src="docs/screenshots/panel-cards-dark.png" alt="Card view (dark)" width="420"><br><sub>Card view — dark</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-logs.png" alt="Live logs" width="420"><br><sub>Live logs</sub></td>
    <td align="center"><img src="docs/screenshots/panel-logs-dark.png" alt="Live logs (dark)" width="420"><br><sub>Live logs — dark</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-diagnostics-dark.png" alt="Diagnostics (dark)" width="420"><br><sub>Diagnostics — dark</sub></td>
    <td align="center"><img src="docs/screenshots/docs-dark.png" alt="Built-in documentation (dark)" width="420"><br><sub>Built-in documentation — dark</sub></td>
  </tr>
</table>

## Development

```bash
npm run check   # syntax check of every module
npm test        # unit + integration tests; the dialer end-to-end test needs Chrome and is skipped without it
npm run probe   # media self-test in a real Chrome, no WhatsApp session required
```

Project layout:

```
src/manager.mjs      manager: registry, proxy, webhooks, panel and docs routes
src/app.mjs          one instance: wires server + browser, watches pairing and the parent process
src/server.mjs       instance HTTP/WS API, media routing, call state
src/browser.mjs      Chrome lifecycle and script injection
src/security.mjs     constant-time compare, limiter, headers, origin rules
src/page/            scripts injected into WhatsApp Web + the panel, docs, dialer and pairing pages
docs/                Markdown documentation (pt / en / es) served at /docs
test/                node:test suites (unit, integration, headless-Chrome end-to-end)
```

## Roadmap

Planned, roughly in order. Open an issue to vote or to propose something else.

- [ ] **Built-in recording** — `record: true` on a call writes a WAV (stereo: agent / contact) to `DATA_DIR` and announces it in `call_ended`.
- [ ] **Transcription hooks** — stream call audio to a speech-to-text provider and deliver transcripts as events.
- [ ] **Scoped tokens** — per-agent credentials with permissions (dial, answer, listen, messages) so browsers can connect without the instance token.
- [ ] **Video upgrade mid-call** — turn a voice call into video without hanging up (currently `501`).
- [ ] **Call transfer** between instances and warm transfer between two agents on one call.
- [ ] **OpenAPI specification** and official SDKs (Node.js, Python).
- [ ] **Metrics endpoint** (`/metrics`, Prometheus) — calls, durations, media frame rates, Chrome memory.
- [ ] **Panel users and roles** — several administrators, audit log, read-only viewers.
- [ ] **Message templates and quick replies** in the panel.
- [ ] **More languages** for the panel and the docs (contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-language)).
- [ ] **Helm chart** and an ARM64 image (blocked on a Chrome build with H.264 for Linux arm64).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please run `npm run check && npm test` before opening a PR, keep the panel and the docs in all three languages, and never include tokens, QR codes or session data in reports.

## Support the project

ZapCall is free and will stay free — MIT, no paid tier, no company behind it. What it *does* cost is real: WhatsApp changes its web client every few weeks and each change can silence every call; keeping ZapCall working means test numbers, a server that places real calls every night, and hours reading minified code. A commercial WhatsApp calling API charges per minute; here you pay what you think it is worth, once, and everyone benefits.

**What your coffee buys**

| | Amount | Funds |
|:---:|:---:|---|
| ☕ | [**R$ 50 — a coffee**](https://mpago.la/1sba1dw) | One test number for a month, so pairing and calls are verified on a real phone. |
| ☕☕ | [**R$ 200 — a big coffee**](https://mpago.la/1Lkup75) | A month of the server that runs the nightly real voice and video calls and catches WhatsApp updates before you do. |
| ☕☕☕ | [**R$ 1.000 — a month of coffee**](https://mpago.la/22kZeoS) | A full week of work on the [roadmap](#roadmap) — recording, scoped tokens, transcription hooks — with your name on the release notes. |

Payments go through Mercado Pago (card, Pix or boleto; works from outside Brazil with a card). Every supporter, at any amount, is added to the [wall of supporters](SUPPORTERS.md) — open a pull request adding your name or handle, or say so in the payment note.

**Zero-cost ways to help:** star the repository (it is how other developers find it), report a bug with the instance logs, translate a documentation page, or tell someone who is still paying per call.

## Limitations

- **One call per instance** — a WhatsApp Web rule. Parallelism means more instances (each takes one of the four linked-device slots of a number).
- **The phone also rings** on incoming calls; whoever answers first keeps the call (`accepted_elsewhere` elsewhere).
- **Return media relies on private WhatsApp Web modules.** A WhatsApp update may break it; the symptom is a connected but silent call with `nativeMedia.ready = false` in `/api/diag`.
- **Not a multi-tenant API.** An instance token grants everything on that instance; per-user authorization belongs in your backend.
- **Terms of service.** Automating WhatsApp Web violates Meta's terms; numbers can be banned.

## License

[MIT](LICENSE). ZapCall is not affiliated with, endorsed by, or connected to WhatsApp LLC or Meta Platforms, Inc.

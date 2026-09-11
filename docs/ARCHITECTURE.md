# Architecture

ZapCall is a manager process that supervises N instance processes. Each instance is one WhatsApp Web session running in its own Chrome.

```
                         ┌──────────────────────── manager (src/manager.mjs) ────────────────────────┐
 client / panel ──HTTP──▶│ registry (instances.json) · global key · proxy · webhooks · docs · panel  │
 client ──WebSocket────▶│ /instances/:name/ws  ──── raw relay (JSON + binary) ────┐                 │
                         └──────────────────────────────────────────────────────────┼─────────────────┘
                                                                                    ▼
                    ┌──────────────────────── instance (src/app.mjs, one per number) ────────────────────────┐
                    │ src/server.mjs  HTTP/WS API · call rows · media routing (one upstream source per call) │
                    │ src/browser.mjs Chrome via puppeteer-core · script injection · QR / session watch      │
                    │        │                                                                               │
                    │        ▼  web.whatsapp.com (Page.addScriptToEvaluateOnNewDocument)                     │
                    │   worklets.mjs → inject.js → wa-js → control.js → native-media.js → messaging.js       │
                    │   virtual mic/cam      call control     return media capture     messages (Evolution)   │
                    └────────────────────────────────────────────────────────────────────────────────────────┘
```

## Processes

| Process | File | Responsibilities |
|---|---|---|
| Manager | `src/manager.mjs` | Loads the registry, generates/loads the global key, spawns one child per enabled instance, restarts crashed children with exponential back-off, kills orphaned Chrome processes, proxies HTTP and WebSocket to children (swapping the credential for the child's token), enforces one call per instance (`409 channel_busy`), listens to every child's event socket and delivers webhooks, serves the panel and the documentation. |
| Instance | `src/app.mjs` | Starts the server, launches Chrome, ties the browser actions to the server, watches pairing (prints QR, reloads expired QR), recreates a dead browser, exits if the parent manager disappears. |

Children receive `PORT`, `PROFILE_DIR`, `ZAPCALL_TOKEN`, `ZAPCALL_PARENT_PID` and inherit the rest of the environment.

## Instance server (`src/server.mjs`)

- **HTTP**: `/api/status`, `/api/calls` (list / offer), `/api/calls/:id/(accept|reject|hangup|mute)`, `/api/rpc` (messages), `/api/pairing/qr`, `/api/diag`, debug routes, the dialer and pairing pages, public static files.
- **WebSocket `/ws`** (clients): sends `hello`, then events; receives binary media (upstream) from **one** socket per call — the owner's first socket — and relays the page's binary media (downstream) to the owner's sockets (or everyone when the call has no owner).
- **WebSocket `/page`** (loopback only): the injected page's bridge. Binary frames both ways; JSON commands (`mute`, `ping`).
- **State**: `chamadas` (call rows keyed by `callId`), pruned to the last 100 ended calls / one hour. Call state comes from WhatsApp Web's own `CallStore` (via `control.js`), never inferred from media.

## Browser (`src/browser.mjs`)

Launches Chrome with fake-UI-for-media (no permission prompts), disabled local-network checks (the public page must reach the loopback), and a fixed profile directory (**the profile is the paired session**). Injects, in order and before any Meta script: audio worklets + `inject.js` (as one script), WA-JS, `control.js`, `native-media.js`, `messaging.js`. Exposes `dial/accept/reject/end/rpc/qr/diagnostico` to the server. `fechar()` is bounded: if `browser.close()` hangs, the process is killed.

## Page scripts (`src/page/`)

| File | Role |
|---|---|
| `worklets.mjs` | The two AudioWorklets (jitter-buffered playback, 960-sample capture). Single source, used by the page **and** the dialer. |
| `inject.js` | Pins native timers (WhatsApp replaces `setInterval`), forces the tab "visible", hooks `getUserMedia`/`enumerateDevices`/`RTCPeerConnection`, provides the virtual microphone (fed by upstream PCM) and camera (canvas fed by decoded upstream H.264), encodes return video from the native adapter, and owns the loopback WebSocket bridge. |
| `control.js` | Reads `CallStore` (`activeCall`, `isInConnectedCall`, `pendingOutgoingCall`) and maps WhatsApp states to `ringing/connecting/active/ended` + `endReason`; implements dial/accept/reject/end; resolves LIDs to phone numbers only by exact match. |
| `native-media.js` | Wraps the private audio-playback and video classes of the WhatsApp Web build to capture return voice/video. Fail-open: any error here never interrupts the original playback. Reports `ready/faltando/error`. |
| `messaging.js` | Messages, chats, contacts and presence in Evolution/Baileys shapes. |
| `zc-ui.js` | Shared shell: theme tokens (light/dark/system), navigation, i18n helper, toasts, flashes, code blocks. |
| `manager.html`, `docs.html`, `dialer.html` | Panel, documentation shell (renders `docs/<lang>/*.md`), reference dialer. |

## Media contract

Binary WebSocket frames: `[kind, flags, orientation, 0] + payload`. Audio = PCM 16 kHz mono Int16 LE, exactly 960 samples. Video = H.264 Annex-B, keyframe flag in bit 0 of `flags`, rotation (0–3 × 90°) in byte 2. Detailed in `docs/<lang>/websocket.md`.

## Security (`src/security.mjs`)

Constant-time comparison, per-IP failure limiter, security headers (CSP without CDN, no-referrer, nosniff, frame-ancestors none), origin allow-list, secret masking. Applied by both the manager and the instance server. Policies: global key only in headers; instance token in URL only for WebSocket/dialer/pairing, stripped by the page on load.

## Data directory

```
DATA_DIR/
  manager.json            global key (0600)
  instances.json          registry: name, channel, token, port, profileDir, enabled, webhook
  instances/<name>/profile  Chrome profile = the paired WhatsApp session
```

## Tests

`node:test`. `test/manager.test.mjs` runs the manager without Chrome (`semProcessos`) or with a stub child (`comando`); `test/server.test.mjs` and `test/hardening.test.mjs` hit the instance server directly; `test/security.test.mjs` covers the primitives; `test/native-media.test.mjs` runs the adapter in a VM with fake WhatsApp modules; `test/dialer-e2e.test.mjs` drives the real dialer in headless Chrome with fake devices (skipped without Chrome). `scripts/probe.mjs` is the media self-test in a real Chrome without a WhatsApp session.

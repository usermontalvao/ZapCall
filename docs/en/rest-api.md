# REST API

Base URL: the manager (`http://127.0.0.1:18475` by default). Two families of routes exist and do the same things:

- **Evolution-style** (`/instance/*`, `/call/*`, `/message/*`, `/chat/*`, `/webhook/*`): the names people already know from the Evolution API. Use these.
- **Manager/instance-style** (`/manager/*`, `/instances/:name/api/*`): what the panel uses, with more complete JSON.

All bodies and responses are JSON. Errors are `{ "error": "<code>", "message": "…" }` — see [Errors](#errors). Credentials: [Authentication](#authentication). *Global* below means the global key is required; *token* means the instance token (or the global key) is enough.

## Instances

| Method | Route | Auth | What it does |
|---|---|---|---|
| `POST` | `/instance/create` | global | Body `{ instanceName, channel?, webhook? }`. Returns the instance and `hash.apikey` (its token). |
| `GET` | `/instance/fetchInstances` | global | All instances with live state. |
| `GET` | `/instance/connect/:name` | token | Current QR: `{ code, base64, ansi }`. If already paired: `{ instance: { state: "open", phone } }`. |
| `GET` | `/instance/connectionState/:name` | token | `{ instance: { instanceName, state, phone, busy, call } }` — `state` is `open`, `connecting` or `close`. |
| `POST` | `/instance/update/:name` | global | Any subset of `{ channel, enabled, webhook }`. |
| `POST` | `/instance/token/:name` | global | Rotates the token; the instance restarts. Returns `hash.apikey`. |
| `POST` | `/instance/restart/:name` | token | Restarts the Chrome; the session is kept. |
| `DELETE` | `/instance/logout/:name` | token | Wipes the session; back to QR. |
| `DELETE` | `/instance/delete/:name` | global | Removes from the registry. `?purge=1` wipes the session too. |

## Calls

Send `x-client-id: <id>` on call routes: it marks the **owner** of the call, and return media goes only to WebSocket clients with that `clientId`.

| Method | Route | Body / result |
|---|---|---|
| `POST` | `/call/offer/:name` | `{ number, isVideo? }` → `{ callId }`. `409 channel_busy` if the instance is already on a call; `409 not_paired` without a session. |
| `POST` | `/call/accept/:name` | `{ callId, video? }`. Answer a video invite with `video: true` — upgrading later is often refused by WhatsApp. |
| `POST` | `/call/reject/:name` | `{ callId }` |
| `POST` | `/call/hangup/:name` | `{ callId }` |
| `POST` | `/call/mute/:name` | `{ callId, muted }` — stops sending your voice. |
| `GET` | `/call/status/:name` | `{ calls: [ call row… ] }` — active calls plus the last 100 ended ones (up to one hour). |

`number` accepts digits with country code (`15551234567`) or a JID. Numbers with 10–11 digits get `DEFAULT_COUNTRY_CODE` prepended if it is set; otherwise they are rejected with `400 numero_invalido`.

## Messages

Bodies and answers in the Evolution API format. `number` accepts digits or a JID (`…@s.whatsapp.net`, `…@lid`, `…@g.us`). Every send returns `key` (`remoteJid`, `fromMe`, `id`).

| Route | Body |
|---|---|
| `POST /message/sendText/:name` | `{ number, text, quoted? }` |
| `POST /message/sendMedia/:name` | `{ number, mediatype: "image"\|"video"\|"document", mimetype, caption?, fileName?, media: <base64 or URL> }` |
| `POST /message/sendWhatsAppAudio/:name` | `{ number, audio: <base64 ogg/opus or URL> }` — sent as a voice note |
| `POST /message/sendSticker/:name` | `{ number, sticker: <base64 webp or URL> }` |
| `POST /message/sendContact/:name` | `{ number, contact: [{ fullName, phoneNumber }] }` |
| `POST /message/sendReaction/:name` | `{ key, reaction }` — `""` removes |

## Chats and contacts

| Route | Body → result |
|---|---|
| `POST /chat/whatsappNumbers/:name` | `{ numbers: [] }` → `[{ exists, jid, number }]` |
| `POST /chat/fetchProfilePictureUrl/:name` | `{ number }` → `{ wuid, profilePictureUrl }` |
| `POST /chat/sendPresence/:name` | `{ number, presence: "composing"\|"recording"\|"paused"\|"available", delay? }` |
| `POST /chat/markMessageAsRead/:name` | `{ readMessages: [{ remoteJid, id }] }` |
| `POST /chat/updateBlockStatus/:name` | `{ number, status: "block"\|"unblock" }` |
| `POST /chat/updateMessage/:name` | `{ key, text }` (edit) |
| `POST /chat/deleteMessageForEveryone/:name` | `{ id, remoteJid, fromMe }` |
| `POST /chat/getBase64FromMediaMessage/:name` | `{ message: { key } }` → `{ mediaType, mimetype, fileName, size, base64 }` |
| `POST /chat/findChats/:name` | `{ limit? }` |
| `POST /chat/findContacts/:name` | `{ where: { id } }` or `{ where: { onlyMyContacts: true } }` |
| `POST /chat/findMessages/:name` | `{ where: { key: { remoteJid } }, limit?, comMidia? }` → `{ messages: { total, records } }` |
| `POST /chat/fetchProfile/:name` | own profile `{ wuid, name, picture }` |

Message bodies may reach 64 MB (base64 media); every other route is capped at 64 KB (`413 payload_too_large`).

## Webhooks

| Route | Body |
|---|---|
| `POST /webhook/set/:name` | `{ url, enabled?, events? }` — empty `events` = all |
| `GET /webhook/find/:name` | configuration, possible events and the last 30 deliveries |

Delivery format: [Events › Webhooks](#events).

## Manager routes (panel)

All require the global key.

| Route | What |
|---|---|
| `GET /manager/instances` · `POST /manager/instances` | list / create (`{ name, channel }`) |
| `GET/PATCH/DELETE /manager/instances/:name` | detail with token / update (`channel`, `enabled`, `webhook`) / delete (`?purge=1`) |
| `GET /manager/instances/:name/status` · `/logs` · `/qr` · `/webhook` | live state · last 200 log lines · QR PNG · webhook + deliveries |
| `POST /manager/instances/:name/restart` · `/logout` · `/token` · `/selftest` | restart · unpair · rotate token · self-test |
| `GET /manager/system` · `GET /manager/config` | machine load, memory and per-instance Chrome footprint · effective configuration (key masked) |

## Per-instance routes

`/instances/:name/api/*` is proxied to the instance process with its token. Useful ones: `GET /api/status`, `GET/POST /api/calls`, `POST /api/calls/:id/(accept|reject|hangup|mute)`, `GET /api/pairing/qr`, `GET /api/diag` (full media diagnostics), `POST /api/debug/fake-incoming` (a fake incoming call to exercise a client UI without ringing anyone).

Public, no credential: `/instances/:name/static/worklets.js`, `/instances/:name/static/zc-ui.js`, `/healthz`, `/docs`.

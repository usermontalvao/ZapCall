# API REST

URL base: el gestor (`http://127.0.0.1:18475` por defecto). Hay dos familias de rutas que hacen lo mismo:

- **Estilo Evolution** (`/instance/*`, `/call/*`, `/message/*`, `/chat/*`, `/webhook/*`): los nombres que ya conoce quien integró la Evolution API. Usa estas.
- **Estilo gestor/instancia** (`/manager/*`, `/instances/:nombre/api/*`): lo que usa el panel, con JSON más completo.

Cuerpos y respuestas son JSON. Los errores son `{ "error": "<código>", "message": "…" }` — ver [Errores](#errors). Credenciales: [Autenticación](#authentication). Abajo, *global* significa que hace falta la clave global; *token* significa que basta el token de la instancia (o la clave global).

## Instancias

| Método | Ruta | Auth | Qué hace |
|---|---|---|---|
| `POST` | `/instance/create` | global | Cuerpo `{ instanceName, channel?, webhook? }`. Devuelve la instancia y `hash.apikey` (su token). |
| `GET` | `/instance/fetchInstances` | global | Todas las instancias con estado en vivo. |
| `GET` | `/instance/connect/:nombre` | token | QR actual: `{ code, base64, ansi }`. Si ya está vinculada: `{ instance: { state: "open", phone } }`. |
| `GET` | `/instance/connectionState/:nombre` | token | `{ instance: { instanceName, state, phone, busy, call } }` — `state` es `open`, `connecting` o `close`. |
| `POST` | `/instance/update/:nombre` | global | Cualquier subconjunto de `{ channel, enabled, webhook }`. |
| `POST` | `/instance/token/:nombre` | global | Rota el token; la instancia se reinicia. Devuelve `hash.apikey`. |
| `POST` | `/instance/restart/:nombre` | token | Reinicia el Chrome; la sesión se mantiene. |
| `DELETE` | `/instance/logout/:nombre` | token | Borra la sesión; vuelve al QR. |
| `DELETE` | `/instance/delete/:nombre` | global | Quita del registro. `?purge=1` borra también la sesión. |

## Llamadas

Envía `x-client-id: <id>` en las rutas de llamada: marca al **dueño** de la llamada, y la media de retorno va solo a los clientes WebSocket con ese `clientId`.

| Método | Ruta | Cuerpo / resultado |
|---|---|---|
| `POST` | `/call/offer/:nombre` | `{ number, isVideo? }` → `{ callId }`. `409 channel_busy` si la instancia ya está en llamada; `409 not_paired` sin sesión. |
| `POST` | `/call/accept/:nombre` | `{ callId, video? }`. Contesta una invitación de video con `video: true` — subir a video después suele ser rechazado por WhatsApp. |
| `POST` | `/call/reject/:nombre` | `{ callId }` |
| `POST` | `/call/hangup/:nombre` | `{ callId }` |
| `POST` | `/call/mute/:nombre` | `{ callId, muted }` — deja de enviar tu voz. |
| `GET` | `/call/status/:nombre` | `{ calls: [ call row… ] }` — llamadas activas más las últimas 100 finalizadas (hasta una hora). |

`number` acepta dígitos con código de país (`34612345678`) o un JID. Los números de 10–11 dígitos reciben `DEFAULT_COUNTRY_CODE` delante si está definido; si no, se rechazan con `400 numero_invalido`.

## Mensajes

Cuerpos y respuestas en el formato de la Evolution API. `number` acepta dígitos o un JID (`…@s.whatsapp.net`, `…@lid`, `…@g.us`). Todo envío devuelve `key` (`remoteJid`, `fromMe`, `id`).

| Ruta | Cuerpo |
|---|---|
| `POST /message/sendText/:nombre` | `{ number, text, quoted? }` |
| `POST /message/sendMedia/:nombre` | `{ number, mediatype: "image"\|"video"\|"document", mimetype, caption?, fileName?, media: <base64 o URL> }` |
| `POST /message/sendWhatsAppAudio/:nombre` | `{ number, audio: <base64 ogg/opus o URL> }` — se envía como nota de voz |
| `POST /message/sendSticker/:nombre` | `{ number, sticker: <base64 webp o URL> }` |
| `POST /message/sendContact/:nombre` | `{ number, contact: [{ fullName, phoneNumber }] }` |
| `POST /message/sendReaction/:nombre` | `{ key, reaction }` — `""` la quita |

## Chats y contactos

| Ruta | Cuerpo → resultado |
|---|---|
| `POST /chat/whatsappNumbers/:nombre` | `{ numbers: [] }` → `[{ exists, jid, number }]` |
| `POST /chat/fetchProfilePictureUrl/:nombre` | `{ number }` → `{ wuid, profilePictureUrl }` |
| `POST /chat/sendPresence/:nombre` | `{ number, presence: "composing"\|"recording"\|"paused"\|"available", delay? }` |
| `POST /chat/markMessageAsRead/:nombre` | `{ readMessages: [{ remoteJid, id }] }` |
| `POST /chat/updateBlockStatus/:nombre` | `{ number, status: "block"\|"unblock" }` |
| `POST /chat/updateMessage/:nombre` | `{ key, text }` (editar) |
| `POST /chat/deleteMessageForEveryone/:nombre` | `{ id, remoteJid, fromMe }` |
| `POST /chat/getBase64FromMediaMessage/:nombre` | `{ message: { key } }` → `{ mediaType, mimetype, fileName, size, base64 }` |
| `POST /chat/findChats/:nombre` | `{ limit? }` |
| `POST /chat/findContacts/:nombre` | `{ where: { id } }` o `{ where: { onlyMyContacts: true } }` |
| `POST /chat/findMessages/:nombre` | `{ where: { key: { remoteJid } }, limit?, comMidia? }` → `{ messages: { total, records } }` |
| `POST /chat/fetchProfile/:nombre` | perfil propio `{ wuid, name, picture }` |

Los cuerpos de mensajes pueden llegar a 64 MB (media en base64); el resto de rutas se limita a 64 KB (`413 payload_too_large`).

## Webhooks

| Ruta | Cuerpo |
|---|---|
| `POST /webhook/set/:nombre` | `{ url, enabled?, events? }` — `events` vacío = todos |
| `GET /webhook/find/:nombre` | configuración, eventos posibles y las últimas 30 entregas |

Formato de entrega: [Eventos › Webhooks](#events).

## Rutas del gestor (panel)

Todas requieren la clave global.

| Ruta | Qué |
|---|---|
| `GET /manager/instances` · `POST /manager/instances` | listar / crear (`{ name, channel }`) |
| `GET/PATCH/DELETE /manager/instances/:nombre` | detalle con token / actualizar (`channel`, `enabled`, `webhook`) / eliminar (`?purge=1`) |
| `GET /manager/instances/:nombre/status` · `/logs` · `/qr` · `/webhook` | estado en vivo · últimas 200 líneas de log · PNG del QR · webhook + entregas |
| `POST /manager/instances/:nombre/restart` · `/logout` · `/token` · `/selftest` | reiniciar · desvincular · rotar token · autotest |
| `GET /manager/system` · `GET /manager/config` | carga, memoria y peso del Chrome por instancia · configuración efectiva (clave enmascarada) |

## Rutas por instancia

`/instances/:nombre/api/*` se reenvía al proceso de la instancia con su token. Útiles: `GET /api/status`, `GET/POST /api/calls`, `POST /api/calls/:id/(accept|reject|hangup|mute)`, `GET /api/pairing/qr`, `GET /api/diag` (diagnóstico completo de media), `POST /api/debug/fake-incoming` (una llamada entrante falsa para ejercitar la UI de un cliente sin llamar a nadie).

Públicas, sin credencial: `/instances/:nombre/static/worklets.js`, `/instances/:nombre/static/zc-ui.js`, `/healthz`, `/docs`.

# Eventos

Los eventos llegan por el [WebSocket](#websocket) como JSON y, opcionalmente, como `POST` a un webhook. Los nombres siguen la Evolution API donde existe un equivalente.

## Eventos de llamada

| `type` | Cuándo |
|---|---|
| `incoming_call` | Un contacto está llamando a la instancia. Suena en todos los dispositivos del número, teléfono incluido. |
| `outgoing_call` | `/call/offer` creó una llamada. |
| `call_accepted` | Un cliente ejecutó `/call/accept`. |
| `call_active` | WhatsApp Web informa la llamada como conectada — el momento de arrancar el cronómetro. Nunca se infiere de la media. |
| `call_update` | Cualquier otro cambio de estado (`ringing → connecting`, silencio, flags de video). |
| `call_ended` | La llamada terminó. `endReason` dice por qué. |

Todos llevan un **call row**:

```json
{ "type": "call_active",
  "call": { "callId": "3EB0…", "direction": "outbound", "status": "active",
            "phone": "34612345678", "lid": null, "peer": "34612345678@c.us",
            "isVideo": false, "videoActive": false, "peerVideo": false, "muted": false,
            "owner": "mi-backend", "startedAt": 1789000000000, "acceptedAt": 1789000004000,
            "endedAt": null, "endReason": null, "raw": "ACTIVE" } }
```

| Campo | Significado |
|---|---|
| `status` | `ringing` · `connecting` · `active` · `ended` |
| `direction` | `inbound` · `outbound` |
| `phone` | Dígitos del número del contacto, cuando WhatsApp lo expone. `null` para contactos solo con LID. |
| `lid` | El identificador `@lid` del contacto cuando la cuenta usa LIDs. **Un LID no es un teléfono** — nunca intentes convertirlo. |
| `owner` | `x-client-id` del cliente que ofreció o contestó la llamada. |
| `endReason` | `terminate` · `rejected` · `missed` · `busy` · `accepted_elsewhere` · `connection_lost` · `relay_failed` |
| `raw` | El estado crudo de WhatsApp Web, para diagnóstico. |

Las llamadas finalizadas se conservan una hora (como máximo 100) para que los clientes tardíos aún puedan leerlas.

## Eventos de sesión

| `type` | Cuerpo |
|---|---|
| `status` | `{ status: { connected, jid, phone, pushName, activeCalls } }` — se envía cuando la sesión se vincula o se cae. En los webhooks es `connection.update` con `state: "open" \| "close"`. |

## Eventos de mensaje

| `type` | Cuerpo |
|---|---|
| `messages.upsert` | Mensaje nuevo, recibido o enviado (`data.key.fromMe`). Formato Baileys/Evolution; la media hasta 2 MB viene inline en `data.base64`. |
| `messages.update` | Estado de entrega: `data.status` = `SERVER_ACK` · `DELIVERY_ACK` · `READ` · `PLAYED` · `ERROR`. |
| `messages.delete` | Un mensaje se borró para todos (`data.key`). |
| `presence.update` | Contacto en línea, escribiendo, grabando: `data.presences[jid].lastKnownPresence`. |

```json
{ "type": "messages.upsert",
  "data": { "key": { "remoteJid": "34612345678@s.whatsapp.net", "fromMe": false, "id": "3EB0…" },
            "pushName": "María", "messageType": "conversation",
            "message": { "conversation": "hola" },
            "messageTimestamp": 1789000000, "status": "DELIVERY_ACK", "source": "web" } }
```

## Webhooks

Configura con `POST /webhook/set/:nombre` (`{ url, enabled, events }`; `events` vacío = todos). Cada evento se convierte en un `POST`, con hasta 3 intentos (retroceso de 1 s, 2 s, 3 s, 8 s de tiempo límite cada uno). La media de la llamada nunca va por webhook. Las últimas 30 entregas (estado HTTP o error) se ven en el panel y en `GET /webhook/find/:nombre`.

```json
{ "event": "messages.upsert", "instance": "ventas", "date_time": "2026-01-01T12:00:00.000Z",
  "server_url": "http://127.0.0.1:18475", "data": { "…": "…" } }
```

Las cabeceras `x-zapcall-event` y `x-zapcall-instance` repiten los dos campos para que puedas enrutar antes de leer el cuerpo.

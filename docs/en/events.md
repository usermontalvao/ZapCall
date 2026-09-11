# Events

Events are delivered on the [WebSocket](#websocket) as JSON and, optionally, as `POST`s to a webhook. Names follow the Evolution API where one exists.

## Call events

| `type` | When |
|---|---|
| `incoming_call` | A contact is calling the instance. Ringing on every device linked to the number, phone included. |
| `outgoing_call` | `/call/offer` created a call. |
| `call_accepted` | `/call/accept` was executed by a client. |
| `call_active` | WhatsApp Web reports the call as connected — the moment to start the timer. Never inferred from media. |
| `call_update` | Any other state change (`ringing → connecting`, mute, video flags). |
| `call_ended` | The call ended. `endReason` says why. |

All of them carry a **call row**:

```json
{ "type": "call_active",
  "call": { "callId": "3EB0…", "direction": "outbound", "status": "active",
            "phone": "15551234567", "lid": null, "peer": "15551234567@c.us",
            "isVideo": false, "videoActive": false, "peerVideo": false, "muted": false,
            "owner": "my-backend", "startedAt": 1789000000000, "acceptedAt": 1789000004000,
            "endedAt": null, "endReason": null, "raw": "ACTIVE" } }
```

| Field | Meaning |
|---|---|
| `status` | `ringing` · `connecting` · `active` · `ended` |
| `direction` | `inbound` · `outbound` |
| `phone` | Digits of the contact's number, when WhatsApp exposes it. `null` for LID-only contacts. |
| `lid` | The contact's `@lid` identifier when the account uses LIDs. **A LID is not a phone number** — never try to convert it. |
| `owner` | `x-client-id` of the client that offered or accepted the call. |
| `endReason` | `terminate` · `rejected` · `missed` · `busy` · `accepted_elsewhere` · `connection_lost` · `relay_failed` |
| `raw` | The raw WhatsApp Web state, for diagnostics. |

Ended calls are kept for one hour (at most 100) so late clients can still read them.

## Session events

| `type` | Payload |
|---|---|
| `status` | `{ status: { connected, jid, phone, pushName, activeCalls } }` — sent when the session pairs or drops. In webhooks this is `connection.update` with `state: "open" \| "close"`. |

## Message events

| `type` | Payload |
|---|---|
| `messages.upsert` | New message, received or sent (`data.key.fromMe`). Baileys/Evolution shape; media up to 2 MB comes inline as `data.base64`. |
| `messages.update` | Delivery status: `data.status` = `SERVER_ACK` · `DELIVERY_ACK` · `READ` · `PLAYED` · `ERROR`. |
| `messages.delete` | A message was deleted for everyone (`data.key`). |
| `presence.update` | Contact online, typing, recording: `data.presences[jid].lastKnownPresence`. |

```json
{ "type": "messages.upsert",
  "data": { "key": { "remoteJid": "15551234567@s.whatsapp.net", "fromMe": false, "id": "3EB0…" },
            "pushName": "Maria", "messageType": "conversation",
            "message": { "conversation": "hello" },
            "messageTimestamp": 1789000000, "status": "DELIVERY_ACK", "source": "web" } }
```

## Webhooks

Configure with `POST /webhook/set/:name` (`{ url, enabled, events }`; empty `events` = all). Each event becomes one `POST`, up to 3 attempts (1 s, 2 s, 3 s back-off, 8 s timeout each). Call media never goes through webhooks. The last 30 deliveries (HTTP status or error) are visible in the panel and in `GET /webhook/find/:name`.

```json
{ "event": "messages.upsert", "instance": "sales", "date_time": "2026-01-01T12:00:00.000Z",
  "server_url": "http://127.0.0.1:18475", "data": { "…": "…" } }
```

Headers `x-zapcall-event` and `x-zapcall-instance` repeat the two fields so you can route before parsing the body.

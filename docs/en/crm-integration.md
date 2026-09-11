# CRM integration

ZapCall was built to sit behind a CRM: the CRM owns users, permissions and the conversation history; ZapCall owns the WhatsApp session and the media. This page is the recommended shape of that integration.

## Topology

```
Browser (agent) ──HTTPS/WSS──▶ your backend ──HTTP/WS (loopback or private network)──▶ ZapCall manager ──▶ instances
```

- The **instance token** lives only in your backend. Agents authenticate with your system; your backend decides who may dial from which instance.
- One ZapCall **instance per line/channel** (support, sales, billing…). `channel` is a free label you can map to your own ids.
- Put ZapCall on the loopback or a private network. If it must cross the internet, use a reverse proxy with TLS in front of `127.0.0.1:18475` and keep `HOST=127.0.0.1`.

## Mapping states to your UI

| ZapCall | CRM |
|---|---|
| `connectionState.state = open` | line available |
| `busy = true` / `409 channel_busy` | line in use — show *who* (`call.phone`, `call.direction`) and since when (`call.acceptedAt`) |
| `incoming_call` | ring the agents entitled to that line; the first `accept` wins |
| `call_active` | start the call timer (never on media) |
| `call_ended` + `endReason` | `terminate` = talked; `missed`/`rejected`/`busy` = not answered; `accepted_elsewhere` = answered on the phone |
| `messages.upsert` | append to the conversation; media ≤ 2 MB comes inline as `base64` |

## Recommended flow for an outbound call

1. Backend checks the agent may use the line, then `GET /instance/connectionState/:name`. If `busy`, tell the agent who is on the line.
2. Backend `POST /call/offer/:name` with `x-client-id: <agent session id>`.
3. Backend opens (or already has) a WebSocket with `clientId = <agent session id>` and relays media to the agent's browser (or the browser connects directly through your proxy with a short-lived credential of your own).
4. On `call_ended`, persist `startedAt`, `acceptedAt`, `endedAt`, `endReason` and, if you recorded, the audio.

## Recording and transcription

Media arrives as raw PCM 16 kHz mono in 60 ms frames — trivial to write to a WAV file (16-bit little-endian, 16000 Hz, 1 channel) or to stream to a speech-to-text service. Keep the two directions in separate buffers if you want stereo recordings (agent left, contact right).

## Webhooks vs WebSocket

- **Webhooks** are enough for state and messages: one `POST` per event, retried three times, in the Evolution format your existing handlers may already understand.
- **WebSocket** is required for **media** and gives you the same events with lower latency. Backends typically use both: webhook for durable state, socket for live calls.

## Multi-instance

`GET /instance/fetchInstances` (global key) returns every line with `state`, `busy` and `call`. Poll it every few seconds for a "lines" dashboard, or subscribe to each instance's socket and keep the state in memory.

## Coming from the Evolution API

Route names, bodies and webhook shapes (`messages.upsert`, `connection.update`, `key`, `pushName`, `message.conversation`…) match the Evolution API so existing handlers can be reused by swapping the base URL. What is new: `/call/*`, the binary media on the WebSocket, and `busy`/`call` on `connectionState`.

## Things the CRM must handle

- **One call per instance.** Queue or route to another instance.
- **A LID is not a phone number.** `remoteJidAlt` (messages) and `phone` (calls) are populated when WhatsApp exposes the number; otherwise key your contact by LID.
- **The phone also rings.** Decide what your UI shows when `accepted_elsewhere` arrives.
- **Sessions can drop.** Watch `status` / `connection.update` and surface "line needs pairing" to an administrator.

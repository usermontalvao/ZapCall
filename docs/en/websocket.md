# WebSocket

One socket per client gives you **events** (JSON text frames) and **call media** (binary frames) for an instance.

```
ws://127.0.0.1:18475/instances/:name/ws?clientId=<your id>&token=<instance token>
```

- `clientId` identifies your client. Use one id per browser tab or per backend process — two sockets with the same id sending media into one call is the classic cause of broken video.
- Credentials: `token` in the query string, or `Authorization: Bearer <token>` as a header when the client can send headers (backends, `ws` in Node).
- With `ALLOWED_ORIGINS` set, browsers from other origins are refused with `403`.
- Frame limit: 2 MB.

## Handshake

Right after connecting you receive one `hello`:

```json
{ "type": "hello",
  "status": { "connected": true, "jid": "15551234567@c.us", "pushName": "Sales", "phone": "15551234567", "activeCalls": 0 },
  "calls": [ ] }
```

`calls` lists the calls the instance still remembers, so a client that reconnects mid-call can redraw its UI.

## Text frames (events)

Every text frame is `{ "type": "<event>", … }`. The full list, with payloads, is in [Events](#events). Call events carry `call` (a *call row*); `status` carries `status`; message events carry `data`.

## Binary frames (call media)

Every binary frame is a 4-byte header followed by the payload:

| Byte | Field | Values |
|---|---|---|
| 0 | `kind` | `1` audio · `2` video |
| 1 | `flags` | bit 0 = keyframe (video only) |
| 2 | `orientation` | 0–3 = rotation in clockwise multiples of 90°, to apply when drawing (video only) |
| 3 | reserved | `0` |

- **Audio**: PCM mono, **16 kHz**, Int16 little-endian, frames of **exactly 960 samples** (60 ms, 1920 bytes). Any other size is dropped on both ends.
- **Video**: H.264 **Annex-B** (SPS/PPS inside the keyframe). From the contact you receive up to 1280×720 at ~15 fps; what you send is re-encoded by WhatsApp (the reference dialer sends 720p at 30 fps, ~2 Mbps).

Direction is symmetric: frames you **send** feed the virtual microphone/camera of the WhatsApp Web session; frames you **receive** are the contact's voice and video.

## Ownership and multiple clients

- Return media goes to the sockets whose `clientId` is the call's **owner** (the `x-client-id` used on `/call/offer` or `/call/accept`). A call with no owner (answered on the phone) goes to every socket.
- Upstream media is accepted from **one socket per call**: the first socket of the owner that sends a frame becomes the source until the call ends. Frames from other sockets are counted in `GET /api/diag` (`servidor.descartes.midiaDeOutroSocket`) and ignored.

## Keyframe discipline

- A decoder that was just created (or recreated after an error) must wait for a keyframe and ignore delta frames until then.
- A sender that had to drop a delta frame (queue full) must hold the following deltas until the next keyframe, and should request one from its encoder.

## Reconnection

Sockets are cheap: reconnect with back-off, read `hello.calls`, and resume. Ended calls stay listed for up to an hour so a late client can still show what happened.

## Node example

```js
import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:18475/instances/sales/ws?clientId=my-backend', { headers: { authorization: 'Bearer INSTANCE_TOKEN' } });
ws.binaryType = 'arraybuffer';
ws.on('message', (data, isBinary) => {
  if (isBinary) { const kind = Buffer.from(data)[0]; return; }      // 1 audio, 2 video
  const ev = JSON.parse(data.toString());
  if (ev.type === 'call_active') console.log('answered', ev.call.callId);
});
```

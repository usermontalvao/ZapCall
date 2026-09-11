# Audio calls

## How voice flows

```
your client ──PCM 16 kHz──▶ manager ──▶ instance ──▶ WhatsApp Web page (virtual microphone) ──▶ WhatsApp
your client ◀──PCM 16 kHz── manager ◀── instance ◀── WhatsApp Web page (return-audio adapter) ◀── WhatsApp
```

Inside the WhatsApp Web page, ZapCall replaces `getUserMedia` with a virtual microphone fed by the frames you send, and captures the contact's voice from the page's audio playback path. Both sides use the same 16 kHz / 960-sample framing described in [WebSocket](#websocket).

## Making a call

```bash
curl -X POST http://127.0.0.1:18475/call/offer/sales \
  -H "apikey: INSTANCE_TOKEN" -H "x-client-id: agent-42" -H "Content-Type: application/json" \
  -d '{"number":"15551234567","isVideo":false}'
# → {"callId":"3EB0…"}
```

Then, on a WebSocket opened with `clientId=agent-42`:

1. Wait for `call_active` (the contact answered). Do not start a timer on `outgoing_call`.
2. Start sending audio frames (kind `1`) and playing the ones you receive.
3. `POST /call/hangup/:name` with the `callId` to end; `call_ended` confirms.

Send audio frames as soon as the call is `active`; frames sent while ringing are accepted but nobody hears them.

## Receiving a call

`incoming_call` arrives with `direction: "inbound"`. Answer with `POST /call/accept/:name` `{ "callId" }` using the same `x-client-id` as your socket, so the media is routed to you. Or reject with `/call/reject/:name`.

The call also rings on the phone: if someone answers there first you receive `call_ended` with `endReason: "accepted_elsewhere"`.

## Mute

`POST /call/mute/:name` `{ "callId", "muted": true }` stops the page from forwarding your frames (you may keep sending; they are dropped). `muted: false` resumes. The call row reflects it in `muted`.

## Audio quality notes

- Frames are 60 ms: keep your sender steady (one frame every 60 ms). The receiver has a jitter buffer that targets 120 ms and shrinks above 240 ms.
- The upstream queue is short on purpose: if the socket buffers more than ~6 audio frames, new frames are dropped rather than delayed. A late frame is worth less than a lost one.
- Enable echo cancellation on the capture side (`echoCancellation: true` in `getUserMedia`); the reference dialer does.
- Peak level (`estado.pico` in the dialer, `remoto.pico` in `/api/diag`) above ~300 means voice; ~0 means silence or a broken path.

## The reference dialer

`/instances/:name/dialer?token=INSTANCE_TOKEN` is a complete voice/video client in one HTML file (`src/page/dialer.html`): WebAudio worklets for capture and playback, WebCodecs for video, no dependencies. It talks to the exact same API your integration will use, which makes it the test bench: what works there works in your client.

Open it from the panel (*Dialer* on a paired instance). The token is moved out of the URL as soon as the page loads.

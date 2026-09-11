# Video calls

Video rides on the same WebSocket as audio, as binary frames with `kind = 2`.

## Offering and answering with video

```bash
curl -X POST http://127.0.0.1:18475/call/offer/sales \
  -H "apikey: INSTANCE_TOKEN" -H "x-client-id: agent-42" -H "Content-Type: application/json" \
  -d '{"number":"15551234567","isVideo":true}'
```

Answering an incoming **video** invite: `POST /call/accept/:name` `{ "callId", "video": true }`. Accept it *with* video from the start — upgrading a voice call to video afterwards is usually refused by WhatsApp (`501 video_upgrade_nao_implementado` on our side).

A voice call that the **contact** turns into video still works: the first video frame arrives with `kind = 2` and your client should create its decoder on demand (the reference dialer does).

## Sending video

- Codec: H.264 Baseline, **Annex-B** byte stream, SPS/PPS inside every keyframe.
- Pick the H.264 *level* for the resolution: `avc1.42E01E` (3.0) only covers up to 720×576; use `avc1.42E01F` (3.1) for 720p and `avc1.42E028` (4.0) for 1080p. A wrong level makes `VideoEncoder.configure` throw and you send nothing.
- The reference dialer defaults to the `realtime` profile: 640×360 @ 24 fps, 650 kbps, a keyframe every 1 s and `latencyMode: 'realtime'`. `balanced` and `hd` are explicit environment options.
- Keep encoder and decoder queues at no more than 2 frames. After dropping any frame, force the next one to be a keyframe; a `media-control` request does this immediately.

The WhatsApp Web page decodes your stream, paces only the newest frame into a virtual camera capped by the selected profile, and WhatsApp re-encodes it for the contact. The cap prevents a VPS from doing two simultaneous 720p/30 transcodes.

## Receiving video

- Frames arrive as H.264 Annex-B, up to 1280×720 at ~15 fps.
- Byte 2 of the header is the **orientation** (0–3 × 90° clockwise): the phone rotates without changing the frame size, so apply the rotation when drawing, from the most recent frame's header.
- After creating (or recreating) your decoder, wait for a keyframe (`flags & 1`) and ignore deltas until then. A fatal `VideoDecoder` error closes it for good: create a new one.

## Diagnostics

| Symptom | Where to look |
|---|---|
| Contact sees black | `GET /api/diag` → `cam.quadros` should grow; `cam.erros` and `cam.descartadosSemKeyframe` should not. |
| Contact sees stuttering video | Check `cam.fps`, `cam.descartadosDecoder`, `servidor.descartes.videoPorFila` and `videoSemKeyframe`. ZapCall drops the past instead of accumulating delay. |
| CPU stays high after the call | `cam.ativa` must return to `false`; streams, decoder, frame and timer are closed at the end. |
| You see nothing | `remoto.video` true and `remoto.quadrosCodificados` growing means frames leave the page; check your decoder/keyframe handling. |
| Sideways video | Apply byte 2 of the header when drawing. |

## Bandwidth

With `realtime`, budget roughly 650 kbps up for your camera and 0.5–1.5 Mbps down for the contact, plus ~256 kbps of PCM audio each way between client and manager. `hd` uses up to 1.8 Mbps upstream.

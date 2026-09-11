# JavaScript examples

## Node.js backend: events, auto-reply and a call

```js
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:18475', NAME = 'sales', TOKEN = process.env.ZAPCALL_INSTANCE_TOKEN;
const H = { 'Content-Type': 'application/json', apikey: TOKEN, 'x-client-id': 'my-backend' };
const post = (route, body) => fetch(`${BASE}${route}/${NAME}`, { method: 'POST', headers: H, body: JSON.stringify(body) }).then(r => r.json());

function connect() {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/instances/${NAME}/ws?clientId=my-backend`, { headers: { authorization: 'Bearer ' + TOKEN } });
  ws.binaryType = 'arraybuffer';
  ws.on('message', async (data, isBinary) => {
    if (isBinary) return;                               // call media — see below
    const ev = JSON.parse(data.toString());
    if (ev.type === 'messages.upsert' && !ev.data.key.fromMe) {
      const text = ev.data.message.conversation || ev.data.message.extendedTextMessage?.text || '';
      if (/call me/i.test(text)) {
        await post('/message/sendText', { number: ev.data.key.remoteJid, text: 'Calling you now!' });
        const r = await post('/call/offer', { number: ev.data.key.remoteJidAlt || ev.data.key.remoteJid });
        if (r.error === 'channel_busy') console.log('line busy until', r.call.callId, 'ends');
      }
    }
    if (ev.call) console.log(ev.type, ev.call.status, ev.call.endReason ?? '');
  });
  ws.on('close', () => setTimeout(connect, 1500));       // reconnect with back-off
  ws.on('error', () => {});
}
connect();
```

## Browser: play the contact's voice

The playback worklet is served ready-made at `/instances/<name>/static/worklets.js` (it defines `window.__ZC_WORKLETS.reproducao` and `.captura`). No `eval`: load it with a `<script>` tag or parse the JSON.

```html
<script src="/instances/sales/static/worklets.js"></script>
<script type="module">
const ctx = new AudioContext({ sampleRate: 16000 });
const url = URL.createObjectURL(new Blob([window.__ZC_WORKLETS.reproducao], { type: 'application/javascript' }));
await ctx.audioWorklet.addModule(url);
const out = new AudioWorkletNode(ctx, 'jw-reproducao', { numberOfInputs: 0, outputChannelCount: [1] });
out.connect(ctx.destination);

const ws = new WebSocket('ws://127.0.0.1:18475/instances/sales/ws?clientId=' + crypto.randomUUID() + '&token=' + TOKEN);
ws.binaryType = 'arraybuffer';
ws.onmessage = (ev) => {
  if (typeof ev.data === 'string') return;                       // JSON event
  const v = new Uint8Array(ev.data);
  if (v[0] === 1 && ev.data.byteLength === 4 + 1920) out.port.postMessage(new Int16Array(ev.data, 4));
};
</script>
```

## Browser: send the microphone

```js
const HEADER = 4, KIND_AUDIO = 1;
const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
const inCtx = new AudioContext({ sampleRate: 16000 });
await inCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([window.__ZC_WORKLETS.captura], { type: 'application/javascript' })));
const capture = new AudioWorkletNode(inCtx, 'jw-captura', { numberOfOutputs: 0 });
capture.port.onmessage = (e) => {                                 // e.data: Int16Array(960)
  if (ws.readyState !== 1 || ws.bufferedAmount > 6 * (HEADER + 1920)) return;   // short queue on purpose
  const buf = new Uint8Array(HEADER + e.data.byteLength);
  buf[0] = KIND_AUDIO;
  buf.set(new Uint8Array(e.data.buffer), HEADER);
  ws.send(buf);
};
inCtx.createMediaStreamSource(mic).connect(capture);
```

## Browser: send the camera (H.264 with WebCodecs)

```js
const KIND_VIDEO = 2, FLAG_KEY = 1;
const codec = (w, h) => { const mb = Math.ceil(w / 16) * Math.ceil(h / 16); return 'avc1.42E0' + (mb <= 1620 ? '1E' : mb <= 3600 ? '1F' : '28'); };
const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
const track = cam.getVideoTracks()[0], { width, height, frameRate } = track.getSettings();
let forceKey = true, n = 0;
const enc = new VideoEncoder({
  output: (chunk) => {
    const body = new Uint8Array(chunk.byteLength); chunk.copyTo(body);
    const buf = new Uint8Array(4 + body.length); buf[0] = KIND_VIDEO; buf[1] = chunk.type === 'key' ? FLAG_KEY : 0; buf.set(body, 4);
    if (ws.bufferedAmount > 512 * 1024) { if (chunk.type !== 'key') forceKey = true; return; }
    ws.send(buf);
  },
  error: console.error,
});
enc.configure({ codec: codec(width, height), width, height, bitrate: 2_000_000, framerate: frameRate, latencyMode: 'realtime', avc: { format: 'annexb' } });
const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
for (;;) {
  const { done, value } = await reader.read(); if (done) break;
  try {
    if (enc.encodeQueueSize >= 3) { forceKey = true; continue; }
    enc.encode(value, { keyFrame: forceKey || n % (frameRate * 2) === 0 }); n++; forceKey = false;
  } finally { value.close(); }
}
```

## Browser: draw the contact's video

```js
let dec = null, waitKey = true, rotation = 0;
const canvas = document.querySelector('canvas'), g = canvas.getContext('2d');
function newDecoder() {
  dec = new VideoDecoder({ output: (f) => { draw(f); f.close(); }, error: () => newDecoder() });
  dec.configure({ codec: 'avc1.42E01E', optimizeForLatency: true });   // Annex-B: no description needed
  waitKey = true;
}
function draw(f) {
  const w = f.displayWidth, h = f.displayHeight, side = rotation % 2 === 1;
  canvas.width = side ? h : w; canvas.height = side ? w : h;
  g.save(); g.translate(canvas.width / 2, canvas.height / 2); g.rotate(rotation * Math.PI / 2); g.drawImage(f, -w / 2, -h / 2); g.restore();
}
ws.addEventListener('message', (ev) => {
  if (typeof ev.data === 'string') return;
  const v = new Uint8Array(ev.data);
  if (v[0] !== 2) return;
  if (!dec) newDecoder();
  const key = (v[1] & 1) !== 0;
  if (waitKey && !key) return; waitKey = false;
  rotation = v[2] & 3;
  dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: performance.now() * 1000, data: new Uint8Array(ev.data, 4) }));
});
```

The complete, working version of all four snippets is `src/page/dialer.html`.

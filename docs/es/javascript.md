# Ejemplos en JavaScript

## Backend Node.js: eventos, respuesta automática y una llamada

```js
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:18475', NOMBRE = 'ventas', TOKEN = process.env.ZAPCALL_INSTANCE_TOKEN;
const H = { 'Content-Type': 'application/json', apikey: TOKEN, 'x-client-id': 'mi-backend' };
const post = (ruta, cuerpo) => fetch(`${BASE}${ruta}/${NOMBRE}`, { method: 'POST', headers: H, body: JSON.stringify(cuerpo) }).then(r => r.json());

function conectar() {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/instances/${NOMBRE}/ws?clientId=mi-backend`, { headers: { authorization: 'Bearer ' + TOKEN } });
  ws.binaryType = 'arraybuffer';
  ws.on('message', async (datos, binario) => {
    if (binario) return;                                // media de la llamada — ver abajo
    const ev = JSON.parse(datos.toString());
    if (ev.type === 'messages.upsert' && !ev.data.key.fromMe) {
      const texto = ev.data.message.conversation || ev.data.message.extendedTextMessage?.text || '';
      if (/llámame/i.test(texto)) {
        await post('/message/sendText', { number: ev.data.key.remoteJid, text: '¡Te llamo ahora!' });
        const r = await post('/call/offer', { number: ev.data.key.remoteJidAlt || ev.data.key.remoteJid });
        if (r.error === 'channel_busy') console.log('línea ocupada hasta que termine', r.call.callId);
      }
    }
    if (ev.call) console.log(ev.type, ev.call.status, ev.call.endReason ?? '');
  });
  ws.on('close', () => setTimeout(conectar, 1500));      // reconecta con retroceso
  ws.on('error', () => {});
}
conectar();
```

## Navegador: reproducir la voz del contacto

El worklet de reproducción se sirve listo en `/instances/<nombre>/static/worklets.js` (define `window.__ZC_WORKLETS.reproducao` y `.captura`). Sin `eval`: cárgalo con una etiqueta `<script>` o lee el JSON.

```html
<script src="/instances/ventas/static/worklets.js"></script>
<script type="module">
const ctx = new AudioContext({ sampleRate: 16000 });
const url = URL.createObjectURL(new Blob([window.__ZC_WORKLETS.reproducao], { type: 'application/javascript' }));
await ctx.audioWorklet.addModule(url);
const salida = new AudioWorkletNode(ctx, 'jw-reproducao', { numberOfInputs: 0, outputChannelCount: [1] });
salida.connect(ctx.destination);

const ws = new WebSocket('ws://127.0.0.1:18475/instances/ventas/ws?clientId=' + crypto.randomUUID() + '&token=' + TOKEN);
ws.binaryType = 'arraybuffer';
ws.onmessage = (ev) => {
  if (typeof ev.data === 'string') return;                       // evento JSON
  const v = new Uint8Array(ev.data);
  if (v[0] === 1 && ev.data.byteLength === 4 + 1920) salida.port.postMessage(new Int16Array(ev.data, 4));
};
</script>
```

## Navegador: enviar el micrófono

```js
const HEADER = 4, KIND_AUDIO = 1;
const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
const ctxEntrada = new AudioContext({ sampleRate: 16000 });
await ctxEntrada.audioWorklet.addModule(URL.createObjectURL(new Blob([window.__ZC_WORKLETS.captura], { type: 'application/javascript' })));
const captura = new AudioWorkletNode(ctxEntrada, 'jw-captura', { numberOfOutputs: 0 });
captura.port.onmessage = (e) => {                                 // e.data: Int16Array(960)
  if (ws.readyState !== 1 || ws.bufferedAmount > 6 * (HEADER + 1920)) return;   // cola corta a propósito
  const buf = new Uint8Array(HEADER + e.data.byteLength);
  buf[0] = KIND_AUDIO;
  buf.set(new Uint8Array(e.data.buffer), HEADER);
  ws.send(buf);
};
ctxEntrada.createMediaStreamSource(mic).connect(captura);
```

## Navegador: enviar la cámara (H.264 con WebCodecs)

```js
const KIND_VIDEO = 2, FLAG_KEY = 1;
const codec = (w, h) => { const mb = Math.ceil(w / 16) * Math.ceil(h / 16); return 'avc1.42E0' + (mb <= 1620 ? '1E' : mb <= 3600 ? '1F' : '28'); };
const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
const track = cam.getVideoTracks()[0], { width, height, frameRate } = track.getSettings();
let forzarKey = true, n = 0;
const enc = new VideoEncoder({
  output: (trozo) => {
    const cuerpo = new Uint8Array(trozo.byteLength); trozo.copyTo(cuerpo);
    const buf = new Uint8Array(4 + cuerpo.length); buf[0] = KIND_VIDEO; buf[1] = trozo.type === 'key' ? FLAG_KEY : 0; buf.set(cuerpo, 4);
    if (ws.bufferedAmount > 512 * 1024) { if (trozo.type !== 'key') forzarKey = true; return; }
    ws.send(buf);
  },
  error: console.error,
});
enc.configure({ codec: codec(width, height), width, height, bitrate: 2_000_000, framerate: frameRate, latencyMode: 'realtime', avc: { format: 'annexb' } });
const lector = new MediaStreamTrackProcessor({ track }).readable.getReader();
for (;;) {
  const { done, value } = await lector.read(); if (done) break;
  try {
    if (enc.encodeQueueSize >= 3) { forzarKey = true; continue; }
    enc.encode(value, { keyFrame: forzarKey || n % (frameRate * 2) === 0 }); n++; forzarKey = false;
  } finally { value.close(); }
}
```

## Navegador: dibujar el video del contacto

```js
let dec = null, esperaKey = true, rotacion = 0;
const canvas = document.querySelector('canvas'), g = canvas.getContext('2d');
function nuevoDecoder() {
  dec = new VideoDecoder({ output: (f) => { dibujar(f); f.close(); }, error: () => nuevoDecoder() });
  dec.configure({ codec: 'avc1.42E01E', optimizeForLatency: true });   // Annex-B: sin description
  esperaKey = true;
}
function dibujar(f) {
  const w = f.displayWidth, h = f.displayHeight, lado = rotacion % 2 === 1;
  canvas.width = lado ? h : w; canvas.height = lado ? w : h;
  g.save(); g.translate(canvas.width / 2, canvas.height / 2); g.rotate(rotacion * Math.PI / 2); g.drawImage(f, -w / 2, -h / 2); g.restore();
}
ws.addEventListener('message', (ev) => {
  if (typeof ev.data === 'string') return;
  const v = new Uint8Array(ev.data);
  if (v[0] !== 2) return;
  if (!dec) nuevoDecoder();
  const key = (v[1] & 1) !== 0;
  if (esperaKey && !key) return; esperaKey = false;
  rotacion = v[2] & 3;
  dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: performance.now() * 1000, data: new Uint8Array(ev.data, 4) }));
});
```

La versión completa y funcional de los cuatro fragmentos es `src/page/dialer.html`.

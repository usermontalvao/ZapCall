# Exemplos em JavaScript

## Backend Node.js: eventos, resposta automática e uma chamada

```js
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:18475', NOME = 'vendas', TOKEN = process.env.ZAPCALL_INSTANCE_TOKEN;
const H = { 'Content-Type': 'application/json', apikey: TOKEN, 'x-client-id': 'meu-backend' };
const post = (rota, corpo) => fetch(`${BASE}${rota}/${NOME}`, { method: 'POST', headers: H, body: JSON.stringify(corpo) }).then(r => r.json());

function conectar() {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/instances/${NOME}/ws?clientId=meu-backend`, { headers: { authorization: 'Bearer ' + TOKEN } });
  ws.binaryType = 'arraybuffer';
  ws.on('message', async (dados, binario) => {
    if (binario) return;                                // mídia da chamada — ver abaixo
    const ev = JSON.parse(dados.toString());
    if (ev.type === 'messages.upsert' && !ev.data.key.fromMe) {
      const texto = ev.data.message.conversation || ev.data.message.extendedTextMessage?.text || '';
      if (/me liga/i.test(texto)) {
        await post('/message/sendText', { number: ev.data.key.remoteJid, text: 'Ligando agora!' });
        const r = await post('/call/offer', { number: ev.data.key.remoteJidAlt || ev.data.key.remoteJid });
        if (r.error === 'channel_busy') console.log('linha ocupada até', r.call.callId, 'terminar');
      }
    }
    if (ev.call) console.log(ev.type, ev.call.status, ev.call.endReason ?? '');
  });
  ws.on('close', () => setTimeout(conectar, 1500));      // reconecta com recuo
  ws.on('error', () => {});
}
conectar();
```

## Navegador: tocar a voz do contato

O worklet de reprodução é servido pronto em `/instances/<nome>/static/worklets.js` (define `window.__ZC_WORKLETS.reproducao` e `.captura`). Sem `eval`: carregue com uma tag `<script>` ou leia o JSON.

```html
<script src="/instances/vendas/static/worklets.js"></script>
<script type="module">
const ctx = new AudioContext({ sampleRate: 16000 });
const url = URL.createObjectURL(new Blob([window.__ZC_WORKLETS.reproducao], { type: 'application/javascript' }));
await ctx.audioWorklet.addModule(url);
const saida = new AudioWorkletNode(ctx, 'jw-reproducao', { numberOfInputs: 0, outputChannelCount: [1] });
saida.connect(ctx.destination);

const ws = new WebSocket('ws://127.0.0.1:18475/instances/vendas/ws?clientId=' + crypto.randomUUID() + '&token=' + TOKEN);
ws.binaryType = 'arraybuffer';
ws.onmessage = (ev) => {
  if (typeof ev.data === 'string') return;                       // evento JSON
  const v = new Uint8Array(ev.data);
  if (v[0] === 1 && ev.data.byteLength === 4 + 1920) saida.port.postMessage(new Int16Array(ev.data, 4));
};
</script>
```

## Navegador: mandar o microfone

```js
const HEADER = 4, KIND_AUDIO = 1;
const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
const ctxEntrada = new AudioContext({ sampleRate: 16000 });
await ctxEntrada.audioWorklet.addModule(URL.createObjectURL(new Blob([window.__ZC_WORKLETS.captura], { type: 'application/javascript' })));
const captura = new AudioWorkletNode(ctxEntrada, 'jw-captura', { numberOfOutputs: 0 });
captura.port.onmessage = (e) => {                                 // e.data: Int16Array(960)
  if (ws.readyState !== 1 || ws.bufferedAmount > 6 * (HEADER + 1920)) return;   // fila curta de propósito
  const buf = new Uint8Array(HEADER + e.data.byteLength);
  buf[0] = KIND_AUDIO;
  buf.set(new Uint8Array(e.data.buffer), HEADER);
  ws.send(buf);
};
ctxEntrada.createMediaStreamSource(mic).connect(captura);
```

## Navegador: mandar a câmera (H.264 com WebCodecs)

```js
const KIND_VIDEO = 2, FLAG_KEY = 1;
const codec = (w, h) => { const mb = Math.ceil(w / 16) * Math.ceil(h / 16); return 'avc1.42E0' + (mb <= 1620 ? '1E' : mb <= 3600 ? '1F' : '28'); };
const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
const track = cam.getVideoTracks()[0], { width, height, frameRate } = track.getSettings();
let forcarKey = true, n = 0;
const enc = new VideoEncoder({
  output: (pedaco) => {
    const corpo = new Uint8Array(pedaco.byteLength); pedaco.copyTo(corpo);
    const buf = new Uint8Array(4 + corpo.length); buf[0] = KIND_VIDEO; buf[1] = pedaco.type === 'key' ? FLAG_KEY : 0; buf.set(corpo, 4);
    if (ws.bufferedAmount > 512 * 1024) { if (pedaco.type !== 'key') forcarKey = true; return; }
    ws.send(buf);
  },
  error: console.error,
});
enc.configure({ codec: codec(width, height), width, height, bitrate: 2_000_000, framerate: frameRate, latencyMode: 'realtime', avc: { format: 'annexb' } });
const leitor = new MediaStreamTrackProcessor({ track }).readable.getReader();
for (;;) {
  const { done, value } = await leitor.read(); if (done) break;
  try {
    if (enc.encodeQueueSize >= 3) { forcarKey = true; continue; }
    enc.encode(value, { keyFrame: forcarKey || n % (frameRate * 2) === 0 }); n++; forcarKey = false;
  } finally { value.close(); }
}
```

## Navegador: desenhar o vídeo do contato

```js
let dec = null, esperaKey = true, rotacao = 0;
const canvas = document.querySelector('canvas'), g = canvas.getContext('2d');
function novoDecoder() {
  dec = new VideoDecoder({ output: (f) => { desenhar(f); f.close(); }, error: () => novoDecoder() });
  dec.configure({ codec: 'avc1.42E01E', optimizeForLatency: true });   // Annex-B: sem description
  esperaKey = true;
}
function desenhar(f) {
  const w = f.displayWidth, h = f.displayHeight, deitado = rotacao % 2 === 1;
  canvas.width = deitado ? h : w; canvas.height = deitado ? w : h;
  g.save(); g.translate(canvas.width / 2, canvas.height / 2); g.rotate(rotacao * Math.PI / 2); g.drawImage(f, -w / 2, -h / 2); g.restore();
}
ws.addEventListener('message', (ev) => {
  if (typeof ev.data === 'string') return;
  const v = new Uint8Array(ev.data);
  if (v[0] !== 2) return;
  if (!dec) novoDecoder();
  const key = (v[1] & 1) !== 0;
  if (esperaKey && !key) return; esperaKey = false;
  rotacao = v[2] & 3;
  dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: performance.now() * 1000, data: new Uint8Array(ev.data, 4) }));
});
```

A versão completa e funcional dos quatro trechos é o `src/page/dialer.html`.

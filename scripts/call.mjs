// O teste que decide: a conta pareada, pelo WhatsApp
// Web, faz uma chamada de VIDEO que TOCA no celular do contato?
//
// Uso: node scripts/call.mjs 5565999999999 [--video] [--segundos=30]
//
// Ele disca pela API publica, imprime a linha do tempo de cada evento, injeta
// um tom de 440 Hz como se fosse a voz do operador e mede o pico do que volta
// — ou seja, responde tocou/atendeu/ouviu/foi ouvido com numero, nao com achismo.
import WebSocket from 'ws';
import { iniciarApp } from '../src/app.mjs';

const args = process.argv.slice(2);
const numero = (args.find(a => /^\d{10,15}$/.test(a)) || '').trim();
const video = args.includes('--video');
const segundos = Number((args.find(a => a.startsWith('--segundos=')) || '').split('=')[1] || 30);
if (!numero) { console.error('uso: node scripts/call.mjs 5565999999999 [--video] [--segundos=30]'); process.exit(1); }

const RATE = 16000, FRAME = 960, HEADER = 4, KIND_AUDIO = 1;
const quadroDeTom = (i) => {
  const pcm = new Int16Array(FRAME);
  for (let k = 0; k < FRAME; k++) pcm[k] = Math.round(Math.sin(2 * Math.PI * 440 * ((i * FRAME + k) / RATE)) * 0.35 * 32767);
  const b = Buffer.alloc(HEADER + pcm.byteLength); b[0] = KIND_AUDIO;
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(b, HEADER); return b;
};

const porta = Number(process.env.PORT || 18475);
const app = await iniciarApp({ port: porta, headful: process.env.HEADFUL === '1' });
const t0 = Date.now();
const marca = () => String((Date.now() - t0) / 1000).padStart(6, ' ') + 's';

for (let i = 0; i < 60; i++) {
  const s = await app.nav.status().catch(() => null);
  if (s && s.connected) break;
  if (i === 59) { console.error('sessao NAO pareada. Rode: node scripts/pair.mjs'); await app.parar(); process.exit(1); }
  await new Promise(r => setTimeout(r, 1000));
}
const conta = await app.nav.status();
console.log('conta: ' + conta.jid + ' (' + (conta.phone || '?') + ')');
console.log('discando para ' + numero + (video ? ' EM VIDEO' : ' em voz') + '\n');

const ws = new WebSocket('ws://127.0.0.1:' + porta + '/ws?clientId=teste');
let pico = 0, quadrosRecebidos = 0, ativa = false, terminou = null;
ws.on('message', (dados, bin) => {
  if (bin) {
    const b = Buffer.from(dados);
    if (b[0] !== KIND_AUDIO) return;
    quadrosRecebidos += 1;
    for (let i = HEADER; i + 1 < b.length; i += 2) { const v = Math.abs(b.readInt16LE(i)); if (v > pico) pico = v; }
    return;
  }
  const ev = JSON.parse(dados.toString());
  if (ev.type === 'hello' || ev.type === 'status') return;
  const c = ev.call || {};
  console.log(marca() + '  ' + ev.type.padEnd(14) + ' estado=' + (c.status || '?').padEnd(10) + ' bruto=' + (c.raw || '?').padEnd(18) + ' video=' + !!c.isVideo + (c.endReason ? ' motivo=' + c.endReason : ''));
  if (c.status === 'active' && !ativa) { ativa = true; console.log(marca() + '  >>> ATENDIDA (o WhatsApp Web disse ACTIVE)'); }
  if (ev.type === 'call_ended') terminou = c.endReason || 'terminate';
});
await new Promise((ok, e) => { ws.once('open', ok); ws.once('error', e); });

const r = await fetch('http://127.0.0.1:' + porta + '/api/calls', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-client-id': 'teste' },
  body: JSON.stringify({ to: numero, video }),
}).then(x => x.json());
console.log(marca() + '  POST /api/calls -> ' + JSON.stringify(r) + '\n');
if (!r.callId) { await app.parar(); process.exit(1); }

let i = 0;
const tom = setInterval(() => { if (ativa) ws.send(quadroDeTom(i++)); }, 60);
const fim = Date.now() + segundos * 1000;
while (Date.now() < fim && !terminou) await new Promise(r2 => setTimeout(r2, 200));
clearInterval(tom);

if (!terminou) { console.log('\n' + marca() + '  tempo esgotado, desligando'); await fetch('http://127.0.0.1:' + porta + '/api/calls/' + r.callId + '/hangup', { method: 'POST', headers: { 'x-client-id': 'teste' }, body: '{}' }); }
await new Promise(r2 => setTimeout(r2, 1200));

console.log('\n=== VEREDITO ===');
console.log('tocou/entrou no WhatsApp: ' + (r.callId ? 'sim (callId ' + r.callId + ')' : 'nao'));
console.log('atendida:                 ' + (ativa ? 'sim' : 'nao'));
console.log('audio do contato:         ' + (quadrosRecebidos ? quadrosRecebidos + ' quadros, pico ' + pico + (pico > 300 ? ' (voz)' : ' (silencio)') : 'nenhum quadro'));
console.log('motivo do fim:            ' + (terminou || 'desligamos'));
ws.close(); await app.parar(); process.exit(0);

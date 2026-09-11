// Autoteste. Duas fases, e as duas rodam sem WhatsApp pareado:
//
//   FASE A (midia): num loopback WebRTC dentro da propria pagina, prova o
//   caminho inteiro — cliente do CRM -> servidor -> pagina -> "microfone"
//   sintetico -> WebRTC -> track remoto -> captura -> servidor -> cliente.
//   E o unico jeito de saber que a ponte de midia funciona antes de existir
//   uma chamada de verdade.
//
//   FASE B (pagina real): carrega o web.whatsapp.com e verifica que os ganchos
//   sobrevivem, que a ponte abre APESAR do CSP e que o wa-js ficou pronto.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import WebSocket from 'ws';
import { iniciarApp } from '../src/app.mjs';
import { paraTerminal } from '../src/qr.mjs';

const jsQR = createRequire(import.meta.url)('jsqr').default;

const SAIDA = join(process.cwd(), 'data', 'probe');
const HEADER = 4;
const KIND_AUDIO = 1;
const RATE = 16000;
const FRAME = 960;

const resultados = [];
const conferir = (nome, ok, detalhe = '') => {
  resultados.push({ nome, ok, detalhe });
  console.log((ok ? '  OK  ' : ' FALHA') + ' | ' + nome + (detalhe ? ' — ' + detalhe : ''));
};
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/** 60 ms de senoide de 440 Hz, do jeito que o CRM manda: 960 amostras Int16. */
function quadroDeTom(indice) {
  const pcm = new Int16Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = (indice * FRAME + i) / RATE;
    pcm[i] = Math.round(Math.sin(2 * Math.PI * 440 * t) * 0.4 * 32767);
  }
  const buf = Buffer.alloc(HEADER + pcm.byteLength);
  buf[0] = KIND_AUDIO;
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, HEADER);
  return buf;
}

mkdirSync(SAIDA, { recursive: true });

const porta = Number(process.env.PORT || 18476);
console.log('\n=== FASE A — ponte de midia (sem WhatsApp) ===');
const app = await iniciarApp({
  port: porta,
  verbose: process.env.VERBOSE === '1',
  headful: process.env.HEADFUL === '1',
  url: 'http://127.0.0.1:' + porta + '/probe',
  // PERFIL PROPRIO. O autoteste nao pode encostar no perfil do pareamento:
  // dois Chromes no mesmo --user-data-dir brigam, e ali mora a sessao do
  // numero pareado. Assim o teste roda com o servico de pareamento no ar.
  profileDir: process.env.PROFILE_DIR || join(process.cwd(), 'data', 'perfil-autoteste'),
  qrNoTerminal: false,
});

try {
  // ------------------------------------------------------------------ ganchos
  await esperar(1500);
  const diag = await app.nav.diagnostico();
  const ganchos = diag && diag.zapcall && diag.zapcall.ganchos;
  conferir('ganchos instalados na pagina', !!(ganchos && ganchos.getUserMedia && ganchos.enumerateDevices && ganchos.rtcPeerConnection), JSON.stringify(ganchos));
  conferir('ponte pagina->agente aberta', !!(diag && diag.zapcall && diag.zapcall.ponte && diag.zapcall.ponte.aberta));
  conferir('servidor viu a pagina', app.servidor.temPagina);

  const probe = await app.nav.page.evaluate(() => window.__probe && { ...window.__probe, pcs: undefined });
  conferir('getUserMedia devolveu o microfone sintetico', !!(diag.zapcall.mic && diag.zapcall.mic.ativo), 'erro: ' + (probe && probe.erro || 'nenhum'));
  conferir('H.264 disponivel no WebCodecs', probe && probe.h264 === true, 'necessario para o video');

  // -------------------------------------------------------- cliente
  const ws = new WebSocket('ws://127.0.0.1:' + porta + '/ws?clientId=probe&token=' + encodeURIComponent(app.token));
  const eventos = [];
  let recebidos = 0, picoRecebido = 0, tamanhos = new Set();
  ws.on('message', (dados, ehBinario) => {
    if (!ehBinario) { try { eventos.push(JSON.parse(dados.toString())); } catch {} return; }
    const buf = Buffer.from(dados);
    if (buf[0] !== KIND_AUDIO) return;
    recebidos += 1;
    tamanhos.add(buf.length - HEADER);
    for (let i = HEADER; i + 1 < buf.length; i += 2) {
      const v = Math.abs(buf.readInt16LE(i));
      if (v > picoRecebido) picoRecebido = v;
    }
  });
  await new Promise((ok, erro) => { ws.once('open', ok); ws.once('error', erro); });
  await esperar(300);
  conferir('WebSocket do cliente aceito e "hello" recebido', eventos.some(e => e.type === 'hello'), JSON.stringify(eventos[0] || null));

  // Espera o loopback conectar antes de falar.
  for (let i = 0; i < 40; i++) {
    const p = await app.nav.page.evaluate(() => !!(window.__probe && window.__probe.pronto));
    if (p) break;
    await esperar(250);
  }
  const pronto = await app.nav.page.evaluate(() => !!(window.__probe && window.__probe.pronto));
  conferir('loopback WebRTC conectado dentro da pagina', pronto);

  const dRemoto = await app.nav.diagnostico();
  conferir('captura do track remoto ligada', !!(dRemoto.zapcall.remoto && dRemoto.zapcall.remoto.audio));

  // --------------------------------------------------------- tom de 3 s
  // Midia de subida so entra com uma chamada de pe (e de UM socket, o do
  // dono): o autoteste registra uma chamada ATIVA de mentira, cujo dono e o
  // proprio cliente do probe, para exercitar o caminho inteiro.
  app.servidor.aplicarEvento({ type: 'call', call: { callId: 'probe', direction: 'outbound', status: 'active', offerTime: Date.now() } });
  app.servidor.chamadas.get('probe').owner = 'probe';
  console.log('  ..  | injetando 3 s de tom de 440 Hz pelo caminho do cliente');
  for (let i = 0; i < 50; i++) { ws.send(quadroDeTom(i)); await esperar(60); }
  await esperar(700);
  app.servidor.aplicarEvento({ type: 'call', call: { callId: 'probe', direction: 'outbound', status: 'ended' } });

  const dFim = await app.nav.diagnostico();
  const mic = dFim.zapcall.mic || {};
  conferir('pagina consumiu os quadros como microfone', (mic.alimentado || 0) >= 45, (mic.alimentado || 0) + '/50 quadros');
  conferir('voz voltou pelo track remoto (pico acima do piso de voz)', picoRecebido > 300, 'pico ' + picoRecebido + ' (piso 300)');
  conferir('quadros de volta tem 960 amostras', tamanhos.size === 1 && tamanhos.has(FRAME * 2), [...tamanhos].join(','));
  conferir('quantidade de quadros de volta e coerente', recebidos >= 40, recebidos + ' quadros');
  ws.close();

  const tracks = await app.nav.page.evaluate(async () => {
    const primeira = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const segunda = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    primeira.getTracks().forEach(t => t.stop());
    const independentes = segunda.getTracks().every(t => t.readyState === 'live');
    segunda.getTracks().forEach(t => t.stop());
    const terceira = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const reutilizavel = terceira.getTracks().every(t => t.readyState === 'live');
    terceira.getTracks().forEach(t => t.stop());
    return { independentes, reutilizavel };
  });
  conferir('fechar previa nao encerra tracks da chamada', tracks.independentes);
  conferir('audio e camera podem ser abertos novamente', tracks.reutilizavel);

  // ------------------------------------------------- FASE B — pagina real
  console.log('\n=== FASE B — web.whatsapp.com de verdade ===');
  await app.nav.page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await esperar(9000);

  const dWA = await app.nav.diagnostico();
  const gWA = dWA && dWA.zapcall && dWA.zapcall.ganchos;
  conferir('ganchos sobrevivem na pagina da Meta', !!(gWA && gWA.getUserMedia && gWA.rtcPeerConnection), JSON.stringify(gWA));
  conferir('CSP contornado: ponte abre de dentro do web.whatsapp.com', !!(dWA && dWA.zapcall && dWA.zapcall.ponte && dWA.zapcall.ponte.aberta));

  for (let i = 0; i < 60 && !(await app.nav.page.evaluate(() => !!window.__zapcallControl)); i++) await esperar(500);
  const wpp = await app.nav.page.evaluate(() => ({
    carregado: !!window.WPP,
    // isReady fica FALSE na tela do QR — informativo, nunca portao.
    isReady: !!(window.WPP && window.WPP.isReady),
    call: !!(window.WPP && window.WPP.call && window.WPP.call.offer && window.WPP.call.accept),
    store: !!(window.WPP && window.WPP.whatsapp && window.WPP.whatsapp.CallStore),
    controle: !!window.__zapcallControl,
    versao: (window.WPP && window.WPP.version) || null,
  }));
  conferir('wa-js com o modulo de chamadas e o CallStore', wpp.call && wpp.store, JSON.stringify(wpp));
  conferir('camada de controle exposta (dial/accept/reject/end)', wpp.controle);

  const status = await app.nav.status();
  conferir('/api/status responde', !!status, JSON.stringify(status));

  const qr = await app.nav.qr();
  if (qr) {
    writeFileSync(join(SAIDA, 'qr.png'), Buffer.from(qr.png, 'base64'));
    conferir('QR de pareamento capturado', true, 'data/probe/qr.png (seletor ' + qr.seletor + ')');

    // O QR do terminal SO vale se for o mesmo que esta na tela. Decodificamos
    // os pixels do canvas e confrontamos com o `data-ref` que alimenta a arte.
    const px = await app.nav.qrPixels();
    const lido = px ? jsQR(new Uint8ClampedArray(Buffer.from(px.b64, 'base64')), px.w, px.h) : null;
    conferir('QR da tela decodifica', !!(lido && lido.data), px ? px.w + 'x' + px.h : 'sem pixels');
    conferir('QR do terminal e o MESMO da tela', !!(lido && lido.data === qr.ref),
      lido && lido.data !== qr.ref ? 'data-ref divergiu do decodificado' : 'data-ref confere');

    const arte = await paraTerminal(qr.ref);
    const linhas = String(arte || '').split('\n').filter(l => l.trim());
    conferir('arte do terminal renderizada', linhas.length >= 20 && linhas.length <= 80, linhas.length + ' linhas');
    writeFileSync(join(SAIDA, 'qr.txt'), String(arte || ''));
  } else {
    conferir('QR de pareamento capturado', !!(status && status.connected), status && status.connected ? 'sessao JA pareada, sem QR' : 'nao achei o QR');
  }
  writeFileSync(join(SAIDA, 'tela.png'), Buffer.from(await app.nav.captura(), 'base64'));
  console.log('  ..  | tela salva em data/probe/tela.png');

  const falhas = resultados.filter(r => !r.ok);
  console.log('\n=== RESUMO: ' + (resultados.length - falhas.length) + '/' + resultados.length + ' verificacoes passaram ===');
  for (const f of falhas) console.log('  falhou: ' + f.nome + (f.detalhe ? ' — ' + f.detalhe : ''));
  writeFileSync(join(SAIDA, 'resultado.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
  await app.parar();
  process.exit(falhas.length ? 1 : 0);
} catch (e) {
  console.error('\nautoteste explodiu:', e && e.stack || e);
  try { writeFileSync(join(SAIDA, 'tela-erro.png'), Buffer.from(await app.nav.captura(), 'base64')); } catch {}
  await app.parar();
  process.exit(2);
}

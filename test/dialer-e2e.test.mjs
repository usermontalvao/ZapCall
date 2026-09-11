// REGRESSAO do discador: "Cannot read properties of undefined (reading
// 'reproducao')". Roda o discador de verdade num Chrome headless com
// microfone e camera falsos, atende uma chamada falsa e confere que o audio
// liga — inclusive quando a tag <script src="static/worklets.js"> FALHA no
// carregamento da pagina (o cenario que produzia o erro). Sem Chrome na
// maquina o teste e pulado, nao reprovado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { criarServidor } from '../src/server.mjs';

let puppeteer = null, chrome = null;
try {
  puppeteer = (await import('puppeteer-core')).default;
  chrome = (await import('../src/browser.mjs')).acharChrome(process.env.CHROME_PATH || '');
} catch { chrome = null; }

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

async function abrirDiscador(t, { bloquearWorklets = false } = {}) {
  const token = 'tok-e2e';
  const srv = criarServidor({ port: 0, token, verbose: false });
  await srv.ouvir(); srv.ligarAcoes({});
  const perfil = mkdtempSync(join(tmpdir(), 'zc-e2e-'));
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--user-data-dir=' + perfil, '--autoplay-policy=no-user-gesture-required', ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
  });
  t.after(async () => { try { await browser.close(); } catch {} await srv.fechar(); rmSync(perfil, { recursive: true, force: true }); });
  const page = (await browser.pages())[0];
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  if (bloquearWorklets) {
    // So a PRIMEIRA carga do arquivo falha (a tag <script>); a busca de
    // recuperacao feita pelo proprio discador tem de passar.
    let bloqueadas = 0;
    await page.setRequestInterception(true);
    page.on('request', r => { if (r.url().endsWith('/static/worklets.js') && bloqueadas++ === 0) r.abort(); else r.continue(); });
  }
  const base = 'http://127.0.0.1:' + srv.port;
  await page.goto(base + '/dialer?token=' + token, { waitUntil: 'load' });
  await esperar(600);
  const cab = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  return { srv, page, erros, base, token, cab };
}

const atender = async ({ page, base, cab }) => {
  const r = await fetch(base + '/api/debug/fake-incoming', { method: 'POST', headers: cab, body: '{}' }).then(r => r.json());
  await esperar(700);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /^(Atender|Answer|Contestar)$/.test(b.textContent.trim())); if (!b) throw new Error('botao de atender nao apareceu'); b.click(); });
  await esperar(2500);
  const log = await page.evaluate(() => document.getElementById('log').textContent);
  return { callId: r.callId, log };
};

test('discador: atende uma chamada com os worklets carregados pela tag', { skip: !chrome && 'Chrome nao encontrado (CHROME_PATH)' }, async t => {
  const d = await abrirDiscador(t);
  assert.equal(await d.page.evaluate(() => typeof window.__ZC_WORKLETS), 'object');
  assert.equal(await d.page.evaluate(() => new URL(location.href).searchParams.get('token')), null, 'token sai da URL');
  const { log } = await atender(d);
  assert.match(log, /áudio ligado|audio on/i, log);
  assert.doesNotMatch(log, /reproducao|falhou ao atender/i, log);
  assert.deepEqual(d.erros.filter(e => !/favicon/.test(e)), []);
  assert.equal(d.srv.retrato().activeCalls, 1);
});

test('discador: recupera sozinho quando static/worklets.js falha na carga da pagina', { skip: !chrome && 'Chrome nao encontrado (CHROME_PATH)' }, async t => {
  const d = await abrirDiscador(t, { bloquearWorklets: true });
  assert.equal(await d.page.evaluate(() => typeof window.__ZC_WORKLETS), 'undefined', 'cenario reproduzido: global ausente');
  const { log } = await atender(d);
  assert.match(log, /worklets de áudio recarregados|audio worklets reloaded/i, log);
  assert.match(log, /áudio ligado|audio on/i, log);
  assert.doesNotMatch(log, /Cannot read properties|reproducao/i, log);
});

test('discador: video usa perfil realtime, anuncia decoder e entrega keyframe', { skip: !chrome && 'Chrome nao encontrado (CHROME_PATH)' }, async t => {
  const d = await abrirDiscador(t);
  const ponte = new WebSocket(d.base.replace('http', 'ws') + '/page?token=' + d.token);
  await once(ponte, 'open');
  t.after(() => ponte.close());
  let config = null, recebeuKeyframe = false;
  ponte.on('message', (dados, bin) => {
    if (bin) {
      const b = Buffer.from(dados);
      if (b[0] === 2 && (b[1] & 1)) recebeuKeyframe = true;
      return;
    }
    try { const m = JSON.parse(dados.toString()); if (m.type === 'media-config') config = m; } catch {}
  });

  await fetch(d.base + '/api/debug/fake-incoming', {
    method: 'POST', headers: d.cab, body: JSON.stringify({ video: true }),
  });
  await esperar(500);
  await d.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /vídeo|video/i.test(x.textContent) && /atender|answer/i.test(x.textContent));
    if (!b) throw new Error('botao de atender com video nao apareceu');
    b.click();
  });
  for (let i = 0; i < 30 && (!config || !recebeuKeyframe); i++) await esperar(100);
  const log = await d.page.evaluate(() => document.getElementById('log').textContent);
  assert.match(log, /câmera realtime|realtime camera/i, log);
  assert.ok(config, 'media-config chegou antes/do lado do keyframe');
  assert.ok(config.width <= 640 && config.height <= 360 && config.frameRate <= 24, JSON.stringify(config));
  assert.equal(recebeuKeyframe, true, 'primeiro GOP entregue com IDR');
});

test('discador: segunda aba nao rouba a midia da chamada (uma fonte por chamada)', { skip: !chrome && 'Chrome nao encontrado (CHROME_PATH)' }, async t => {
  const d = await abrirDiscador(t);
  const { callId } = await atender(d);
  const outra = await d.page.browser().newPage();
  await outra.goto(d.base + '/dialer?token=' + d.token, { waitUntil: 'load' });
  await esperar(800);
  const ids = await Promise.all([d.page, outra].map(p => p.evaluate(() => sessionStorage.getItem('zc.dialer.clientId'))));
  assert.notEqual(ids[0], ids[1], 'cada aba tem o proprio clientId');
  // A segunda aba ve a chamada ativa, mas e apenas observadora: nao deve nem
  // abrir/codificar a camera que o servidor descartaria depois.
  await esperar(2500);
  const logOutra = await outra.evaluate(() => document.getElementById('log').textContent);
  assert.doesNotMatch(logOutra, /áudio ligado|audio on|câmera realtime|realtime camera/i, logOutra);
  const antes = d.srv.descartes.midiaDeOutroSocket;
  await esperar(1500);
  assert.ok(d.srv.descartes.midiaDeOutroSocket >= antes, 'quadros da segunda aba sao descartados, nao misturados');
  assert.equal(d.srv.retrato().activeCalls, 1);
  await fetch(d.base + '/api/calls/' + callId + '/hangup', { method: 'POST', headers: d.cab, body: '{}' });
  await esperar(500);
  assert.equal(d.srv.retrato().activeCalls, 0);
});

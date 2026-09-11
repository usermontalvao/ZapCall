// O que a revisao de seguranca e de robustez acrescentou, testado pelo lado
// de fora: arquivos publicos nos dois servidores, documentacao embutida,
// cabecalhos, forca bruta virando 429, token em header no WebSocket, Origin
// restrito, poda de chamadas encerradas e nenhum segredo em pagina publica.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { criarServidor } from '../src/server.mjs';
import { iniciarGerente } from '../src/manager.mjs';

const pasta = () => mkdtempSync(join(tmpdir(), 'zc-'));

test('instancia: /static/worklets.js e /static/zc-ui.js sao publicos e trazem os dois worklets', async t => {
  const s = criarServidor({ port: 0, token: 'tok' });
  await s.ouvir(); t.after(() => s.fechar()); s.ligarAcoes({});
  const base = 'http://127.0.0.1:' + s.port;
  const w = await fetch(base + '/static/worklets.js');
  assert.equal(w.status, 200);
  assert.match(w.headers.get('content-type'), /javascript/);
  const texto = await w.text();
  assert.match(texto, /window\.__ZC_WORKLETS = \{"reproducao":/);
  assert.match(texto, /jw-reproducao/); assert.match(texto, /jw-captura/);
  assert.equal((await fetch(base + '/static/zc-ui.js')).status, 200);
  assert.equal((await fetch(base + '/static/inexistente.js')).status, 401, 'fora dos publicos volta a exigir token');
});

test('gerente: serve os mesmos arquivos publicos e a documentacao embutida em 3 idiomas', async t => {
  const dir = pasta();
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: 'k', semProcessos: true, verbose: false });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  assert.equal((await fetch(base + '/static/worklets.js')).status, 200);
  assert.equal((await fetch(base + '/static/zc-ui.js')).status, 200);
  const docs = await fetch(base + '/docs');
  assert.equal(docs.status, 200);
  const idx = await fetch(base + '/docs/index.json').then(r => r.json());
  assert.deepEqual(Object.keys(idx.languages).sort(), ['en', 'es', 'pt']);
  assert.ok(idx.pages.length >= 16, 'ao menos 16 paginas de documentacao');
  for (const lang of Object.keys(idx.languages)) {
    for (const p of idx.pages) {
      const r = await fetch(base + '/docs/content/' + lang + '/' + p.id + '.md');
      assert.equal(r.status, 200, lang + '/' + p.id);
      const md = await r.text();
      assert.ok(md.length > 200, lang + '/' + p.id + ' esta vazio');
    }
  }
  assert.equal((await fetch(base + '/docs/content/pt/../../package.md')).status, 404);
  assert.equal((await fetch(base + '/docs/content/xx/nao-existe.md')).status, 404);
});

test('nenhuma pagina publica, exemplo ou documentacao contem a chave, token ou dado da instalacao', async t => {
  const dir = pasta();
  const chave = 'CHAVE-SECRETA-DE-TESTE-9f8e7d6c';
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: chave, semProcessos: true, verbose: false });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  const tok = (await fetch(base + '/manager/instances', { method: 'POST', headers: { apikey: chave, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'a' }) }).then(r => r.json())).instance.token;
  for (const rota of ['/', '/docs', '/docs/index.json', '/static/zc-ui.js', '/healthz']) {
    const texto = await fetch(base + rota).then(r => r.text());
    assert.ok(!texto.includes(chave), rota + ' vaza a chave global');
    assert.ok(!texto.includes(tok), rota + ' vaza o token');
  }
  const cfg = await fetch(base + '/manager/config', { headers: { apikey: chave } }).then(r => r.text());
  assert.ok(!cfg.includes(chave), '/manager/config so mostra a chave mascarada');
  // Nada do ambiente de quem desenvolveu no codigo publicavel.
  const raiz = join(import.meta.dirname, '..');
  // Nome antigo do projeto, dominio e caminhos da maquina de quem desenvolveu.
  const proibidos = [/advcuiaba/i, /jurius/i, /\/Users\/pedro/i, /cuiaba/i];
  // Telefone REAL: qualquer numero brasileiro de 12-13 digitos que nao seja
  // um dos exemplos ficticios da documentacao (DDD 11 com digitos repetidos).
  const telefoneReal = (texto) => (texto.match(/\b55\d{10,11}\b/g) || []).filter(n => !/^55\d\d(\d)\1{7,8}$/.test(n) && !/^5511(8{8,9}|9{8,9})$/.test(n) && !/^5565(9{8,9})$/.test(n));
  const varrer = (d) => {
    for (const nome of readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'data', '.git', 'test'].includes(nome.name)) continue;
      const cam = join(d, nome.name);
      if (nome.isDirectory()) { varrer(cam); continue; }
      if (!/\.(mjs|js|html|md|json|yml|yaml|sh|example|txt)$/.test(nome.name) && !nome.name.startsWith('.env')) continue;
      const texto = readFileSync(cam, 'utf8');
      for (const re of proibidos) assert.ok(!re.test(texto), cam + ' contem ' + re);
      assert.deepEqual(telefoneReal(texto), [], cam + ' contem um telefone que nao e exemplo');
    }
  };
  varrer(raiz);
});

test('forca bruta: falhas repetidas do mesmo IP viram 429 e a credencial certa volta a valer depois', async t => {
  const dir = pasta();
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: 'k', semProcessos: true, verbose: false });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  let ultimo = 0;
  for (let i = 0; i < 25; i++) ultimo = (await fetch(base + '/manager/instances', { headers: { apikey: 'errada-' + i } })).status;
  assert.equal(ultimo, 429);
  assert.equal((await fetch(base + '/manager/instances', { headers: { apikey: 'k' } })).status, 429, 'bloqueio vale para o IP, mesmo com a chave certa');
  assert.equal((await fetch(base + '/healthz')).status, 429);
});

test('WebSocket da instancia: token em header, Origin fora da lista recusado, cabecalhos de seguranca', async t => {
  const s = criarServidor({ port: 0, token: 'tok', allowedOrigins: 'https://crm.exemplo' });
  await s.ouvir(); t.after(() => s.fechar()); s.ligarAcoes({});
  const base = 'http://127.0.0.1:' + s.port;
  const wsUrl = base.replace('http', 'ws') + '/ws?clientId=c';
  const ok = new WebSocket(wsUrl, { headers: { authorization: 'Bearer tok' } });
  await once(ok, 'open'); ok.close();
  const semToken = new WebSocket(wsUrl);
  const [erroSem] = await once(semToken, 'error');
  assert.match(String(erroSem.message), /401/);
  const origemRuim = new WebSocket(wsUrl + '&token=tok', { headers: { origin: 'https://mal.exemplo' } });
  const [erroOrigem] = await once(origemRuim, 'error');
  assert.match(String(erroOrigem.message), /403/);
  const origemBoa = new WebSocket(wsUrl + '&token=tok', { headers: { origin: 'https://crm.exemplo' } });
  await once(origemBoa, 'open'); origemBoa.close();
  const r = await fetch(base + '/api/status', { headers: { authorization: 'Bearer tok', origin: 'https://mal.exemplo' } });
  assert.equal(r.status, 403);
  const h = await fetch(base + '/api/status', { headers: { authorization: 'Bearer tok' } });
  assert.equal(h.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(h.headers.get('access-control-allow-origin'), null, 'com lista de origens nao ha CORS *');
  const pag = await fetch(base + '/dialer?token=tok');
  assert.match(pag.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('chamadas encerradas sao podadas: ficam as ativas e as ultimas 100', async t => {
  const s = criarServidor({ port: 0, token: '' });
  await s.ouvir(); t.after(() => s.fechar()); s.ligarAcoes({});
  for (let i = 0; i < 150; i++) {
    s.aplicarEvento({ type: 'call', call: { callId: 'c' + i, direction: 'outbound', status: 'ringing', offerTime: i } });
    s.aplicarEvento({ type: 'call', call: { callId: 'c' + i, direction: 'outbound', status: 'ended' } });
  }
  s.aplicarEvento({ type: 'call', call: { callId: 'ativa', direction: 'inbound', status: 'ringing' } });
  assert.ok(s.chamadas.size <= 101, 'tamanho ' + s.chamadas.size);
  assert.ok(s.chamadas.has('ativa'));
  assert.ok(s.chamadas.has('c149')); assert.ok(!s.chamadas.has('c0'));
});

test('sem DDI configurado, numero nacional e recusado com motivo; com DDI, aceito', async t => {
  const s = criarServidor({ port: 0, token: '', countryCode: '' });
  await s.ouvir(); t.after(() => s.fechar());
  s.ligarAcoes({ dial: async () => ({ callId: 'x' }) }); s.definirConta({ connected: true });
  const base = 'http://127.0.0.1:' + s.port;
  const r = await fetch(base + '/api/calls', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: '11999999999' }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).motivo, /DEFAULT_COUNTRY_CODE/);
  const s2 = criarServidor({ port: 0, token: '', countryCode: '55' });
  await s2.ouvir(); t.after(() => s2.fechar());
  s2.ligarAcoes({ dial: async (n) => ({ callId: n }) }); s2.definirConta({ connected: true });
  const r2 = await fetch('http://127.0.0.1:' + s2.port + '/api/calls', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: '11999999999' }) });
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).callId, '5511999999999');
});

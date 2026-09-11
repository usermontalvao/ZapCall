// O gerente sem Chrome nenhum (semProcessos): cadastro, autenticacao, rotas e
// a recusa de chamada quando a instancia esta em uso ou parada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirCadastro, proximaPorta, NOME_VALIDO } from '../src/instances.mjs';
import { iniciarGerente } from '../src/manager.mjs';

const pasta = () => mkdtempSync(join(tmpdir(), 'jw-'));

test('cadastro: cria, persiste, aloca porta, gira token, remove', () => {
  const dir = pasta();
  try {
    const c = abrirCadastro({ dataDir: dir, portBase: 19000 });
    const a = c.criar({ name: 'Vendas' });
    assert.equal(a.name, 'vendas'); assert.equal(a.port, 19000); assert.ok(a.token.length > 20);
    assert.equal(a.profileDir, join(dir, 'instances', 'vendas', 'profile'));
    const b = c.criar({ name: 'suporte', channel: 'Atendimento', profileDir: '/tmp/perfil-importado' });
    assert.equal(b.port, 19001); assert.equal(b.profileDir, '/tmp/perfil-importado');
    assert.throws(() => c.criar({ name: 'vendas' }), /ja existe/);
    assert.throws(() => c.criar({ name: 'Nome Com Espaco' }), /nome invalido/);
    assert.ok(!NOME_VALIDO.test('../x'));

    const relido = abrirCadastro({ dataDir: dir, portBase: 19000 });
    assert.deepEqual(relido.listar().map(i => i.name), ['vendas', 'suporte']);
    assert.ok(existsSync(join(dir, 'instances.json')));

    const t0 = a.token;
    assert.notEqual(relido.girarToken('vendas').token, t0);
    assert.equal(relido.remover('vendas'), true);
    assert.equal(relido.remover('vendas'), false);
    assert.equal(proximaPorta(relido.listar(), 19000), 19000, 'porta liberada volta a ser usada');
    assert.equal(JSON.parse(readFileSync(join(dir, 'instances.json'), 'utf8')).instances.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gerente: chave global protege /manager, token da instancia so abre a propria', async t => {
  const dir = pasta();
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: 'chave-global', semProcessos: true, verbose: false });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  const j = async (rota, op = {}) => { const r = await fetch(base + rota, op); return { status: r.status, corpo: await r.json().catch(() => ({})) }; };

  assert.equal((await j('/manager/instances')).status, 401);
  assert.equal((await j('/manager/instances', { headers: { apikey: 'errada' } })).status, 401);
  const lista = await j('/manager/instances', { headers: { apikey: 'chave-global' } });
  assert.equal(lista.status, 200); assert.deepEqual(lista.corpo.instances, []);

  const criada = await j('/manager/instances', { method: 'POST', headers: { apikey: 'chave-global', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'vendas' }) });
  assert.equal(criada.status, 201);
  const token = criada.corpo.instance.token;
  assert.ok(token);
  assert.equal(criada.corpo.instance.maxCalls, 1);
  assert.equal(criada.corpo.instance.busy, false);
  assert.equal((await j('/manager/instances', { method: 'POST', headers: { apikey: 'chave-global', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'vendas' }) })).status, 409);

  // Token da instancia nao administra, e nao abre outra instancia.
  assert.equal((await j('/manager/instances', { headers: { apikey: token } })).status, 401);
  assert.equal((await j('/instances/vendas/api/status')).status, 401);
  assert.equal((await j('/instances/outra/api/status', { headers: { authorization: 'Bearer ' + token } })).status, 404);
  // Sem processo (teste), a instancia esta parada: 503, e nao 401.
  assert.equal((await j('/instances/vendas/api/status', { headers: { authorization: 'Bearer ' + token } })).status, 503);
  assert.equal((await j('/instances/vendas/api/status', { headers: { apikey: 'chave-global' } })).status, 503);

  const pagina = await fetch(base + '/');
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /instâncias/);
  assert.equal((await j('/healthz')).status, 503, 'instancia habilitada e parada reprova o healthz');

  assert.equal((await j('/manager/instances/vendas', { method: 'DELETE', headers: { apikey: 'chave-global' } })).status, 200);
  assert.equal((await j('/manager/instances/vendas', { headers: { apikey: 'chave-global' } })).status, 404);
});

test('rotas no estilo Evolution: create/fetchInstances/connectionState/webhook/call', async t => {
  const dir = pasta();
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: 'k', semProcessos: true, verbose: false });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  const j = async (rota, op = {}) => { const r = await fetch(base + rota, op); return { status: r.status, corpo: await r.json().catch(() => ({})) }; };
  const admin = { apikey: 'k', 'content-type': 'application/json' };

  const c = await j('/instance/create', { method: 'POST', headers: admin, body: JSON.stringify({ instanceName: 'vendas', webhook: 'https://exemplo.test/hook' }) });
  assert.equal(c.status, 201);
  assert.equal(c.corpo.instance.instanceName, 'vendas');
  assert.equal(c.corpo.instance.state, 'close', 'sem processo = close');
  const token = c.corpo.hash.apikey; assert.ok(token);
  assert.equal(c.corpo.instance.webhook.url, 'https://exemplo.test/hook');
  assert.equal(c.corpo.instance.webhook.enabled, true);

  const lista = await j('/instance/fetchInstances', { headers: { apikey: 'k' } });
  assert.equal(lista.status, 200); assert.equal(lista.corpo[0].instance.instanceName, 'vendas');
  assert.equal((await j('/instance/fetchInstances', { headers: { apikey: token } })).status, 401, 'token da instancia nao lista');

  const st = await j('/instance/connectionState/vendas', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(st.status, 200); assert.equal(st.corpo.instance.state, 'close');

  const wf = await j('/webhook/find/vendas', { headers: { apikey: token } });
  assert.equal(wf.status, 200); assert.ok(wf.corpo.events.includes('call_ended'));
  const ws = await j('/webhook/set/vendas', { method: 'POST', headers: { apikey: token, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'ftp://x', events: ['call_ended'] }) });
  assert.equal(ws.status, 400, 'url sem http e recusada');
  const ws2 = await j('/webhook/set/vendas', { method: 'POST', headers: { apikey: token, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1:1/hook', events: ['call_ended'] }) });
  assert.equal(ws2.status, 200); assert.deepEqual(ws2.corpo.webhook.events, ['call_ended']);

  assert.equal((await j('/call/offer/vendas', { method: 'POST', headers: { apikey: token, 'content-type': 'application/json' }, body: '{"number":"5565999999999"}' })).status, 503, 'instancia parada');
  assert.equal((await j('/call/offer/outra', { method: 'POST', headers: admin, body: '{}' })).status, 404);
  assert.equal((await j('/docs')).status, 200);
  assert.equal((await j('/instance/delete/vendas', { method: 'DELETE', headers: { apikey: token } })).status, 401, 'apagar e so da chave global');
  assert.equal((await j('/instance/delete/vendas', { method: 'DELETE', headers: admin })).status, 200);
});

test('chave global na URL e recusada; token de instancia na URL vale so para a propria', async t => {
  const dir = pasta();
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: 'segredo', semProcessos: true, verbose: false });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  const st = async (rota, op) => (await fetch(base + rota, op)).status;
  assert.equal(await st('/manager/instances?token=segredo'), 401, 'chave global via URL nao entra');
  assert.equal(await st('/manager/instances?apikey=segredo'), 401);
  assert.equal(await st('/manager/instances', { headers: { apikey: 'segredo' } }), 200);
  const r = await fetch(base + '/instance/create', { method: 'POST', headers: { apikey: 'segredo', 'content-type': 'application/json' }, body: '{"instanceName":"a"}' });
  const token = (await r.json()).hash.apikey;
  assert.equal(await st('/instance/connectionState/a?token=' + token), 200, 'token da instancia na URL abre a propria');
  assert.equal(await st('/instance/connectionState/a?token=segredo'), 401, 'chave global na URL nao abre nem instancia');
  assert.equal(await st('/instance/fetchInstances?token=' + token), 401);
});

test('sistema, config (chave mascarada) e autoteste de instancia parada', async t => {
  const dir = pasta();
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: 'chave-muito-secreta', semProcessos: true, verbose: false });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  const j = async (rota, op = {}) => { const r = await fetch(base + rota, { headers: { apikey: 'chave-muito-secreta', 'content-type': 'application/json' }, ...op }); return { status: r.status, corpo: await r.json() }; };
  const sys = await j('/manager/system');
  assert.equal(sys.status, 200); assert.ok(sys.corpo.memTotalMb > 0); assert.ok(Array.isArray(sys.corpo.instancias));
  const cfg = await j('/manager/config');
  assert.equal(cfg.status, 200);
  assert.ok(!JSON.stringify(cfg.corpo).includes('chave-muito-secreta'), 'a chave nunca sai inteira');
  assert.equal(cfg.corpo.apiKeyMascarada, 'chav…eta');
  await j('/manager/instances', { method: 'POST', body: '{"name":"x"}' });
  const st = await j('/manager/instances/x/selftest', { method: 'POST', body: '{}' });
  assert.equal(st.status, 200); assert.equal(st.corpo.ok, false); assert.equal(st.corpo.itens[0].nome, 'processo');
});

test('gerenciar o canal de fora: /instance/update e /instance/token (chave global)', async t => {
  const dir = pasta();
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: 'k', semProcessos: true, verbose: false });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  const j = async (rota, op = {}) => { const r = await fetch(base + rota, op); return { status: r.status, corpo: await r.json() }; };
  const admin = { apikey: 'k', 'content-type': 'application/json' };
  const c = await j('/instance/create', { method: 'POST', headers: admin, body: '{"instanceName":"crm"}' });
  const token = c.corpo.hash.apikey;
  const u = await j('/instance/update/crm', { method: 'POST', headers: admin, body: JSON.stringify({ channel: 'Financeiro', webhook: 'https://crm.exemplo/hook' }) });
  assert.equal(u.status, 200); assert.equal(u.corpo.instance.channel, 'Financeiro'); assert.equal(u.corpo.instance.webhook.url, 'https://crm.exemplo/hook');
  assert.equal((await j('/instance/update/crm', { method: 'POST', headers: { apikey: token, 'content-type': 'application/json' }, body: '{"channel":"x"}' })).status, 401, 'token da instancia nao administra');
  const tk = await j('/instance/token/crm', { method: 'POST', headers: admin, body: '{}' });
  assert.equal(tk.status, 200); assert.notEqual(tk.corpo.hash.apikey, token);
  assert.equal((await j('/instance/connectionState/crm', { headers: { apikey: token } })).status, 401, 'token antigo morreu');
  assert.equal((await j('/instance/connectionState/crm', { headers: { apikey: tk.corpo.hash.apikey } })).status, 200);
});

test('ciclo de vida: filha morta por sinal conta como parada e sobe de novo ao ligar', async t => {
  const dir = pasta();
  // Processo inerte no lugar do app.mjs: o que esta em teste e o gerente.
  const g = await iniciarGerente({ port: 0, dataDir: dir, apiKey: 'k', verbose: false, comando: [process.execPath, '-e', 'setInterval(() => {}, 1000)'] });
  t.after(async () => { await g.parar(); rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + g.port;
  const adm = { apikey: 'k', 'content-type': 'application/json' };
  const j = async (rota, op = {}) => { const r = await fetch(base + rota, op); return { status: r.status, corpo: await r.json().catch(() => ({})) }; };
  const criada = await j('/manager/instances', { method: 'POST', headers: adm, body: JSON.stringify({ name: 'x' }) });
  assert.equal(criada.status, 201);
  const pid1 = criada.corpo.instance.pid;
  assert.ok(pid1 > 0, 'subiu com pid');
  // Desligar: o processo inerte nao trata SIGTERM e morre POR SINAL (exitCode nulo).
  const off = await j('/manager/instances/x', { method: 'PATCH', headers: adm, body: JSON.stringify({ enabled: false }) });
  assert.equal(off.status, 200);
  assert.equal(off.corpo.instance.running, false, 'morta por sinal = parada');
  assert.equal(off.corpo.instance.pid, null);
  const on = await j('/manager/instances/x', { method: 'PATCH', headers: adm, body: JSON.stringify({ enabled: true }) });
  assert.equal(on.corpo.instance.running, true, 'ligar sobe de novo');
  assert.notEqual(on.corpo.instance.pid, pid1, 'pid novo');
  const re = await j('/manager/instances/x/restart', { method: 'POST', headers: adm, body: '{}' });
  assert.equal(re.status, 200);
  const depois = await j('/manager/instances/x/status', { headers: adm });
  assert.equal(depois.corpo.running, true);
  assert.notEqual(depois.corpo.pid, on.corpo.instance.pid, 'reiniciar troca o pid');
  const logs = (await j('/manager/instances/x/logs', { headers: adm })).corpo.logs;
  assert.ok(logs.some(l => /SIGTERM/.test(l)), 'o log registra a saida por sinal');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { criarServidor } from '../src/server.mjs';

test('API rejects invalid call actions and broadcasts pairing changes', async t => {
  const server = criarServidor({ port: 0, token: 'test-token' });
  await server.ouvir();
  t.after(() => server.fechar());
  server.ligarAcoes({});
  const base = `http://127.0.0.1:${server.port}`;
  assert.equal((await fetch(base + '/api/status')).status, 401);
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=test-token&clientId=test');
  await once(ws, 'open');
  const message = once(ws, 'message');
  server.definirConta({ connected: true, jid: 'test@c.us' });
  assert.equal(JSON.parse((await message)[0]).type, 'status');
  server.aplicarEvento({ type: 'call', call: { status: 'ringing' } });
  assert.equal(server.chamadas.size, 0);
  const response = await fetch(base + '/api/calls/missing/hangup', {
    method: 'POST', headers: { authorization: 'Bearer test-token' }, body: '{}',
  });
  assert.equal(response.status, 404);
  const malformedHost = await new Promise((resolve, reject) => {
    const req = request(base + '/healthz', { headers: { host: '[' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(malformedHost, 200);
});

test('corpo HTTP acima do limite responde 413 e o servidor continua servindo', async t => {
  const server = criarServidor({ port: 0, token: '' });
  await server.ouvir();
  t.after(() => server.fechar());
  server.ligarAcoes({});
  const base = `http://127.0.0.1:${server.port}`;
  const grande = await fetch(base + '/api/calls', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'x'.repeat(200000) }),
  });
  assert.equal(grande.status, 413);
  assert.equal((await grande.json()).error, 'payload_too_large');
  const depois = await fetch(base + '/api/calls', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(depois.status, 400);
});

test('midia de subida vem de UM socket: o dono da chamada; os outros sao descartados', async t => {
  const server = criarServidor({ port: 0, token: '' });
  await server.ouvir();
  t.after(() => server.fechar());
  server.ligarAcoes({});
  const base = `ws://127.0.0.1:${server.port}`;
  const pagina = new WebSocket(base + '/page');
  const dono = new WebSocket(base + '/ws?clientId=dono');
  const outro = new WebSocket(base + '/ws?clientId=outro');
  await Promise.all([once(pagina, 'open'), once(dono, 'open'), once(outro, 'open')]);
  const recebidos = [];
  pagina.on('message', (d, bin) => { if (bin) recebidos.push(Buffer.from(d)[3]); });
  const quadro = (marca) => Buffer.from([1, 0, 0, marca]);
  const tique = () => new Promise(r => setTimeout(r, 60));

  outro.send(quadro(9)); await tique();
  assert.equal(recebidos.length, 0, 'sem chamada, nada sobe');

  server.aplicarEvento({ type: 'call', call: { callId: 'c1', direction: 'outbound', status: 'ringing' } });
  server.chamadas.get('c1').owner = 'dono';
  outro.send(quadro(1)); dono.send(quadro(2)); outro.send(quadro(3)); await tique();
  assert.deepEqual(recebidos, [2], 'so o dono sobe');
  assert.equal(server.descartes.midiaDeOutroSocket, 2);

  server.aplicarEvento({ type: 'call', call: { callId: 'c1', direction: 'outbound', status: 'ended' } });
  dono.send(quadro(4)); await tique();
  assert.deepEqual(recebidos, [2], 'chamada encerrada solta a fonte e nada sobe');
  for (const ws of [pagina, dono, outro]) ws.close();
});

test('config do encoder e pedido de keyframe atravessam somente entre pagina e dono', async t => {
  const server = criarServidor({ port: 0, token: '' });
  await server.ouvir();
  t.after(() => server.fechar());
  server.ligarAcoes({});
  const base = `ws://127.0.0.1:${server.port}`;
  const pagina = new WebSocket(base + '/page');
  const dono = new WebSocket(base + '/ws?clientId=dono');
  const outro = new WebSocket(base + '/ws?clientId=outro');
  await Promise.all([once(pagina, 'open'), once(dono, 'open'), once(outro, 'open')]);
  server.aplicarEvento({ type: 'call', call: { callId: 'v1', direction: 'outbound', status: 'ringing' } });
  server.chamadas.get('v1').owner = 'dono';

  const esperar = (ws, filtro, rotulo) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', ler); reject(new Error(rotulo + ' nao chegou')); }, 1000);
    const ler = (d, bin) => {
      let valor = d;
      if (!bin) { try { valor = JSON.parse(d.toString()); } catch {} }
      if (!filtro(valor, bin)) return;
      clearTimeout(timer); ws.off('message', ler); resolve(valor);
    };
    ws.on('message', ler);
  });

  const configNaPagina = esperar(pagina, (m, bin) => !bin && m.type === 'media-config', 'media-config');
  outro.send(JSON.stringify({ type: 'media-config', kind: 'video', codec: 'avc1.42E01E', width: 320, height: 180, frameRate: 15 }));
  dono.send(JSON.stringify({ type: 'media-config', kind: 'video', codec: 'avc1.42E01E', width: 640, height: 360, frameRate: 24 }));
  assert.equal((await configNaPagina).width, 640, 'config de outro cliente nao chega');

  const pedidoNoDono = esperar(dono, (m, bin) => !bin && m.type === 'media-control', 'pedido da pagina');
  pagina.send(JSON.stringify({ type: 'media-control', action: 'request-keyframe', reason: 'decoder-backpressure' }));
  assert.equal((await pedidoNoDono).action, 'request-keyframe');

  // Uma pagina/decoder novo nunca recebe delta solto; pede IDR e so entao
  // libera o GOP. Isso cobre tambem reconexao em producao.
  const pedidoPorDelta = esperar(dono, (m, bin) => !bin && m.reason === 'relay-waiting-keyframe', 'pedido por delta');
  dono.send(Buffer.from([2, 0, 0, 0, 1]));
  await pedidoPorDelta;
  const keyNaPagina = esperar(pagina, (d, bin) => bin && d[0] === 2 && (d[1] & 1), 'keyframe');
  dono.send(Buffer.from([2, 1, 0, 0, 2]));
  await keyNaPagina;

  for (const ws of [pagina, dono, outro]) ws.close();
});

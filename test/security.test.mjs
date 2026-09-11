// As regras de seguranca compartilhadas, sem servidor: comparacao em tempo
// constante, limite de falhas por IP, lista de origens, cabecalhos e mascara.
import test from 'node:test';
import assert from 'node:assert/strict';
import { credencialConfere, criarLimitador, listaDeOrigens, origemPermitida, cabecalhosDeSeguranca, mascarar } from '../src/security.mjs';
import { normalizar } from '../src/phone.mjs';

test('credencialConfere: igual, diferente, vazio e tipos errados', () => {
  assert.equal(credencialConfere('abc', 'abc'), true);
  assert.equal(credencialConfere('abc', 'abd'), false);
  assert.equal(credencialConfere('ab', 'abc'), false, 'tamanho diferente nao explode');
  assert.equal(credencialConfere('', ''), false, 'segredo vazio nunca confere');
  assert.equal(credencialConfere(undefined, 'x'), false);
  assert.equal(credencialConfere('x', null), false);
});

test('limitador: bloqueia depois do limite, esquece na janela, sucesso zera', () => {
  let agora = 1_000_000;
  const original = Date.now; Date.now = () => agora;
  try {
    const l = criarLimitador({ maxFalhas: 3, janelaMs: 1000 });
    l.falhou('ip'); l.falhou('ip');
    assert.equal(l.bloqueado('ip'), false);
    l.falhou('ip');
    assert.equal(l.bloqueado('ip'), true);
    assert.equal(l.bloqueado('outro'), false);
    agora += 1001;
    assert.equal(l.bloqueado('ip'), false, 'janela passou');
    l.falhou('ip'); l.falhou('ip'); l.falhou('ip');
    assert.equal(l.bloqueado('ip'), true);
    l.sucesso('ip');
    assert.equal(l.bloqueado('ip'), false, 'credencial certa limpa o contador');
  } finally { Date.now = original; }
});

test('limitador: memoria limitada mesmo sob ataque distribuido', () => {
  const l = criarLimitador({ maxChaves: 100 });
  for (let i = 0; i < 500; i++) l.falhou('ip-' + i);
  assert.ok(l.tamanho <= 100, 'tamanho ' + l.tamanho);
});

test('origens: sem lista tudo passa; com lista so quem esta nela (e quem nao manda Origin)', () => {
  assert.deepEqual(listaDeOrigens(' https://a.com/, https://b.com ,, '), ['https://a.com', 'https://b.com']);
  assert.equal(origemPermitida('https://qualquer.com', []), true);
  const lista = listaDeOrigens('https://crm.exemplo');
  assert.equal(origemPermitida('https://crm.exemplo', lista), true);
  assert.equal(origemPermitida('https://crm.exemplo/', lista), true);
  assert.equal(origemPermitida('https://mal.exemplo', lista), false);
  assert.equal(origemPermitida(undefined, lista), true, 'curl e backends nao mandam Origin');
});

test('cabecalhos: Referer nunca sai, HTML ganha CSP sem CDN e nunca vai em iframe', () => {
  const h = cabecalhosDeSeguranca({ html: true });
  assert.equal(h['referrer-policy'], 'no-referrer');
  assert.equal(h['x-frame-options'], 'DENY');
  assert.match(h['content-security-policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(h['content-security-policy'], /cdn|https:\/\//, 'paginas sao autocontidas');
  const j = cabecalhosDeSeguranca({ corsOrigin: null });
  assert.equal(j['access-control-allow-origin'], undefined, 'com lista de origens nao ha CORS aberto');
  assert.equal(j['content-security-policy'], undefined);
});

test('mascarar nunca devolve o segredo inteiro', () => {
  const s = 'N18c9yABCDEFGHIJKLMNOPQRSTUVWX';
  const m = mascarar(s);
  assert.notEqual(m, s); assert.ok(m.length < 12); assert.ok(!m.includes(s.slice(4, -3)));
  assert.equal(mascarar('curto'), '••••');
});

test('normalizar: DDI vem da configuracao, nunca de um chute', () => {
  assert.deepEqual(normalizar('11999999999', '55').numero, '5511999999999');
  assert.equal(normalizar('5511999999999', '55').valido, true);
  assert.equal(normalizar('11999999999', '').valido, false, 'sem DDI configurado, numero nacional e recusado');
  assert.equal(normalizar('14155550123', '').valido, false);
  assert.equal(normalizar('14155550123', '1').numero, '14155550123', 'ja tem o DDI 1 (11 digitos): passa');
  assert.equal(normalizar('+55 (65) 9999-9999', '55').numero, '556599999999');
  assert.equal(normalizar('4915112345678', '').valido, true, 'internacional inteiro passa sem DDI padrao');
  assert.equal(normalizar('', '55').valido, false);
  assert.equal(normalizar('123', '55').valido, false);
});

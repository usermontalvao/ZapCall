// Regras de seguranca compartilhadas pelo gerente e por cada instancia.
//
// Nada aqui depende de HTTP: sao funcoes puras (ou quase) para dar para
// testar sem subir servidor nenhum. O que vale para os dois processos:
//
//   - credencial conferida em TEMPO CONSTANTE (nada de `===` em segredo);
//   - falhas de autenticacao limitadas por IP (forca bruta vira 429);
//   - cabecalhos que impedem o token de vazar por Referer e a pagina de ser
//     embutida em outro site;
//   - `Origin` conferido no WebSocket e no CORS quando o operador restringe.
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * `a === b` sem vazar o tamanho nem o prefixo pelo tempo de resposta. As
 * duas strings viram hash do mesmo tamanho antes da comparacao — assim a
 * comparacao e sempre sobre 32 bytes, seja qual for o tamanho do segredo.
 */
export function credencialConfere(apresentada, esperada) {
  if (typeof apresentada !== 'string' || typeof esperada !== 'string' || !esperada) return false;
  const a = createHash('sha256').update(apresentada).digest();
  const b = createHash('sha256').update(esperada).digest();
  return timingSafeEqual(a, b);
}

/**
 * Limitador de falhas por chave (o IP). `falhou(chave)` registra uma falha e
 * `bloqueado(chave)` diz se a chave estourou o limite na janela. Sucesso
 * limpa o contador. Memoria limitada: chaves velhas sao esquecidas.
 */
export function criarLimitador({ maxFalhas = 20, janelaMs = 60_000, maxChaves = 10_000 } = {}) {
  const falhas = new Map(); // chave -> { n, desde }
  const agora = () => Date.now();
  const podar = () => {
    if (falhas.size < maxChaves) return;
    const limite = agora() - janelaMs;
    for (const [k, v] of falhas) if (v.desde < limite) falhas.delete(k);
    // Ainda cheio (ataque distribuido): esquece a metade mais antiga.
    if (falhas.size >= maxChaves) for (const k of [...falhas.keys()].slice(0, Math.floor(maxChaves / 2))) falhas.delete(k);
  };
  return {
    bloqueado(chave) {
      const r = falhas.get(chave);
      if (!r) return false;
      if (agora() - r.desde > janelaMs) { falhas.delete(chave); return false; }
      return r.n >= maxFalhas;
    },
    falhou(chave) {
      podar();
      const r = falhas.get(chave);
      if (!r || agora() - r.desde > janelaMs) falhas.set(chave, { n: 1, desde: agora() });
      else r.n += 1;
    },
    sucesso(chave) { falhas.delete(chave); },
    get tamanho() { return falhas.size; },
  };
}

/** `ALLOWED_ORIGINS="https://a.com, https://b.com"` -> lista; vazio = qualquer. */
export function listaDeOrigens(texto) {
  return String(texto || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

/**
 * O `Origin` do pedido e aceito? Sem lista, qualquer um (inclusive nenhum:
 * curl e backends nao mandam Origin). Com lista, so quem esta nela — e
 * pedidos SEM Origin continuam passando, porque nao vem de navegador.
 */
export function origemPermitida(origin, lista) {
  if (!lista || !lista.length) return true;
  if (!origin) return true;
  return lista.includes(String(origin).replace(/\/+$/, ''));
}

/**
 * Cabecalhos de seguranca das respostas. `Referrer-Policy: no-referrer` e o
 * mais importante: o token da instancia vive na URL do discador e da pagina
 * de pareamento, e sem isto ele iria no Referer de qualquer link clicado.
 */
export function cabecalhosDeSeguranca({ html = false, corsOrigin = '*' } = {}) {
  const h = {
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cache-control': 'no-store',
  };
  if (corsOrigin) h['access-control-allow-origin'] = corsOrigin;
  if (html) {
    // Paginas sao autocontidas (sem CDN): tudo vem do proprio servico. `data:`
    // e para o PNG do QR; `blob:` em script-src/worker-src para os worklets
    // de audio (addModule recebe uma URL de blob); ws/wss para a midia e os
    // eventos. Sem 'unsafe-eval': nenhuma pagina avalia string.
    h['content-security-policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: http: https:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  }
  return h;
}

/** Mascara um segredo para log e tela: `abcd…xyz`. Nunca devolve o valor inteiro. */
export function mascarar(segredo) {
  const s = String(segredo || '');
  // Chave curta mascarada "abcd…xyz" seria a chave inteira: nada aparece.
  if (s.length < 16) return '••••';
  return s.slice(0, 4) + '…' + s.slice(-3);
}

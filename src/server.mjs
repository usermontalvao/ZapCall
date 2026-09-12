// A API de UMA instancia: HTTP + WebSocket. O vocabulario (call rows, eventos
// incoming_call/call_active/call_ended, midia binaria no mesmo socket) foi
// desenhado para um CRM ja existente e por isso e estavel: quem integra
// escreve contra ele uma vez.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { paraPng, paraTerminal } from './qr.mjs';
import { normalizar } from './phone.mjs';
import { preludio } from './page/worklets.mjs';
import { credencialConfere, criarLimitador, cabecalhosDeSeguranca, origemPermitida, listaDeOrigens } from './security.mjs';
import { configurarMidia } from './media-config.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

const KIND_AUDIO = 1;
const KIND_VIDEO = 2;
const HEADER = 4;

/** Chamadas encerradas guardadas para consulta: acima disto, as mais velhas saem. */
const MAX_ENCERRADAS = 100;
/** Uma chamada encerrada ha mais de 1 h nao interessa mais a ninguem. */
const ENCERRADA_TTL_MS = 60 * 60 * 1000;

/** Motivos de fim que significam "ninguem atendeu" — o CRM decide por eles. */
export function nuncaAtendeu(reason) {
  return ['rejected', 'declined', 'missed', 'timeout', 'busy', 'no_answer']
    .includes(String(reason || '')) || String(reason || '').endsWith('_elsewhere');
}

export function criarServidor(opcoes) {
  const {
    port, host = '127.0.0.1', token = '', verbose = false,
    // DDI acrescentado a numeros nacionais (10-11 digitos). Vazio = nenhum palpite.
    countryCode = process.env.DEFAULT_COUNTRY_CODE || '',
    // Origens de navegador aceitas no WebSocket e no CORS. Vazio = qualquer.
    allowedOrigins = listaDeOrigens(process.env.ALLOWED_ORIGINS),
  } = opcoes;
  const mediaConfig = configurarMidia(opcoes.mediaConfig || process.env);

  const log = (...a) => { if (verbose) console.log('[servidor]', ...a); };
  const origens = Array.isArray(allowedOrigins) ? allowedOrigins : listaDeOrigens(allowedOrigins);
  const corsOrigin = origens.length ? null : '*';
  /** 401 repetidos do mesmo IP viram 429 por um minuto. */
  const limitador = criarLimitador();
  const ipDe = (req) => String((req.socket && req.socket.remoteAddress) || '');

  /** Ligado depois, em app.mjs: o navegador nao existe quando o servidor nasce. */
  let acoes = null;
  /** Pergunta ao app se o navegador esta vivo (ver /healthz). */
  let sondaDeVida = () => true;
  /** Avisa o app que alguem esta ativamente tentando parear. */
  let aoPedirQr = () => {};
  let conta = { connected: false, jid: null, pushName: 'ZapCall', phone: null };

  /** callId -> CallRow (a forma que o CRM le). */
  const chamadas = new Map();
  /** Clientes atachados (backends, discador): ws -> clientId. */
  const clientes = new Map();
  /**
   * O socket da PAGINA — o que recebe a midia do operador.
   *
   * Nao e "o ultimo que conectou". Os scripts sao injetados por DOCUMENTO
   * (Page.addScriptToEvaluateOnNewDocument), e o WhatsApp Web abre iframes
   * passageiros: cada um roda o inject e abre o proprio /page. Medido em
   * 11/09/2026: a pagina principal dizia `ponte.aberta` e mandava 47 mil
   * quadros, enquanto o servidor contava `semPagina` em todos os quadros do
   * operador — o iframe conectou depois, virou `pagina`, fechou, e o servidor
   * zerou a referencia mesmo com o socket principal vivo. Voz e camera do
   * operador nao chegavam ao celular, sem erro em lugar nenhum.
   *
   * Regra: todos os sockets de pagina ficam em `paginas`; quem MANDA midia e
   * a pagina de verdade (iframe nao tem microfone nem chamada) e passa a ser
   * `pagina`; ao fechar, cai para qualquer outro socket vivo.
   */
  let pagina = null;
  const paginas = new Set();
  /**
   * O UNICO socket cuja midia sobe para a pagina durante a chamada.
   *
   * Medido em 10/09/2026: duas abas do discador (mesmo clientId, uma sem
   * recarregar) mandavam video ao mesmo tempo, 640x480 e 1280x720
   * intercalados no MESMO decoder da pagina — um erro por segundo, decoder
   * recriado, 1 fps no celular. A fonte e travada no primeiro socket que
   * envia com a chamada de pe e solta quando ela acaba.
   */
  let fonteMidia = null;
  const descartes = {
    midiaDeOutroSocket: 0,
    videoPorFila: 0,
    audioPorFila: 0,
    videoSemKeyframe: 0,
    semPagina: 0,
  };
  let paginaEsperaKeyframe = true;

  /**
 * Toda acao no navegador tem prazo. Sem isto, `WPP.call.offer` numa sessao nao
 * pareada nao resolve NUNCA e a requisicao fica pendurada ate o protocolTimeout
 * do CDP (2 min) — o CRM leria isso como servico morto.
 */
  async function comPrazo(promessa, ms, rotulo) {
    let timer;
    try { return await Promise.race([
      promessa,
      new Promise((_, erro) => { timer = setTimeout(() => erro(new Error('prazo esgotado: ' + rotulo)), ms); }),
    ]); } finally { clearTimeout(timer); }
  }

  function retrato() {
    return {
      connected: !!conta.connected,
      jid: conta.jid || null,
      pushName: conta.pushName || 'ZapCall',
      phone: conta.phone || null,
      activeCalls: [...chamadas.values()].filter(c => c.status !== 'ended').length,
    };
  }

  function emitir(tipo, extra = {}) {
    const msg = JSON.stringify({ type: tipo, ...extra });
    for (const ws of clientes.keys()) { try { ws.send(msg); } catch {} }
  }

  function linhaParaCRM(linha, anterior) {
    const agora = Date.now();
    const base = anterior || {
      callId: linha.callId,
      direction: linha.direction,
      owner: null,
      muted: false,
      startedAt: Number(linha.offerTime) || agora,
      acceptedAt: null,
      endedAt: null,
    };
    const status = linha.status;
    return {
      ...base,
      direction: linha.direction || base.direction,
      status,
      peer: linha.peer || '',
      // A pagina so sabe o LID; o numero DISCADO fica guardado no POST /api/calls
      // e nao pode ser apagado por uma atualizacao de estado sem telefone.
      phone: linha.phone || base.phone || null,
      lid: linha.lid || null,
      isVideo: !!linha.isVideo,
      // MVP: o WhatsApp Web nao expoe no CallModel quem esta com a camera no
      // ar; enquanto isso, a chamada de video conta como video nos dois lados.
      videoActive: !!linha.isVideo,
      peerVideo: !!linha.isVideo,
      // Atendimento e o ACTIVE do proprio WhatsApp Web, nunca a subida da midia.
      acceptedAt: status === 'active' ? (base.acceptedAt || agora) : base.acceptedAt,
      endedAt: status === 'ended' ? (base.endedAt || agora) : null,
      endReason: status === 'ended' ? (linha.endReason || 'terminate') : null,
      raw: linha.raw || null,
    };
  }

  /**
   * O mapa de chamadas nao pode crescer para sempre: um processo que fica
   * semanas no ar guardaria todas as chamadas da vida. Ficam as ativas, as
   * ultimas MAX_ENCERRADAS e nada encerrado ha mais de uma hora.
   */
  function podarEncerradas() {
    const agora = Date.now();
    const encerradas = [...chamadas.values()].filter(c => c.status === 'ended').sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
    let sobrando = encerradas.length - MAX_ENCERRADAS;
    for (const c of encerradas) {
      const velha = c.endedAt && agora - c.endedAt > ENCERRADA_TTL_MS;
      if (sobrando > 0 || velha) { chamadas.delete(c.callId); sobrando -= 1; }
    }
  }

  /** O que o navegador reporta -> estado + evento para o CRM. */
  function aplicarEvento(ev) {
    if (!ev || typeof ev !== 'object') return;

    if (ev.type === 'wpp-ready' && ev.account) {
      conta = { ...conta, ...ev.account };
      emitir('status', { status: retrato() });
      return;
    }

    if (ev.type === 'call' && ev.call) {
      if (typeof ev.call.callId !== 'string' || !ev.call.callId) return;
      const anterior = chamadas.get(ev.call.callId);
      const linha = linhaParaCRM(ev.call, anterior);
      chamadas.set(linha.callId, linha);

      const virouAtiva = linha.status === 'active' && (!anterior || anterior.status !== 'active');
      const terminou = linha.status === 'ended' && (!anterior || anterior.status !== 'ended');
      if (!anterior && linha.status !== 'ended') paginaEsperaKeyframe = true;
      if (terminou && ![...chamadas.values()].some(c => c.status !== 'ended')) {
        fonteMidia = null;
        paginaEsperaKeyframe = true;
      }
      if (terminou) podarEncerradas();

      if (!anterior && linha.direction === 'inbound' && linha.status === 'ringing') {
        emitir('incoming_call', { call: linha });
      } else if (!anterior && linha.direction === 'outbound') {
        emitir('outgoing_call', { call: linha });
      } else if (terminou) {
        emitir('call_ended', { call: linha });
      } else if (virouAtiva) {
        emitir('call_active', { call: linha });
      } else {
        emitir('call_update', { call: linha });
      }
      return;
    }

    // Mensagens/presenca no formato Evolution: repassa cru ao CRM.
    if (ev.type === 'wa' && ev.event) { emitir(ev.event, { data: ev.data }); return; }

    log('evento da pagina', ev.type, ev);
  }

  // ------------------------------------------------------------------- HTTP
  /** Token valido em header (`Authorization: Bearer`) ou, para paginas, em `?token=`. */
  function tokenConfere(valor) { return !token || credencialConfere(String(valor || ''), token); }
  function autorizado(req) {
    if (!token) return true;
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') && credencialConfere(h.slice(7), token);
  }

  function json(res, code, corpo) {
    const texto = JSON.stringify(corpo);
    res.writeHead(code, {
      ...cabecalhosDeSeguranca({ corsOrigin }),
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-headers': 'authorization,content-type,x-client-id',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'content-length': Buffer.byteLength(texto),
    });
    res.end(texto);
  }
  function html(res, corpo) {
    res.writeHead(200, { ...cabecalhosDeSeguranca({ html: true, corsOrigin: null }), 'content-type': 'text/html; charset=utf-8' });
    res.end(corpo);
  }
  /** Um 401 que conta para o limite do IP. */
  function negar(res, req) {
    const ip = ipDe(req);
    limitador.falhou(ip);
    return json(res, limitador.bloqueado(ip) ? 429 : 401, limitador.bloqueado(ip) ? { error: 'too_many_attempts', message: 'muitas falhas de autenticacao; aguarde um minuto' } : { error: 'unauthorized' });
  }

  /** Corpo maximo: chamadas sao bytes; so a midia em base64 (rpc) chega a dezenas de MB. */
  const CORPO_MAX = 64 * 1024;
  const CORPO_MAX_MIDIA = 64 * 1024 * 1024;
  class CorpoGrande extends Error { constructor(max) { super('corpo maior que ' + max + ' bytes'); this.code = 'payload_too_large'; } }

  async function corpoDe(req, max = CORPO_MAX) {
    const pedacos = [];
    let total = 0;
    for await (const p of req) {
      total += p.length;
      if (total > max) throw new CorpoGrande(max);
      pedacos.push(p);
    }
    if (!pedacos.length) return {};
    try { return JSON.parse(Buffer.concat(pedacos).toString('utf8')); } catch { return {}; }
  }

  const http = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return json(res, 400, { error: 'invalid_url' }); }
    const rota = url.pathname;

    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (!origemPermitida(req.headers.origin, origens)) return json(res, 403, { error: 'origin_not_allowed' });
    if (limitador.bloqueado(ipDe(req))) return json(res, 429, { error: 'too_many_attempts', message: 'muitas falhas de autenticacao; aguarde um minuto' });
    if (rota === '/healthz') {
      // Pagina morta e servico inutil: o healthcheck TEM de reprovar, senao o
      // container fica verde sem servir para nada.
      const viva = sondaDeVida();
      return json(res, viva ? 200 : 503, { ok: viva, pagina: viva ? 'viva' : 'morta', uptime: process.uptime() });
    }

    // Pagina de autoteste da midia. Precisa ser http://127.0.0.1 (contexto
    // seguro) para o getUserMedia existir.
    if (rota === '/probe') return html(res, PAGINA_PROBE);

    // Arquivos publicos (sem credencial): a casca compartilhada e os worklets
    // de audio — os MESMOS que a pagina do WhatsApp usa do outro lado.
    const estatico = await servirEstatico(rota);
    if (estatico) {
      res.writeHead(200, { ...cabecalhosDeSeguranca({ corsOrigin }), 'content-type': estatico.tipo });
      return res.end(estatico.corpo);
    }

    // Discador de teste. Fala a MESMA API que o cliente vai falar — e por
    // isso que ele serve de bancada: o que funcionar aqui funciona la.
    if (rota === '/dialer' || rota === '/discador') {
      if (!tokenConfere(url.searchParams.get('token'))) return negar(res, req);
      const pagina = await readFile(join(AQUI, 'page', 'dialer.html'), 'utf8');
      return html(res, pagina.replace('__ZC_MEDIA_CONFIG__', JSON.stringify(mediaConfig)));
    }

    // Pagina de pareamento: QR sempre atual, sem abrir Chrome nenhum.
    // Com token configurado ela EXIGE o token (QR de pareamento aberto na
    // internet e conta vinculada por qualquer um).
    if (rota === '/pair') {
      if (!tokenConfere(url.searchParams.get('token'))) return negar(res, req);
      return html(res, PAGINA_PAREAMENTO);
    }

    if (!autorizado(req)) return negar(res, req);
    limitador.sucesso(ipDe(req));
    if (!acoes) return json(res, 503, { error: 'browser_not_ready' });

    const clientId = String(req.headers['x-client-id'] || '') || null;

    try {
      if (rota === '/api/status' && req.method === 'GET') return json(res, 200, retrato());

      if (rota === '/api/calls' && req.method === 'GET') {
        return json(res, 200, { calls: [...chamadas.values()] });
      }

      if (rota === '/api/calls' && req.method === 'POST') {
        const { to, video } = await corpoDe(req);
        if (!to) return json(res, 400, { error: 'missing_to' });
        // O 55 entra AQUI, um lugar so. Sem DDI a oferta volta vazia e a
        // chamada nem nasce — ver src/phone.mjs.
        const alvo = normalizar(to, countryCode);
        if (!alvo.valido) return json(res, 400, { error: 'numero_invalido', motivo: alvo.motivo, numero: alvo.numero });
        // Sessao caida = nao ha para onde discar. Recusar aqui e mais honesto
        // do que deixar o WhatsApp Web engolir a chamada em silencio.
        if (!conta.connected) return json(res, 409, { error: 'not_paired', status: retrato() });
        const r = await comPrazo(acoes.dial(alvo.numero, !!video), 20000, 'dial');
        if (!r || !r.callId) {
          return json(res, 502, {
            error: 'sem_chamada',
            numero: alvo.numero,
            // O motivo REAL, vindo da pagina: sem isto o 502 so dizia
            // "no_call_id" e nao havia por onde comecar.
            motivo: (r && r.erro) || 'o WhatsApp Web aceitou a oferta mas nenhuma chamada apareceu',
            detalhe: r || null,
          });
        }
        const linha = chamadas.get(r.callId);
        if (linha) { linha.owner = clientId; if (!linha.phone) linha.phone = alvo.numero; }
        else chamadas.set(r.callId, {
          callId: r.callId, direction: 'outbound', status: 'ringing', peer: '', phone: alvo.numero,
          lid: null, owner: clientId, isVideo: !!video, videoActive: !!video, peerVideo: false,
          muted: false, startedAt: Date.now(), acceptedAt: null, endedAt: null, endReason: null,
        });
        return json(res, 200, { callId: r.callId });
      }

      const m = rota.match(/^\/api\/calls\/([^/]+)\/(accept|reject|hangup|mute|video\/enable|video\/disable)$/);
      if (m && req.method === 'POST') {
        const callId = decodeURIComponent(m[1]);
        const acao = m[2];
        const corpo = await corpoDe(req);
        const linha = chamadas.get(callId);
        if (!linha) return json(res, 404, { error: 'call_not_found' });

        // Chamada FALSA (/api/debug/fake-incoming) nunca toca no navegador:
        // ela existe para exercitar a tela — atender, video, mudo, desligar —
        // sem ligar para ninguem. Mandar isto para o wa-js daria erro cru.
        if (linha && linha.falsa) {
          const agora = Date.now();
          if (acao === 'accept') {
            linha.status = 'active'; linha.acceptedAt = agora; linha.owner = clientId; linha.raw = 'ACTIVE';
            if (corpo.video) { linha.isVideo = true; linha.videoActive = true; }
            emitir('call_accepted', { call: linha });
            emitir('call_active', { call: linha });
          } else if (acao === 'mute') {
            linha.muted = !!corpo.muted; emitir('call_update', { call: linha });
          } else {
            linha.status = 'ended'; linha.endedAt = agora;
            linha.endReason = acao === 'reject' ? 'rejected' : 'terminate';
            emitir('call_ended', { call: linha });
          }
          return json(res, 200, { ok: true, falsa: true });
        }

        if (acao === 'accept') {
          if (linha) linha.owner = clientId;
          await comPrazo(acoes.accept(callId), 15000, 'accept');
          if (linha) emitir('call_accepted', { call: linha });
          return json(res, 200, { ok: true });
        }
        if (acao === 'reject') { await comPrazo(acoes.reject(callId), 10000, 'reject'); return json(res, 200, { ok: true }); }
        if (acao === 'hangup') { await comPrazo(acoes.end(), 10000, 'end'); return json(res, 200, { ok: true }); }
        if (acao === 'mute') {
          const muted = !!corpo.muted;
          if (linha) linha.muted = muted;
          // O mudo corta o ENVIO de quadros: desligar a track nao basta.
          paginaEnviar(JSON.stringify({ cmd: 'mute', muted }));
          if (linha) emitir('call_update', { call: linha });
          return json(res, 200, { ok: true });
        }
        // MVP: video so nasce na oferta (POST /api/calls com video:true).
        return json(res, 501, { error: 'video_upgrade_nao_implementado' });
      }

      // Mensagens, contatos e presenca (ver src/page/messaging.js).
      if (rota === '/api/rpc' && req.method === 'POST') {
        const { action, params } = await corpoDe(req, CORPO_MAX_MIDIA);
        if (!action) return json(res, 400, { error: 'missing_action' });
        if (!conta.connected) return json(res, 409, { error: 'not_paired' });
        const r = await comPrazo(acoes.rpc(String(action), params || {}), 60000, 'rpc ' + action);
        if (!r || !r.ok) return json(res, 502, { error: 'wa_error', message: (r && r.error) || 'sem resposta' });
        return json(res, 200, r.result);
      }

      if (rota === '/api/pairing/qr' && req.method === 'GET') {
        // Por padrao o caminho e barato: payload -> PNG. `?tela=1` acrescenta o
        // screenshot do canvas, que serve para diagnostico e nao para ler.
        // Alguem pedindo o QR = alguem tentando parear agora: o log volta a
        // imprimir mesmo que o limite de QRs ja tenha sido atingido.
        aoPedirQr();
        const querTela = url.searchParams.get('tela') === '1';
        const qr = querTela ? await acoes.qr() : await acoes.qrRef();
        if (!qr || !qr.ref) return json(res, 404, { error: 'sem_qr', status: retrato() });
        // `ansi` e o QR pronto para o terminal: dentro do Docker e assim que
        // alguem pareia sem janela nenhuma —
        //   curl -s .../api/pairing/qr | jq -r .ansi
        // `png` e desenhado por nos a partir do payload; `pngTela` e o
        // screenshot do canvas, que serve para diagnostico e nao para ler.
        return json(res, 200, {
          ref: qr.ref,
          seletor: qr.seletor || null,
          png: await paraPng(qr.ref),
          pngTela: querTela ? qr.png : undefined,
          ansi: await paraTerminal(qr.ref),
        });
      }

      if (rota === '/api/screenshot' && req.method === 'GET') {
        return json(res, 200, { png: await acoes.captura() });
      }

      // DESLIGADO por padrao. So com DEBUG_EVAL=1, e so do loopback: pelo
      // tunel isto seria execucao remota de codigo dentro da sessao do
      // numero pareado. Nunca ligar no compose.
      if (rota === '/api/debug/eval' && req.method === 'POST') {
        if (process.env.DEBUG_EVAL !== '1') return json(res, 404, { error: 'not_found' });
        const remoto = req.socket.remoteAddress || '';
        if (!remoto.includes('127.0.0.1') && !remoto.includes('::1')) return json(res, 403, { error: 'so_loopback' });
        const { code } = await corpoDe(req);
        return json(res, 200, await acoes.avaliar(String(code || 'null')));
      }

      if (rota === '/api/debug/calls' && req.method === 'GET') {
        return json(res, 200, { pagina: await acoes.debugChamadas(), servidor: [...chamadas.values()] });
      }

      // Dispara um convite FALSO para os clientes atachados. Serve para provar
      // a tela de chamada recebida sem depender de alguem ligar de verdade.
      if (rota === '/api/debug/fake-incoming' && req.method === 'POST') {
        const corpo = await corpoDe(req);
        const falsa = {
          callId: 'falsa-' + Date.now(), direction: 'inbound', status: 'ringing',
          peer: '556599999999@c.us', phone: '556599999999', lid: null, owner: null,
          isVideo: !!corpo.video, videoActive: !!corpo.video, peerVideo: !!corpo.video,
          muted: false, startedAt: Date.now(), acceptedAt: null, endedAt: null, endReason: null,
          raw: 'INCOMING_RING', falsa: true,
        };
        chamadas.set(falsa.callId, falsa);
        podarEncerradas();
        emitir('incoming_call', { call: falsa });
        return json(res, 200, { ok: true, callId: falsa.callId });
      }

      if (rota === '/api/diag' && req.method === 'GET') {
        return json(res, 200, { diag: await acoes.diagnostico(), status: retrato(), servidor: { clientes: clientes.size, fonteMidia: fonteMidia ? clientes.get(fonteMidia) || null : null, paginas: paginas.size, paginaAtiva: !!(pagina && pagina.readyState === 1), mediaConfig, descartes } });
      }

      return json(res, 404, { error: 'not_found' });
    } catch (e) {
      const msg = String(e && e.message || e);
      // Prazo esgotado nao e erro nosso de programacao: e a pagina nao
      // respondendo. O CRM precisa distinguir para poder tentar de novo.
      if (msg.startsWith('prazo esgotado')) return json(res, 504, { error: 'timeout', message: msg });
      if (e && e.code === 'payload_too_large') return json(res, 413, { error: 'payload_too_large', message: msg });
      return json(res, 500, { error: 'falha', message: msg });
    }
  });

  // --------------------------------------------------------------- WebSocket
  const wssCRM = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const wssPagina = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  function paginaEnviar(dados) {
    if (pagina && pagina.readyState === 1) { try { pagina.send(dados); return true; } catch {} }
    return false;
  }

  function pedirKeyframe(ws, motivo) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify({ type: 'media-control', action: 'request-keyframe', reason: motivo })); } catch {}
  }

  function byteDe(dados, indice) {
    if (dados instanceof ArrayBuffer) return new Uint8Array(dados)[indice];
    if (ArrayBuffer.isView(dados)) return new Uint8Array(dados.buffer, dados.byteOffset, dados.byteLength)[indice];
    return undefined;
  }

  /** Relay com prioridade para o presente: nunca deixa a fila interna da VPS
   * crescer sem limite. Depois de descartar um delta, so retoma num IDR. */
  function repassarMidiaParaPagina(origem, dados) {
    if (!pagina || pagina.readyState !== 1) {
      descartes.semPagina += 1;
      if (byteDe(dados, 0) === KIND_VIDEO) pedirKeyframe(origem, 'page-disconnected');
      return false;
    }
    const kind = byteDe(dados, 0);
    if (kind === KIND_AUDIO && pagina.bufferedAmount > 4 * (HEADER + 960 * 2)) {
      descartes.audioPorFila += 1;
      return false;
    }
    if (kind === KIND_VIDEO) {
      const keyframe = !!(byteDe(dados, 1) & 1);
      if (paginaEsperaKeyframe && !keyframe) {
        descartes.videoSemKeyframe += 1;
        pedirKeyframe(origem, 'relay-waiting-keyframe');
        return false;
      }
      if (pagina.bufferedAmount > mediaConfig.relayQueueBytes) {
        paginaEsperaKeyframe = true;
        descartes.videoPorFila += 1;
        pedirKeyframe(origem, 'relay-backpressure');
        return false;
      }
      if (keyframe) paginaEsperaKeyframe = false;
    }
    return paginaEnviar(dados);
  }

  wssCRM.on('connection', (ws, req) => {
    try { req.socket && req.socket.setNoDelay(true); } catch {}
    const url = new URL(req.url, 'http://localhost');
    const clientId = url.searchParams.get('clientId') || 'anon';
    clientes.set(ws, clientId);
    ws.binaryType = 'arraybuffer';
    log('cliente conectou', clientId, '(' + clientes.size + ')');

    ws.send(JSON.stringify({
      type: 'hello',
      status: retrato(),
      calls: [...chamadas.values()],
    }));

    ws.on('message', (dados, ehBinario) => {
      if (!ehBinario) {
        // Unico texto aceito do cliente: metadados publicos do encoder. Vai
        // para a pagina somente se este cliente pode ser a fonte da chamada.
        if (dados.length > 1024) return;
        let msg; try { msg = JSON.parse(dados.toString()); } catch { return; }
        if (msg.type !== 'media-config' || msg.kind !== 'video') return;
        const ativa = [...chamadas.values()].find(c => c.status !== 'ended');
        if (!ativa || (ativa.owner && ativa.owner !== clientId)) return;
        if (fonteMidia && fonteMidia.readyState === 1 && fonteMidia !== ws) return;
        fonteMidia = ws;
        const width = Math.round(Number(msg.width)), height = Math.round(Number(msg.height));
        const frameRate = Math.round(Number(msg.frameRate));
        const codec = String(msg.codec || '');
        if (!/^avc1\.[0-9a-f]{6}$/i.test(codec) || width < 2 || width > 1920 || height < 2 || height > 1080 || frameRate < 1 || frameRate > 60) return;
        paginaEnviar(JSON.stringify({ type: 'media-config', kind: 'video', codec, width, height, frameRate }));
        return;
      }
      // Voz e video do operador: repassados crus para a pagina — de UM socket.
      const ativa = [...chamadas.values()].find(c => c.status !== 'ended');
      if (!ativa) return;
      if (!fonteMidia || fonteMidia.readyState !== 1) {
        // Trava na primeira fonte legitima: o dono da chamada, ou qualquer
        // um se a chamada nao tem dono (atendida sem passar pela API).
        if (ativa.owner && ativa.owner !== clientId) { descartes.midiaDeOutroSocket += 1; return; }
        fonteMidia = ws;
        log('midia de subida travada no cliente', clientId);
      }
      if (fonteMidia !== ws) { descartes.midiaDeOutroSocket += 1; return; }
      repassarMidiaParaPagina(ws, dados);
    });
    ws.on('close', () => { clientes.delete(ws); if (fonteMidia === ws) fonteMidia = null; });
  });

  /** Troca a pagina que recebe a midia do operador (e exige IDR de novo). */
  function adotarPagina(ws) {
    if (pagina === ws) return;
    pagina = ws;
    paginaEsperaKeyframe = true;
    if (fonteMidia) pedirKeyframe(fonteMidia, 'page-changed');
  }

  wssPagina.on('connection', (ws) => {
    try { ws._socket && ws._socket.setNoDelay(true); } catch {}
    paginas.add(ws);
    // So assume o lugar se nao ha pagina viva: um iframe que conecta no meio
    // da chamada nao pode roubar a midia do frame principal.
    if (!pagina || pagina.readyState !== 1) adotarPagina(ws);
    ws.binaryType = 'arraybuffer';
    log('pagina conectou (' + paginas.size + ')');
    ws.on('message', (dados, ehBinario) => {
      // Midia so sai do frame principal: quem manda e a pagina de verdade.
      if (ehBinario) adotarPagina(ws);
      if (!ehBinario) {
        // A pagina pode pedir um IDR quando seu decoder ficar para tras. Nao
        // repassamos nenhum outro texto privado da pagina para clientes.
        if (dados.length > 1024) return;
        let msg; try { msg = JSON.parse(dados.toString()); } catch { return; }
        if (msg.type === 'media-control' && msg.action === 'request-keyframe') {
          pedirKeyframe(fonteMidia, String(msg.reason || 'page-request').slice(0, 80));
        }
        return;
      }
      // Midia vinda do WhatsApp: vai para o dono da chamada; sem dono, para todos.
      const donos = [...chamadas.values()].filter(c => c.status !== 'ended').map(c => c.owner).filter(Boolean);
      for (const [cliente, id] of clientes) {
        if (donos.length && !donos.includes(id)) continue;
        try { cliente.send(dados, { binary: true }); } catch {}
      }
    });
    ws.on('close', () => {
      paginas.delete(ws);
      if (pagina !== ws) return;
      pagina = null;
      paginaEsperaKeyframe = true;
      const outra = [...paginas].find(p => p.readyState === 1);
      if (outra) adotarPagina(outra);
      log('pagina fechou; ' + (outra ? 'outra assumiu' : 'nenhuma restou'));
    });
  });

  const recusarUpgrade = (socket, codigo, texto) => { try { socket.write('HTTP/1.1 ' + codigo + ' ' + texto + '\r\nConnection: close\r\n\r\n'); } catch {} socket.destroy(); };
  http.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { socket.destroy(); return; }
    const ip = String(socket.remoteAddress || '');
    if (limitador.bloqueado(ip)) return recusarUpgrade(socket, 429, 'Too Many Requests');
    if (url.pathname === '/page') {
      // Somente loopback: e o canal da nossa propria pagina.
      if (!ip.includes('127.0.0.1') && !ip.includes('::1')) { socket.destroy(); return; }
      if (!tokenConfere(url.searchParams.get('token'))) { limitador.falhou(ip); socket.destroy(); return; }
      wssPagina.handleUpgrade(req, socket, head, ws => wssPagina.emit('connection', ws, req));
      return;
    }
    if (url.pathname === '/ws') {
      if (!origemPermitida(req.headers.origin, origens)) return recusarUpgrade(socket, 403, 'Forbidden');
      // Token em header (backends) ou na URL (navegadores nao mandam header no WS).
      const auth = String(req.headers.authorization || '');
      const apresentado = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
      if (!tokenConfere(apresentado)) { limitador.falhou(ip); return recusarUpgrade(socket, 401, 'Unauthorized'); }
      limitador.sucesso(ip);
      wssCRM.handleUpgrade(req, socket, head, ws => wssCRM.emit('connection', ws, req));
      return;
    }
    socket.destroy();
  });

  return {
    get port() { return http.address()?.port; },
    async ouvir() {
      await new Promise((ok, erro) => { http.once('error', erro); http.listen(port, host, ok); });
      log('ouvindo em http://' + host + ':' + port);
    },
    async fechar() {
      for (const ws of [...wssCRM.clients, ...wssPagina.clients]) ws.terminate();
      // Uma conexao HTTP presa (corpo recusado no meio, keep-alive de cliente
      // sumido) seguraria o close() para sempre.
      await new Promise(ok => { http.close(ok); http.closeAllConnections(); });
    },
    ligarAcoes(a) { acoes = a; },
    definirSondaDeVida(fn) { sondaDeVida = fn; },
    definirAoPedirQr(fn) { aoPedirQr = fn; },
    aplicarEvento,
    definirConta(c) {
      const antes = JSON.stringify(retrato());
      conta = { ...conta, ...c };
      if (JSON.stringify(retrato()) !== antes) emitir('status', { status: retrato() });
    },
    chamadas,
    retrato,
    paginaEnviar,
    /** Quantos clientes do CRM estao atachados (usado pelo autoteste). */
    get clientes() { return clientes; },
    get temPagina() { return !!(pagina && pagina.readyState === 1); },
    /** Quantos quadros de subida foram recusados por virem de outro socket. */
    get descartes() { return descartes; },
    /** Quadro binario cru para a pagina — o autoteste injeta tom por aqui. */
    enviarParaPagina(kind, flags, corpo) {
      const buf = Buffer.alloc(HEADER + corpo.length);
      buf[0] = kind; buf[1] = flags; buf[2] = 0; buf[3] = 0;
      Buffer.from(corpo.buffer, corpo.byteOffset, corpo.byteLength).copy(buf, HEADER);
      return paginaEnviar(buf);
    },
  };
}

/** Os arquivos publicos que o discador e a pagina de pareamento carregam. */
export async function servirEstatico(rota) {
  if (rota === '/static/zc-ui.js') return { tipo: 'application/javascript; charset=utf-8', corpo: await readFile(join(AQUI, 'page', 'zc-ui.js'), 'utf8') };
  if (rota === '/static/worklets.js') return { tipo: 'application/javascript; charset=utf-8', corpo: preludio() };
  // O favicon e pedido pelo navegador SEM credencial: sem esta rota ele
  // virava um 401 por aba aberta — e contava como tentativa de invasao.
  if (rota === '/favicon.ico' || rota === '/static/favicon.svg') return { tipo: 'image/svg+xml', corpo: FAVICON };
  return null;
}

/** A marca em SVG (a mesma de zc-ui.js), para a aba do navegador. */
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#34d399"/><stop offset="1" stop-color="#15803d"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><path d="M32 12c-11.6 0-21 8.1-21 18.2 0 4.6 2 8.8 5.3 12L14 50l9.7-3.4a24.6 24.6 0 0 0 8.3 1.4c11.6 0 21-8.1 21-18.2S43.6 12 32 12z" fill="#fff" fill-opacity=".16" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M36.5 20 25 32.5h8.5L27.5 42 40 29.5h-8.5z" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>';

/**
 * Pagina de pareamento. Mostra o QR ATUAL e se redesenha sozinha conforme o
 * WhatsApp Web gira o codigo (~20 s). Serve para parear sem janela do Chrome:
 * no Mac abre direto, no servidor por tunel SSH.
 */
const PAGINA_PAREAMENTO = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZapCall — pareamento</title>
<script src="static/zc-ui.js"></script>
<style>
  .pagina { display:grid; place-items:center; min-height:calc(100vh - var(--nav-h)); padding:20px; }
  .cartao { background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:28px 32px; text-align:center; box-shadow:var(--shadow); max-width:420px; }
  img { width:264px; max-width:70vw; height:auto; aspect-ratio:1; image-rendering:pixelated; border-radius:10px; background:#fff; padding:8px; }
  h1 { font-size:17px; margin:0 0 4px; }
  p { margin:6px 0 0; opacity:.75; font-size:13px; line-height:1.5; }
  .ok { color:var(--brand-ink); font-weight:600; }
  .idade { font-variant-numeric:tabular-nums; opacity:.6; font-size:12px; }
</style>
<div class="pagina">
<div class="cartao">
  <h1 id="h1">Conectar o WhatsApp</h1>
  <p id="p1">No celular: <b>WhatsApp &gt; Dispositivos conectados &gt; Conectar dispositivo</b></p>
  <div id="alvo" style="margin:18px 0"><p>…</p></div>
  <p class="idade" id="idade"></p>
</div>
</div>
<script>
// Mesma chave de idioma do painel: a escolha vale para tudo. Padrao: portugues.
const I18N = {
  pt: { h1: 'Conectar o WhatsApp', p1: 'No celular: <b>WhatsApp &gt; Dispositivos conectados &gt; Conectar dispositivo</b>', procurando: 'procurando o QR…', pareado: 'PAREADO', fechar: 'pode fechar esta aba', idade: 'este código tem {s}s (o WhatsApp troca a cada ~20s)', fora: 'serviço fora do ar?' },
  en: { h1: 'Link WhatsApp', p1: 'On the phone: <b>WhatsApp &gt; Linked devices &gt; Link a device</b>', procurando: 'looking for the QR…', pareado: 'PAIRED', fechar: 'you can close this tab', idade: 'this code is {s}s old (WhatsApp rotates it every ~20s)', fora: 'service down?' },
};
const t = (k, s) => ZC.t(I18N, k, { s });
ZC.nav({ links: [{ href: '/', rotulo: { pt: 'Painel', en: 'Panel' } }, { href: '#', rotulo: { pt: 'Pareamento', en: 'Pairing' }, ativo: true }, { href: '/docs', rotulo: { pt: 'Documentação', en: 'Documentation' } }] });
function idioma() { document.getElementById('h1').textContent = t('h1'); document.getElementById('p1').innerHTML = t('p1'); if (!refAtual) alvo.innerHTML = '<p>' + t('procurando') + '</p>'; }
ZC.onChange(idioma);
const alvo = document.getElementById('alvo');
const idade = document.getElementById('idade');
let refAtual = null, desde = Date.now();
// O token sai da barra de endereco assim que e lido (fica so nesta aba).
const params = new URLSearchParams(location.search);
const tokenPair = (() => { const v = params.get('token'); try { if (v) { sessionStorage.setItem('zc.pair.token', v); params.delete('token'); history.replaceState(null, '', location.pathname + (params.size ? '?' + params : '')); return v; } return sessionStorage.getItem('zc.pair.token') || ''; } catch { return v || ''; } })();
const auth = tokenPair ? { Authorization: 'Bearer ' + tokenPair } : {};
async function tique() {
  try {
    // Caminhos RELATIVOS: atras do gerente esta pagina vive em /instances/<nome>/pair.
    const s = await fetch('api/status', { headers: auth }).then(r => r.json());
    if (s.connected) {
      alvo.innerHTML = '<p class="ok">' + t('pareado') + '</p><p>' + (s.phone || s.jid || '') + '<br>' + (s.pushName || '') + '</p>';
      idade.textContent = t('fechar');
      return;
    }
    const q = await fetch('api/pairing/qr', { headers: auth }).then(r => r.ok ? r.json() : null);
    if (q && q.png && q.ref !== refAtual) {
      refAtual = q.ref; desde = Date.now();
      alvo.innerHTML = '<img alt="QR de pareamento" src="data:image/png;base64,' + q.png + '">';
    }
    if (refAtual) idade.textContent = t('idade', Math.round((Date.now() - desde) / 1000));
  } catch (e) { idade.textContent = t('fora'); }
}
tique(); setInterval(tique, 2000);
</script>`;

/** Pagina de autoteste: exercita os ganchos sem depender do WhatsApp. */
const PAGINA_PROBE = `<!doctype html><meta charset="utf-8"><title>probe</title>
<body style="font:14px system-ui;padding:16px">
<h1>ZapCall — autoteste de midia</h1><pre id="log"></pre>
<script>
const linhas = [];
const log = (m) => { linhas.push(m); document.getElementById('log').textContent = linhas.join('\\n'); };
window.__probe = { pronto: false, erro: null, linhas };
(async () => {
  try {
    log('pedindo microfone (o gancho deve devolver o nosso)...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    log('stream: ' + stream.getAudioTracks().length + ' track(s) de audio');
    const pc1 = new RTCPeerConnection(); const pc2 = new RTCPeerConnection();
    pc1.onicecandidate = e => e.candidate && pc2.addIceCandidate(e.candidate);
    pc2.onicecandidate = e => e.candidate && pc1.addIceCandidate(e.candidate);
    pc2.ontrack = () => log('pc2 recebeu track remoto');
    for (const t of stream.getTracks()) pc1.addTrack(t, stream);
    const oferta = await pc1.createOffer();
    await pc1.setLocalDescription(oferta); await pc2.setRemoteDescription(oferta);
    const resposta = await pc2.createAnswer();
    await pc2.setLocalDescription(resposta); await pc1.setRemoteDescription(resposta);
    window.__probe.pcs = [pc1, pc2];
    const espera = setInterval(() => {
      if (pc1.connectionState === 'connected') { clearInterval(espera); log('loopback conectado'); window.__probe.pronto = true; }
    }, 200);
    if ('VideoEncoder' in window) {
      const s = await VideoEncoder.isConfigSupported({ codec: 'avc1.42E01E', width: 640, height: 480, avc: { format: 'annexb' } });
      window.__probe.h264 = !!s.supported; log('H.264 no WebCodecs: ' + s.supported);
    } else { window.__probe.h264 = false; log('sem WebCodecs'); }
  } catch (e) { window.__probe.erro = String(e && e.message || e); log('ERRO: ' + window.__probe.erro); }
})();
</script>`;

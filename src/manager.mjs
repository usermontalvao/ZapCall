// O GERENTE: varias instancias (canais) num processo so, no estilo da
// Evolution API.
//
//   gerente (PORT, ex. 18475)  ──proxy──▶  instancia "vendas"   (127.0.0.1:18500)
//         │                    ──proxy──▶  instancia "suporte"  (127.0.0.1:18501)
//         └── /manager/*  (cadastro, QR, status, pagina de configuracoes)
//
// Cada instancia e um PROCESSO FILHO rodando src/app.mjs com o proprio Chrome,
// perfil e porta no loopback. Isolamento de verdade: um Chrome que morre nao
// leva os outros, e cada um pode ser reiniciado sozinho. O gerente so repassa
// (HTTP e WebSocket, midia inclusive) e impoe o que o WhatsApp Web ja impoe —
// UMA chamada por instancia — antes de a chamada nascer, com um 409 honesto.
//
// Autenticacao: a chave GLOBAL (`apikey`, como na Evolution) administra tudo;
// cada instancia nasce com um TOKEN proprio que so da acesso a ela. O CRM (e
// a comunidade) usa o token da instancia; a pagina de configuracoes, a chave.
import { spawn, execFile } from 'node:child_process';
import { readFileSync as lerSync } from 'node:fs';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import { abrirCadastro } from './instances.mjs';
import { servirEstatico } from './server.mjs';
import { credencialConfere, criarLimitador, cabecalhosDeSeguranca, origemPermitida, listaDeOrigens, mascarar } from './security.mjs';
import { configurarMidia } from './media-config.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(AQUI, '..', 'docs');

export async function iniciarGerente(op = {}) {
  // `op.port` 0 e legitimo (porta efemera, nos testes): nao pode cair no `||`.
  const port = op.port != null ? Number(op.port) : Number(process.env.PORT || 18475);
  const host = op.host || process.env.HOST || '127.0.0.1';
  const dataDir = resolve(op.dataDir || process.env.DATA_DIR || join(AQUI, '..', 'data'));
  const portBase = Number(op.portBase || process.env.INSTANCE_PORT_BASE || 18500);
  const verbose = op.verbose ?? (process.env.VERBOSE === '1');
  const mediaConfig = configurarMidia(op.mediaConfig || process.env);
  const log = (...a) => console.log('[gerente]', ...a);
  // Origens de navegador aceitas (WebSocket e CORS). Vazio = qualquer origem.
  const origens = listaDeOrigens(op.allowedOrigins ?? process.env.ALLOWED_ORIGINS);
  const corsOrigin = origens.length ? null : '*';
  /** Falhas de autenticacao por IP: forca bruta contra a chave vira 429. */
  const limitador = criarLimitador();
  const ipDe = (req) => String((req.socket && req.socket.remoteAddress) || '');

  // ------------------------------------------------------------- chave global
  // Sem ZAPCALL_API_KEY o gerente GERA uma e guarda em DATA_DIR/manager.json —
  // um servico de chamadas nunca nasce aberto, nem "so para testar".
  mkdirSync(dataDir, { recursive: true });
  const arquivoGerente = join(dataDir, 'manager.json');
  let apiKey = op.apiKey ?? process.env.ZAPCALL_API_KEY ?? '';
  if (!apiKey) {
    try { apiKey = JSON.parse(readFileSync(arquivoGerente, 'utf8')).apiKey || ''; } catch {}
    if (!apiKey) {
      apiKey = randomBytes(24).toString('base64url');
      writeFileSync(arquivoGerente, JSON.stringify({ apiKey }, null, 2), { mode: 0o600 });
      log('chave global gerada e guardada em ' + arquivoGerente + ' (' + mascarar(apiKey) + ')');
    }
  }

  const cadastro = abrirCadastro({ dataDir, portBase });

  // ------------------------------------------------------------ processos
  /** name -> { proc, parando, tentativas, iniciadoEm, logs[], status } */
  const vivas = new Map();
  /**
   * Processo ainda de pe? `exitCode` fica NULO quando o filho morre por
   * SINAL (SIGTERM/SIGKILL): so `signalCode` conta essa morte. Conferir so o
   * exitCode fazia uma instancia derrubada parecer viva para sempre — e o
   * `subir` seguinte, achando que ela ja rodava, nao subia nada.
   */
  const vivo = (proc) => !!proc && proc.exitCode === null && proc.signalCode === null;

  function subir(inst) {
    const atual = vivas.get(inst.name);
    if (atual && vivo(atual.proc)) return atual;
    // Testes do gerente nao sobem Chrome nenhum: o cadastro e a API sao o alvo.
    if (op.semProcessos) { const reg = atual || { tentativas: 0, logs: [], status: null, proc: null }; vivas.set(inst.name, reg); return reg; }
    mkdirSync(inst.profileDir, { recursive: true });
    const env = {
      ...process.env,
      PORT: String(inst.port), HOST: '127.0.0.1',
      PROFILE_DIR: inst.profileDir, ZAPCALL_TOKEN: inst.token,
      ZAPCALL_VIDEO_PROFILE: mediaConfig.profile,
      ZAPCALL_VIDEO_WIDTH: String(mediaConfig.width),
      ZAPCALL_VIDEO_HEIGHT: String(mediaConfig.height),
      ZAPCALL_VIDEO_FPS: String(mediaConfig.frameRate),
      ZAPCALL_VIDEO_BITRATE: String(mediaConfig.bitrate),
      // O QR sai pela API/pagina do gerente, nao pelo stdout de cada filho.
      QR_TERMINAL: '0',
      // A filha vigia este pid: gerente morto de repente = filha se encerra.
      ZAPCALL_PARENT_PID: String(process.pid),
    };
    // Um Chrome de uma vida anterior ainda segurando este perfil deixaria o
    // proximo Chrome sem sessao (ele sobe num perfil temporario, calado).
    matarChromeOrfao(inst).catch(() => {});
    // `op.comando` troca o executavel da filha (os testes sobem um processo
    // inerte no lugar do app.mjs para exercitar o ciclo de vida sem Chrome).
    const [exe, ...args] = op.comando || [process.execPath, join(AQUI, 'app.mjs')];
    const proc = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const reg = atual || { tentativas: 0, logs: [], status: null };
    Object.assign(reg, { proc, parando: false, iniciadoEm: Date.now() });
    vivas.set(inst.name, reg);
    const guardar = (linha) => {
      reg.logs.push(linha); if (reg.logs.length > 200) reg.logs.shift();
      if (verbose) process.stdout.write('[' + inst.name + '] ' + linha + '\n');
    };
    let resto = '';
    const ler = (chunk) => {
      resto += chunk; const partes = resto.split('\n'); resto = partes.pop();
      for (const l of partes) if (l.trim()) guardar(l);
    };
    proc.stdout.on('data', ler); proc.stderr.on('data', ler);
    proc.on('exit', (codigo, sinal) => {
      guardar('processo saiu (codigo ' + codigo + (sinal ? ', sinal ' + sinal : '') + ')');
      reg.status = null;
      if (reg.parando) return;
      const viva = cadastro.obter(inst.name);
      if (!viva || !viva.enabled) return;
      // Reinicio com recuo: um Chrome que morre no boot nao pode virar laco quente.
      reg.tentativas += 1;
      const espera = Math.min(60000, 2000 * 2 ** Math.min(5, reg.tentativas - 1));
      guardar('reiniciando em ' + Math.round(espera / 1000) + ' s');
      setTimeout(() => { if (!reg.parando) subir(viva); }, espera);
    });
    log('instancia ' + inst.name + ' subindo na porta ' + inst.port + ' (pid ' + proc.pid + ')');
    escutar(inst);
    return reg;
  }

  async function derrubar(nome) {
    const reg = vivas.get(nome);
    if (!reg || !reg.proc) return;
    reg.parando = true;
    const proc = reg.proc;
    if (!vivo(proc)) return;
    proc.kill('SIGTERM');
    let naMarra = false;
    await new Promise(ok => {
      const t = setTimeout(() => { naMarra = true; try { proc.kill('SIGKILL'); } catch {} ok(); }, 12000);
      proc.once('exit', () => { clearTimeout(t); ok(); });
    });
    // SIGKILL no node nao derruba o Chrome dele: ele fica orfao, no perfil.
    if (naMarra) { const inst = cadastro.obter(nome); if (inst) await matarChromeOrfao(inst); }
  }

  /**
   * Processos do Chrome que usam o perfil da instancia. Sao NETOS do gerente
   * (filhos do node da instancia) e nao morrem quando o node morre na marra
   * — por isso sao encontrados pelo `--user-data-dir`, e nao pela arvore.
   */
  function chromesDoPerfil(profileDir) {
    return new Promise((ok) => {
      execFile('ps', ['-axo', 'pid=,args='], { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => {
        if (e) return ok([]);
        const alvo = '--user-data-dir=' + profileDir;
        const pids = [];
        for (const l of String(out).split('\n')) {
          const m = l.match(/^\s*(\d+)\s+(.*)$/); if (!m) continue;
          if (/chrome|chromium/i.test(m[2]) && (m[2].includes(alvo + ' ') || m[2].endsWith(alvo))) pids.push(Number(m[1]));
        }
        ok(pids);
      });
    });
  }
  async function matarChromeOrfao(inst) {
    if (op.semProcessos) return 0;
    const pids = await chromesDoPerfil(inst.profileDir);
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    if (pids.length) log('instancia ' + inst.name + ': ' + pids.length + ' processo(s) de Chrome orfao(s) encerrado(s)');
    return pids.length;
  }

  // ----------------------------------------------------- status das filhas
  function chamarFilha(inst, caminho, opcoes = {}) {
    return new Promise((ok, erro) => {
      const req = httpRequest({
        host: '127.0.0.1', port: inst.port, path: caminho, method: opcoes.method || 'GET',
        headers: { authorization: 'Bearer ' + inst.token, 'content-type': 'application/json', ...(opcoes.headers || {}) },
        timeout: opcoes.timeout || 4000,
      }, (res) => {
        const pedacos = [];
        res.on('data', p => pedacos.push(p));
        res.on('end', () => {
          const texto = Buffer.concat(pedacos).toString('utf8');
          let corpo; try { corpo = JSON.parse(texto); } catch { corpo = { raw: texto }; }
          ok({ status: res.statusCode, corpo });
        });
      });
      req.on('timeout', () => { req.destroy(new Error('prazo esgotado')); });
      req.on('error', erro);
      if (opcoes.body) req.write(typeof opcoes.body === 'string' ? opcoes.body : JSON.stringify(opcoes.body));
      req.end();
    });
  }

  /**
   * Retrato de uma instancia para a API e para a pagina. `busy` e o que o CRM
   * precisa para mostrar "canal em uso"; `call` diz com quem e desde quando.
   */
  async function retrato(inst) {
    const reg = vivas.get(inst.name);
    const base = {
      name: inst.name, channel: inst.channel, port: inst.port, enabled: inst.enabled, createdAt: inst.createdAt,
      running: !!(reg && vivo(reg.proc)),
      pid: reg && vivo(reg.proc) ? reg.proc.pid : null,
      uptime: reg && reg.iniciadoEm ? Math.round((Date.now() - reg.iniciadoEm) / 1000) : null,
      healthy: false, connected: false, phone: null, pushName: null,
      activeCalls: 0, busy: false, call: null,
      // Uma chamada por instancia: e a regra do WhatsApp Web, nao uma escolha nossa.
      maxCalls: 1,
      webhook: inst.webhook || { url: null, enabled: false, events: [] },
    };
    if (!base.running) return base;
    try {
      const s = await chamarFilha(inst, '/api/status', { timeout: 2500 });
      if (s.status === 200) {
        Object.assign(base, {
          healthy: true, connected: !!s.corpo.connected, phone: s.corpo.phone || null,
          pushName: s.corpo.pushName || null, activeCalls: Number(s.corpo.activeCalls) || 0,
        });
        base.busy = base.activeCalls > 0;
        if (base.busy) {
          const c = await chamarFilha(inst, '/api/calls', { timeout: 2500 });
          const ativa = (c.corpo.calls || []).find(x => x.status !== 'ended');
          if (ativa) base.call = { callId: ativa.callId, direction: ativa.direction, status: ativa.status, phone: ativa.phone, lid: ativa.lid, isVideo: ativa.isVideo, startedAt: ativa.startedAt, acceptedAt: ativa.acceptedAt, owner: ativa.owner };
        }
      } else if (s.status === 503) base.healthy = false;
    } catch { /* filha ainda subindo ou morta: fica como esta */ }
    if (reg) reg.status = base;
    return base;
  }

  // ---------------------------------------------------- eventos + webhooks
  // O gerente e um cliente WS de cada instancia so para OUVIR os eventos
  // (JSON). Cada um vira um POST no webhook da instancia, no formato da
  // Evolution: { event, instance, data, date_time, server_url }. A midia
  // (binaria) e ignorada aqui — o gerente nunca e dono de chamada.
  const EVENTOS = ['status', 'incoming_call', 'outgoing_call', 'call_accepted', 'call_active', 'call_update', 'call_ended',
    'messages.upsert', 'messages.update', 'messages.delete', 'presence.update'];
  /** Nomes que a Evolution usa no campo `event` do webhook (e no `connection.update`). */
  const NOME_EVOLUTION = { status: 'connection.update' };
  const entregas = new Map(); // name -> ultimas entregas (para a pagina)

  async function entregarWebhook(inst, evento, dados) {
    const atual = cadastro.obter(inst.name);
    const w = atual && atual.webhook;
    if (!w || !w.enabled || !w.url) return;
    if (w.events && w.events.length && !w.events.includes(evento)) return;
    const nomeEv = NOME_EVOLUTION[evento] || evento;
    const dadosEv = evento === 'status' ? { instance: inst.name, state: dados && dados.connected ? 'open' : 'close', statusReason: dados && dados.connected ? 200 : 401, ...dados } : dados;
    const corpo = JSON.stringify({ event: nomeEv, instance: inst.name, data: dadosEv, date_time: new Date().toISOString(), server_url: 'http://' + host + ':' + http.address().port });
    const lista = entregas.get(inst.name) || []; entregas.set(inst.name, lista);
    const registro = { event: evento, at: Date.now(), status: null, error: null, tentativas: 0 };
    lista.push(registro); if (lista.length > 30) lista.shift();
    // Tres tentativas com recuo curto: webhook fora do ar nao pode segurar o gerente.
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      registro.tentativas = tentativa;
      try {
        const r = await fetch(w.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zapcall-event': evento, 'x-zapcall-instance': inst.name }, body: corpo, signal: AbortSignal.timeout(8000) });
        registro.status = r.status; registro.error = null;
        if (r.ok) return;
      } catch (e) { registro.error = String(e && e.message || e); }
      await new Promise(r => setTimeout(r, 1000 * tentativa));
    }
  }

  const escutas = new Map(); // name -> { ws, parar }
  function escutar(inst) {
    if (escutas.has(inst.name) || op.semProcessos) return;
    const reg = { ws: null, parar: false, tentativas: 0 };
    escutas.set(inst.name, reg);
    const abrir = () => {
      if (reg.parar) return;
      const atual = cadastro.obter(inst.name);
      if (!atual) return;
      const ws = new WebSocket('ws://127.0.0.1:' + atual.port + '/ws?clientId=zapcall-manager&token=' + encodeURIComponent(atual.token));
      reg.ws = ws;
      ws.on('open', () => { reg.tentativas = 0; });
      ws.on('message', (d, bin) => {
        if (bin) return;
        let m; try { m = JSON.parse(d.toString()); } catch { return; }
        if (!m || !m.type || m.type === 'hello') return;
        const vivo = vivas.get(inst.name);
        if (vivo && m.status) vivo.ultimoStatus = m.status;
        if (EVENTOS.includes(m.type)) entregarWebhook(atual, m.type, m.call || m.status || m).catch(() => {});
      });
      const denovo = () => { if (reg.parar) return; reg.tentativas += 1; setTimeout(abrir, Math.min(15000, 1000 * reg.tentativas)); };
      ws.on('close', denovo); ws.on('error', () => { try { ws.close(); } catch {} });
    };
    abrir();
  }
  function pararEscuta(nome) {
    const reg = escutas.get(nome); if (!reg) return;
    reg.parar = true; try { reg.ws && reg.ws.close(); } catch {}
    escutas.delete(nome);
  }

  /** Desparear: derruba, apaga o perfil (a sessao) e sobe de novo, no QR. */
  async function desparear(inst) {
    await derrubar(inst.name);
    rmSync(inst.profileDir, { recursive: true, force: true });
    const reg = vivas.get(inst.name); if (reg) reg.tentativas = 0;
    subir(inst);
  }

  // ------------------------------------------------- sistema e autoteste
  // O servico vai morar num servidor: o painel precisa dizer quanto cada
  // Chrome esta pesando e se a maquina esta apertada ANTES de alguem abrir
  // mais uma instancia. Leitura barata (ps + os), sem dependencia.
  function ps(pids) {
    return new Promise((ok) => {
      if (!pids.length) return ok({});
      execFile('ps', ['-o', 'pid=,rss=,%cpu=', '-p', pids.join(',')], { timeout: 3000 }, (e, out) => {
        const r = {};
        if (!e) for (const l of String(out).trim().split('\n')) { const [pid, rss, cpu] = l.trim().split(/\s+/); if (pid) r[pid] = { rssMb: Math.round(Number(rss) / 1024), cpu: Number(cpu) }; }
        ok(r);
      });
    });
  }
  function df(caminho) {
    return new Promise((ok) => {
      execFile('df', ['-k', caminho], { timeout: 3000 }, (e, out) => {
        if (e) return ok(null);
        const l = String(out).trim().split('\n').pop().trim().split(/\s+/);
        // Formato do df -k: fs, 1K-blocks, used, avail, capacity, mounted
        ok({ totalGb: +(Number(l[1]) / 1048576).toFixed(1), usadoGb: +(Number(l[2]) / 1048576).toFixed(1), livreGb: +(Number(l[3]) / 1048576).toFixed(1) });
      });
    });
  }
  let versao = '0.0.0';
  try { versao = JSON.parse(lerSync(join(AQUI, '..', 'package.json'), 'utf8')).version || versao; } catch {}

  async function sistema() {
    const filhos = [...vivas.entries()].filter(([, r]) => vivo(r.proc)).map(([nome, r]) => ({ nome, pid: r.proc.pid }));
    const medidas = await ps([process.pid, ...filhos.map(f => f.pid)]);
    // O Chrome de cada instancia e NETO (filho do node da instancia). O ps por
    // pid pega so o node; o peso real do Chrome vem por pgid nao ser portavel,
    // entao somamos os processos "chrome" cujo --user-data-dir e o perfil dela.
    const chromes = await new Promise((ok) => execFile('ps', ['-axo', 'pid=,rss=,%cpu=,args='], { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => {
      const r = {};
      if (e) return ok(r);
      for (const l of String(out).split('\n')) {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/); if (!m) continue;
        const args = m[4]; if (!/chrome|chromium/i.test(args)) continue;
        for (const inst of cadastro.listar()) if (args.includes('--user-data-dir=' + inst.profileDir)) { const a = r[inst.name] || (r[inst.name] = { processos: 0, rssMb: 0, cpu: 0 }); a.processos += 1; a.rssMb += Math.round(Number(m[2]) / 1024); a.cpu += Number(m[3]); }
      }
      ok(r);
    }));
    return {
      version: versao, node: process.version, platform: process.platform, uptime: Math.round(process.uptime()),
      cpus: cpus().length, load: loadavg().map(x => +x.toFixed(2)), memTotalMb: Math.round(totalmem() / 1048576), memLivreMb: Math.round(freemem() / 1048576),
      disco: await df(dataDir), dataDir, port: http.address().port, portBase,
      gerente: medidas[process.pid] || null,
      instancias: filhos.map(f => ({ nome: f.nome, pid: f.pid, node: medidas[f.pid] || null, chrome: chromes[f.nome] || { processos: 0, rssMb: 0, cpu: 0 } })),
    };
  }

  /**
   * Autoteste de UMA instancia, sem chamada: processo vivo, API respondendo,
   * sessao, ganchos de midia, ponte pagina<->servidor, adaptador nativo,
   * WebCodecs H.264 e latencia. E o que se roda antes de culpar a rede.
   */
  async function autoteste(inst) {
    const itens = [];
    const marcar = (nome, ok, detalhe = '') => itens.push({ nome, ok, detalhe });
    const reg = vivas.get(inst.name);
    const viva = !!(reg && vivo(reg.proc));
    marcar('processo', viva, viva ? 'pid ' + reg.proc.pid : 'parado');
    if (!viva) return { ok: false, itens };
    const t0 = Date.now();
    let s;
    try { s = await chamarFilha(inst, '/api/status', { timeout: 4000 }); } catch (e) { marcar('api', false, e.message); return { ok: false, itens }; }
    const ms = Date.now() - t0;
    marcar('api', s.status === 200, 'HTTP ' + s.status + ' em ' + ms + ' ms');
    marcar('latencia', ms < 500, ms + ' ms (limite 500)');
    marcar('sessao', !!s.corpo.connected, s.corpo.connected ? '+' + s.corpo.phone : 'sem sessao pareada (leia o QR)');
    let d = null;
    try { d = (await chamarFilha(inst, '/api/diag', { timeout: 6000 })).corpo; } catch (e) { marcar('diagnostico', false, e.message); }
    const z = d && d.diag && d.diag.zapcall;
    if (z) {
      const g = z.ganchos || {};
      marcar('ganchos de midia', !!(g.getUserMedia && g.enumerateDevices && g.rtcPeerConnection), JSON.stringify(g));
      marcar('ponte pagina<->servidor', !!(z.ponte && z.ponte.aberta), z.ponte ? 'tentativas ' + z.ponte.tentativas : 'sem ponte');
      const n = z.nativeMedia;
      marcar('adaptador nativo (voz/video de retorno)', !!(n && n.ready), n ? (n.ready ? 'pronto' : 'faltando: ' + (n.faltando || []).join(', ')) : (s.corpo.connected ? 'nao instalado' : 'so instala com sessao pareada'));
      marcar('controle (wa-js)', !!(d.diag.controle), d.diag.controle ? 'ok' : 'camada de controle ausente');
      marcar('timers nativos', !!(z.ponte), z.visibilidade === 'forcada' ? 'aba sempre visivel' : 'visibilidade ' + z.visibilidade);
    }
    const chrome = (await sistema()).instancias.find(x => x.nome === inst.name);
    if (chrome) marcar('memoria do chrome', chrome.chrome.rssMb < 1500, chrome.chrome.rssMb + ' MB em ' + chrome.chrome.processos + ' processos (alerta acima de 1500)');
    return { ok: itens.every(i => i.ok), itens, quando: new Date().toISOString() };
  }

  // --------------------------------------------------------------- HTTP
  function json(res, code, corpo) {
    const texto = JSON.stringify(corpo);
    res.writeHead(code, {
      ...cabecalhosDeSeguranca({ corsOrigin }),
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-headers': 'authorization,content-type,x-client-id,apikey',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'content-length': Buffer.byteLength(texto),
    });
    res.end(texto);
  }
  function html(res, corpo) {
    res.writeHead(200, { ...cabecalhosDeSeguranca({ html: true, corsOrigin: null }), 'content-type': 'text/html; charset=utf-8' });
    res.end(corpo);
  }
  /** 401 que conta para o limite do IP (e vira 429 quando estoura). */
  function negar(res, req) {
    const ip = ipDe(req);
    limitador.falhou(ip);
    if (limitador.bloqueado(ip)) return json(res, 429, { error: 'too_many_attempts', message: 'muitas falhas de autenticacao; aguarde um minuto' });
    return json(res, 401, { error: 'unauthorized' });
  }

  const CORPO_MAX = 64 * 1024;
  const CORPO_MAX_MIDIA = 64 * 1024 * 1024; // so /message/* e /chat/*: midia em base64
  async function corpoDe(req, max = CORPO_MAX) {
    const pedacos = []; let total = 0;
    for await (const p of req) { total += p.length; if (total > max) throw Object.assign(new Error('corpo grande'), { code: 413 }); pedacos.push(p); }
    if (!pedacos.length) return {};
    try { return JSON.parse(Buffer.concat(pedacos).toString('utf8')); } catch { return {}; }
  }

  /**
   * Credencial apresentada. A CHAVE GLOBAL so vale em header (`apikey` ou
   * `Authorization: Bearer`): na URL ela iria parar em historico, log de
   * proxy e Referer. O TOKEN DE INSTANCIA pode vir em `?token=` — e o unico
   * jeito de um navegador abrir o WebSocket, o discador e a pagina do QR —
   * e por isso ele e restrito a uma instancia e pode ser girado.
   */
  function credencial(req, url) {
    const h = req.headers;
    if (h.apikey) return { valor: String(h.apikey), viaUrl: false };
    const auth = String(h.authorization || '');
    if (auth.startsWith('Bearer ')) return { valor: auth.slice(7), viaUrl: false };
    const q = url.searchParams.get('token');
    return { valor: q || '', viaUrl: !!q };
  }
  const ehAdmin = (cred) => !!cred.valor && !cred.viaUrl && credencialConfere(cred.valor, apiKey);
  const podeUsar = (cred, inst) => ehAdmin(cred) || (!!cred.valor && credencialConfere(cred.valor, inst.token));

  /** Repassa a requisicao para a filha, trocando a credencial pelo token dela. */
  function proxy(req, res, inst, caminho) {
    const cabecalhos = { ...req.headers, host: '127.0.0.1:' + inst.port, authorization: 'Bearer ' + inst.token };
    delete cabecalhos.apikey;
    const alvo = httpRequest({ host: '127.0.0.1', port: inst.port, path: caminho, method: req.method, headers: cabecalhos, timeout: 30000 }, (r) => {
      res.writeHead(r.statusCode, { ...r.headers, 'access-control-allow-origin': '*' });
      r.pipe(res);
    });
    alvo.on('timeout', () => alvo.destroy(new Error('prazo esgotado')));
    alvo.on('error', (e) => { if (!res.headersSent) json(res, 502, { error: 'instance_unreachable', message: e.message }); else res.destroy(); });
    req.pipe(alvo);
  }

  const http = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'invalid_url' }); }
    const rota = url.pathname;
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (!origemPermitida(req.headers.origin, origens)) return json(res, 403, { error: 'origin_not_allowed' });
    if (limitador.bloqueado(ipDe(req))) return json(res, 429, { error: 'too_many_attempts', message: 'muitas falhas de autenticacao; aguarde um minuto' });
    const cred = credencial(req, url);
    // Credencial apresentada e correta: o IP deixa de contar falhas.
    if (cred.valor && (ehAdmin(cred) || cadastro.listar().some(i => credencialConfere(cred.valor, i.token)))) limitador.sucesso(ipDe(req));

    try {
      if (rota === '/healthz') {
        const retratos = await Promise.all(cadastro.listar().map(retrato));
        const ok = retratos.every(r => !r.enabled || r.healthy);
        return json(res, ok ? 200 : 503, { ok, instances: retratos.length, healthy: retratos.filter(r => r.healthy).length, uptime: process.uptime() });
      }

      // O painel. Ele mesmo pede a chave e guarda no navegador (so em header).
      if (rota === '/' || rota === '/manager' || rota === '/manager/') {
        return html(res, await readFile(join(AQUI, 'page', 'manager.html'), 'utf8'));
      }

      // Arquivos publicos: a casca compartilhada e os worklets de audio.
      const estatico = await servirEstatico(rota);
      if (estatico) {
        res.writeHead(200, { ...cabecalhosDeSeguranca({ corsOrigin }), 'content-type': estatico.tipo });
        return res.end(estatico.corpo);
      }

      // Documentacao embutida: a casca em /docs, o indice e as paginas em
      // Markdown por idioma em docs/<idioma>/<pagina>.md. Sem credencial: nao
      // ha nada la alem de exemplos com valores ficticios.
      if (rota === '/docs' || rota === '/docs/') {
        return html(res, await readFile(join(AQUI, 'page', 'docs.html'), 'utf8'));
      }
      if (rota === '/docs/index.json') {
        const texto = await readFile(join(DOCS_DIR, 'index.json'), 'utf8');
        res.writeHead(200, { ...cabecalhosDeSeguranca({ corsOrigin }), 'content-type': 'application/json; charset=utf-8' });
        return res.end(texto);
      }
      const md = rota.match(/^\/docs\/content\/([a-z]{2}(?:-[a-z]{2})?)\/([a-z0-9-]+)\.md$/);
      if (md) {
        // Caminho montado so com os grupos validados acima: nada de `..`.
        const arquivo = normalize(join(DOCS_DIR, md[1], md[2] + '.md'));
        if (!arquivo.startsWith(normalize(DOCS_DIR) + sep)) return json(res, 404, { error: 'not_found' });
        try {
          const texto = await readFile(arquivo, 'utf8');
          res.writeHead(200, { ...cabecalhosDeSeguranca({ corsOrigin }), 'content-type': 'text/markdown; charset=utf-8' });
          return res.end(texto);
        } catch { return json(res, 404, { error: 'not_found' }); }
      }

      // ------------------------------------------- rotas no estilo Evolution
      // Quem ja integrou a Evolution API reconhece: /instance/*, /webhook/*,
      // /call/*. Sao a MESMA coisa que /manager e /instances/<nome>/api, com
      // os nomes que a comunidade ja conhece.
      const ev = rota.match(/^\/(instance|webhook|call|message|chat)\/([a-zA-Z0-9]+)(?:\/([a-z0-9_-]+))?$/);
      if (ev) {
        const [, grupo, verbo, nome] = ev;
        const admin = ehAdmin(cred);
        const alvo = nome ? cadastro.obter(nome) : null;
        if (nome && !alvo) return json(res, 404, { error: 'instance_not_found' });
        const autorizado = admin || (alvo && podeUsar(cred, alvo));
        const estadoDe = (r) => !r.running ? 'close' : r.connected ? 'open' : 'connecting';

        if (grupo === 'instance') {
          if (verbo === 'create' && req.method === 'POST') {
            if (!admin) return negar(res, req);
            const corpo = await corpoDe(req);
            let inst;
            try { inst = cadastro.criar({ name: corpo.instanceName || corpo.name, channel: corpo.channel, profileDir: corpo.profileDir || null }); }
            catch (e) { return json(res, e.code === 'already_exists' ? 409 : 400, { error: e.code || 'invalid', message: e.message }); }
            if (corpo.webhook) {
              try { inst = cadastro.atualizar(inst.name, { webhook: typeof corpo.webhook === 'string' ? { url: corpo.webhook } : corpo.webhook }); }
              catch (e) { cadastro.remover(inst.name); return json(res, 400, { error: e.code, message: e.message }); }
            }
            subir(inst);
            const r = await retrato(inst);
            return json(res, 201, { instance: { instanceName: inst.name, state: estadoDe(r), ...r }, hash: { apikey: inst.token } });
          }
          if (verbo === 'fetchInstances' && req.method === 'GET') {
            if (!admin) return negar(res, req);
            const todas = await Promise.all(cadastro.listar().map(retrato));
            return json(res, 200, todas.map(r => ({ instance: { instanceName: r.name, state: estadoDe(r), ...r } })));
          }
          if (!alvo) return json(res, 404, { error: 'not_found' });
          if (!autorizado) return negar(res, req);
          if (verbo === 'connect' && req.method === 'GET') {
            const r = await retrato(alvo);
            if (r.connected) return json(res, 200, { instance: { instanceName: alvo.name, state: 'open', phone: r.phone } });
            try {
              const q = await chamarFilha(alvo, '/api/pairing/qr', { timeout: 8000 });
              if (q.status !== 200) return json(res, q.status, q.corpo);
              return json(res, 200, { code: q.corpo.ref, base64: 'data:image/png;base64,' + q.corpo.png, ansi: q.corpo.ansi });
            } catch (e) { return json(res, 502, { error: 'instance_unreachable', message: e.message }); }
          }
          if (verbo === 'connectionState' && req.method === 'GET') {
            const r = await retrato(alvo);
            return json(res, 200, { instance: { instanceName: alvo.name, state: estadoDe(r), phone: r.phone, busy: r.busy, call: r.call } });
          }
          if (verbo === 'restart' && (req.method === 'POST' || req.method === 'PUT')) {
            await derrubar(alvo.name); const reg = vivas.get(alvo.name); if (reg) reg.tentativas = 0; subir(alvo);
            return json(res, 200, { instance: { instanceName: alvo.name, state: 'connecting' } });
          }
          if (verbo === 'logout' && req.method === 'DELETE') {
            await desparear(alvo);
            return json(res, 200, { instance: { instanceName: alvo.name, state: 'connecting' }, message: 'sessao apagada; leia o QR de novo' });
          }
          // Gerenciar o canal de FORA (o CRM): rotulo, liga/desliga e webhook num
          // POST so, e um token novo quando o antigo vazou.
          if (verbo === 'update' && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
            if (!admin) return negar(res, req);
            const corpo = await corpoDe(req);
            const campos = {};
            if ('channel' in corpo) campos.channel = corpo.channel;
            if ('enabled' in corpo) campos.enabled = corpo.enabled;
            if ('webhook' in corpo) campos.webhook = typeof corpo.webhook === 'string' ? { url: corpo.webhook } : corpo.webhook;
            let nova;
            try { nova = cadastro.atualizar(alvo.name, campos); } catch (e) { return json(res, 400, { error: e.code || 'invalid', message: e.message }); }
            if ('enabled' in campos) { if (nova.enabled) subir(nova); else await derrubar(nova.name); }
            const r = await retrato(nova);
            return json(res, 200, { instance: { instanceName: nova.name, state: estadoDe(r), ...r } });
          }
          if (verbo === 'token' && req.method === 'POST') {
            if (!admin) return negar(res, req);
            const nova = cadastro.girarToken(alvo.name);
            await derrubar(nova.name); subir(nova);
            return json(res, 200, { instance: { instanceName: nova.name }, hash: { apikey: nova.token } });
          }
          if (verbo === 'delete' && req.method === 'DELETE') {
            if (!admin) return negar(res, req);
            pararEscuta(alvo.name); await derrubar(alvo.name); vivas.delete(alvo.name); cadastro.remover(alvo.name);
            if (url.searchParams.get('purge') === '1') rmSync(join(dataDir, 'instances', alvo.name), { recursive: true, force: true });
            return json(res, 200, { status: 'SUCCESS', message: 'instancia removida' });
          }
          return json(res, 404, { error: 'not_found' });
        }

        if (!alvo) return json(res, 404, { error: 'instance_not_found' });
        if (!autorizado) return negar(res, req);

        if (grupo === 'webhook') {
          if (verbo === 'set' && req.method === 'POST') {
            const corpo = await corpoDe(req);
            const w = corpo.webhook && typeof corpo.webhook === 'object' ? corpo.webhook : corpo;
            try { cadastro.atualizar(alvo.name, { webhook: { url: w.url, enabled: w.enabled, events: w.events } }); }
            catch (e) { return json(res, 400, { error: e.code || 'invalid', message: e.message }); }
            return json(res, 200, { webhook: cadastro.obter(alvo.name).webhook });
          }
          if (verbo === 'find' && req.method === 'GET') {
            return json(res, 200, { webhook: alvo.webhook, events: EVENTOS, deliveries: entregas.get(alvo.name) || [] });
          }
          return json(res, 404, { error: 'not_found' });
        }

        // Mensagens e conversas, com os nomes e os corpos da Evolution API.
        if (grupo === 'message' || grupo === 'chat') {
          const reg = vivas.get(alvo.name);
          if (!reg || !vivo(reg.proc)) return json(res, 503, { error: 'instance_stopped' });
          const ACOES = {
            message: { sendText: 1, sendMedia: 1, sendWhatsAppAudio: 1, sendSticker: 1, sendContact: 1, sendReaction: 1 },
            chat: { whatsappNumbers: 1, fetchProfilePictureUrl: 1, updateBlockStatus: 1, sendPresence: 1, deleteMessageForEveryone: 1, updateMessage: 1, findChats: 1, findContacts: 1, findMessages: 1, getBase64FromMediaMessage: 1, markMessageAsRead: 1, fetchProfile: 1 },
          };
          if (!ACOES[grupo][verbo]) return json(res, 404, { error: 'not_found' });
          if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
          const corpo = req.method === 'POST' ? await corpoDe(req, CORPO_MAX_MIDIA) : Object.fromEntries(url.searchParams);
          try {
            const x = await chamarFilha(alvo, '/api/rpc', { method: 'POST', body: { action: verbo, params: corpo }, timeout: 65000 });
            return json(res, x.status, x.corpo);
          } catch (e) { return json(res, 502, { error: 'instance_unreachable', message: e.message }); }
        }

        if (grupo === 'call') {
          const reg = vivas.get(alvo.name);
          if (!reg || !vivo(reg.proc)) return json(res, 503, { error: 'instance_stopped' });
          const corpo = req.method === 'POST' ? await corpoDe(req) : {};
          const clientId = String(req.headers['x-client-id'] || '') || 'evolution-style';
          const filha = (caminho, body) => chamarFilha(alvo, caminho, { method: 'POST', body, headers: { 'x-client-id': clientId }, timeout: 25000 });
          if (verbo === 'offer' && req.method === 'POST') {
            const r = await retrato(alvo);
            if (r.busy) return json(res, 409, { error: 'channel_busy', message: 'esta instancia ja esta em chamada', call: r.call });
            if (!r.connected) return json(res, 409, { error: 'not_paired' });
            const x = await filha('/api/calls', { to: corpo.number || corpo.to, video: !!(corpo.isVideo ?? corpo.video) });
            return json(res, x.status, x.corpo);
          }
          if (verbo === 'status' && req.method === 'GET') { const x = await chamarFilha(alvo, '/api/calls'); return json(res, x.status, x.corpo); }
          const acoes = { accept: 'accept', reject: 'reject', hangup: 'hangup', mute: 'mute' };
          if (acoes[verbo] && req.method === 'POST') {
            if (!corpo.callId) return json(res, 400, { error: 'missing_callId' });
            const x = await filha('/api/calls/' + encodeURIComponent(corpo.callId) + '/' + acoes[verbo], { video: !!corpo.video, muted: !!corpo.muted });
            return json(res, x.status, x.corpo);
          }
          return json(res, 404, { error: 'not_found' });
        }
      }

      // ----------------------------------------------------- /manager/*
      if (rota.startsWith('/manager/')) {
        if (!ehAdmin(cred)) return negar(res, req);

        if (rota === '/manager/system' && req.method === 'GET') return json(res, 200, await sistema());
        if (rota === '/manager/config' && req.method === 'GET') {
          return json(res, 200, {
            version: versao, port: http.address().port, host, dataDir, portBase,
            apiKeyOrigem: process.env.ZAPCALL_API_KEY ? 'env' : 'arquivo', apiKeyMascarada: mascarar(apiKey),
            chromePath: process.env.CHROME_PATH || null, verbose, instancias: cadastro.listar().length,
            video: mediaConfig,
            allowedOrigins: origens, countryCode: process.env.DEFAULT_COUNTRY_CODE || null,
          });
        }
        if (rota === '/manager/instances' && req.method === 'GET') {
          return json(res, 200, { instances: await Promise.all(cadastro.listar().map(retrato)) });
        }
        if (rota === '/manager/instances' && req.method === 'POST') {
          const corpo = await corpoDe(req);
          let inst;
          try { inst = cadastro.criar({ name: corpo.name, channel: corpo.channel, profileDir: corpo.profileDir || null }); }
          catch (e) { return json(res, e.code === 'already_exists' ? 409 : 400, { error: e.code || 'invalid', message: e.message }); }
          subir(inst);
          return json(res, 201, { instance: { ...await retrato(inst), token: inst.token } });
        }
        const m = rota.match(/^\/manager\/instances\/([a-z0-9_-]+)(?:\/(qr|restart|logs|token|status|logout|webhook|selftest))?$/);
        if (m) {
          const inst = cadastro.obter(m[1]);
          if (!inst) return json(res, 404, { error: 'instance_not_found' });
          const acao = m[2] || null;
          if (!acao && req.method === 'GET') return json(res, 200, { instance: { ...await retrato(inst), token: inst.token } });
          if (!acao && req.method === 'PATCH') {
            const corpo = await corpoDe(req);
            let nova;
            try { nova = cadastro.atualizar(inst.name, corpo); }
            catch (e) { return json(res, 400, { error: e.code || 'invalid', message: e.message }); }
            if ('enabled' in corpo) { if (nova.enabled) subir(nova); else await derrubar(nova.name); }
            return json(res, 200, { instance: { ...await retrato(nova), token: nova.token } });
          }
          if (!acao && req.method === 'DELETE') {
            pararEscuta(inst.name);
            await derrubar(inst.name);
            vivas.delete(inst.name);
            cadastro.remover(inst.name);
            // `?purge=1` apaga tambem a sessao pareada. Sem ele o perfil fica,
            // e recriar a instancia com o mesmo nome volta pareada.
            if (url.searchParams.get('purge') === '1') rmSync(join(dataDir, 'instances', inst.name), { recursive: true, force: true });
            return json(res, 200, { ok: true });
          }
          if (acao === 'restart' && req.method === 'POST') {
            await derrubar(inst.name);
            const reg = vivas.get(inst.name); if (reg) reg.tentativas = 0;
            subir(inst);
            return json(res, 200, { ok: true });
          }
          if (acao === 'token' && req.method === 'POST') {
            const nova = cadastro.girarToken(inst.name);
            await derrubar(nova.name); subir(nova);
            return json(res, 200, { token: nova.token });
          }
          if (acao === 'logs' && req.method === 'GET') {
            return json(res, 200, { logs: (vivas.get(inst.name) || { logs: [] }).logs });
          }
          if (acao === 'status' && req.method === 'GET') return json(res, 200, await retrato(inst));
          if (acao === 'logout' && req.method === 'POST') { await desparear(inst); return json(res, 200, { ok: true }); }
          if (acao === 'selftest' && req.method === 'POST') return json(res, 200, await autoteste(inst));
          if (acao === 'webhook' && req.method === 'GET') return json(res, 200, { webhook: inst.webhook, events: EVENTOS, deliveries: entregas.get(inst.name) || [] });
          if (acao === 'qr' && req.method === 'GET') {
            try {
              const r = await chamarFilha(inst, '/api/pairing/qr', { timeout: 8000 });
              return json(res, r.status, r.corpo);
            } catch (e) { return json(res, 502, { error: 'instance_unreachable', message: e.message }); }
          }
        }
        return json(res, 404, { error: 'not_found' });
      }

      // --------------------------------------------- /instances/:name/*
      const mi = rota.match(/^\/instances\/([a-z0-9_-]+)(\/.*)?$/);
      if (mi) {
        const inst = cadastro.obter(mi[1]);
        if (!inst) return json(res, 404, { error: 'instance_not_found' });
        // Os worklets sao codigo publico carregados por <script> SEM credencial
        // pelo discador; exigir token aqui deixava o discador sem audio.
        const publico = (mi[2] || '').startsWith('/static/');
        if (!publico && !podeUsar(cred, inst)) return negar(res, req);
        const reg = vivas.get(inst.name);
        if (!reg || !vivo(reg.proc)) return json(res, 503, { error: 'instance_stopped' });
        let caminho = (mi[2] || '/') + url.search;

        // UMA chamada por canal. O WhatsApp Web recusaria a segunda de qualquer
        // jeito, mas com um erro cru no meio da UI; aqui a recusa e antes e diz
        // o porque — e o CRM mostra "canal em uso" em vez de tentar.
        if (mi[2] === '/api/calls' && req.method === 'POST') {
          const r = await retrato(inst);
          if (r.busy) return json(res, 409, { error: 'channel_busy', message: 'esta instancia ja esta em chamada', call: r.call });
          if (!r.connected) return json(res, 409, { error: 'not_paired', message: 'instancia sem sessao pareada' });
        }
        // Paginas do filho exigem ?token= dele; quem chegou aqui ja se autenticou.
        if (mi[2] === '/dialer' || mi[2] === '/discador' || mi[2] === '/pair') {
          const u = new URL(caminho, 'http://x'); u.searchParams.set('token', inst.token);
          caminho = u.pathname + u.search;
        }
        return proxy(req, res, inst, caminho);
      }

      return json(res, 404, { error: 'not_found', dica: 'GET / e a pagina de configuracoes; /instances/<nome>/api/... e a API de cada instancia' });
    } catch (e) {
      if (e && e.code === 413) return json(res, 413, { error: 'payload_too_large' });
      return json(res, 500, { error: 'falha', message: String(e && e.message || e) });
    }
  });

  // ----------------------------------------------------------- WebSocket
  // /instances/:name/ws -> ws da filha. Repasse cru nos dois sentidos, quadros
  // binarios (a midia) inclusive; o token que vai para a filha e o dela.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  http.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    const m = url.pathname.match(/^\/instances\/([a-z0-9_-]+)\/ws$/);
    if (!m) { socket.destroy(); return; }
    const recusar = (codigo, texto) => { try { socket.write('HTTP/1.1 ' + codigo + ' ' + texto + '\r\nConnection: close\r\n\r\n'); } catch {} socket.destroy(); };
    const ip = String(socket.remoteAddress || '');
    if (limitador.bloqueado(ip)) return recusar(429, 'Too Many Requests');
    if (!origemPermitida(req.headers.origin, origens)) return recusar(403, 'Forbidden');
    const inst = cadastro.obter(m[1]);
    if (!inst || !podeUsar(credencial(req, url), inst)) { limitador.falhou(ip); return recusar(401, 'Unauthorized'); }
    limitador.sucesso(ip);
    const params = new URLSearchParams(url.search);
    params.set('token', inst.token);
    const filha = new WebSocket('ws://127.0.0.1:' + inst.port + '/ws?' + params.toString());
    filha.binaryType = 'arraybuffer';
    filha.on('error', () => { try { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {} socket.destroy(); });
    filha.once('open', () => {
      try { filha._socket && filha._socket.setNoDelay(true); } catch {}
      wss.handleUpgrade(req, socket, head, (cliente) => {
        try { socket.setNoDelay(true); } catch {}
        cliente.binaryType = 'arraybuffer';
        let idaEsperaKeyframe = true, voltaEsperaKeyframe = false;
        const byteDe = (dados, indice) => {
          if (dados instanceof ArrayBuffer) return new Uint8Array(dados)[indice];
          if (ArrayBuffer.isView(dados)) return new Uint8Array(dados.buffer, dados.byteOffset, dados.byteLength)[indice];
          return undefined;
        };
        const pedirKeyframe = (motivo) => {
          if (cliente.readyState !== 1) return;
          try { cliente.send(JSON.stringify({ type: 'media-control', action: 'request-keyframe', reason: motivo })); } catch {}
        };
        cliente.on('message', (d, bin) => {
          if (filha.readyState !== 1) return;
          if (!bin) { filha.send(d, { binary: false }); return; }
          const kind = byteDe(d, 0);
          if (kind === 1 && filha.bufferedAmount > 4 * (4 + 960 * 2)) return;
          if (kind === 2) {
            const keyframe = !!(byteDe(d, 1) & 1);
            if (idaEsperaKeyframe && !keyframe) { pedirKeyframe('manager-waiting-keyframe'); return; }
            if (filha.bufferedAmount > mediaConfig.relayQueueBytes) {
              idaEsperaKeyframe = true; pedirKeyframe('manager-backpressure'); return;
            }
            if (keyframe) idaEsperaKeyframe = false;
          }
          filha.send(d, { binary: true });
        });
        filha.on('message', (d, bin) => {
          if (cliente.readyState !== 1) return;
          if (!bin) { cliente.send(d, { binary: false }); return; }
          const kind = byteDe(d, 0);
          if (kind === 1 && cliente.bufferedAmount > 4 * (4 + 960 * 2)) return;
          if (kind === 2) {
            const keyframe = !!(byteDe(d, 1) & 1);
            if (voltaEsperaKeyframe && !keyframe) return;
            if (cliente.bufferedAmount > mediaConfig.relayQueueBytes * 2) { voltaEsperaKeyframe = true; return; }
            if (keyframe) voltaEsperaKeyframe = false;
          }
          cliente.send(d, { binary: true });
        });
        cliente.on('close', () => filha.close());
        filha.on('close', () => cliente.close());
        cliente.on('error', () => filha.close());
      });
    });
  });

  await new Promise((ok, erro) => { http.once('error', erro); http.listen(port, host, ok); });
  log('ouvindo em http://' + host + ':' + http.address().port + ' | cadastro ' + cadastro.arquivo);

  for (const inst of cadastro.listar()) if (inst.enabled) subir(inst);
  if (!cadastro.listar().length) log('nenhuma instancia ainda: abra http://' + host + ':' + http.address().port + '/ e crie a primeira');

  return {
    // A porta REAL (com port 0 o sistema escolhe uma).
    port: http.address().port, host, apiKey, dataDir, cadastro, origens,
    retrato: (nome) => { const i = cadastro.obter(nome); return i ? retrato(i) : null; },
    async parar() {
      for (const nome of [...escutas.keys()]) pararEscuta(nome);
      await Promise.all([...vivas.keys()].map(derrubar));
      for (const c of wss.clients) c.terminate();
      await new Promise(ok => { http.close(ok); http.closeAllConnections(); });
    },
  };
}

const executadoDireto = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (executadoDireto) {
  const g = await iniciarGerente({ verbose: process.env.VERBOSE !== '0' });
  console.log('[gerente] configuracoes em http://' + g.host + ':' + g.port + '/');
  // A chave NUNCA vai inteira para o log (logs sao copiados, enviados,
  // guardados). Quem precisa dela le o arquivo ou define a variavel.
  if (!process.env.ZAPCALL_API_KEY) console.log('[gerente] chave global ' + mascarar(g.apiKey) + ' — inteira em ' + join(g.dataDir, 'manager.json') + ' (ou defina ZAPCALL_API_KEY)');
  const sair = async () => { await g.parar(); process.exit(0); };
  process.on('SIGINT', sair); process.on('SIGTERM', sair);
}

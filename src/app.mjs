// Fiacao: servidor primeiro (ele conhece a porta), navegador depois (ele
// precisa da porta para a ponte de midia), e as acoes do navegador
// entregues ao servidor no fim.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarServidor } from './server.mjs';
import { abrirNavegador } from './browser.mjs';
import { blocoDeLog } from './qr.mjs';
import { configurarMidia } from './media-config.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

export async function iniciarApp(op = {}) {
  // `op.port` 0 e legitimo (porta efemera, nos testes): nao pode cair no `||`.
  const port = op.port != null ? Number(op.port) : Number(process.env.PORT || 18475);
  const host = op.host || process.env.HOST || '127.0.0.1';
  const token = op.token ?? process.env.ZAPCALL_TOKEN ?? '';
  const verbose = op.verbose ?? (process.env.VERBOSE === '1');
  const profileDir = resolve(op.profileDir || process.env.PROFILE_DIR || join(AQUI, '..', 'data', 'profile'));
  const headful = op.headful ?? (process.env.HEADFUL === '1');
  const mediaConfig = configurarMidia(op.mediaConfig || process.env);

  mkdirSync(profileDir, { recursive: true });

  const servidor = criarServidor({ port, host, token, verbose, mediaConfig });
  await servidor.ouvir();

  const opcoesNav = {
    profileDir,
    chromePath: op.chromePath || process.env.CHROME_PATH || '',
    headful, port, token, verbose, mediaConfig,
    url: op.url,
    onEvent: servidor.aplicarEvento,
  };
  let nav = await abrirNavegador(opcoesNav);
  servidor.ligarAcoes(nav);

  // Vigia do pareamento. Num container nao ha janela: o QR TEM de sair no
  // stdout, senao ninguem pareia. Ele gira a cada ~20 s, e cada novo QR e
  // impresso — um QR velho no log nao serve para nada.
  const qrNoTerminal = (op.qrNoTerminal ?? (process.env.QR_TERMINAL !== '0'));
  const maxQr = Number(process.env.QR_MAX || 30);
  let ultimoRef = null;
  let contaQr = 0;
  let pausado = false;
  let estavaConectado = null;
  let ultimaMudanca = Date.now();
  let recarregando = false;
  /**
   * Quanto tempo sem o QR girar antes de considerar EXPIRADO.
   *
   * ESTE PRAZO E REDE DE SEGURANCA, NAO O GATILHO. Quem renova o QR e o sinal
   * do proprio WhatsApp Web (o botao "Selecione para recarregar o QR code").
   *
   * Medido em 10/09/2026: o codigo gira sozinho a cada ~20 s, seis vezes, e o
   * botao aparece por volta dos 2:48. Duas versoes deste vigia atropelaram
   * isso: recarregar a cada 30 s fazia o QR sumir embaixo de quem estava
   * lendo, e um gatilho de 45 s sem rotacao disparava ANTES de o botao existir
   * — recarregando a pagina a esmo. Por isso o prazo agora e longo e serve
   * apenas para destravar uma pagina realmente morta.
   */
  const qrParadoMs = Number(process.env.QR_STALE_MS || 180000);

  let recriando = false;
  /**
   * Ressuscita o navegador. Sem isto, uma aba que morre deixa o servico
   * inutil e calado — foi exatamente o que aconteceu em 10/09/2026: a pagina
   * fechou sozinha e /api/pairing/qr passou a devolver 404 para sempre.
   */
  async function recriarNavegador(motivo) {
    if (recriando) return;
    recriando = true;
    console.log('[zapcall] navegador morreu (' + motivo + ') — recriando');
    try {
      try { await nav.fechar(); } catch {}
      nav = await abrirNavegador(opcoesNav);
      servidor.ligarAcoes(nav);
      ultimoRef = null; ultimaMudanca = Date.now(); contaQr = 0; pausado = false;
      console.log('[zapcall] navegador de pe novamente');
    } catch (e) {
      console.log('[zapcall] FALHA ao recriar o navegador: ' + (e && e.message));
    } finally { recriando = false; }
  }
  servidor.definirSondaDeVida(() => !recriando && nav.vivo());
  servidor.definirAoPedirQr(() => { if (pausado) { pausado = false; contaQr = 0; } });

  const relogio = setInterval(async () => {
    if (recriando) return;
    if (!nav.vivo()) { await recriarNavegador('aba fechada ou browser desconectado'); return; }

    const s = await nav.status();
    if (s) servidor.definirConta(s);

    const conectado = !!(s && s.connected);
    if (conectado !== estavaConectado) {
      const antes = estavaConectado;
      estavaConectado = conectado;
      if (conectado) {
        console.log('[zapcall] PAREADO — jid ' + s.jid + ' | telefone ' + (s.phone || '?'));
        ultimoRef = null; contaQr = 0; pausado = false; ultimaMudanca = Date.now();
      } else if (antes === true) {
        // So quando ESTAVA pareada: no boot sem sessao nao ha o que "cair".
        console.log('[zapcall] sessao CAIU — e preciso parear de novo (QR)');
      } else if (antes === null) {
        console.log('[zapcall] sem sessao pareada — aguardando leitura do QR');
      }
    }
    if (conectado || !qrNoTerminal || pausado) return;

    const qr = await nav.qr().catch(() => null);
    if (!qr || !qr.ref || qr.ref === ultimoRef) {
      // QR expirado vira um botao de recarregar que ninguem vai clicar dentro
      // do container. Recarregar a pagina traz codigo novo, e nao depende de
      // seletor nem do idioma da interface.
      if (recarregando) return;

      // GATILHO 1 (o certo): o WhatsApp Web dizendo que o codigo expirou.
      const sinal = await nav.sinalDeQrExpirado();
      if (sinal.expirado) {
        recarregando = true;
        try {
          const clicou = await nav.clicarRecarregarQr();
          console.log('[zapcall] QR expirou ("' + sinal.rotulo + '") — '
            + (clicou ? 'cliquei para renovar' : 'nao consegui clicar, recarregando'));
          if (!clicou) await nav.recarregar();
          ultimaMudanca = Date.now(); ultimoRef = null;
        } catch (e) { console.log('[zapcall] falha ao renovar o QR: ' + (e && e.message)); }
        finally { recarregando = false; }
        return;
      }

      // GATILHO 2 (rede de seguranca): pagina morta de verdade.
      if (Date.now() - ultimaMudanca > qrParadoMs && await nav.telaDoQr()) {
        recarregando = true;
        try {
          console.log('[zapcall] ' + Math.round(qrParadoMs / 1000) + 's sem QR novo e sem sinal de expiracao'
            + ' — recarregando. Botoes na tela: ' + JSON.stringify(sinal.botoes));
          await nav.recarregar();
          ultimaMudanca = Date.now(); ultimoRef = null;
        } catch (e) { console.log('[zapcall] falha ao recarregar: ' + (e && e.message)); }
        finally { recarregando = false; }
      }
      return;
    }
    ultimoRef = qr.ref;
    ultimaMudanca = Date.now();
    contaQr += 1;
    if (contaQr > maxQr) {
      pausado = true;
      console.log('[zapcall] ' + maxQr + ' QRs sem ninguem parear; parei de imprimir.'
        + ' Para retomar: reinicie o container, ou peca sob demanda com'
        + ' curl -s http://127.0.0.1:' + port + '/api/pairing/qr | jq -r .ansi');
      return;
    }
    const bloco = await blocoDeLog(qr.ref, contaQr);
    if (bloco) console.log(bloco);
  }, 3000);

  // Filho do gerente: se o gerente morrer (SIGKILL, OOM, `docker kill`) sem
  // conseguir derrubar ninguem, cada instancia se derruba sozinha — senao
  // ficam um node e um Chrome orfaos por canal, ocupando porta e memoria.
  let vigiaPai = null;
  const paiPid = Number(op.parentPid ?? process.env.ZAPCALL_PARENT_PID) || 0;
  if (paiPid) {
    vigiaPai = setInterval(() => {
      let vivo = true;
      try { process.kill(paiPid, 0); } catch { vivo = false; }
      if (!vivo || process.ppid !== paiPid) {
        console.log('[zapcall] gerente (pid ' + paiPid + ') sumiu — encerrando esta instancia');
        clearInterval(vigiaPai);
        parar().finally(() => process.exit(0));
      }
    }, 5000);
  }

  async function parar() {
    clearInterval(relogio);
    if (vigiaPai) clearInterval(vigiaPai);
    await nav.fechar();
    await servidor.fechar();
  }

  return {
    servidor, port, host, token, profileDir,
    // Getter: o navegador pode ser TROCADO por um novo a qualquer momento.
    get nav() { return nav; },
    parar,
  };
}

const executadoDireto = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (executadoDireto) {
  // Os sinais sao tratados ANTES de o app existir: o puppeteer registra o
  // proprio SIGTERM ao lancar o Chrome (e com um ouvinte instalado o node
  // deixa de encerrar sozinho). Sem isto, um SIGTERM no meio do boot deixava
  // um node vivo, sem servidor e sem navegador, ate o gerente dar SIGKILL.
  let app = null, saindo = false;
  const sair = async () => {
    if (saindo) return; saindo = true;
    try { if (app) await app.parar(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', sair); process.on('SIGTERM', sair);
  app = await iniciarApp({ verbose: true });
  if (saindo) { await sair(); }
  console.log('[zapcall] API em http://' + app.host + ':' + app.port + ' | perfil ' + app.profileDir);
}

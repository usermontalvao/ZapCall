// Ciclo de vida do Chrome e a injecao. Nada de API publica aqui.
import { readFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { preludio } from './page/worklets.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const WA_URL = 'https://web.whatsapp.com';

/** Onde o Chrome costuma estar, em ordem: container primeiro, Mac depois. */
const CAMINHOS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function acharChrome(preferido) {
  if (preferido) return preferido;
  for (const c of CAMINHOS) if (existsSync(c)) return c;
  throw new Error('Chrome nao encontrado. Defina CHROME_PATH.');
}

/**
 * O perfil E a sessao pareada. Container morto de repente deixa o perfil
 * trancado, e o Chrome seguinte sobe num diretorio temporario sem sessao —
 * some o pareamento sem nenhum erro visivel.
 */
function destrancarPerfil(dir) {
  for (const nome of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { rmSync(join(dir, nome), { force: true }); } catch {}
  }
}

export async function abrirNavegador(opcoes) {
  const {
    profileDir, chromePath, headful = false, port, token = '',
    verbose = false, url = WA_URL, onEvent = () => {}, mediaConfig = null,
  } = opcoes;

  destrancarPerfil(profileDir);

  const args = [
    '--user-data-dir=' + profileDir,
    // Concede microfone e camera sem clique humano. Num container nao ha
    // ninguem para clicar em "Permitir".
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    // O web.whatsapp.com e um site PUBLICO falando com o loopback: sem isto o
    // Chrome barra a ponte com ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS.
    // Nao e CSP nem conteudo misto — Page.setBypassCSP nao resolve.
    '--disable-features=Translate,MediaRouter,OptimizationHints,LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests',
    '--allow-running-insecure-content',
    '--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:' + port + ',ws://127.0.0.1:' + port,
    '--window-size=1280,900',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ];
  // O compose reserva 1 GB de /dev/shm justamente para os frames do Chrome.
  // Forcar /tmp anulava essa reserva e piorava o caminho de video na VPS.
  // A flag continua disponivel como escape para ambientes sem shm utilizavel.
  if (process.env.CHROME_DISABLE_DEV_SHM_USAGE === '1') args.push('--disable-dev-shm-usage');
  if (process.env.CHROME_NO_SANDBOX === '1') args.push('--no-sandbox', '--disable-setuid-sandbox');

  const browser = await puppeteer.launch({
    executablePath: acharChrome(chromePath),
    headless: !headful,
    args,
    defaultViewport: null,
    protocolTimeout: 120000,
  });

  const paginas = await browser.pages();
  const page = paginas[0] || await browser.newPage();

  // O connect-src do web.whatsapp.com barraria o WebSocket da pagina para o
  // agente. Sem esta linha o Plano A de midia "misteriosamente nao funciona".
  await page.setBypassCSP(true);
  // Mantem versao e plataforma REAIS do Chrome instalado. So remove a marca
  // Headless, em vez de fingir para sempre ser um Chrome 131 de macOS.
  const userAgent = (await browser.userAgent()).replace(/HeadlessChrome\//g, 'Chrome/');
  await page.setUserAgent(userAgent);

  // A ponte de eventos tem de existir ANTES dos scripts injetados.
  await page.exposeFunction('__zapcallEvent', (json) => {
    try { onEvent(JSON.parse(json)); } catch { /* evento malformado, ignora */ }
  });

  const injecao = await readFile(join(AQUI, 'page', 'inject.js'), 'utf8');
  const controle = await readFile(join(AQUI, 'page', 'control.js'), 'utf8');
  const nativeMedia = await readFile(join(AQUI, 'page', 'native-media.js'), 'utf8');
  const mensagens = await readFile(join(AQUI, 'page', 'messaging.js'), 'utf8');
  const waJs = await readFile(
    join(AQUI, '..', 'node_modules', '@wppconnect', 'wa-js', 'dist', 'wppconnect-wa.js'),
    'utf8',
  );

  const cfg = JSON.stringify({ port, token, verbose, media: mediaConfig });
  // Ordem obrigatoria: worklets -> ganchos de midia -> wa-js -> controle. Os
  // ganchos tem de estar de pe antes de qualquer script da Meta guardar a
  // referencia original.
  // Worklets e ganchos vao num script SO: nao existe "o preludio rodou e o
  // inject nao" (ou o contrario) — ou os dois entram, ou nenhum.
  await page.evaluateOnNewDocument(preludio() + '\n' + injecao.replace('__ZC_CONFIG__', cfg));
  await page.evaluateOnNewDocument(waJs);
  await page.evaluateOnNewDocument(controle);
  await page.evaluateOnNewDocument(nativeMedia);
  await page.evaluateOnNewDocument(mensagens);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

  /**
   * Uma recarga em curso destaca o frame, e QUALQUER evaluate no meio dela
   * estoura com "Attempted to use detached Frame". Nao e erro de verdade: e
   * corrida. Uma segunda tentativa depois de meio segundo resolve.
   */
  async function resiliente(fn, valorPadrao = null) {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try { return await fn(); }
      catch (e) {
        const msg = String(e && e.message || e);
        if (tentativa === 1 || !/detached|Execution context|Target closed/i.test(msg)) {
          if (tentativa === 1) return valorPadrao;
          throw e;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return valorPadrao;
  }

  let caiu = false;
  browser.on('disconnected', () => { caiu = true; });
  page.on('close', () => { caiu = true; });

  return {
    browser,
    page,

    /**
     * A pagina ainda existe? Chrome headless de longa duracao MORRE — aba
     * derrubada, renderer estourado, browser desconectado. Quando isso
     * acontece o servico continua de pe respondendo 404 em /api/pairing/qr
     * para sempre: `healthz` verde e servico inutil. Quem vigia isto e o
     * app.mjs, que recria o navegador.
     */
    vivo() {
      try { return !caiu && browser.connected !== false && !page.isClosed(); }
      catch { return false; }
    },

    /**
     * Fecha o Chrome — e garante. `browser.close()` espera o navegador
     * responder pelo CDP; um Chrome travado nunca responde, e o processo
     * ficaria vivo para sempre (com o perfil trancado). Depois do prazo, o
     * processo e morto na marra.
     */
    async fechar() {
      const proc = browser.process();
      try { await Promise.race([browser.close(), new Promise(r => setTimeout(r, 8000))]); } catch {}
      try { if (proc && proc.exitCode === null && !proc.killed) proc.kill('SIGKILL'); } catch {}
    },

    /**
     * A pagina ainda esta mostrando o QR? Se alguem acabou de LER o codigo, o
     * WhatsApp Web troca essa tela por um carregamento — e recarregar ali
     * derrubaria o pareamento no meio do handshake.
     */
    /**
     * O QR expirou e virou botao? Clica nele. Medido em 10/09/2026: o WhatsApp
     * Web renova o codigo sozinho a cada ~20 s e SO aos ~2:48 troca por
     * "Selecione para recarregar o QR code". Clicar e menos invasivo que
     * recarregar a pagina — nao joga fora o estado do cliente.
     */
    async clicarRecarregarQr() {
      return page.evaluate(() => {
        const alvos = [...document.querySelectorAll('button,[role="button"]')];
        const casa = (b) => /recarregar|reload|refresh|actualizar|atualizar/i.test(
          (b.innerText || '') + ' ' + (b.getAttribute('aria-label') || ''),
        );
        const b = document.querySelector('div[data-ref] button, div[data-ref] [role="button"]') || alvos.find(casa);
        if (!b) return false;
        b.click();
        return true;
      }).catch(() => false);
    },

    async telaDoQr() {
      return page.evaluate(() => !!document.querySelector('div[data-ref]')).catch(() => false);
    },

    /**
     * Recarrega a pagina. E o jeito de conseguir um QR novo sem depender de
     * seletor nem de idioma: quando o codigo expira, o WhatsApp Web troca o QR
     * por um botao "clique para recarregar" — e num container headless nao
     * existe ninguem para clicar. Os scripts injetados voltam sozinhos, porque
     * a injecao e por documento.
     */
    async recarregar() {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    },

    /** Retrato dos ganchos, direto da pagina. */
    async diagnostico() {
      return page.evaluate(() => ({
        zapcall: window.__zapcall || null,
        wpp: !!(window.WPP && window.WPP.isReady),
        controle: !!window.__zapcallControl,
        h264: null,
      })).catch(() => null);
    },

    async status() {
      return resiliente(
        () => page.evaluate(() => (window.__zapcallControl ? window.__zapcallControl.status() : null)),
        null,
      );
    },

    async dial(numero, video) {
      return page.evaluate((n, v) => window.__zapcallControl.dial(n, v), numero, !!video);
    },
    async accept(callId) { return page.evaluate((id) => window.__zapcallControl.accept(id), callId || null); },
    async reject(callId) { return page.evaluate((id) => window.__zapcallControl.reject(id), callId || null); },
    async end() { return page.evaluate(() => window.__zapcallControl.end()); },
    /** Mensagens, contatos, presenca: uma acao do messaging.js, por nome. */
    async rpc(acao, params) {
      return page.evaluate(async (a, p) => {
        try { return { ok: true, result: await window.__zapcallMessaging.rpc(a, p) }; }
        catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      }, acao, params || {});
    },

    /**
     * Avalia codigo NA PAGINA. Existe so para depuracao e nasce DESLIGADO:
     * exposto pelo tunel, seria execucao remota de codigo dentro da sessao do
     * WhatsApp da instancia. Ver DEBUG_EVAL em server.mjs.
     */
    async avaliar(codigo) {
      return page.evaluate(async (src) => {
        try {
          const r = await (0, eval)(src);
          try { return { ok: true, valor: JSON.parse(JSON.stringify(r ?? null)) }; }
          catch { return { ok: true, valor: String(r) }; }
        } catch (e) {
          return { ok: false, erro: String(e && e.message || e), pilha: String(e && e.stack || '').slice(0, 600) };
        }
      }, codigo);
    },

    /** O que a pagina sabe sobre chamadas, cru. Ver control.js. */
    async debugChamadas() {
      return resiliente(() => page.evaluate(() => (window.__zapcallControl ? window.__zapcallControl.debug() : null)), null);
    },

    /**
     * O QR do pareamento. Devolve PNG em base64 — quem le e um humano com o
     * celular na mao, e o CRM ja sabe exibir `session-qr`.
     */
    async qr() {
      return resiliente(() => this.qrCru(), null);
    },

    /**
     * Só o payload, sem screenshot. A pagina /pair pergunta a cada 2 s: tirar
     * print do canvas nessa cadencia e CDP a rodo por nada, ja que o PNG que
     * vale e desenhado do payload.
     */
    async qrRef() {
      return resiliente(() => page.evaluate(() => {
        const c = document.querySelector('div[data-ref]');
        return c ? { ref: c.getAttribute('data-ref'), temCanvas: !!c.querySelector('canvas') } : null;
      }), null);
    },

    /**
     * O sinal REAL de QR expirado: o WhatsApp Web troca o codigo por um botao
     * ("Selecione para recarregar o QR code"). Devolve tambem a lista de
     * botoes visiveis — se um dia o texto mudar, o log mostra o que havia na
     * tela em vez de sumir com um "sem botao".
     */
    async sinalDeQrExpirado() {
      return resiliente(() => page.evaluate(() => {
        const rotulo = (b) => ((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).trim();
        const botoes = [...document.querySelectorAll('button,[role="button"]')];
        const casa = botoes.find(b => /recarregar|reload|refresh|actualizar|atualizar/i.test(rotulo(b)));
        return {
          expirado: !!casa,
          rotulo: casa ? rotulo(casa).slice(0, 60) : null,
          botoes: botoes.map(rotulo).filter(Boolean).slice(0, 6),
        };
      }), { expirado: false, rotulo: null, botoes: [] });
    },

    async qrCru() {
      const seletores = ['div[data-ref] canvas', '[data-testid="qrcode"] canvas', 'canvas[aria-label]', 'canvas'];
      for (const sel of seletores) {
        const el = await page.$(sel);
        if (!el) continue;
        const png = await el.screenshot({ encoding: 'base64' }).catch(() => null);
        if (png) {
          const ref = await page.$eval('div[data-ref]', d => d.getAttribute('data-ref')).catch(() => null);
          return { png, ref, seletor: sel };
        }
      }
      return null;
    },

    async captura() { return page.screenshot({ encoding: 'base64', fullPage: false }); },

    /**
     * Pixels crus do canvas do QR. Existe para o autoteste DECODIFICAR o que
     * esta na tela e confrontar com o `data-ref` — e assim garantir que o QR
     * impresso no terminal e o mesmo que o WhatsApp esta mostrando.
     */
    async qrPixels() {
      return page.evaluate(() => {
        const c = document.querySelector('div[data-ref] canvas');
        if (!c) return null;
        const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        let bin = '';
        for (let i = 0; i < img.data.length; i++) bin += String.fromCharCode(img.data[i]);
        return { b64: btoa(bin), w: c.width, h: c.height };
      }).catch(() => null);
    },
  };
}

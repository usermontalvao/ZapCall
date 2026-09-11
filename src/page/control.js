// Camada de CONTROLE, injetada depois do wa-js.
//
// O estado da chamada e LIDO do proprio WhatsApp Web (CallModel.getState()),
// nunca inferido da midia. Foi exatamente esse palpite que fazia o cronometro
// do CRM disparar quando o relay subia, com o telefone do contato apenas
// chamando.
(() => {
  'use strict';
  const relatar = (ev) => { try { window.__zapcallEvent(JSON.stringify(ev)); } catch {} };
  // Timers nativos presos pelo inject.js: o clearInterval que o WhatsApp Web
  // instala depois NAO cancela relogios nativos — e foi assim que o portao
  // abaixo "parava" e o iniciar() continuava rodando a cada 250 ms.
  const timers = window.__zapcallTimers || {
    setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window),
    setTimeout: window.setTimeout.bind(window),
  };

  /** CALL_STATES do WhatsApp Web -> o vocabulario que o CRM ja entende. */
  const MAPA = {
    1: { status: 'ringing' }, 2: { status: 'ringing' },
    3: { status: 'ringing' }, 4: { status: 'connecting' },
    5: { status: 'connecting' }, 6: { status: 'active' },
    7: { status: 'ended', reason: 'accepted_elsewhere' },
    8: { status: 'ringing' }, 9: { status: 'connecting' },
    12: { status: 'ringing' }, 13: { status: 'ended', reason: 'terminate' },
    INCOMING_RING: { status: 'ringing' },
    OUTGOING_RING: { status: 'ringing' },
    OUTGOING_CALLING: { status: 'ringing' },
    PreCalling: { status: 'ringing' },
    CONNECTING: { status: 'connecting' },
    ACTIVE: { status: 'active' },
    ENDED: { status: 'ended', reason: 'terminate' },
    REJECTED: { status: 'ended', reason: 'rejected' },
    NOT_ANSWERED: { status: 'ended', reason: 'missed' },
    HANDLED_REMOTELY: { status: 'ended', reason: 'accepted_elsewhere' },
    REMOTE_CALL_IN_PROGRESS: { status: 'ended', reason: 'busy' },
    CONNECTION_LOST: { status: 'ended', reason: 'connection_lost' },
    FAILED: { status: 'ended', reason: 'relay_failed' },
  };

  function wid(v) {
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (typeof v._serialized === 'string') return v._serialized;
    if (typeof v.toString === 'function') { const s = v.toString(); return s === '[object Object]' ? null : s; }
    return null;
  }

  function conta() {
    const W = window.WPP;
    try {
      const eu = (W.conn && W.conn.getMyUserId && W.conn.getMyUserId())
        || (W.whatsapp && W.whatsapp.UserPrefs && W.whatsapp.UserPrefs.getMaybeMeUser && W.whatsapp.UserPrefs.getMaybeMeUser())
        || (W.whatsapp && W.whatsapp.Conn && W.whatsapp.Conn.wid);
      const jid = wid(eu);
      return {
        jid,
        // O telefone da conta e o que liga esta sessao ao canal do CRM.
        phone: jid ? String(jid).replace(/@.*$/, '').replace(/[^0-9]/g, '') || null : null,
        pushName: (W.whatsapp && W.whatsapp.Conn && W.whatsapp.Conn.pushname) || 'ZapCall',
        connected: !!(W.conn && W.conn.isAuthenticated && W.conn.isAuthenticated()),
      };
    } catch {
      return { jid: null, phone: null, pushName: 'ZapCall', connected: false };
    }
  }

  function linha(m, conectada) {
    let bruto = 'None';
    try { bruto = String(m.getState()); } catch {}
    // `isInConnectedCall` e a verdade do atendimento neste build; o getState()
    // do modelo nem sempre existe. Atendimento NUNCA e inferido da midia.
    const traduzido = Object.assign({}, MAPA[bruto] || { status: 'ringing' });
    if (conectada && traduzido.status !== 'ended') traduzido.status = 'active';
    const peer = wid(m.peerJid) || wid(m.sender) || '';
    const digitos = peer.replace(/@.*$/, '').replace(/[^0-9]/g, '');
    const ehLid = /@lid$/.test(peer);
    return {
      callId: m.id,
      direction: m.outgoing ? 'outbound' : 'inbound',
      status: traduzido.status,
      raw: bruto,
      peer,
      // LID NUNCA vira telefone. Sem sufixo @lid os digitos sao o numero.
      phone: ehLid ? null : (digitos || null),
      lid: ehLid ? peer : null,
      isVideo: !!m.isVideo,
      isGroup: !!m.isGroup,
      offerTime: Number(m.offerTime) || Date.now(),
      endReason: traduzido.reason || null,
    };
  }

  /**
   * O estado da chamada NAO esta na colecao de modelos do CallStore.
   *
   * Medido em 10/09/2026 com uma ligacao ATIVA em curso:
   * `CallStore.getModelsArray()` devolvia `[]`. O wa-js 4.6.0 le exatamente
   * essa colecao — por isso a ligacao acontecia e o sistema nao via nada.
   * Neste build valem as propriedades do proprio store: `activeCall` (o modelo
   * vivo), `isInConnectedCall` (atendida ou nao), `pendingOutgoingCall` e
   * `lastActiveCall` (para saber o que acabou).
   */
  function varrer() {
    const W = window.WPP;
    try {
      const S = W.whatsapp && W.whatsapp.CallStore;
      if (!S) return [];
      const m = S.activeCall || S.pendingOutgoingCall || null;
      if (!m || typeof m.id !== 'string' || !m.id) return [];
      return [linha(m, !!S.isInConnectedCall)];
    } catch { return []; }
  }

  let anterior = new Map();
  function publicar() {
    const agora = new Map(varrer().map(l => [l.callId, l]));
    for (const [id, l] of agora) {
      const velho = anterior.get(id);
      if (!velho) { relatar({ type: 'call', phase: 'new', call: l }); continue; }
      if (velho.status !== l.status || velho.raw !== l.raw || velho.isVideo !== l.isVideo) {
        relatar({ type: 'call', phase: 'update', call: l });
      }
    }
    for (const [id, velho] of anterior) {
      if (!agora.has(id) && velho.status !== 'ended') {
        // Sumiu do store: acabou. O motivo, quando o build informa, vem do
        // ultimo estado conhecido do modelo.
        let motivo = velho.endReason;
        try {
          const ult = window.WPP.whatsapp.CallStore.lastActiveCall;
          if (ult && ult.id === id && ult.getState) {
            const t = MAPA[String(ult.getState())];
            if (t && t.reason) motivo = t.reason;
          }
        } catch {}
        relatar({ type: 'call', phase: 'update', call: { ...velho, status: 'ended', endReason: motivo || 'terminate' } });
        // Fim de chamada: o codificador de video da ponte nao pode sobreviver
        // a ela (a proxima chamada nasceria com estado da anterior).
        try { window.__zapcallMedia && window.__zapcallMedia.encerrar && window.__zapcallMedia.encerrar(); } catch {}
      }
    }
    anterior = agora;
  }

  /**
   * O portao NAO pode ser `WPP.isReady`: na tela do QR ele fica false para
   * sempre (medido: 60 s), enquanto `WPP.call.offer` e o `CallStore` ja existem
   * desde os primeiros segundos. Esperar por `isReady` deixava a camada de
   * controle sem nascer justamente quando ela e necessaria para parear e
   * diagnosticar. Esperamos pelo que de fato usamos.
   */
  function modulosProntos() {
    // TEM de ser a prova de excecao: os acessos do wa-js sao preguicosos e
    // LANCAM enquanto o modulo nao carregou. Com um setTimeout recursivo sem
    // try, a primeira excecao matava a cadeia de retentativa para sempre — a
    // camada de controle simplesmente nunca nascia, sem erro no console.
    try {
      const W = window.WPP;
      return !!(W && W.call && W.call.offer && W.call.accept && W.whatsapp && W.whatsapp.CallStore);
    } catch { return false; }
  }

  let interfaceLigada = false;
  function ligarInterfaceDeChamada() {
    if (interfaceLigada) return;
    interfaceLigada = true;
    // Sem isto o cliente web nao assume o tratamento das chamadas.
    try { window.WPP.call.enableCallInterface().catch(() => { interfaceLigada = false; }); }
    catch { interfaceLigada = false; }
  }

  /**
   * Fecha o que estiver por cima. O aviso "Novidades do WhatsApp Web" apareceu
   * justamente na hora de ligar e engole o clique sem deixar rastro.
   */
  /**
   * Variantes do mesmo telefone brasileiro. Um celular com DDD existe em duas
   * formas — com e sem o nono digito — e o WhatsApp so conhece UMA delas para
   * cada conta. Medido em 10/09/2026: um celular de MT com nono digito
   * (`5565 9 XXXX-XXXX`) nao tinha LID; a forma sem o 9 tinha.
   */
  function variantes(digitos) {
    const saida = [digitos];
    const m = /^55(\d{2})(\d{8,9})$/.exec(digitos);
    if (m) {
      const [, ddd, resto] = m;
      if (resto.length === 9 && resto.startsWith('9')) saida.push('55' + ddd + resto.slice(1));
      if (resto.length === 8) saida.push('55' + ddd + '9' + resto);
    }
    return [...new Set(saida)];
  }

  /**
   * Descobre o endereco que ESTE build aceita para ligar.
   *
   * Este build e migrado para LID: `chat.find` com telefone responde "No LID
   * for user" e ligar so funciona com o `@lid`. A ordem abaixo vai do mais
   * confiavel (a conversa que ja existe na conta) ao mais fraco (consulta ao
   * servidor), e cada degrau diz por onde passou — sem isso, "nao consegui
   * abrir a conversa" nao tem diagnostico.
   */
  async function resolverAlvo(digitos) {
    const W = window.WPP;
    const formas = variantes(digitos);

    // 1) A lista de conversas ja sincronizada. Todas vem em @lid, e o telefone
    //    de cada uma sai do proprio WhatsApp — evidencia exata, nao palpite.
    //    A comparacao e EXATA contra as variantes (com e sem nono digito).
    //    Comparar por sufixo de 8 digitos, como ja se fez, casaria um numero
    //    de outro DDD (ou outro pais) e ligaria para a pessoa errada.
    try {
      for (const chat of W.whatsapp.ChatStore.getModelsArray()) {
        const id = String(chat.id || '');
        if (!/@lid$/.test(id)) continue;
        let pn = '';
        try { pn = String(W.whatsapp.functions.getPnForLid(chat.id) || ''); } catch {}
        if (!pn) { try { pn = String((chat.contact && chat.contact.id) || ''); } catch {} }
        const so = pn.replace(/@.*$/, '').replace(/\D/g, '');
        if (so && formas.includes(so)) {
          return { endereco: id, via: 'conversa ja sincronizada (' + so + ')' };
        }
      }
    } catch {}

    // 2) Conversao direta, nas duas formas do numero.
    for (const f of formas) {
      try {
        const w = W.whatsapp.WidFactory.createWid(f + '@c.us');
        const lid = W.whatsapp.functions.toUserLid(w);
        if (lid) return { endereco: String(lid), via: 'toUserLid(' + f + ')' };
      } catch {}
    }

    // 3) Consulta ao servidor, nas duas formas. Em algumas contas ela devolve
    //    o LID direto no campo `wid`.
    for (const f of formas) {
      try {
        const c = await W.contact.queryExists(f + '@c.us');
        if (!c) continue;
        const bruto = String(c.lid || c.wid || '');
        if (/@lid$/.test(bruto)) return { endereco: bruto, via: 'queryExists(' + f + ')' };
      } catch {}
    }

    return {
      endereco: null,
      via: null,
      erro: 'sem LID para ' + formas.join(' nem ')
        + ' — esta sessao nunca falou com esse numero. Mande uma mensagem ou receba uma chamada dele primeiro.',
    };
  }

  function fecharDialogos() {
    try {
      for (const d of document.querySelectorAll('[role="dialog"]')) {
        const b = [...d.querySelectorAll('button,[role="button"]')]
          .find(x => /fechar|ok|entendi|continuar|close/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.innerText || '')));
        if (b) b.click();
      }
    } catch {}
  }

  let iniciado = false;
  function iniciar() {
    // Trava explicita, alem do clearInterval: rodar duas vezes duplicaria o
    // ouvinte de chamada recebida e o relogio de publicacao.
    if (iniciado) return;
    iniciado = true;
    const W = window.WPP;
    try {
      W.on('call.incoming_call', (c) => relatar({
        type: 'call', phase: 'incoming',
        call: {
          callId: c.id, direction: 'inbound', status: 'ringing', raw: 'INCOMING_RING',
          peer: wid(c.peerJid) || wid(c.sender) || '',
          phone: (() => { const p = wid(c.sender) || ''; return /@lid$/.test(p) ? null : (p.replace(/@.*$/, '').replace(/[^0-9]/g, '') || null); })(),
          lid: (() => { const p = wid(c.peerJid) || ''; return /@lid$/.test(p) ? p : null; })(),
          isVideo: !!c.isVideo, isGroup: !!c.isGroup, offerTime: Number(c.offerTime) || Date.now(), endReason: null,
        },
      }));
    } catch {}

    window.__zapcallControl = {
      status: () => ({ ...conta(), calls: varrer() }),
      /**
       * Retrato CRU do que a pagina sabe sobre chamadas. Existe porque, sem
       * ele, "o telefone tocou e no computador nao apareceu nada" nao tem por
       * onde ser investigado: nao da para saber se o WhatsApp Web nem soube da
       * chamada, se soube e decidiu que quem atende e o celular, ou se soube e
       * nos e que perdemos o evento.
       */
      debug: () => {
        const W = window.WPP;
        let modelos = [];
        try {
          const col = W.whatsapp.CallStore;
          modelos = (col.getModelsArray ? col.getModelsArray() : col.models || []).map(m => {
            let st = '?'; try { st = String(m.getState()); } catch {}
            return {
              id: m.id, estado: st, outgoing: !!m.outgoing, isVideo: !!m.isVideo,
              peerJid: wid(m.peerJid), offerTime: m.offerTime,
              // Estes dois sao a resposta para "o celular atendeu e o
              // computador nem soube": o WhatsApp decide QUEM trata a chamada.
              canHandleLocally: m.canHandleLocally,
              webClientShouldHandle: m.webClientShouldHandle,
            };
          });
        } catch (e) { modelos = [{ erro: String(e && e.message || e) }]; }
        return {
          interfaceDeChamadaLigada: interfaceLigada,
          visibilidade: document.visibilityState,
          temFoco: document.hasFocus(),
          modelos,
          conta: conta(),
        };
      },
      dial: async (numero, video) => {
        // POR QUE NAO `WPP.call.offer`: ele chama `startWAWebVoipCall(wid,
        // isVideo, 8, 5)` com uma assinatura que este build ignora em
        // silencio — sem excecao, sem chamada, em 221 ms. E `chat.find` pelo
        // telefone responde "No LID for user": o build e migrado para LID.
        // O caminho MEDIDO que funciona e o do humano: resolver o LID, abrir a
        // conversa e clicar no botao de ligar.
        const digitos = String(numero).replace(/[^0-9]/g, '');
        const dorme = (ms) => new Promise(r => timers.setTimeout(r, ms));
        const saida = { callId: null, erro: null, destino: null, via: 'ui' };

        const alvo = await resolverAlvo(digitos);
        saida.destino = alvo.endereco;
        saida.comoResolveu = alvo.via;
        if (!alvo.endereco) {
          saida.erro = alvo.erro || 'nao consegui resolver o destino';
          return saida;
        }
        try {
          await window.WPP.chat.openChatBottom(alvo.endereco);
        } catch (e) {
          saida.erro = 'nao consegui abrir a conversa: ' + String(e && e.message || e);
          return saida;
        }

        fecharDialogos();
        // O rotulo do botao segue o IDIOMA do WhatsApp Web da sessao: pt, en e
        // es cobertos; outro idioma cai no plano B (qualquer botao com
        // "call/chamada/llamada" que nao seja o outro tipo).
        const padrao = video
          ? /liga\u00e7\u00e3o de v\u00eddeo|ligacao de video|video call|videollamada|llamada de video/i
          : /liga\u00e7\u00e3o de voz|ligacao de voz|voice call|llamada de voz|audio call/i;
        let botao = null;
        for (let i = 0; i < 20 && !botao; i++) {
          botao = [...document.querySelectorAll('button,[role="button"]')]
            .find(b => padrao.test(b.getAttribute('aria-label') || ''));
          if (!botao) await dorme(150);
        }
        if (!botao) {
          // Plano B por idioma desconhecido: o primeiro botao de chamada cujo rotulo nao e do outro tipo.
          const outro = video ? /voz|voice|audio/i : /v\u00eddeo|video/i;
          botao = [...document.querySelectorAll('button,[role="button"]')]
            .find(b => { const r = b.getAttribute('aria-label') || ''; return /call|chamada|llamada|liga\u00e7\u00e3o|ligacao/i.test(r) && !outro.test(r); });
        }
        if (!botao) { saida.erro = 'botao de ' + (video ? 'video' : 'voz') + ' nao apareceu na conversa (idioma do WhatsApp Web nao reconhecido?)'; return saida; }
        botao.click();

        for (let i = 0; i < 30 && !saida.callId; i++) {
          await dorme(200);
          const atual = varrer()[0];
          if (atual) saida.callId = atual.callId;
        }
        if (!saida.callId) saida.erro = 'cliquei em ligar e nenhuma chamada apareceu no store';
        return saida;
      },

      accept: (callId) => window.WPP.call.accept(callId || undefined),
      reject: (callId) => window.WPP.call.reject(callId || undefined),
      end: () => window.WPP.call.end(),
    };

    relatar({ type: 'wpp-ready', account: conta(), isReady: !!W.isReady });
    timers.setInterval(() => {
      // A interface de chamada so faz sentido com a sessao de pe, e a sessao
      // pode subir muito depois da pagina (alguem le o QR meia hora depois).
      if (conta().connected) ligarInterfaceDeChamada();
      publicar();
    }, 300);
    publicar();
  }

  // Intervalo, nao recursao: um tique que explode nao pode levar os proximos.
  const espera = timers.setInterval(() => {
    try {
      if (!modulosProntos()) return;
      timers.clearInterval(espera);
      iniciar();
    } catch (e) {
      relatar({ type: 'control-error', message: String(e && e.message || e) });
    }
  }, 250);
})();

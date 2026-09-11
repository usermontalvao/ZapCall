// MENSAGENS (texto, midia, reacao, presenca, contatos) por wa-js, injetado
// depois do control.js.
//
// O formato de saida e o da Evolution API / Baileys de proposito: quem ja
// integrou a Evolution (o CRM que originou este projeto, inclusive) troca a
// URL e o resto do codigo continua valendo. Eventos:
//   messages.upsert  { key:{remoteJid, fromMe, id, remoteJidAlt?}, pushName,
//                      message:{conversation|imageMessage|...}, messageType,
//                      messageTimestamp, base64? }
//   messages.update  { key:{remoteJid, fromMe, id}, status:'DELIVERY_ACK'|'READ'|... }
//   presence.update  { id, presences:{ [id]: { lastKnownPresence } } }
//
// Regras: LID nunca vira telefone por conta propria — `remoteJidAlt` so vem
// quando o WhatsApp diz qual e o numero. Midia ate 2 MB vai em base64 no
// proprio evento; acima disso, quem quer pede por getBase64FromMediaMessage.
(() => {
  'use strict';
  const relatar = (ev) => { try { window.__zapcallEvent(JSON.stringify(ev)); } catch {} };
  const timers = window.__zapcallTimers || { setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window), setTimeout: window.setTimeout.bind(window) };
  const MIDIA_INLINE_MAX = 2 * 1024 * 1024;

  const wid = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v._serialized === 'string') return v._serialized;
    try { const s = String(v); return s === '[object Object]' ? '' : s; } catch { return ''; }
  };
  /** `5511999999999@c.us` -> `5511999999999@s.whatsapp.net` (o jid que a Evolution mostra). */
  const jidEvolution = (id) => String(id || '').replace(/@c\.us$/, '@s.whatsapp.net');
  /** Telefone conhecido de um LID, se o WhatsApp souber. Nunca por palpite. */
  function telefoneDoLid(id) {
    try {
      if (!/@lid$/.test(id)) return null;
      const W = window.WPP;
      const w = W.whatsapp.WidFactory.createWid(id);
      const pn = W.whatsapp.functions.getPnForLid && W.whatsapp.functions.getPnForLid(w);
      const s = wid(pn);
      return s && /@c\.us$/.test(s) ? jidEvolution(s) : null;
    } catch { return null; }
  }
  /** Numero/jid de entrada -> id que o wa-js aceita. */
  function alvo(numero) {
    const s = String(numero || '').trim();
    if (/@(c\.us|lid|g\.us|s\.whatsapp\.net)$/.test(s)) return s.replace(/@s\.whatsapp\.net$/, '@c.us');
    const d = s.replace(/\D/g, '');
    if (!d) throw new Error('numero vazio');
    return d + '@c.us';
  }

  const blobParaBase64 = (blob) => new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^;]*;base64,/, ''));
    r.onerror = () => erro(new Error('leitura da midia falhou'));
    r.readAsDataURL(blob);
  });

  // ------------------------------------------------- modelo -> Evolution
  const TIPOS = { chat: 'conversation', image: 'imageMessage', ptt: 'audioMessage', audio: 'audioMessage', video: 'videoMessage', document: 'documentMessage', sticker: 'stickerMessage', vcard: 'contactMessage', location: 'locationMessage', gif: 'videoMessage' };
  async function converter(m, { comMidia = true } = {}) {
    const id = m.id || {};
    const fromMe = !!id.fromMe;
    const remoto = wid(id.remote) || wid(fromMe ? m.to : m.from) || '';
    const chave = { remoteJid: jidEvolution(remoto), fromMe, id: id.id || wid(id).split('_').pop() || '' };
    const alt = telefoneDoLid(remoto); if (alt) chave.remoteJidAlt = alt;
    if (m.author) chave.participant = jidEvolution(wid(m.author));
    const tipo = m.type || 'chat';
    const nomeMsg = TIPOS[tipo] || 'unknownMessage';
    const message = {};
    if (tipo === 'chat') {
      message.conversation = m.body || '';
      if (m.quotedMsg || m.quotedStanzaID) message.extendedTextMessage = { text: m.body || '', contextInfo: { stanzaId: m.quotedStanzaID || wid(m.quotedMsg && m.quotedMsg.id) } };
    } else if (tipo === 'vcard') {
      message.contactMessage = { displayName: m.vcardFormattedName || '', vcard: m.body || '' };
    } else if (tipo === 'location') {
      message.locationMessage = { degreesLatitude: m.lat, degreesLongitude: m.lng, name: m.loc || '' };
    } else {
      const no = { mimetype: m.mimetype || '', caption: m.caption || undefined, fileLength: m.size || undefined, fileName: m.filename || undefined, seconds: m.duration ? Math.round(Number(m.duration)) : undefined, ptt: tipo === 'ptt' || undefined, width: m.width, height: m.height, url: m.deprecatedMms3Url || m.clientUrl || undefined };
      message[nomeMsg] = no;
      if (m.body && /^[A-Za-z0-9+/=]{100,}$/.test(m.body) && !no.jpegThumbnail) no.jpegThumbnail = m.body;
    }
    const saida = {
      key: chave,
      pushName: (m.sender && (m.sender.pushname || m.sender.name)) || (m.senderObj && m.senderObj.pushname) || m.notifyName || (fromMe ? undefined : (m.chat && m.chat.contact && m.chat.contact.pushname)) || null,
      message, messageType: nomeMsg,
      messageTimestamp: Number(m.t) || Math.round(Date.now() / 1000),
      status: ackParaStatus(m.ack),
      source: 'web', instanceId: null,
    };
    if (comMidia && message[nomeMsg] && nomeMsg !== 'conversation' && nomeMsg !== 'contactMessage' && nomeMsg !== 'locationMessage' && (m.size || 0) <= MIDIA_INLINE_MAX) {
      try {
        const blob = await window.WPP.chat.downloadMedia(wid(id));
        if (blob && blob.size <= MIDIA_INLINE_MAX) { saida.base64 = await blobParaBase64(blob); saida.message[nomeMsg].mimetype = saida.message[nomeMsg].mimetype || blob.type; }
      } catch (e) { saida.mediaError = String(e && e.message || e); }
    }
    return saida;
  }
  function ackParaStatus(ack) {
    return ({ [-1]: 'ERROR', 0: 'PENDING', 1: 'SERVER_ACK', 2: 'DELIVERY_ACK', 3: 'READ', 4: 'PLAYED' })[Number(ack)] || 'PENDING';
  }

  // -------------------------------------------------------------- eventos
  let ouvindo = false;
  function ouvir() {
    if (ouvindo) return;
    const W = window.WPP; if (!W || !W.on) return;
    ouvindo = true;
    W.on('chat.new_message', async (m) => {
      try {
        const remoto = wid(m && m.id && m.id.remote) || wid(m.from) || '';
        if (remoto === 'status@broadcast') return;
        relatar({ type: 'wa', event: 'messages.upsert', data: await converter(m) });
      } catch (e) { relatar({ type: 'wa-error', where: 'new_message', message: String(e && e.message || e) }); }
    });
    W.on('chat.msg_ack_change', ({ ack, chat, ids }) => {
      try {
        for (const id of ids || []) {
          const s = wid(id); const partes = s.split('_');
          relatar({ type: 'wa', event: 'messages.update', data: { key: { remoteJid: jidEvolution(wid(chat) || partes[1] || ''), fromMe: partes[0] === 'true', id: partes[partes.length - 1] }, status: ackParaStatus(ack) } });
        }
      } catch {}
    });
    W.on('chat.presence_change', (p) => {
      try {
        const id = jidEvolution(wid(p.id));
        const estado = p.state === 'composing' ? 'composing' : p.state === 'recording' ? 'recording' : p.isOnline ? 'available' : 'unavailable';
        relatar({ type: 'wa', event: 'presence.update', data: { id, presences: { [id]: { lastKnownPresence: estado, lastSeen: p.t ? Number(p.t) : undefined } } } });
      } catch {}
    });
    W.on('chat.msg_revoke', (r) => {
      try { relatar({ type: 'wa', event: 'messages.delete', data: { key: { remoteJid: jidEvolution(wid(r.chat && r.chat.id) || wid(r.id && r.id.remote)), fromMe: !!(r.id && r.id.fromMe), id: wid(r.id).split('_').pop() } } }); } catch {}
    });
    W.on('chat.new_reaction', (r) => {
      try {
        const msgId = wid(r.msgId); const partes = msgId.split('_');
        relatar({ type: 'wa', event: 'messages.upsert', data: {
          key: { remoteJid: jidEvolution(partes[1] || ''), fromMe: !!(r.id && r.id.fromMe), id: wid(r.id).split('_').pop() },
          pushName: null, messageType: 'reactionMessage',
          message: { reactionMessage: { key: { remoteJid: jidEvolution(partes[1] || ''), fromMe: partes[0] === 'true', id: partes[partes.length - 1] }, text: r.reactionText || '' } },
          messageTimestamp: Number(r.timestamp) || Math.round(Date.now() / 1000), status: 'SERVER_ACK', source: 'web',
        } });
      } catch {}
    });
    relatar({ type: 'wa-ready' });
  }

  // ----------------------------------------------------------- RPC (API)
  // Cada acao devolve JSON no formato da rota Evolution equivalente.
  const chaveDe = (r) => { const id = r && (r.id || r); const s = wid(id); const p = s.split('_'); return { remoteJid: jidEvolution(p[1] || ''), fromMe: p[0] === 'true', id: p[p.length - 1] }; };
  const respostaEnvio = async (r) => {
    const key = chaveDe(r);
    let m = null; try { m = await window.WPP.chat.getMessageById(wid(r.id)); } catch {}
    return { key, message: m ? (await converter(m, { comMidia: false })).message : {}, messageType: m ? (TIPOS[m.type] || 'unknownMessage') : 'conversation', messageTimestamp: m ? Number(m.t) : Math.round(Date.now() / 1000), status: 'PENDING' };
  };
  const msgIdDe = (key) => (key.fromMe ? 'true' : 'false') + '_' + String(key.remoteJid || '').replace(/@s\.whatsapp\.net$/, '@c.us') + '_' + key.id;

  const acoes = {
    async sendText({ number, text, quoted, linkPreview }) {
      const r = await window.WPP.chat.sendTextMessage(alvo(number), String(text ?? ''), { quotedMsg: quoted && quoted.key ? msgIdDe(quoted.key) : undefined, linkPreview: linkPreview !== false });
      return respostaEnvio(r);
    },
    async sendMedia({ number, media, mediatype, mimetype, caption, fileName, quoted }) {
      if (!media) throw new Error('media (base64 ou URL) obrigatoria');
      const conteudo = /^https?:\/\//i.test(media) ? media : (media.startsWith('data:') ? media : 'data:' + (mimetype || 'application/octet-stream') + ';base64,' + media);
      const tipo = { image: 'image', video: 'video', document: 'document', audio: 'audio' }[mediatype] || 'auto-detect';
      const r = await window.WPP.chat.sendFileMessage(alvo(number), conteudo, { type: tipo, caption: caption || undefined, filename: fileName || undefined, mimetype: mimetype || undefined, quotedMsg: quoted && quoted.key ? msgIdDe(quoted.key) : undefined, waitForAck: false });
      return respostaEnvio(r);
    },
    async sendWhatsAppAudio({ number, audio }) {
      const conteudo = /^https?:\/\//i.test(audio) ? audio : (audio.startsWith('data:') ? audio : 'data:audio/ogg; codecs=opus;base64,' + audio);
      const r = await window.WPP.chat.sendFileMessage(alvo(number), conteudo, { type: 'audio', isPtt: true, waitForAck: false });
      return respostaEnvio(r);
    },
    async sendSticker({ number, sticker }) {
      const conteudo = /^https?:\/\//i.test(sticker) ? sticker : (sticker.startsWith('data:') ? sticker : 'data:image/webp;base64,' + sticker);
      const r = await window.WPP.chat.sendFileMessage(alvo(number), conteudo, { type: 'sticker', waitForAck: false });
      return respostaEnvio(r);
    },
    async sendContact({ number, contact }) {
      const lista = (Array.isArray(contact) ? contact : [contact]).map(c => ({ id: alvo(c.wuid || c.phoneNumber || c.number), name: c.fullName || c.name || '' }));
      const r = await window.WPP.chat.sendVCardContactMessage(alvo(number), lista);
      return respostaEnvio(r);
    },
    async sendReaction({ key, reaction }) {
      const r = await window.WPP.chat.sendReactionMessage(msgIdDe(key), reaction ? String(reaction) : false);
      return { key, reaction: reaction || '', sendMsgResult: r && r.sendMsgResult };
    },
    async deleteMessageForEveryone({ id, remoteJid, fromMe }) {
      const chat = alvo(remoteJid);
      const r = await window.WPP.chat.deleteMessage(chat, msgIdDe({ id, remoteJid, fromMe: fromMe !== false }), false, true);
      return { ok: true, result: r };
    },
    async updateMessage({ key, text }) {
      const r = await window.WPP.chat.editMessage(msgIdDe(key), String(text ?? ''));
      return respostaEnvio(r);
    },
    async sendPresence({ number, presence, delay }) {
      const chat = alvo(number); const ms = Number(delay) || 1000;
      if (presence === 'composing') await window.WPP.chat.markIsComposing(chat, ms);
      else if (presence === 'recording') await window.WPP.chat.markIsRecording(chat, ms);
      else if (presence === 'paused') await window.WPP.chat.markIsPaused(chat);
      else if (presence === 'available' || presence === 'unavailable') { try { await window.WPP.conn.markAvailable ? window.WPP.conn.markAvailable() : null; } catch {} }
      return { presence: presence || 'available' };
    },
    async markMessageAsRead({ readMessages }) {
      const chats = new Set((readMessages || []).map(m => alvo(m.remoteJid)));
      for (const c of chats) { try { await window.WPP.chat.markIsRead(c); } catch {} }
      return { message: 'Read messages', read: 'success' };
    },
    async whatsappNumbers({ numbers }) {
      const saida = [];
      for (const n of numbers || []) {
        const d = String(n).replace(/\D/g, '');
        let r = null; try { r = await window.WPP.contact.queryExists(d + '@c.us'); } catch {}
        // Celular brasileiro: sem resposta, tenta a outra forma do nono digito.
        if (!r) { const m = /^55(\d{2})(\d{8,9})$/.exec(d); if (m) { const alt = m[2].length === 9 && m[2].startsWith('9') ? '55' + m[1] + m[2].slice(1) : m[2].length === 8 ? '55' + m[1] + '9' + m[2] : null; if (alt) { try { r = await window.WPP.contact.queryExists(alt + '@c.us'); } catch {} } } }
        const jid = r ? jidEvolution(wid(r.wid)) : d + '@s.whatsapp.net';
        saida.push({ exists: !!r, jid, number: d, name: undefined, lid: r && r.lid ? wid(r.lid) : undefined });
      }
      return saida;
    },
    async fetchProfilePictureUrl({ number }) {
      let url = null; try { url = await window.WPP.contact.getProfilePictureUrl(alvo(number), true); } catch {}
      return { wuid: jidEvolution(alvo(number)), profilePictureUrl: url || null };
    },
    async updateBlockStatus({ number, status }) {
      const chat = alvo(number);
      if (status === 'block') await window.WPP.blocklist.blockContact(chat); else await window.WPP.blocklist.unblockContact(chat);
      return { number, status };
    },
    async findChats({ limit }) {
      const lista = await window.WPP.chat.list({ count: Number(limit) || 100 });
      return lista.map(c => ({ id: jidEvolution(wid(c.id)), remoteJid: jidEvolution(wid(c.id)), name: c.formattedTitle || c.name || (c.contact && c.contact.pushname) || '', unreadCount: c.unreadCount || 0, isGroup: !!c.isGroup, lastMessageTimestamp: c.t ? Number(c.t) : null, archived: !!c.archive }));
    },
    async findContacts({ where, limit }) {
      const id = where && (where.id || where.remoteJid);
      if (id) { const c = await window.WPP.contact.get(alvo(id)); return c ? [{ id: jidEvolution(wid(c.id)), pushName: c.pushname || null, name: c.name || c.formattedName || null, isBusiness: !!c.isBusiness, isMyContact: !!c.isMyContact }] : []; }
      const lista = await window.WPP.contact.list({ onlyMyContacts: !!(where && where.onlyMyContacts) });
      return lista.slice(0, Number(limit) || 500).map(c => ({ id: jidEvolution(wid(c.id)), pushName: c.pushname || null, name: c.name || c.formattedName || null, isBusiness: !!c.isBusiness, isMyContact: !!c.isMyContact }));
    },
    async findMessages({ where, limit, comMidia }) {
      const jid = where && where.key && where.key.remoteJid; if (!jid) throw new Error('where.key.remoteJid obrigatorio');
      const msgs = await window.WPP.chat.getMessages(alvo(jid), { count: Number(limit) || 50, direction: 'before' });
      const saida = []; for (const m of msgs) saida.push(await converter(m, { comMidia: !!comMidia }));
      return { messages: { total: saida.length, records: saida } };
    },
    async getBase64FromMediaMessage({ message }) {
      const key = message && message.key; if (!key) throw new Error('message.key obrigatorio');
      const m = await window.WPP.chat.getMessageById(msgIdDe(key));
      if (!m) throw new Error('mensagem nao encontrada');
      const blob = await window.WPP.chat.downloadMedia(msgIdDe(key));
      return { mediaType: TIPOS[m.type] || m.type, mimetype: blob.type || m.mimetype || '', fileName: m.filename || undefined, size: blob.size, base64: await blobParaBase64(blob) };
    },
    async fetchProfile() {
      const W = window.WPP; const me = W.conn.getMyUserId && W.conn.getMyUserId();
      let url = null; try { url = await W.contact.getProfilePictureUrl(wid(me), true); } catch {}
      return { wuid: jidEvolution(wid(me)), name: (W.whatsapp.Conn && W.whatsapp.Conn.pushname) || null, picture: url };
    },
  };

  window.__zapcallMessaging = {
    async rpc(action, params) {
      const fn = acoes[action];
      if (!fn) throw new Error('acao desconhecida: ' + action);
      if (!(window.WPP && window.WPP.conn && window.WPP.conn.isAuthenticated && window.WPP.conn.isAuthenticated())) throw new Error('sessao nao pareada');
      return fn(params || {});
    },
    acoes: Object.keys(acoes),
  };

  const espera = timers.setInterval(() => {
    try {
      const W = window.WPP;
      if (!(W && W.on && W.chat && W.chat.sendTextMessage && W.contact)) return;
      timers.clearInterval(espera);
      ouvir();
    } catch {}
  }, 500);
})();

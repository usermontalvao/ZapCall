// Tudo o que roda DENTRO da pagina do WhatsApp Web.
//
// Regra deste arquivo: os ganchos sao em APIs PADRAO do navegador
// (getUserMedia, enumerateDevices, RTCPeerConnection, WebAudio, WebCodecs).
// Nenhum deles depende de nome de modulo, chunk de webpack ou classe de CSS da
// Meta — por isso uma atualizacao do WhatsApp Web nao os quebra.
//
// O que NAO esta aqui, de proposito: a midia deste build nao trafega nas
// tracks das RTCPeerConnections (medido em 10/09/2026 — zero transceptores).
// A voz e o video de RETORNO chegam pelo adaptador de interfaces privadas em
// native-media.js, que fala com este arquivo por `window.__zapcallMedia`. O
// gancho de RTCPeerConnection continua de pe como diagnostico e como plano B
// para um build que volte a usar tracks.
//
// Injetado com Page.addScriptToEvaluateOnNewDocument, ou seja ANTES de qualquer
// script da Meta. Se rodar depois, o WhatsApp Web ja guardou a referencia
// original de getUserMedia e o gancho nao serve para nada.
(() => {
  'use strict';
  const CFG = __ZC_CONFIG__;
  const MEDIA = CFG.media || {
    profile: 'realtime', width: 640, height: 360, frameRate: 24,
    bitrate: 650000, decoderQueueSize: 2, relayQueueBytes: 96 * 1024,
  };

  const KIND_AUDIO = 1;
  const KIND_VIDEO = 2;
  const HEADER = 4;
  const FLAG_KEYFRAME = 1;
  /** Taxa unica de audio em todo o projeto: 16 kHz mono. */
  const RATE = 16000;
  /** Quadro de 60 ms = 960 amostras. O CRM descarta qualquer outro tamanho. */
  const FRAME = 960;

  // TIMERS NATIVOS, presos AGORA. O WhatsApp Web substitui window.setInterval
  // e window.clearInterval por um agendador proprio (JSScheduler) depois que
  // estes scripts ja rodaram — e o clearInterval deles ignora ids nativos.
  // Medido em 10/09/2026: um relogio criado aqui e "cancelado" pelo global
  // continuava batendo para sempre. Os outros scripts injetados usam estes.
  const timers = {
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  };
  window.__zapcallTimers = timers;

  /** H.264 Baseline com o nivel certo: 42E01E (3.0) so vai ate 720x576;
   *  720p pede 1F (3.1) e 1080p pede 28 (4.0). Nivel errado mata o encoder. */
  const codecH264 = (w, h, fps = 30) => {
    const mb = Math.ceil(w / 16) * Math.ceil(h / 16);
    const mbps = mb * fps;
    return 'avc1.42E0' + (mb <= 1620 && mbps <= 40500 ? '1E' : mb <= 3600 && mbps <= 108000 ? '1F' : '28');
  };

  const log = (...a) => { if (CFG.verbose) console.log('[zapcall]', ...a); };
  const relatar = (ev) => {
    try { window.__zapcallEvent(JSON.stringify(ev)); } catch { /* binding ainda nao instalado */ }
  };

  const estado = {
    ganchos: { getUserMedia: false, enumerateDevices: false, rtcPeerConnection: false },
    ponte: { aberta: false, tentativas: 0, quadrosEnviados: 0, quadrosRecebidos: 0 },
    pcs: 0,
    mic: { ativo: false, silenciado: false, alimentado: 0 },
    cam: { ativa: false, quadros: 0, pulsos: 0, track: null },
    remoto: { audio: false, video: false, pico: 0, quadrosLidos: 0, quadrosCodificados: 0, tamanho: null, erro: null },
    pcsDetalhe: [],
    gum: [],
    worklets: (window.__ZC_WORKLETS && window.__ZC_WORKLETS.reproducao) ? 'ok' : 'ausente',
  };
  window.__zapcall = estado;

  // ------------------------------------------------------- aba sempre visivel
  // Num container a aba nunca esta em primeiro plano, e aplicacao web costuma
  // SEGURAR o que e caro (toque, camera, timers) quando se acha escondida.
  // Aqui a pagina passa a vida inteira achando que esta visivel e focada.
  try {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
    document.hasFocus = () => true;
    // Evento de mudanca de visibilidade nunca chega a quem escuta: se a pagina
    // nao e notificada, ela nao tem por que pausar nada.
    document.addEventListener('visibilitychange', (e) => { e.stopImmediatePropagation(); }, true);
    window.addEventListener('blur', (e) => { e.stopImmediatePropagation(); }, true);
    estado.visibilidade = 'forcada';
  } catch { estado.visibilidade = 'falhou'; }

  // ------------------------------------------------------------------ ponte
  // Um WebSocket para o agente, no loopback. So funciona porque o agente liga
  // Page.setBypassCSP — o connect-src do web.whatsapp.com barraria isto.
  let ws = null;

  function conectar() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try {
      ws = new WebSocket('ws://127.0.0.1:' + CFG.port + '/page?token=' + encodeURIComponent(CFG.token));
    } catch (e) {
      estado.ponte.tentativas += 1;
      timers.setTimeout(conectar, 1000);
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { estado.ponte.aberta = true; log('ponte aberta'); relatar({ type: 'bridge', open: true }); };
    ws.onclose = () => {
      estado.ponte.aberta = false;
      relatar({ type: 'bridge', open: false });
      estado.ponte.tentativas += 1;
      timers.setTimeout(conectar, Math.min(5000, 300 * estado.ponte.tentativas));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') { comando(ev.data); return; }
      estado.ponte.quadrosRecebidos += 1;
      const view = new Uint8Array(ev.data);
      const kind = view[0];
      if (kind === KIND_AUDIO) receberAudio(ev.data);
      else if (kind === KIND_VIDEO) receberVideo(ev.data, (view[1] & FLAG_KEYFRAME) !== 0);
    };
  }

  /** Fila de subida tolerada por tipo. Voz: ~6 quadros (360 ms). Video: um
   *  keyframe 720p sozinho passa de 60 KB, e derrubar keyframe e ficar cego
   *  ate o proximo — o teto de video e bem mais folgado. */
  const FILA_AUDIO = 6 * (HEADER + FRAME * 2);
  const FILA_VIDEO = 512 * 1024;
  /** Um delta descartado invalida os seguintes: so volta a mandar no keyframe. */
  let videoEsperaKeyframe = false;

  function enviarQuadro(kind, flags, orientation, corpo) {
    if (!ws || ws.readyState !== 1) return false;
    const ehVideo = kind === KIND_VIDEO;
    if (ehVideo) {
      const keyframe = (flags & FLAG_KEYFRAME) !== 0;
      if (videoEsperaKeyframe && !keyframe) { estado.ponte.videoDescartado = (estado.ponte.videoDescartado || 0) + 1; return false; }
      if (ws.bufferedAmount > FILA_VIDEO) {
        // Descartou: o proximo delta nao tem referencia. Espera o keyframe.
        videoEsperaKeyframe = true;
        estado.ponte.videoDescartado = (estado.ponte.videoDescartado || 0) + 1;
        return false;
      }
      videoEsperaKeyframe = false;
    } else if (ws.bufferedAmount > FILA_AUDIO) {
      // Em voz, um quadro atrasado vale menos que um quadro perdido.
      estado.ponte.audioDescartado = (estado.ponte.audioDescartado || 0) + 1;
      return false;
    }
    const buf = new Uint8Array(HEADER + corpo.byteLength);
    buf[0] = kind; buf[1] = flags; buf[2] = orientation; buf[3] = 0;
    buf.set(new Uint8Array(corpo.buffer || corpo, corpo.byteOffset || 0, corpo.byteLength), HEADER);
    ws.send(buf);
    estado.ponte.quadrosEnviados += 1;
    return true;
  }

  function comando(texto) {
    let msg; try { msg = JSON.parse(texto); } catch { return; }
    if (msg.cmd === 'mute') { estado.mic.silenciado = !!msg.muted; }
    if (msg.cmd === 'ping') { try { ws.send(JSON.stringify({ type: 'pong', t: Date.now() })); } catch {} }
    if (msg.type === 'media-config' && msg.kind === 'video') configurarDecoderDoOperador(msg);
  }

  // -------------------------------------------------------------- worklets
  // Fonte unica em src/page/worklets.mjs, publicada pelo preludio que o
  // browser.mjs injeta ANTES deste arquivo. Duas copias do buffer de jitter
  // divergiriam em silencio, e o defeito apareceria so numa ligacao real.
  //
  // Lidos NA HORA DE USAR, nunca no topo: se o preludio faltar, os ganchos
  // de midia continuam instalados e o erro aparece com nome no diagnostico
  // (estado.worklets) — em vez de este arquivo inteiro morrer na linha 1 com
  // "Cannot read properties of undefined (reading 'reproducao')" e a pagina
  // ficar sem gancho nenhum, calada.
  function codigoWorklet(qual) {
    const W = window.__ZC_WORKLETS;
    if (!W || typeof W[qual] !== 'string') {
      estado.worklets = 'ausente: ' + qual;
      relatar({ type: 'media-error', message: 'worklet ' + qual + ' ausente (preludio nao injetado)' });
      throw new Error('worklet de audio "' + qual + '" ausente');
    }
    estado.worklets = 'ok';
    return W[qual];
  }

  async function moduloWorklet(ctx, codigo) {
    const url = URL.createObjectURL(new Blob([codigo], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  }

  // ------------------------------------------------------------ microfone
  let micCtx = null, micNode = null, micStream = null;

  /** Uma track parada nao volta a viver: tem de nascer outra. */
  function fluxoVivo(stream) {
    try { return !!stream && stream.getTracks().some(t => t.readyState === 'live'); }
    catch { return false; }
  }

  async function garantirMic() {
    if (fluxoVivo(micStream)) return micStream;
    if (micStream) {
      // O WhatsApp Web chama track.stop() quando a chamada acaba. Se a proxima
      // chamada receber a MESMA track (agora 'ended'), ela nasce muda — e nao
      // ha erro em lugar nenhum para explicar.
      relatar({ type: 'mic-recriado', motivo: 'track anterior encerrada' });
      try { micStream.getTracks().forEach(t => t.stop()); } catch {}
      try { micCtx && micCtx.close(); } catch {}
      micStream = null; micCtx = null; micNode = null;
      estado.mic.recriado = (estado.mic.recriado || 0) + 1;
    }
    // Contexto EM 16 kHz: o proprio WebAudio faz a conversao para o que o
    // WebRTC precisa, e nao sobra reamostragem escrita a mao no caminho.
    micCtx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
    await moduloWorklet(micCtx, codigoWorklet('reproducao'));
    micNode = new AudioWorkletNode(micCtx, 'jw-reproducao', { numberOfInputs: 0, outputChannelCount: [1] });
    const destino = micCtx.createMediaStreamDestination();
    micNode.connect(destino);
    if (micCtx.state === 'suspended') await micCtx.resume();
    micStream = destino.stream;
    estado.mic.ativo = true;
    estado.mic.ctx = micCtx.state;
    relatar({ type: 'mic', ready: true, rate: micCtx.sampleRate, ctx: micCtx.state });
    return micStream;
  }

  function receberAudio(buffer) {
    if (!micNode || estado.mic.silenciado || buffer.byteLength !== HEADER + FRAME * 2) return;
    const pcm = new Int16Array(buffer, HEADER);
    if (pcm.length !== FRAME) return;
    micNode.port.postMessage(pcm);
    estado.mic.alimentado += 1;
  }

  // --------------------------------------------------------------- camera
  let camCanvas = null, camCtx2d = null, camStream = null, decoder = null;
  /** Tique que redesenha o canvas da "camera". Ver garantirCam. */
  let camPulso = null;
  /** Ultimo quadro decodificado, redesenhado pelo pulso ate chegar outro. */
  let ultimoQuadro = null;
  let versaoQuadro = 0, versaoDesenhada = 0;
  /** Quando o ultimo quadro foi desenhado (o pulso so repete se ficou parado). */
  let ultimoDesenho = 0;
  /** Tamanho que o WhatsApp PEDIU ao getUserMedia. Ver tamanhoPedido. */
  let camPedido = { width: MEDIA.width, height: MEDIA.height, frameRate: MEDIA.frameRate };

  /**
   * O tamanho da camera virtual e o que o WhatsApp pediu, e nao o do quadro
   * que chega do operador. Antes o canvas mudava para 1280x720 no meio da
   * chamada: o codificador nativo (WASM, software) recebia outra resolucao
   * em pleno stream e ainda tinha de escalar cada quadro — o video travava
   * no celular. Quadro de outra proporcao entra com barras (contain).
   */
  function tamanhoPedido(video) {
    const lerNum = (v) => {
      if (typeof v === 'number') return v;
      if (v && typeof v === 'object') return Number(v.exact ?? v.ideal ?? v.max ?? v.min) || null;
      return null;
    };
    const pedido = { width: MEDIA.width, height: MEDIA.height, frameRate: MEDIA.frameRate };
    if (video && typeof video === 'object') {
      pedido.width = lerNum(video.width) || pedido.width;
      pedido.height = lerNum(video.height) || pedido.height;
      pedido.frameRate = lerNum(video.frameRate) || pedido.frameRate;
    }
    // Preserva a proporcao pedida, mas nunca deixa o encoder nativo do
    // WhatsApp ultrapassar o orcamento do perfil da hospedagem.
    const escala = Math.min(1, MEDIA.width / pedido.width, MEDIA.height / pedido.height);
    pedido.width = Math.max(2, Math.round(pedido.width * escala / 2) * 2);
    pedido.height = Math.max(2, Math.round(pedido.height * escala / 2) * 2);
    pedido.frameRate = Math.min(MEDIA.frameRate, pedido.frameRate);
    return pedido;
  }

  function desenharNaCam(frame) {
    const fw = frame.displayWidth || frame.codedWidth, fh = frame.displayHeight || frame.codedHeight;
    const cw = camCanvas.width, ch = camCanvas.height;
    const escala = Math.min(cw / fw, ch / fh);
    const dw = Math.round(fw * escala), dh = Math.round(fh * escala);
    if (dw !== cw || dh !== ch) { camCtx2d.fillStyle = '#000'; camCtx2d.fillRect(0, 0, cw, ch); }
    camCtx2d.drawImage(frame, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    ultimoDesenho = performance.now();
  }

  function armarPulsoDaCam() {
    if (camPulso) timers.clearInterval(camPulso);
    camPulso = timers.setInterval(() => {
      if (!camCtx2d) return;
      if (ultimoQuadro) {
        // Pacer: a chegada pelo TCP pode vir em rajadas; so o quadro MAIS
        // RECENTE e desenhado, numa cadencia regular. Isso evita que o canvas
        // engula cinco quadros juntos e fique parado no intervalo seguinte.
        const repetido = versaoQuadro === versaoDesenhada;
        if (repetido && performance.now() - ultimoDesenho < 100) return;
        try {
          desenharNaCam(ultimoQuadro);
          versaoDesenhada = versaoQuadro;
          estado.cam.pulsos += 1;
          if (repetido) estado.cam.repetidos = (estado.cam.repetidos || 0) + 1;
        }
        catch { /* o decoder esta trocando o quadro neste exato instante */ }
      } else {
        // Antes do primeiro quadro basta um heartbeat baixo; preto a 24 fps
        // gastava CPU no container sem carregar informacao alguma.
        const agora = performance.now();
        if (agora - ultimoDesenho < 200) return;
        camCtx2d.fillStyle = (Date.now() / 500 | 0) % 2 ? '#010101' : '#000000';
        camCtx2d.fillRect(0, 0, 2, 2);
        ultimoDesenho = agora; estado.cam.pulsos += 1;
      }
    }, 1000 / camPedido.frameRate);
  }

  async function garantirCam(pedido) {
    if (pedido) camPedido = pedido;
    if (fluxoVivo(camStream)) {
      // O WhatsApp pede a camera duas vezes: primeiro `video: true` (previa)
      // e depois 1280x720 para a chamada. A track e a mesma; o canvas muda
      // de tamanho AQUI, antes de o codificador nativo comecar.
      if (camCanvas && (camCanvas.width !== camPedido.width || camCanvas.height !== camPedido.height)) {
        camCanvas.width = camPedido.width; camCanvas.height = camPedido.height;
        camCtx2d.fillStyle = '#000'; camCtx2d.fillRect(0, 0, camCanvas.width, camCanvas.height);
        estado.cam.tamanho = { ...camPedido };
        estado.cam.redimensionada = (estado.cam.redimensionada || 0) + 1;
      }
      armarPulsoDaCam();
      return camStream;
    }
    if (camStream) {
      relatar({ type: 'cam-recriada', motivo: 'track anterior encerrada' });
      try { camStream.getTracks().forEach(t => t.stop()); } catch {}
      if (camPulso) { timers.clearInterval(camPulso); camPulso = null; }
      try { decoder && decoder.state !== 'closed' && decoder.close(); } catch {}
      camStream = null; decoder = null;
      estado.cam.recriada = (estado.cam.recriada || 0) + 1;
    }
    camCanvas = document.createElement('canvas');
    camCanvas.width = camPedido.width; camCanvas.height = camPedido.height;
    camCtx2d = camCanvas.getContext('2d', { alpha: false });
    camCtx2d.fillStyle = '#000'; camCtx2d.fillRect(0, 0, camCanvas.width, camCanvas.height);
    // captureStream em canvas e universal; MediaStreamTrackGenerator seria mais
    // elegante e muda de nome entre versoes do Chrome — fica como otimizacao.
    // A taxa e a pedida (ate 30): a 15 o WhatsApp recebia metade dos quadros.
    camStream = camCanvas.captureStream(camPedido.frameRate);
    estado.cam.tamanho = { ...camPedido };
    try { camStream.getVideoTracks()[0].contentHint = 'motion'; } catch {}

    // BOMBA DE QUADROS. Um canvas que ninguem redesenha nao emite quadro
    // nenhum: o WhatsApp recebe uma track viva e VAZIA, e o outro lado ve
    // tela preta sem nenhum erro em lugar nenhum. Redesenhar sempre (mesmo
    // repetindo o ultimo quadro) e o que faz a camera existir de verdade.
    armarPulsoDaCam();
    if ('VideoDecoder' in window) criarDecoder();
    estado.cam.ativa = true;
    const t = camStream.getVideoTracks()[0];
    estado.cam.track = t ? t.readyState : null;
    relatar({ type: 'cam', ready: true, track: estado.cam.track });
    return camStream;
  }

  /** Decoder recem-criado (ou recem-recuperado) so aceita a partir de um keyframe. */
  let decoderEsperaKeyframe = true;
  let decoderConfig = {
    codec: codecH264(MEDIA.width, MEDIA.height, MEDIA.frameRate),
    codedWidth: MEDIA.width,
    codedHeight: MEDIA.height,
    optimizeForLatency: true,
  };
  let ultimoPedidoKeyframe = 0;

  function pedirKeyframe(motivo) {
    const agora = performance.now();
    if (agora - ultimoPedidoKeyframe < 250) return;
    ultimoPedidoKeyframe = agora;
    try { ws && ws.readyState === 1 && ws.send(JSON.stringify({ type: 'media-control', action: 'request-keyframe', reason: motivo })); } catch {}
  }

  function configurarDecoderDoOperador(msg) {
    const width = Math.round(Number(msg.width));
    const height = Math.round(Number(msg.height));
    const frameRate = Math.round(Number(msg.frameRate));
    const codec = String(msg.codec || '');
    if (!/^avc1\.[0-9a-f]{6}$/i.test(codec)) return;
    if (width < 2 || width > 1920 || height < 2 || height > 1080 || frameRate < 1 || frameRate > 60) return;
    const proxima = { codec, codedWidth: width, codedHeight: height, optimizeForLatency: true };
    const mudou = !decoderConfig || decoderConfig.codec !== codec
      || decoderConfig.codedWidth !== width || decoderConfig.codedHeight !== height;
    decoderConfig = proxima;
    estado.cam.decoderConfig = { codec, width, height, frameRate };
    if (mudou && decoder) criarDecoder();
  }

  /**
   * O decoder do video do OPERADOR. Erro fatal fecha o VideoDecoder para
   * sempre (state 'closed'); a recuperacao e criar outro e esperar o proximo
   * keyframe — um delta sem referencia so produziria outro erro.
   */
  function criarDecoder() {
    try { decoder && decoder.state !== 'closed' && decoder.close(); } catch {}
    decoderEsperaKeyframe = true;
    decoder = new VideoDecoder({
      output: (frame) => {
        estado.cam.quadros += 1;
        estado.cam.quadroTamanho = (frame.displayWidth || frame.codedWidth) + 'x' + (frame.displayHeight || frame.codedHeight);
        // Nao desenha aqui: WebSocket/TCP entrega rajadas. O pacer da camera
        // pega somente o frame mais recente no proximo tique regular.
        const anterior = ultimoQuadro;
        ultimoQuadro = frame;
        versaoQuadro += 1;
        if (anterior) { try { anterior.close(); } catch {} }
      },
      error: (e) => {
        estado.cam.erros = (estado.cam.erros || 0) + 1;
        relatar({ type: 'decoder-error', message: String(e && e.message || e) });
        criarDecoder();
        pedirKeyframe('decoder-error');
      },
    });
    // Annex-B: configuracao SEM description. O SPS/PPS vem nos proprios quadros.
    decoder.configure(decoderConfig);
  }

  function receberVideo(buffer, keyframe) {
    if (!decoder || decoder.state !== 'configured') return;
    if (decoder.decodeQueueSize >= MEDIA.decoderQueueSize) {
      // Continuar decodificando aqui exibiria o passado. Joga fora o GOP
      // congestionado, volta a exigir IDR e pede um imediatamente ao emissor.
      estado.cam.descartadosDecoder = (estado.cam.descartadosDecoder || 0) + 1;
      criarDecoder();
      pedirKeyframe('decoder-backpressure');
      if (!keyframe) return;
    }
    if (decoderEsperaKeyframe) {
      if (!keyframe) { estado.cam.descartadosSemKeyframe = (estado.cam.descartadosSemKeyframe || 0) + 1; return; }
      decoderEsperaKeyframe = false;
    }
    const corpo = new Uint8Array(buffer, HEADER);
    try {
      decoder.decode(new EncodedVideoChunk({
        type: keyframe ? 'key' : 'delta',
        timestamp: performance.now() * 1000,
        data: corpo,
      }));
    } catch (e) {
      relatar({ type: 'decoder-error', message: String(e && e.message || e) });
      criarDecoder();
      pedirKeyframe('decode-exception');
    }
  }

  /**
   * Os streams-base sao nossos; o WhatsApp recebe clones e parar um clone nao
   * para o original. Sem esta limpeza, cada chamada de video deixava um canvas
   * e um timer redesenhando o ultimo frame para sempre dentro da VPS.
   */
  function encerrarEntradasVirtuais() {
    if (camPulso) { timers.clearInterval(camPulso); camPulso = null; }
    try { decoder && decoder.state !== 'closed' && decoder.close(); } catch {}
    decoder = null; decoderEsperaKeyframe = true;
    try { ultimoQuadro && ultimoQuadro.close(); } catch {}
    ultimoQuadro = null; ultimoDesenho = 0; versaoQuadro = 0; versaoDesenhada = 0;
    try { camStream && camStream.getTracks().forEach(t => t.stop()); } catch {}
    camStream = null; camCanvas = null; camCtx2d = null;
    camPedido = { width: MEDIA.width, height: MEDIA.height, frameRate: MEDIA.frameRate };
    estado.cam.ativa = false; estado.cam.track = null; estado.cam.fps = 0;

    try { micStream && micStream.getTracks().forEach(t => t.stop()); } catch {}
    try { micCtx && micCtx.close(); } catch {}
    micStream = null; micCtx = null; micNode = null;
    estado.mic.ativo = false; estado.mic.ctx = 'closed';
  }

  // ------------------------------------------------------- gancho gUM/devices
  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices && mediaDevices.getUserMedia) {
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async function (constraints) {
      const pedeAudio = !!(constraints && constraints.audio);
      const pedeVideo = !!(constraints && constraints.video);
      const pedido = pedeVideo ? tamanhoPedido(constraints.video) : null;
      // O que o WhatsApp pediu fica registrado: sem isso "o video trava" nao
      // tem por onde comecar (ele pede 640x480? 30 fps? muda entre builds).
      let cru = null; try { cru = JSON.parse(JSON.stringify(constraints && constraints.video)); } catch {}
      estado.gum.push({ audio: pedeAudio, video: pedeVideo, pedido, cru, quando: Date.now() });
      if (estado.gum.length > 10) estado.gum.shift();
      relatar({ type: 'gum', audio: pedeAudio, video: pedeVideo, pedido });
      try {
        const saida = new MediaStream();
        if (pedeAudio) (await garantirMic()).getAudioTracks().forEach(t => saida.addTrack(t.clone()));
        if (pedeVideo) (await garantirCam(pedido)).getVideoTracks().forEach(t => saida.addTrack(t.clone()));
        if (saida.getTracks().length === 0) return original(constraints);
        return saida;
      } catch (e) {
        // Melhor devolver o dispositivo real (se houver) do que derrubar a
        // chamada: sem stream nenhum o WhatsApp Web nem tenta.
        relatar({ type: 'gum-fallback', message: String(e && e.message || e) });
        return original(constraints);
      }
    };
    estado.ganchos.getUserMedia = true;

    if (mediaDevices.enumerateDevices) {
      const originalDev = mediaDevices.enumerateDevices.bind(mediaDevices);
      mediaDevices.enumerateDevices = async function () {
        const reais = await originalDev().catch(() => []);
        const fachada = [
          { deviceId: 'zapcall-mic', groupId: 'zapcall', kind: 'audioinput', label: 'ZapCall (microfone)', toJSON() { return this; } },
          { deviceId: 'zapcall-cam', groupId: 'zapcall', kind: 'videoinput', label: 'ZapCall (camera)', toJSON() { return this; } },
          { deviceId: 'zapcall-out', groupId: 'zapcall', kind: 'audiooutput', label: 'ZapCall (saida)', toJSON() { return this; } },
        ];
        // Fachada PRIMEIRO: um container nao tem hardware nenhum, e pagina que
        // enxerga zero dispositivos costuma nem oferecer o botao de ligar.
        return [...fachada, ...reais];
      };
      estado.ganchos.enumerateDevices = true;
    }
  }

  // ------------------------------------------------- gancho RTCPeerConnection
  const RealPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (RealPC) {
    const capturados = new WeakSet();

    // A stack nativa pode reproduzir PCM via WebAudio, sem tracks RTP.
    // Espelhamos somente ligacoes feitas pela aplicacao a sua saida de audio.
    // O contexto de captura abaixo usa um destino MediaStream para converter
    // a taxa nativa (tipicamente 48 kHz) para os 16 kHz do contrato CRM.
    const conectarOriginal = AudioNode.prototype.connect;
    const saidasCapturadas = new WeakSet();
    function capturarNo(no) {
      if (!no || saidasCapturadas.has(no)) return () => {};
        saidasCapturadas.add(no);
        const espelho = no.context.createMediaStreamDestination();
        conectarOriginal.call(no, espelho);
        ligarAudioRemoto(espelho.stream).catch(e => {
          estado.remoto.erro = String(e.message || e);
          relatar({ type: 'media-error', message: estado.remoto.erro });
        });
        return () => {
          try { no.disconnect(espelho); } catch {}
          espelho.stream.getTracks().forEach(t => { t.stop(); t.dispatchEvent(new Event('ended')); });
          saidasCapturadas.delete(no);
        };
    }

    // ------------------------------------------------ ponte da midia nativa
    // Quem chama e o native-media.js. Enums observados no build de 10/09/2026:
    // orientation Unknown=0, Normal=1, Rotate90=2, Rotate180=3, Rotate270=4;
    // format NV12=0, I420=1, RGB24=2, RGBA=3, H264=100. No fio a orientacao vai
    // como 0..3 (multiplos de 90 graus, sentido horario) no byte 2 do header.
    const FORMATO_H264 = 100;
    const FORMATOS_CRUS = { 0: 'NV12', 1: 'I420', 3: 'RGBA' };
    let nativeEncoder = null, nativeSize = '', nativeFrames = 0;
    /** Ultima rotacao vista: o `output` do encoder e assincrono e nao pode
     *  prender a rotacao do quadro que criou o encoder. */
    let rotacaoAtual = 0;
    /** Depois de um descarte, o proximo quadro cru sai como keyframe. */
    let forcarKeyframe = true;

    function encerrarEncoderNativo() {
      try { nativeEncoder && nativeEncoder.state !== 'closed' && nativeEncoder.close(); } catch {}
      nativeEncoder = null; nativeSize = ''; nativeFrames = 0; forcarKeyframe = true;
    }

    window.__zapcallMedia = {
      captureAudioNode: capturarNo,
      /** Fim de chamada (ou da saida de audio nativa): nada fica pendurado. */
      encerrar() {
        encerrarEncoderNativo();
        encerrarEntradasVirtuais();
        estado.remoto.video = false;
        estado.remoto.tamanho = null;
        videoEsperaKeyframe = false;
      },
      video(buffer, width, height, orientation, format, timestamp, keyframe) {
        estado.remoto.video = true;
        estado.remoto.quadrosLidos += 1;
        estado.remoto.tamanho = { width, height, format };
        rotacaoAtual = orientation >= 1 && orientation <= 4 ? orientation - 1 : 0;
        if (format === FORMATO_H264) {
          // Ja vem Annex-B com SPS/PPS no keyframe: passa direto.
          if (enviarQuadro(KIND_VIDEO, keyframe ? FLAG_KEYFRAME : 0, rotacaoAtual, buffer)) estado.remoto.quadrosCodificados += 1;
          return;
        }
        const pixelFormat = FORMATOS_CRUS[format];
        if (!pixelFormat) {
          estado.remoto.formatoNaoSuportado = format;
          throw new Error('Formato de video nativo nao suportado: ' + format);
        }
        if (!('VideoEncoder' in window)) throw new Error('WebCodecs indisponivel para codificar video cru');
        const size = width + 'x' + height;
        if (!nativeEncoder || nativeEncoder.state === 'closed' || nativeSize !== size) {
          encerrarEncoderNativo();
          nativeSize = size;
          nativeEncoder = new VideoEncoder({
            output(chunk) {
              const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
              const ehKey = chunk.type === 'key';
              if (enviarQuadro(KIND_VIDEO, ehKey ? FLAG_KEYFRAME : 0, rotacaoAtual, bytes)) estado.remoto.quadrosCodificados += 1;
              else if (!ehKey) forcarKeyframe = true;
            },
            error(e) { estado.remoto.erro = String(e.message || e); encerrarEncoderNativo(); },
          });
          nativeEncoder.configure({ codec: codecH264(width, height, 15), width, height, bitrate: Math.min(2500000, Math.max(600000, width * height * 15 * 0.07)), framerate: 15, latencyMode: 'realtime', avc: { format: 'annexb' } });
        }
        if (nativeEncoder.encodeQueueSize > 2) { forcarKeyframe = true; return; }
        const frame = new VideoFrame(buffer, { format: pixelFormat, codedWidth: width, codedHeight: height, timestamp: timestamp * 1000 / 90 });
        try {
          const keyFrame = forcarKeyframe || nativeFrames % 30 === 0;
          nativeEncoder.encode(frame, { keyFrame });
          nativeFrames += 1; forcarKeyframe = false;
        } finally { frame.close(); }
      },
    };

    /**
     * Track remoto de WebRTC ligado SO no WebAudio nao bombeia amostra nenhuma
     * no Chrome — chegam quadros com pico 0. Prender o stream a um <audio> e o
     * que acorda o pipeline; volume 0 (e nao muted) para o container nao
     * mandar a voz do cliente para saida de audio nenhuma.
     */
    function acordarPipeline(stream) {
      try {
        const el = document.createElement('audio');
        el.srcObject = stream; el.volume = 0; el.autoplay = true;
        el.setAttribute('data-zapcall', 'sink');
        document.documentElement.appendChild(el);
        el.play().catch(() => {});
        return el;
      } catch { return null; }
    }

    async function ligarAudioRemoto(stream) {
      const track = stream.getAudioTracks()[0];
      if (!track || capturados.has(track)) return;
      capturados.add(track);
      const sink = acordarPipeline(stream);
      const capCtx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
      track.addEventListener('ended', () => { sink?.remove(); capCtx.close().catch(() => {}); }, { once: true });
      await moduloWorklet(capCtx, codigoWorklet('captura'));
      const capOrigem = capCtx.createMediaStreamSource(stream);
      const capNode = new AudioWorkletNode(capCtx, 'jw-captura', { numberOfOutputs: 0 });
      capNode.port.onmessage = (e) => {
        const pcm = e.data;
        let pico = 0;
        for (let i = 0; i < pcm.length; i += 16) { const a = Math.abs(pcm[i]); if (a > pico) pico = a; }
        if (pico > estado.remoto.pico) estado.remoto.pico = pico;
        enviarQuadro(KIND_AUDIO, 0, 0, pcm);
      };
      capOrigem.connect(capNode);
      if (capCtx.state === 'suspended') await capCtx.resume();
      estado.remoto.audio = true;
      estado.remoto.ctx = capCtx.state;
      relatar({ type: 'remote-audio', ready: true, ctx: capCtx.state });
    }

    async function ligarVideoRemoto(track) {
      if (capturados.has(track)) return;
      if (!('MediaStreamTrackProcessor' in window) || !('VideoEncoder' in window)) throw new Error('WebCodecs indisponivel');
      capturados.add(track);
      const encoder = new VideoEncoder({
        output: (chunk) => {
          const corpo = new Uint8Array(chunk.byteLength);
          chunk.copyTo(corpo);
          enviarQuadro(KIND_VIDEO, chunk.type === 'key' ? FLAG_KEYFRAME : 0, 0, corpo);
        },
        error: (e) => relatar({ type: 'encoder-error', message: String(e && e.message || e) }),
      });
      const cfg = { codec: 'avc1.42E01E', width: 640, height: 480, bitrate: 700000, framerate: 15, latencyMode: 'realtime', avc: { format: 'annexb' } };
      encoder.configure(cfg);
      const processor = new MediaStreamTrackProcessor({ track });
      const leitor = processor.readable.getReader();
      track.addEventListener('ended', () => { leitor.cancel().catch(() => {}); }, { once: true });
      estado.remoto.video = true;
      relatar({ type: 'remote-video', ready: true });
      let n = 0;
      while (true) {
        const { done, value } = await leitor.read();
        if (done) { if (encoder.state !== 'closed') encoder.close(); break; }
        try {
          if (encoder.encodeQueueSize < 3) encoder.encode(value, { keyFrame: n % 45 === 0 });
          n += 1;
        } finally { value.close(); }
      }
    }

    function PC(cfg) {
      const pc = new RealPC(cfg);
      estado.pcs += 1;
      // Retrato de cada PeerConnection. Sem isto, "nenhum track remoto chegou"
      // e uma afirmacao sem investigacao possivel: nao da para saber se o
      // WhatsApp nem negociou recepcao, se negociou e o track veio mudo, ou se
      // o audio dele nao passa por RTCPeerConnection nenhuma.
      const retrato = { n: estado.pcs, criadaEm: Date.now(), tracks: 0, estado: 'new', transceptores: [] };
      estado.pcsDetalhe.push(retrato);
      if (estado.pcsDetalhe.length > 12) estado.pcsDetalhe.shift();
      const atualizar = () => {
        try {
          retrato.estado = pc.connectionState + '/' + pc.signalingState + '/' + pc.iceConnectionState;
          retrato.transceptores = pc.getTransceivers().map(t => ({
            direcao: t.direction, atual: t.currentDirection,
            enviando: t.sender && t.sender.track ? t.sender.track.kind + ':' + t.sender.track.readyState : null,
            recebendo: t.receiver && t.receiver.track ? t.receiver.track.kind + ':' + t.receiver.track.readyState + (t.receiver.track.muted ? ':mudo' : '') : null,
          }));
        } catch {}
      };
      const relogioRetrato = timers.setInterval(atualizar, 1000);
      relatar({ type: 'pc', n: estado.pcs });
      pc.addEventListener('track', (ev) => {
        retrato.tracks += 1;
        relatar({ type: 'pc-track', kind: ev.track.kind });
        const falhou = e => { estado.remoto.erro = String(e.message || e); relatar({ type: 'media-error', message: estado.remoto.erro }); };
        if (ev.track.kind === 'audio') ligarAudioRemoto(new MediaStream([ev.track])).catch(falhou);
        if (ev.track.kind === 'video') ligarVideoRemoto(ev.track).catch(falhou);
      });
      pc.addEventListener('connectionstatechange', () => {
        relatar({ type: 'pc-state', state: pc.connectionState });
        // PC fechada nao muda mais: o retrato para, senao cada chamada deixa
        // meia duzia de relogios batendo para sempre.
        if (pc.connectionState === 'closed') { atualizar(); timers.clearInterval(relogioRetrato); }
      });
      return pc;
    }
    PC.prototype = RealPC.prototype;
    PC.generateCertificate = RealPC.generateCertificate;
    window.RTCPeerConnection = PC;
    window.webkitRTCPeerConnection = PC;
    estado.ganchos.rtcPeerConnection = true;
  }

  // Medidor por segundo: quantos quadros o decoder do operador entregou e
  // quantos o WhatsApp mandou de volta. E o numero que diz se o travamento
  // e de quem manda, de quem decodifica ou de quem codifica de novo.
  let ultCam = 0, ultRemoto = 0;
  timers.setInterval(() => {
    estado.cam.fps = estado.cam.quadros - ultCam; ultCam = estado.cam.quadros;
    estado.remoto.fps = estado.remoto.quadrosLidos - ultRemoto; ultRemoto = estado.remoto.quadrosLidos;
  }, 1000);

  conectar();
  relatar({ type: 'hooks', ganchos: estado.ganchos });
  log('ganchos instalados', estado.ganchos);
})();

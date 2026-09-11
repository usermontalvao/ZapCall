// Adaptador da midia NATIVA (WASM) do WhatsApp Web.
//
// Por que existe: neste build a voz e o video da chamada NAO passam pelas
// tracks das RTCPeerConnections que o inject.js intercepta (medido em
// 10/09/2026: sete PCs, algumas conectadas, zero transceptores). O WhatsApp
// reproduz o audio por AudioWorklet/ScriptProcessor proprio e entrega os
// quadros de video a um registro de renderizadores. Este arquivo espelha esses
// dois pontos para a ponte (`window.__zapcallMedia`, definida no inject.js).
//
// Diferente do inject.js, AQUI os ganchos sao em interfaces PRIVADAS da Meta
// (nomes de modulo). Uma atualizacao do WhatsApp Web pode renomea-las; quando
// isso acontecer o adaptador nao quebra a chamada — apenas para de espelhar, e
// `window.__zapcall.nativeMedia.faltando` diz o que nao encontrou.
//
// Regra inegociavel: falha na ponte NUNCA interrompe a reproducao original.
// Toda chamada original e feita, com o mesmo `this`, os mesmos argumentos e o
// mesmo retorno, mesmo que o espelho estoure.
(() => {
  'use strict';
  const AUDIO_CLASSES = [
    'WAWebVoipAudioPlaybackWorklet',
    'WAWebVoipAudioPlaybackSharedBufferWorklet',
    'WAWebVoipAudioPlaybackScriptProcessor',
  ];
  const VIDEO_REGISTRY = 'WAWebVoipVideoRendererRegistry';

  const wrapped = new WeakSet();
  const cleanups = new WeakMap();
  const status = {
    /** Classes de audio ja envolvidas. */
    audio: [],
    /** Registro de video ja envolvido. */
    video: false,
    /** Tudo o que procuramos foi encontrado e envolvido. */
    ready: false,
    /** O que ainda nao foi encontrado (loader ainda carregando, ou renomeado). */
    faltando: [...AUDIO_CLASSES, VIDEO_REGISTRY],
    tentativas: 0,
    /** Erro da PONTE (nunca de prontidao do loader). */
    error: null,
  };
  function report(error) { status.error = String((error && error.message) || error); }

  /**
   * `loader.loadModule` LANCA enquanto o loader nao esta pronto
   * ("moduleRequire is not a function"). Isso e prontidao, nao erro: fica
   * fora de `status.error`, senao um erro de segundos antes da instalacao
   * completa aparece como falha atual para sempre.
   */
  function modulo(loader, nome) {
    try { return loader.loadModule(nome) || null; } catch { return null; }
  }

  function envolverAudio(bridge, loader, nome) {
    const proto = modulo(loader, nome)?.[nome]?.prototype;
    if (!proto) return false;
    if (wrapped.has(proto)) return true;
    if (typeof proto.startAudioPlayback !== 'function' || typeof proto.stopAudioPlayback !== 'function') return false;
    const start = proto.startAudioPlayback, stop = proto.stopAudioPlayback;
    proto.startAudioPlayback = async function (...args) {
      const result = await start.apply(this, args);
      try {
        cleanups.get(this)?.();
        cleanups.set(this, bridge.captureAudioNode(this.audioWorkletNode || this.playbackScriptProcessor));
      } catch (error) { report(error); }
      return result;
    };
    proto.stopAudioPlayback = function (...args) {
      try { cleanups.get(this)?.(); cleanups.delete(this); } catch (error) { report(error); }
      // A saida de audio parando e o sinal mais proximo de "a chamada acabou"
      // que a stack nativa oferece: o codificador de video vai junto.
      try { bridge.encerrar?.(); } catch (error) { report(error); }
      return stop.apply(this, args);
    };
    wrapped.add(proto);
    status.audio.push(nome);
    return true;
  }

  function envolverVideo(bridge, loader) {
    const registry = modulo(loader, VIDEO_REGISTRY)?.videoRendererRegistry;
    if (!registry) return false;
    if (wrapped.has(registry)) return true;
    if (typeof registry.onVideoFrameWasmToJs !== 'function') return false;
    const original = registry.onVideoFrameWasmToJs;
    // Assinatura observada: (source, frameBuffer, width, height, orientation,
    // format, timestamp, isKeyFrame). So o lado REMOTO e espelhado — a previa
    // local e a nossa propria camera virtual voltando.
    registry.onVideoFrameWasmToJs = function (source, ...args) {
      try { if (source && typeof source.isSelf === 'function' && !source.isSelf()) bridge.video(...args); }
      catch (error) { report(error); }
      return original.call(this, source, ...args);
    };
    wrapped.add(registry);
    status.video = true;
    return true;
  }

  // Timers nativos (ver inject.js): o clearInterval do WhatsApp Web nao
  // cancela um relogio nativo, e este ficaria batendo a cada segundo para sempre.
  const timers = window.__zapcallTimers || {
    setInterval: (fn, ms) => window.setInterval(fn, ms), clearInterval: (id) => window.clearInterval(id),
  };
  let relogio = null;
  function install() {
    const bridge = window.__zapcallMedia;
    const loader = window.WPP && window.WPP.loader;
    if (!bridge || !loader) return false;
    if (window.__zapcall) window.__zapcall.nativeMedia = status;
    status.tentativas += 1;
    const faltando = [];
    for (const nome of AUDIO_CLASSES) {
      try { if (!envolverAudio(bridge, loader, nome)) faltando.push(nome); }
      catch (error) { report(error); faltando.push(nome); }
    }
    try { if (!envolverVideo(bridge, loader)) faltando.push(VIDEO_REGISTRY); }
    catch (error) { report(error); faltando.push(VIDEO_REGISTRY); }
    status.faltando = faltando;
    status.ready = faltando.length === 0;
    if (status.ready) {
      // Instalacao completa: o que ficou de erro era prontidao, nao falha.
      status.error = null;
      if (relogio) { timers.clearInterval(relogio); relogio = null; }
    }
    return status.ready;
  }

  window.__zapcallNativeMedia = { install, status, AUDIO_CLASSES, VIDEO_REGISTRY };
  if (!install()) relogio = timers.setInterval(install, 1000);
})();

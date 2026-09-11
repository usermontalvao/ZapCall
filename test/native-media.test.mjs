// O adaptador roda DENTRO da pagina do WhatsApp; aqui ele roda dentro de um
// contexto `vm` com um `window` de mentira. Os mocks imitam so o que o
// adaptador toca: `WPP.loader.loadModule`, as classes de reproducao de audio,
// o registro de renderizadores de video e a ponte `__zapcallMedia`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

/** Arrays nascidos no contexto vm tem outro prototipo: compara-se por valor. */
const igual = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

const FONTE = await readFile(new URL('../src/page/native-media.js', import.meta.url), 'utf8');

/** Um build de mentira: classes de audio e registro de video, prontos ou nao. */
function buildFalso({ pronto = true } = {}) {
  const chamadas = [];
  class Playback {
    async startAudioPlayback(...args) { chamadas.push(['start', this, args]); this.audioWorkletNode = { id: 'no-' + (this.n = (this.n || 0) + 1) }; return 'start-ok'; }
    stopAudioPlayback(...args) { chamadas.push(['stop', this, args]); return 'stop-ok'; }
  }
  const classes = {
    WAWebVoipAudioPlaybackWorklet: class extends Playback {},
    WAWebVoipAudioPlaybackSharedBufferWorklet: class extends Playback {},
    WAWebVoipAudioPlaybackScriptProcessor: class extends Playback {},
  };
  const registry = {
    onVideoFrameWasmToJs(source, ...args) { chamadas.push(['frame', this, [source, ...args]]); return 'frame-ok'; },
  };
  const loader = {
    loadModule(nome) {
      // Antes de pronto, o loader real LANCA — exatamente o erro que ficava
      // preso em status.error.
      if (!pronto) throw new TypeError('(0 , t.moduleRequire) is not a function');
      if (classes[nome]) return { [nome]: classes[nome] };
      if (nome === 'WAWebVoipVideoRendererRegistry') return { videoRendererRegistry: registry };
      return undefined;
    },
    set pronto(v) { pronto = v; },
  };
  return { loader, classes, registry, chamadas };
}

function ponteFalsa() {
  const p = { capturas: [], limpezas: 0, videos: [], encerrados: 0, explodir: false };
  p.captureAudioNode = (no) => { if (p.explodir) throw new Error('ponte explodiu'); p.capturas.push(no); return () => { p.limpezas += 1; }; };
  p.video = (...args) => { if (p.explodir) throw new Error('ponte explodiu'); p.videos.push(args); };
  p.encerrar = () => { p.encerrados += 1; };
  return p;
}

function montar({ build = buildFalso(), ponte = ponteFalsa(), comZapcall = true } = {}) {
  const timers = [];
  const window = { WPP: { loader: build.loader }, __zapcallMedia: ponte };
  if (comZapcall) window.__zapcall = {};
  // Os timers nativos que o inject.js prende antes de a Meta troca-los.
  window.__zapcallTimers = {
    setInterval: (fn, ms) => { timers.push({ fn, ms, ativo: true }); return timers.length; },
    clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].ativo = false; },
  };
  const ctx = createContext({ window });
  runInContext(FONTE, ctx, { filename: 'native-media.js' });
  return { window, build, ponte, timers, api: window.__zapcallNativeMedia };
}

test('instala os quatro ganchos e fica pronto sem erro', () => {
  const { api, window, timers } = montar();
  assert.equal(api.status.ready, true);
  igual(api.status.audio, api.AUDIO_CLASSES);
  assert.equal(api.status.video, true);
  igual(api.status.faltando, []);
  assert.equal(api.status.error, null);
  assert.equal(window.__zapcall.nativeMedia, api.status, 'diagnostico exposto em window.__zapcall');
  assert.equal(timers.length, 0, 'instalou de primeira: nao precisa de relogio');
});

test('loader ainda carregando: tenta de novo sem registrar erro, e para o relogio ao completar', () => {
  const build = buildFalso({ pronto: false });
  const { api, timers } = montar({ build });
  assert.equal(api.status.ready, false);
  assert.equal(api.status.error, null, 'prontidao do loader nao e erro');
  assert.equal(api.status.faltando.length, 4);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ativo, true);

  timers[0].fn();
  assert.equal(api.status.ready, false, 'continua indisponivel');

  build.loader.pronto = true;
  timers[0].fn();
  assert.equal(api.status.ready, true);
  assert.equal(api.status.error, null);
  assert.equal(timers[0].ativo, false, 'relogio desarmado depois de completar');
});

test('instalar de novo nao duplica os ganchos', async () => {
  const { api, build, ponte } = montar();
  api.install(); api.install();
  assert.equal(api.status.audio.length, 3);
  const inst = new build.classes.WAWebVoipAudioPlaybackWorklet();
  await inst.startAudioPlayback();
  assert.equal(ponte.capturas.length, 1, 'uma captura por start, nao uma por install');
  const fonte = { isSelf: () => false };
  build.registry.onVideoFrameWasmToJs(fonte, 'buf', 640, 480, 1, 100, 0, true);
  assert.equal(ponte.videos.length, 1);
});

test('start preserva this, argumentos e retorno, e captura o no de audio', async () => {
  const { build, ponte } = montar();
  const inst = new build.classes.WAWebVoipAudioPlaybackSharedBufferWorklet();
  const r = await inst.startAudioPlayback('a', 2);
  assert.equal(r, 'start-ok');
  const [tipo, thisArg, args] = build.chamadas.at(-1);
  assert.equal(tipo, 'start'); assert.equal(thisArg, inst); igual(args, ['a', 2]);
  assert.equal(ponte.capturas.length, 1); assert.equal(ponte.capturas[0], inst.audioWorkletNode);
});

test('start seguido captura de novo e limpa a captura anterior; stop limpa e encerra o video', async () => {
  const { build, ponte } = montar();
  const inst = new build.classes.WAWebVoipAudioPlaybackScriptProcessor();
  await inst.startAudioPlayback();
  await inst.startAudioPlayback();
  assert.equal(ponte.capturas.length, 2);
  assert.equal(ponte.limpezas, 1, 'o segundo start limpou o primeiro espelho');
  const r = inst.stopAudioPlayback('x');
  assert.equal(r, 'stop-ok');
  assert.equal(ponte.limpezas, 2);
  assert.equal(ponte.encerrados, 1, 'parar o audio nativo encerra o codificador de video');
  assert.equal(build.chamadas.at(-1)[0], 'stop'); assert.equal(build.chamadas.at(-1)[1], inst); igual(build.chamadas.at(-1)[2], ['x']);
  inst.stopAudioPlayback();
  assert.equal(ponte.limpezas, 2, 'stop repetido nao limpa duas vezes');
});

test('excecao na ponte nunca interrompe o original', async () => {
  const { api, build, ponte } = montar();
  ponte.explodir = true;
  const inst = new build.classes.WAWebVoipAudioPlaybackWorklet();
  assert.equal(await inst.startAudioPlayback(), 'start-ok');
  assert.equal(api.status.error, 'ponte explodiu');
  const fonte = { isSelf: () => false };
  assert.equal(build.registry.onVideoFrameWasmToJs(fonte, 'buf', 1, 1, 1, 100, 0, true), 'frame-ok');
  assert.equal(build.chamadas.at(-1)[0], 'frame');
  assert.equal(build.chamadas.at(-1)[1], build.registry, 'this do registro preservado');
});

test('video: so o lado remoto vai para a ponte; a previa local e descartada', () => {
  const { build, ponte } = montar();
  const remoto = { isSelf: () => false };
  const local = { isSelf: () => true };
  const semIsSelf = {};
  build.registry.onVideoFrameWasmToJs(local, 'b1', 640, 480, 1, 100, 10, true);
  build.registry.onVideoFrameWasmToJs(semIsSelf, 'b2', 640, 480, 1, 100, 20, true);
  build.registry.onVideoFrameWasmToJs(remoto, 'b3', 1280, 720, 2, 100, 30, false);
  assert.equal(build.chamadas.length, 3, 'o original recebeu os tres');
  igual(ponte.videos, [['b3', 1280, 720, 2, 100, 30, false]]);
});

test('modulo renomeado: os outros ganchos entram e o que falta fica listado', () => {
  const build = buildFalso();
  delete build.classes.WAWebVoipAudioPlaybackScriptProcessor;
  const { api, timers } = montar({ build });
  assert.equal(api.status.ready, false);
  igual(api.status.faltando, ['WAWebVoipAudioPlaybackScriptProcessor']);
  assert.equal(api.status.audio.length, 2);
  assert.equal(api.status.video, true);
  assert.equal(api.status.error, null);
  assert.equal(timers[0].ativo, true, 'continua procurando');
});

test('sem ponte ou sem loader nao faz nada e nao explode', () => {
  const ctx = createContext({ window: { setInterval: () => 1, clearInterval: () => {} } });
  runInContext(FONTE, ctx);
  assert.equal(ctx.window.__zapcallNativeMedia.status.ready, false);
  assert.equal(ctx.window.__zapcallNativeMedia.install(), false);
});

// Perfil unico para todo o caminho webcam -> WhatsApp. Manter estes valores
// juntos evita que o discador codifique um formato e a pagina tente decodificar
// outro — e permite escolher qualidade sem voltar a criar filas de segundos.

const PERFIS = Object.freeze({
  // Prioriza movimento continuo e fila curta. E o padrao seguro para VPS sem
  // GPU e para operadores conectados pela internet.
  realtime: Object.freeze({
    width: 640,
    height: 360,
    frameRate: 24,
    bitrate: 650_000,
    keyframeIntervalMs: 1_000,
    browserQueueBytes: 32 * 1024,
    relayQueueBytes: 96 * 1024,
    decoderQueueSize: 2,
  }),
  // Meio-termo para uma maquina com pelo menos dois nucleos livres por canal.
  balanced: Object.freeze({
    width: 960,
    height: 540,
    frameRate: 24,
    bitrate: 1_050_000,
    keyframeIntervalMs: 1_000,
    browserQueueBytes: 48 * 1024,
    relayQueueBytes: 128 * 1024,
    decoderQueueSize: 2,
  }),
  // So use quando CPU e upload foram medidos; continua com fila curta.
  hd: Object.freeze({
    width: 1280,
    height: 720,
    frameRate: 30,
    bitrate: 1_800_000,
    keyframeIntervalMs: 1_000,
    browserQueueBytes: 64 * 1024,
    relayQueueBytes: 192 * 1024,
    decoderQueueSize: 2,
  }),
});

const LIMITES = Object.freeze({
  width: [160, 1920],
  height: [120, 1080],
  frameRate: [10, 30],
  bitrate: [150_000, 4_000_000],
});

function inteiro(valor, padrao, [min, max]) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Aceita `process.env` ou um objeto ja normalizado. Overrides granulares sao
 * uteis em hardware conhecido; para a maioria dos casos basta o perfil.
 */
export function configurarMidia(fonte = process.env) {
  const nomePedido = String(fonte.profile || fonte.ZAPCALL_VIDEO_PROFILE || 'realtime').toLowerCase();
  const profile = PERFIS[nomePedido] ? nomePedido : 'realtime';
  const base = PERFIS[profile];
  const width = inteiro(fonte.width ?? fonte.ZAPCALL_VIDEO_WIDTH, base.width, LIMITES.width);
  const height = inteiro(fonte.height ?? fonte.ZAPCALL_VIDEO_HEIGHT, base.height, LIMITES.height);
  const frameRate = inteiro(fonte.frameRate ?? fonte.ZAPCALL_VIDEO_FPS, base.frameRate, LIMITES.frameRate);
  const bitrate = inteiro(fonte.bitrate ?? fonte.ZAPCALL_VIDEO_BITRATE, base.bitrate, LIMITES.bitrate);
  return Object.freeze({
    profile,
    // H.264 4:2:0 exige dimensoes pares na pratica.
    width: width - (width % 2),
    height: height - (height % 2),
    frameRate,
    bitrate,
    keyframeIntervalMs: base.keyframeIntervalMs,
    browserQueueBytes: base.browserQueueBytes,
    relayQueueBytes: base.relayQueueBytes,
    decoderQueueSize: base.decoderQueueSize,
  });
}

export const PERFIS_DE_VIDEO = PERFIS;

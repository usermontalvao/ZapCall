// Os DOIS worklets de audio do projeto, em fonte unica.
//
// Eles sao usados nas duas pontas e em espelho: na pagina do WhatsApp, a
// "reproducao" vira o MICROFONE (o que o operador falou) e a "captura" pega a
// voz do cliente; no discador e o contrario. Mesmo codigo, papeis trocados —
// por isso nao pode existir uma segunda copia divergindo em silencio.
//
// Taxa unica: 16 kHz mono, quadros de 960 amostras (60 ms).

/**
 * Buffer de jitter. Tres regras que so funcionam juntas: ALVO de 120 ms antes
 * de comecar a tocar; TETO de 240 ms, acima do qual duas amostras viram uma
 * (encolhe sem emenda, porque e media e nao corte); e no FURO decai do ultimo
 * valor em vez de escrever zero seco — zero seco e descontinuidade, ou seja,
 * um clique. Depois do furo ele reprime, senao um furo vira metralhadora.
 */
export const CODIGO_REPRODUCAO = `
class Reproducao extends AudioWorkletProcessor {
  constructor() {
    super();
    this.anel = new Float32Array(16000 * 2);
    this.leitura = 0; this.escrita = 0; this.cheio = 0;
    this.alvo = 1920; this.teto = 3840;
    this.armado = false; this.ultimo = 0; this.furos = 0;
    this.port.onmessage = (e) => {
      const pcm = e.data;
      for (let i = 0; i < pcm.length; i++) {
        this.anel[this.escrita] = pcm[i] / 32768;
        this.escrita = (this.escrita + 1) % this.anel.length;
        if (this.cheio < this.anel.length) this.cheio++;
        else this.leitura = (this.leitura + 1) % this.anel.length;
      }
    };
  }
  process(_inputs, outputs) {
    const saida = outputs[0][0];
    if (!this.armado) {
      if (this.cheio < this.alvo) { saida.fill(0); return true; }
      this.armado = true;
    }
    const encolher = this.cheio > this.teto;
    for (let i = 0; i < saida.length; i++) {
      if (this.cheio <= 0) {
        this.ultimo *= 0.85; saida[i] = this.ultimo;
        this.furos++; this.armado = false;
        continue;
      }
      let v = this.anel[this.leitura];
      this.leitura = (this.leitura + 1) % this.anel.length; this.cheio--;
      if (encolher && this.cheio > 0) {
        const w = this.anel[this.leitura];
        this.leitura = (this.leitura + 1) % this.anel.length; this.cheio--;
        v = (v + w) / 2;
      }
      this.ultimo = v; saida[i] = v;
    }
    return true;
  }
}
registerProcessor('jw-reproducao', Reproducao);
`;

/** Acumula ate 960 amostras e entrega o quadro pronto para a rede. */
export const CODIGO_CAPTURA = `
class Captura extends AudioWorkletProcessor {
  constructor() { super(); this.acc = new Int16Array(960); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      let s = ch[i] * 32768;
      if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
      this.acc[this.n++] = s | 0;
      if (this.n === 960) { this.port.postMessage(this.acc.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('jw-captura', Captura);
`;

/** O preludio que publica os dois na pagina, para quem nao pode importar. */
export function preludio() {
  return 'window.__ZC_WORKLETS = '
    + JSON.stringify({ reproducao: CODIGO_REPRODUCAO, captura: CODIGO_CAPTURA })
    + ';';
}

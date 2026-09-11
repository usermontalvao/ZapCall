// O QR no TERMINAL. Dentro do Docker nao existe janela: quem pareia le o
// codigo no `docker logs`, ou pede por `GET /api/pairing/qr`.
//
// O payload vem do atributo `data-ref` do proprio WhatsApp Web. Que ele e
// exatamente o conteudo do QR desenhado na tela nao e suposicao: o autoteste
// decodifica os pixels do canvas com jsQR e compara com o `data-ref`.
import QRCode from 'qrcode';

/**
 * PNG desenhado por nos, a partir do payload. E melhor que um screenshot do
 * canvas: o screenshot pega o logo do WhatsApp por cima, pode sair cortado ou
 * capturado no meio do desenho — foi assim que apareceu "QR bugado".
 */
export async function paraPng(payload, escala = 8) {
  if (!payload) return null;
  const buf = await QRCode.toBuffer(payload, { type: 'png', scale: escala, margin: 2, errorCorrectionLevel: 'L' });
  return buf.toString('base64');
}

/** Desenha o QR em blocos, do tamanho que caiba num terminal. */
export async function paraTerminal(payload) {
  if (!payload) return null;
  return QRCode.toString(payload, { type: 'terminal', small: true, errorCorrectionLevel: 'L' });
}

/**
 * O bloco que vai para o log. Sem o payload em texto de proposito: quem le o
 * log durante a janela de pareamento consegue vincular o PROPRIO aparelho ao
 * numero, e um QR ja e o suficiente para isso.
 */
export async function blocoDeLog(payload, numero) {
  const arte = await paraTerminal(payload);
  if (!arte) return null;
  const risco = '─'.repeat(58);
  return [
    '',
    risco,
    ' LEIA ESTE QR NO CELULAR DO NUMERO A PAREAR',
    ' WhatsApp > Dispositivos conectados > Conectar dispositivo',
    ' (QR n. ' + numero + ' — expira em ~20 s; o proximo sai aqui sozinho)',
    risco,
    arte,
    risco,
    '',
  ].join('\n');
}

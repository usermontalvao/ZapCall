// A regra do numero, num lugar so.
//
// Numero sem DDI e a armadilha classica de quem integra: aqui, sem o codigo
// do pais, o `WPP.call.offer` volta VAZIO e a chamada nem nasce. Por isso o
// numero e normalizado numa funcao so, e o DDI padrao e uma CONFIGURACAO
// (`DEFAULT_COUNTRY_CODE`), nunca um chute embutido no codigo.

/**
 * Deixa o numero na forma que o WhatsApp entende (so digitos, com DDI).
 *
 * - Ja vem com 12-15 digitos: e internacional, passa inteiro.
 * - Tem 10-11 digitos (numero nacional com DDD) e ha `countryCode`: ganha o
 *   DDI. Sem `countryCode`, o numero e recusado — melhor um 400 explicito do
 *   que uma chamada para o pais errado.
 * - Quem ja comeca pelo `countryCode` e tem o tamanho certo passa direto.
 */
export function normalizar(bruto, countryCode = '') {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  const ddi = String(countryCode ?? '').replace(/\D/g, '');
  if (!digitos) return { numero: '', valido: false, motivo: 'vazio' };
  if (ddi && digitos.startsWith(ddi) && digitos.length >= ddi.length + 10 && digitos.length <= 15) {
    return { numero: digitos, valido: true, motivo: 'ja tinha DDI' };
  }
  if (digitos.length === 10 || digitos.length === 11) {
    if (ddi) return { numero: ddi + digitos, valido: true, motivo: 'DDI ' + ddi + ' acrescentado' };
    return { numero: digitos, valido: false, motivo: 'sem codigo do pais (defina DEFAULT_COUNTRY_CODE ou envie o numero completo)' };
  }
  if (digitos.length >= 12 && digitos.length <= 15) {
    return { numero: digitos, valido: true, motivo: 'numero internacional' };
  }
  return { numero: digitos, valido: false, motivo: 'tamanho improvavel (' + digitos.length + ' digitos)' };
}

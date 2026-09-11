// Pareamento SEM janela — que e como vai ser no Docker.
//
// O Chrome fica headless: o QR sai no terminal e na pagina http://.../pair, que
// se redesenha sozinha conforme o codigo gira. `HEADFUL=1` abre a janela, mas
// so para depurar. Ler o QR e sempre acao humana: vincula um dispositivo ao
// numero e gasta uma das ~4 vagas.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { iniciarApp } from '../src/app.mjs';

const SAIDA = join(process.cwd(), 'data', 'probe');
mkdirSync(SAIDA, { recursive: true });

const app = await iniciarApp({
  port: Number(process.env.PORT || 18475),
  headful: process.env.HEADFUL === '1',
  verbose: false,
});
console.log('QR no terminal abaixo, e tambem em http://127.0.0.1:' + app.port + '/pair');
console.log('No celular: WhatsApp > Dispositivos conectados > Conectar dispositivo.');
console.log('(o codigo gira a cada ~20 s; os dois lugares mostram sempre o atual)\n');

let ultimo = '';
const relogio = setInterval(async () => {
  const s = await app.nav.status().catch(() => null);
  const linha = s && s.connected
    ? 'PAREADO — jid ' + s.jid + ' | telefone ' + (s.phone || '?') + ' | ' + (s.pushName || '')
    : 'aguardando leitura do QR...';
  if (linha !== ultimo) { console.log(new Date().toLocaleTimeString('pt-BR') + '  ' + linha); ultimo = linha; }
  if (s && s.connected) {
    writeFileSync(join(SAIDA, 'pareado.json'), JSON.stringify(s, null, 2));
    console.log('\nSessao guardada em ' + app.profileDir);
    console.log('Agora: node scripts/call.mjs <numero> --video');
    clearInterval(relogio);
  } else {
    const qr = await app.nav.qr().catch(() => null);
    if (qr && qr.ref) {
      const { paraPng } = await import('../src/qr.mjs');
      writeFileSync(join(SAIDA, 'qr-live.png'), Buffer.from(await paraPng(qr.ref), 'base64'));
    }
  }
}, 3000);

process.on('SIGINT', async () => { clearInterval(relogio); await app.parar(); process.exit(0); });

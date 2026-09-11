// Imprime o QR ATUAL, ao vivo, do servico que ja esta rodando.
//
// Nao sobe navegador nenhum: fala HTTP com o ZapCall. Por isso pode rodar
// junto com `npm start`/`npm run pair` sem brigar pelo perfil do Chrome — e
// serve igual no servidor (`--url` aponta para o tunel).
//
// Uso: npm run qr            (127.0.0.1:18475)
//      npm run qr -- --url=http://127.0.0.1:18475 --token=xxx
const args = process.argv.slice(2);
const pega = (nome, padrao) => {
  const a = args.find(x => x.startsWith('--' + nome + '='));
  return a ? a.split('=').slice(1).join('=') : padrao;
};
const base = pega('url', 'http://127.0.0.1:' + (process.env.PORT || 18475)).replace(/\/+$/, '');
const token = pega('token', process.env.ZAPCALL_TOKEN || '');
const headers = token ? { Authorization: 'Bearer ' + token } : {};
const limpar = () => process.stdout.write('\x1b[2J\x1b[H');

let ref = null;
let n = 0;
console.log('lendo o QR de ' + base + ' … (ctrl+c para sair)');

for (;;) {
  try {
    const s = await fetch(base + '/api/status', { headers }).then(r => r.json());
    if (s.connected) {
      limpar();
      console.log('\n  PAREADO\n');
      console.log('  jid ......: ' + s.jid);
      console.log('  telefone .: ' + (s.phone || '?'));
      console.log('  nome .....: ' + (s.pushName || '?') + '\n');
      console.log('  agora: npm run call -- 5565999999999 --video\n');
      process.exit(0);
    }
    const resposta = await fetch(base + '/api/pairing/qr', { headers });
    const q = resposta.ok ? await resposta.json() : null;
    if (q && q.ref && q.ref !== ref) {
      ref = q.ref; n += 1;
      limpar();
      console.log('  ZapCall — leia com o celular do numero a parear');
      console.log('  WhatsApp > Dispositivos conectados > Conectar dispositivo');
      console.log('  (codigo n. ' + n + '; o WhatsApp troca sozinho a cada ~20 s)\n');
      console.log(q.ansi);
    }
    if (!q) {
      // Mensagem honesta: "esta subindo?" escondia uma pagina MORTA respondendo
      // 404 para sempre. Agora /healthz diz se a pagina esta viva.
      const saude = await fetch(base + '/healthz').then(r => r.json()).catch(() => null);
      const porque = resposta.status === 401 ? 'token invalido'
        : saude && saude.pagina === 'morta' ? 'a pagina do Chrome morreu — o servico esta se recriando, aguarde'
        : 'a tela do QR ainda nao apareceu';
      console.log('sem QR (HTTP ' + resposta.status + '): ' + porque);
    }
  } catch (e) {
    console.log('servico fora do ar em ' + base + ' (' + (e && e.message) + ')');
  }
  await new Promise(r => setTimeout(r, 2000));
}

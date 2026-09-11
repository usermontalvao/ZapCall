// A demo manager on a separate port, with a THROWAWAY key and temporary
// data, so the panel can be explored (and screenshotted) without touching a
// real installation. Instances stay in "Waiting for QR" unless you pair them.
//
//   node scripts/demo.mjs            → http://127.0.0.1:18490  (key: demo-key)
//   PORT=18495 DEMO_KEY=x node scripts/demo.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarGerente } from '../src/manager.mjs';

export async function subirDemo({ port = Number(process.env.PORT || 18490), apiKey = process.env.DEMO_KEY || 'demo-key', instancias = true } = {}) {
  const g = await iniciarGerente({ port, dataDir: mkdtempSync(join(tmpdir(), 'zc-demo-')), portBase: 18800, apiKey, verbose: false });
  const base = 'http://127.0.0.1:' + g.port;
  const adm = { apikey: apiKey, 'content-type': 'application/json' };
  if (instancias) {
    for (const [name, channel] of [['sales', 'Sales team'], ['support', 'Customer support'], ['billing', 'Billing']]) {
      await fetch(base + '/manager/instances', { method: 'POST', headers: adm, body: JSON.stringify({ name, channel }) });
    }
    await fetch(base + '/manager/instances/billing', { method: 'PATCH', headers: adm, body: JSON.stringify({ enabled: false }) });
    await fetch(base + '/manager/instances/support', { method: 'PATCH', headers: adm, body: JSON.stringify({ webhook: { url: 'https://example.com/zapcall' } }) });
  }
  return { gerente: g, base, apiKey };
}

const direto = process.argv[1] && new URL(import.meta.url).pathname === (await import('node:path')).resolve(process.argv[1]);
if (direto) {
  const d = await subirDemo();
  console.log('demo manager at ' + d.base + '  (global key: ' + d.apiKey + ')');
  const sair = async () => { await d.gerente.parar(); process.exit(0); };
  process.on('SIGINT', sair); process.on('SIGTERM', sair);
}

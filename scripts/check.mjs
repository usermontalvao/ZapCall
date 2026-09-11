import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

let failed = false;
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { await check(path); continue; }
    const sources = /\.(mjs|js)$/.test(path) ? [await readFile(path, 'utf8')]
      : path.endsWith('.html') ? [...(await readFile(path, 'utf8')).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]) : [];
    for (const source of sources) {
      const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
      if (result.status !== 0) { failed = true; console.error(path, result.stderr); }
    }
  }
}
await check('src');
await check('scripts');
await check('test');
process.exitCode = failed ? 1 : 0;

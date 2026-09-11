// Prints the CHANGELOG.md section of one version (used for release notes).
//   node scripts/changelog.mjs 0.1.0
import { readFileSync } from 'node:fs';
const versao = process.argv[2];
if (!versao) { console.error('uso: node scripts/changelog.mjs <versao>'); process.exit(1); }
const linhas = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split('\n');
const inicio = linhas.findIndex(l => l.startsWith('## [' + versao + ']'));
if (inicio < 0) { console.error('versao ' + versao + ' nao esta no CHANGELOG.md'); process.exit(1); }
const corpo = [];
for (const l of linhas.slice(inicio + 1)) { if (l.startsWith('## [') || /^\[[^\]]+\]: /.test(l)) break; corpo.push(l); }
process.stdout.write(corpo.join('\n').trim() + '\n');

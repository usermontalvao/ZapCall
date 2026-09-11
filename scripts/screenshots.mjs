// Regenerates docs/screenshots/*.png: a demo manager with a throwaway key,
// three instances (no WhatsApp session needed) and a headless Chrome that
// signs in, opens the pairing dialog, the logs tab and the documentation.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { acharChrome } from '../src/browser.mjs';
import { subirDemo } from './demo.mjs';

const SAIDA = join(process.cwd(), 'docs', 'screenshots');
mkdirSync(SAIDA, { recursive: true });
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

const demo = await subirDemo({ port: 0 });
// Give the instances a few seconds to boot so the table shows "Waiting for QR".
await esperar(6000);
const perfil = mkdtempSync(join(tmpdir(), 'zc-shots-'));
const browser = await puppeteer.launch({ executablePath: acharChrome(process.env.CHROME_PATH || ''), headless: true, args: ['--user-data-dir=' + perfil, ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])], defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 } });
try {
  const page = (await browser.pages())[0];
  await page.goto(demo.base + '/', { waitUntil: 'load' });
  await page.evaluate((k) => { localStorage.setItem('zc.manager.apikey', k); localStorage.setItem('zc.lang', 'en'); localStorage.setItem('zc.theme', 'light'); }, demo.apiKey);
  await page.reload({ waitUntil: 'load' });
  await esperar(2500);
  await page.screenshot({ path: join(SAIDA, 'panel-instances.png') });

  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /Pair/.test(b.textContent))?.click());
  await esperar(3500);
  await page.screenshot({ path: join(SAIDA, 'panel-pairing.png') });
  await page.keyboard.press('Escape');

  await page.evaluate(() => document.querySelector('#corpoTabela tr')?.click());
  await esperar(800);
  await page.evaluate(() => document.querySelector('#gAbas [data-aba="logs"]')?.click());
  await esperar(1500);
  await page.screenshot({ path: join(SAIDA, 'panel-logs.png') });

  await page.goto(demo.base + '/docs#websocket', { waitUntil: 'load' });
  await esperar(1500);
  await page.screenshot({ path: join(SAIDA, 'docs.png') });
  console.log('screenshots written to ' + SAIDA);
} finally {
  await browser.close();
  rmSync(perfil, { recursive: true, force: true });
  await demo.gerente.parar();
}

// Usage: node snap.mjs <outdir> t1 t2 ...  — saves PNG frames at given seconds
import { createRequire } from 'module';
import { execSync } from 'child_process';
const req = createRequire(import.meta.url);
let pw; try { pw = req('playwright'); } catch { pw = req(execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium } = pw;
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
const [out, ...ts] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
await page.goto(pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), (process.env.PAGE || 'index.html'))).href + '?render=1');
await page.evaluate(() => document.fonts.load('900 40px "Noto Sans KR"'));
await page.setViewportSize(await page.evaluate(() => ({ width: window.VW || 1920, height: window.VH || 1080 })));
for (const t of ts) {
  await page.evaluate(t => renderFrame(t), +t);
  const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/jpeg', .8).split(',')[1]);
  fs.writeFileSync(`${out}/f${String(t).padStart(6, '0')}.jpg`, Buffer.from(b64, 'base64'));
}
console.log(errs.length ? errs.join('\n') : 'ok');
await browser.close();

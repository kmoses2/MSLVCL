// Renders index.html to an MP4 (1920x1080) via headless Chromium + ffmpeg.
// Usage: node render.mjs [out.mp4] [fps]
import { createRequire } from 'module';
import { execSync, spawn } from 'child_process';
import { pathToFileURL } from 'url';
import path from 'path';
const req = createRequire(import.meta.url);
let pw; try { pw = req('playwright'); } catch { pw = req(execSync('npm root -g').toString().trim() + '/playwright'); }
const out = process.argv[2] || 'yellowstone.mp4', fps = +(process.argv[3] || 30);
const here = path.dirname(new URL(import.meta.url).pathname);
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(path.join(here, 'index.html')).href + '?render=1');
await page.evaluate(() => document.fonts.ready);
const total = await page.evaluate(() => window.TOTAL);
const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const n = Math.round(total * fps);
for (let f = 0; f < n; f++) {
  const b64 = await page.evaluate(t => { renderFrame(t); return document.getElementById('c').toDataURL('image/jpeg', .92).split(',')[1]; }, f / fps);
  if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  if (f % (fps * 20) === 0) console.log(`${(f / fps).toFixed(0)}s / ${total}s`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await browser.close();
console.log('done', out);

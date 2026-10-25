import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { getBrowser, shutdownBrowser } from '../server/renderer.js';
import { readRuntime, PUBLIC_DIR, DATA_DIR } from '../server/config.js';
import { composeDocument } from '../shared/compose.js';

const OUT_DIR = path.join(DATA_DIR, 'preset-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PRESETS = [
  ['last-train', 8],
  ['fold', 10],
  ['index-01', 9],
  ['halftone', 8],
  ['specimen-04', 10],
  ['quiet-sun', 12],
  ['manifesto', 8],
  ['signal', 10]
];

const FRACTIONS = [0.14, 0.38, 0.62, 0.9];
const runtime = readRuntime();
const browser = await getBrowser();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tile(inputs, output) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    for (const input of inputs) args.push('-i', input);
    args.push(
      '-filter_complex',
      '[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack[out]',
      '-map',
      '[out]',
      output
    );
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg ' + code))));
  });
}

async function waitReady(page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(
      () => !!(window.__MS_CLOCK__ && window.__MS_CLOCK__.ready === true)
    ).catch(() => false);
    if (ready) return;
    await sleep(60);
  }
  throw new Error('not ready');
}

const only = process.argv[2];

for (const [id, duration] of PRESETS) {
  if (only && id !== only) continue;
  const code = fs.readFileSync(path.join(PUBLIC_DIR, 'presets', `${id}.html`), 'utf8');
  const doc = composeDocument(code, runtime, { csp: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 0.5 });
  await page.setContent(doc, { waitUntil: 'load', timeout: 20000 });
  await waitReady(page);

  const files = [];
  for (let i = 0; i < FRACTIONS.length; i++) {
    const t = Math.round(duration * 1000 * FRACTIONS[i]);
    await page.evaluate((time) => window.__MS_CLOCK__.step(time), t);
    await sleep(30);
    const file = path.join(OUT_DIR, `${id}-${i}.png`);
    await page.screenshot({ path: file, type: 'png' });
    files.push(file);
  }

  const sheet = path.join(OUT_DIR, `${id}.png`);
  await tile(files, sheet);
  console.log(`${id}: ${errors.length ? 'errors: ' + errors.slice(0, 3).join(' | ') : 'ok'}`);
  await page.close();
}

await shutdownBrowser();
console.log('sheets in', OUT_DIR);

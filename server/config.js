import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const RENDERS_DIR = path.join(ROOT, 'renders');
export const DATA_DIR = path.join(ROOT, '.data');
export const RUNTIME_PATH = path.join(PUBLIC_DIR, 'runtime.js');
export const LIBRARY_PATH = path.join(DATA_DIR, 'library.json');

for (const dir of [PUBLIC_DIR, RENDERS_DIR, DATA_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

export function findChrome() {
  for (const candidate of chromeCandidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (e) {}
  }
  return null;
}

export const CHROME_PATH = findChrome();

export function readRuntime() {
  return fs.readFileSync(RUNTIME_PATH, 'utf8');
}

export function lanAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    const virtual = /vEthernet|vethernet|wsl|docker|vmware|virtualbox|hyper-v|loopback|bluetooth/i.test(name);
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const address = net.address || '';
      let score = virtual ? -40 : 0;
      if (/^192\.168\./.test(address)) score += 40;
      else if (/^10\./.test(address)) score += 30;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 12;
      else if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) score += 6;
      else if (/^169\.254\./.test(address)) score -= 60;
      else score += 4;
      if (/wi-?fi|wlan|ethernet|eth\d/i.test(lower)) score += 6;
      candidates.push({ address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length ? candidates[0].address : 'localhost';
}

export const ASPECTS = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 }
};

function even(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * The composition is always authored at the design size (1080-based).
 * Resolution changes only the number of raster pixels, never the layout.
 */
export function resolveSize(aspect, resolution = '1080') {
  const base = ASPECTS[aspect] || ASPECTS['9:16'];
  const factor = resolution === '720' ? 2 / 3 : resolution === '1440' ? 4 / 3 : 1;
  const width = even(base.width * factor);
  const height = even(base.height * factor);
  return {
    designWidth: base.width,
    designHeight: base.height,
    width,
    height,
    scale: width / base.width
  };
}


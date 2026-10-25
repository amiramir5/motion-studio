import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME_PATH, PUBLIC_DIR } from '../server/config.js';

const OUT = path.join(PUBLIC_DIR, 'icons');
fs.mkdirSync(OUT, { recursive: true });

const svg = fs.readFileSync(path.join(PUBLIC_DIR, 'icon.svg'), 'utf8');

if (!CHROME_PATH) {
  console.error('Chrome not found.');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
});

const page = await browser.newPage();

async function render(size, file, maskable = false) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const inner = maskable
    ? `<div style="width:100%;height:100%;display:grid;place-items:center;background:#141412">
         <div style="width:78%;height:78%">${svg}</div>
       </div>`
    : svg;
  await page.setContent(
    `<!doctype html><html><head><style>
      html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}
      svg{display:block;width:100%;height:100%}
    </style></head><body>${inner}</body></html>`,
    { waitUntil: 'load' }
  );
  await page.screenshot({
    path: path.join(OUT, file),
    omitBackground: !maskable,
    type: 'png'
  });
  console.log(`wrote icons/${file}`);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'maskable-512.png', true);

await browser.close();

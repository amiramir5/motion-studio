import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME_PATH, readRuntime } from '../server/config.js';
import { composeDocument } from '../shared/compose.js';

const SAMPLE = `<!DOCTYPE html><html><head><style>
html,body{margin:0;height:100%;background:#0e0e10;overflow:hidden}
.stage{position:relative;width:100%;height:100%}
.box{position:absolute;left:8%;top:16%;width:34%;aspect-ratio:1;background:#e4572e;animation:slide 2s cubic-bezier(.2,.8,.2,1) infinite alternate}
@keyframes slide{to{transform:translateX(140%) rotate(90deg)}}
.title{position:absolute;bottom:12%;left:8%;font-size:64px;color:#f4efe6;font-family:system-ui;opacity:0;animation:fade 700ms 400ms forwards}
@keyframes fade{to{opacity:1}}
.circle{position:absolute;left:0;top:0;width:46px;height:46px;border-radius:50%;background:#f4efe6}
</style></head><body><div class=stage><div class=box></div><div class=title>MOTION</div><div class=circle id=c></div></div>
<script>const c=document.getElementById('c');function loop(){const t=performance.now()/1000;c.style.transform='translate('+(60+Math.sin(t*2)*70+100)+'px,'+(420+Math.cos(t*2)*70)+'px)';requestAnimationFrame(loop)}requestAnimationFrame(loop)</script>
</body></html>`;

const doc = composeDocument(SAMPLE, readRuntime(), { csp: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getUserDataDir() {
  const dir = path.join(process.cwd(), '.data', 'bench-profile-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function setupPage(browser, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(doc, { waitUntil: 'load', timeout: 20000 });
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => !!(window.__MS_CLOCK__ && window.__MS_CLOCK__.ready));
    if (ready) break;
    await sleep(50);
  }
  const cdp = await page.createCDPSession();
  return { page, cdp };
}

async function bench(name, browser, opts) {
  const { width, height, format = 'jpeg', quality = 96, fromSurface = true, ff = false, frames = 30 } = opts;
  let page, cdp;
  try {
    ({ page, cdp } = await setupPage(browser, width, height));
    const shotOpts = { format, fromSurface, captureBeyondViewport: false };
    if (format === 'jpeg') shotOpts.quality = quality;
    // warm up
    for (let i = 0; i < 4; i++) {
      await page.evaluate((t) => window.__MS_CLOCK__.step(t), i * 16);
      await cdp.send('Page.captureScreenshot', shotOpts);
    }
    let bytes = 0;
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = (i * 1000) / 30;
      if (ff) {
        const p = page.evaluate((time) => window.__MS_CLOCK__.step(time), t);
        const shot = await cdp.send('Page.captureScreenshot', shotOpts);
        await p;
        bytes += shot.data.length;
      } else {
        await page.evaluate((time) => window.__MS_CLOCK__.step(time), t);
        const shot = await cdp.send('Page.captureScreenshot', shotOpts);
        bytes += shot.data.length;
      }
    }
    const ms = Date.now() - t0;
    console.log(
      `${name.padEnd(34)} ${String(Math.round((frames / ms) * 1000)).padStart(4)} fps  ` +
        `${(ms / frames).toFixed(1)} ms/frame  ${Math.round(bytes / frames / 1024)} KB/frame`
    );
  } catch (e) {
    console.log(`${name}: ERROR ${e.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

const variant = process.env.VARIANT || 'normal';
const args = [
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--hide-scrollbars',
  '--mute-audio',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage'
];
if (variant === 'gpu') {
  // let Chrome use the GPU
} else {
  args.push('--disable-gpu');
}
const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  userDataDir: await getUserDataDir(),
  protocolTimeout: 120000,
  args
});
console.log('Variant:', variant);
await bench('540x960 jpeg96 surface', browser, { width: 540, height: 960 });
await bench('540x960 jpeg96 view', browser, { width: 540, height: 960, fromSurface: false });
await bench('540x960 png surface', browser, { width: 540, height: 960, format: 'png' });
await bench('540x960 jpeg96 fireforget', browser, { width: 540, height: 960, ff: true });
await bench('1080x1920 jpeg96 surface', browser, { width: 1080, height: 1920, frames: 20 });
await bench('1080x1920 jpeg96 view', browser, { width: 1080, height: 1920, fromSurface: false, frames: 20 });
await bench('1080x1920 jpeg90 surface', browser, { width: 1080, height: 1920, quality: 90, frames: 20 });
await bench('1080x1920 png surface', browser, { width: 1080, height: 1920, format: 'png', frames: 20 });
await bench('1080x1920 jpeg96 fireforget', browser, { width: 1080, height: 1920, ff: true, frames: 20 });
await browser.close();

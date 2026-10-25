import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { CHROME_PATH, readRuntime } from '../server/config.js';
import { composeDocument } from '../shared/compose.js';

const SAMPLE = `<!DOCTYPE html><html><head><style>
html,body{margin:0;height:100%;background:#0e0e10;overflow:hidden}
.box{position:absolute;left:8%;top:16%;width:34%;aspect-ratio:1;background:#e4572e;animation:slide 2s cubic-bezier(.2,.8,.2,1) infinite alternate}
@keyframes slide{to{transform:translateX(140%) rotate(90deg)}}
.c{position:absolute;left:0;top:0;width:46px;height:46px;border-radius:50%;background:#f4efe6}
</style></head><body><div class=box></div><div class=c id=c></div>
<script>const c=document.getElementById('c');function loop(){const t=performance.now()/1000;c.style.transform='translate('+(60+Math.sin(t*2)*70+100)+'px,'+(420+Math.cos(t*2)*70)+'px)';requestAnimationFrame(loop)}requestAnimationFrame(loop)</script>
</body></html>`;

const doc = composeDocument(SAMPLE, readRuntime(), { csp: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const opts = { format: 'jpeg', quality: 96, fromSurface: true, captureBeyondViewport: false };

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  protocolTimeout: 120000,
  args: [
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--no-first-run',
    '--disable-dev-shm-usage'
  ]
});
console.log('browser launched');

async function pass(fireForget) {
  const page = await browser.newPage();
  await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 1 });
  await page.setContent(doc, { waitUntil: 'load', timeout: 20000 });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => !!(window.__MS_CLOCK__ && window.__MS_CLOCK__.ready))) break;
    await sleep(50);
  }
  const cdp = await page.createCDPSession();
  const out = [];
  for (let i = 0; i < 10; i++) {
    const t = i * 33.3333;
    if (fireForget) {
      const pending = page.evaluate((time) => window.__MS_CLOCK__.step(time), t);
      const shot = await cdp.send('Page.captureScreenshot', opts);
      await pending;
      out.push(hash(shot.data));
    } else {
      await page.evaluate((time) => window.__MS_CLOCK__.step(time), t);
      const shot = await cdp.send('Page.captureScreenshot', opts);
      out.push(hash(shot.data));
    }
  }
  await page.close();
  return out;
}

const normal = await pass(false);
console.log('normal done');
const ff = await pass(true);
console.log('ff done');
let mismatch = 0;
for (let i = 0; i < normal.length; i++) {
  const same = normal[i] === ff[i];
  if (!same) mismatch++;
  console.log(`frame ${i} same=${same} ${normal[i]} ${ff[i]}`);
}
console.log('mismatches:', mismatch);
await browser.close();

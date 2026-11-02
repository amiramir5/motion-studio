// Regression test: the exported film must run the user's scripts exactly once
// with a fresh clock, even after the duration probe fast-forwarded a first load.
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { renderFilm, shutdownBrowser } from '../server/renderer.js';

const SAMPLE = `<!DOCTYPE html><html><head><style>
html,body{margin:0;width:100%;height:100%;background:#000}
#bar{position:absolute;left:0;top:0;height:100%;width:0;background:#0f0}
</style></head><body><div id="bar"></div><script>
const body = document.body;
const bar = document.getElementById('bar');
setTimeout(() => { body.style.background = '#f00'; }, 1000);
function loop() {
  const t = performance.now();
  bar.style.width = Math.min(50, t / 40) + '%';
  if (t < 2000) requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
const stamp = new Date().getTime();
if (stamp !== Date.now()) throw new Error('new Date() is not on the virtual clock');
</script></body></html>`;

function pixel(file, seconds, x, y) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
      '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', reject);
    child.on('close', () => resolve([...Buffer.concat(chunks)]));
  });
}

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 40);
let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

try {
  const meta = await renderFilm({
    code: SAMPLE, id: `clock-test-${Date.now()}`, width: 200, height: 200,
    designWidth: 200, designHeight: 200, fps: 30, duration: 3, quality: 'draft'
  });
  const file = new URL(`../renders/${meta.id}.mp4`, import.meta.url).pathname;
  check(`no script errors (${JSON.stringify(meta.warnings)})`, meta.warnings.length === 0);
  check('background is black before the 1s timer', close(await pixel(file, 0.5, 190, 100), [0, 0, 0]));
  check('background is red after the 1s timer', close(await pixel(file, 1.6, 190, 100), [255, 0, 0]));
  check('requestAnimationFrame drives the bar at 0.5s', close(await pixel(file, 0.5, 5, 100), [0, 255, 0]));
  check('bar has not reached the right edge at 0.5s', close(await pixel(file, 0.5, 150, 100), [0, 0, 0]));
} finally {
  await shutdownBrowser();
}
process.exit(failed ? 1 : 0);

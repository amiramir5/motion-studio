import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { renderFilm, shutdownBrowser } from '../server/renderer.js';
import { RENDERS_DIR } from '../server/config.js';

const SAMPLE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: Inter; src: local("Segoe UI"), local("Helvetica"); }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0e0e10; color: #f4efe6; font-family: Inter, system-ui, sans-serif; overflow: hidden; }
  .stage { position: relative; width: 100%; height: 100%; overflow: hidden; }
  .box { position: absolute; left: 8%; top: 16%; width: 34%; aspect-ratio: 1; background: #e4572e; animation: slide 2s cubic-bezier(.2,.8,.2,1) infinite alternate; }
  @keyframes slide { to { transform: translateX(140%) rotate(90deg); } }
  .title { position: absolute; bottom: 12%; left: 8%; font-size: 64px; line-height: .92; letter-spacing: -.05em; font-weight: 700; opacity: 0; animation: fade 700ms 400ms forwards; }
  @keyframes fade { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
  .circle { position: absolute; left: 0; top: 0; width: 46px; height: 46px; border-radius: 50%; background: #f4efe6; }
  .stamp { position: absolute; top: 60%; left: 8%; font: 600 26px ui-monospace, monospace; color: #9ee7d8; letter-spacing: .08em; }
  .grid { position: absolute; inset: 0; background-image: linear-gradient(#ffffff12 1px, transparent 1px); background-size: 100% 48px; }
</style>
</head>
<body>
  <div class="stage">
    <div class="grid"></div>
    <div class="box"></div>
    <div class="title">MOTION<br>TEST</div>
    <div class="circle" id="circle"></div>
    <div class="stamp" id="stamp"></div>
  </div>
  <script>
    const circle = document.getElementById('circle');
    const stamp = document.getElementById('stamp');
    function loop() {
      const t = performance.now() / 1000;
      circle.style.transform = 'translate(' + (60 + Math.sin(t * 2) * 70 + 100) + 'px,' + (420 + Math.cos(t * 2) * 70) + 'px)';
      stamp.textContent = 'T+' + t.toFixed(2) + 's';
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    setTimeout(() => {
      const el = document.createElement('div');
      el.textContent = 'TIMER / 1.0s';
      el.style.cssText = 'position:absolute;top:70%;left:8%;font:600 20px ui-monospace,monospace;color:#f4efe6';
      document.querySelector('.stage').appendChild(el);
    }, 1000);
  </script>
</body>
</html>`;

function runCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.slice(-2000)));
    });
  });
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

const fps = 30;
const duration = 2;
const width = 540;
const height = 960;
const id = `engine-test-${Date.now()}`;

console.log(`Rendering ${width}x${height} @ ${fps}fps for ${duration}s ...`);
const started = Date.now();

const meta = await renderFilm({
  code: SAMPLE,
  id,
  width,
  height,
  fps,
  duration,
  quality: 'high',
  onProgress: (p) => {
    if (p.phase === 'rendering' && (p.frame % 15 === 0 || p.frame === p.total)) {
      console.log(
        `  frame ${p.frame}/${p.total}  ${Math.round(p.renderFps || 0)} fps  eta ${p.eta || 0}ms`
      );
    }
  }
});

console.log('Rendered in', Date.now() - started, 'ms');
console.log(meta);

const video = path.join(RENDERS_DIR, `${id}.mp4`);
const frameDir = path.join(RENDERS_DIR, `${id}-frames`);
fs.mkdirSync(frameDir, { recursive: true });

const times = [0, 0.5, 1.0, 1.5, 1.9];
for (let i = 0; i < times.length; i++) {
  await runCapture([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(times[i]),
    '-i',
    video,
    '-frames:v',
    '1',
    path.join(frameDir, `f${i}.png`)
  ]);
}

const hashes = times.map((_, i) => hash(path.join(frameDir, `f${i}.png`)));
console.log('Frame hashes:', hashes.join(' '));
console.log('Distinct frames:', new Set(hashes).size, 'of', hashes.length);

const probe = await new Promise((resolve) => {
  const child = spawn(ffmpegPath, ['-hide_banner', '-i', video], {
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let text = '';
  child.stderr.on('data', (chunk) => {
    text += chunk.toString();
  });
  child.on('close', () => resolve(text));
});
const durationMatch = probe.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
const durationSec = durationMatch
  ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
  : null;
const videoStream = probe.match(/Video: ([^\n]+)/)?.[1]?.trim();
console.log('Video stream:', videoStream);
console.log('Duration:', durationSec);

if (durationSec === null || Math.abs(durationSec - duration) > 0.15) {
  console.error('Duration check FAILED');
  process.exitCode = 1;
}
if (new Set(hashes).size !== hashes.length) {
  console.error('Animation check FAILED: some frames are identical');
  process.exitCode = 1;
}
if (!videoStream || !/60 fps|30 fps|59.94|29.97/.test(videoStream)) {
  console.error('FPS stream check FAILED');
  process.exitCode = 1;
}

console.log('Test video:', video);
console.log(meta.warnings.length ? `Warnings: ${meta.warnings.join(' | ')}` : 'No page warnings');
await shutdownBrowser();

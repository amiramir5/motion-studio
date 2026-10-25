import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { renderFilm, shutdownBrowser } from '../server/renderer.js';
import { RENDERS_DIR, resolveSize } from '../server/config.js';

const SAMPLE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#111;color:#f4efe6;font-family:system-ui,sans-serif;overflow:hidden}
.stage{position:relative;width:100%;height:100%}
.box{position:absolute;left:10%;top:14%;width:30%;aspect-ratio:1;background:#e4572e}
.title{position:absolute;left:10%;bottom:12%;font-size:72px;font-weight:800;line-height:.9;letter-spacing:-.04em}
.line{position:absolute;left:10%;top:54%;width:40%;height:3px;background:#9ee7d8}
</style></head><body><div class="stage">
<div class="box"></div><div class="title">LAYOUT<br>LOCK</div><div class="line"></div>
</div></body></html>`;

function ff(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.slice(-1200)))));
  });
}

async function frameAt(video, out) {
  await ff(['-y', '-i', video, '-frames:v', '1', '-vf', 'scale=540:960', out]);
}

const results = [];
for (const resolution of ['720', '1080', '1440']) {
  const size = resolveSize('9:16', resolution);
  const id = `resolution-${resolution}-${Date.now()}`;
  const meta = await renderFilm({
    code: SAMPLE,
    id,
    width: size.width,
    height: size.height,
    designWidth: size.designWidth,
    designHeight: size.designHeight,
    fps: 30,
    duration: 1,
    quality: 'high'
  });
  const grab = path.join(RENDERS_DIR, `${id}-grab.png`);
  const video = path.join(RENDERS_DIR, `${id}.mp4`);
  await frameAt(video, grab);
  results.push({ resolution, ...meta, grab });
  console.log(`${resolution}: ${size.width}x${size.height} frames=${meta.frames} -> ${path.basename(video)}`);
}

for (let i = 1; i < results.length; i += 1) {
  const a = results[0].grab;
  const b = results[i].grab;
  const out = await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', () => {
      const m = err.match(/All:([0-9.]+)/);
      resolve(m ? Number(m[1]) : NaN);
    });
  });
  console.log(`SSIM 720 vs ${results[i].resolution}: ${out}`);
}

for (const r of results) fs.rmSync(r.grab, { force: true });
await shutdownBrowser();

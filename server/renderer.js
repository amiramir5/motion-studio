import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import ffmpegPath from 'ffmpeg-static';
import { CHROME_PATH, RENDERS_DIR, readRuntime } from './config.js';
import { composeDocument } from '../shared/compose.js';

const QUALITY = {
  draft: { format: 'jpeg', jpegQuality: 90, crf: 21, preset: 'veryfast' },
  high: { format: 'jpeg', jpegQuality: 96, crf: 17, preset: 'medium' },
  max: { format: 'png', jpegQuality: 100, crf: 14, preset: 'slow' }
};

let browserPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPrivateHost(hostname) {
  if (!hostname) return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    host.endsWith('.arpa')
  ) {
    return true;
  }
  if (host === '0.0.0.0' || host === '::1' || host === '::') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^fc|^fd|^fe80/.test(host)) return true;
  return false;
}

function shouldBlockRequest(rawUrl) {
  if (/^(data:|blob:|about:)/i.test(rawUrl)) return false;
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  if (isPrivateHost(url.hostname)) return true;
  if (url.port && url.port !== '80' && url.port !== '443') return true;
  return false;
}

export async function getBrowser() {
  if (!browserPromise) {
    if (!CHROME_PATH) throw new Error('Chrome/Edge not found. Set CHROME_PATH in .env.');
    browserPromise = puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      protocolTimeout: 180000,
      args: [
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--disable-lcd-text',
        '--hide-scrollbars',
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-extensions',
        '--disable-features=Translate,BackForwardCache,MediaRouter',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
      ]
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

export async function shutdownBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (e) {}
  browserPromise = null;
}

export function ffmpegVersion() {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(null);
    const child = spawn(ffmpegPath, ['-version']);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const match = output.match(/ffmpeg version (\S+)/i);
      resolve(match ? match[1] : 'installed');
    });
  });
}

function spawnEncoder({ outPath, fps, format, crf, preset }) {
  return new Promise((resolve, reject) => {
    const inputCodec = format === 'png' ? 'png' : 'mjpeg';
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-vcodec',
      inputCodec,
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-tune',
      'animation',
      '-crf',
      String(crf),
      '-vf',
      'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-fps_mode',
      'cfr',
      '-g',
      String(fps * 2),
      '-movflags',
      '+faststart',
      outPath
    ];
    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.once('spawn', () => resolve(child));
    child.on('error', reject);
    child.stderr.on('error', () => {});
  });
}

function runFfmpeg(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (e) {}
      resolve(false);
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function makePoster(videoPath, posterPath, duration) {
  const at = Math.min(1.2, Math.max(0.15, duration * 0.28));
  return runFfmpeg([
    '-ss',
    String(at),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=720:-2',
    '-q:v',
    '3',
    posterPath
  ]);
}

/**
 * Render a single HTML motion piece to MP4.
 * @param {object} options
 * @param {string} options.code
 * @param {string} options.id
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.fps
 * @param {number} options.duration seconds
 * @param {'draft'|'high'|'max'} [options.quality]
 * @param {(p:object)=>void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 */
export async function renderFilm(options) {
  const {
    code,
    id,
    width,
    height,
    designWidth,
    designHeight,
    fps = 60,
    duration = 10,
    quality = 'high',
    onProgress = () => {},
    signal
  } = options;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    throw new Error('Invalid output size');
  }
  const cssWidth = Number(designWidth) || width;
  const cssHeight = Number(designHeight) || height;
  const deviceScaleFactor = Math.min(3, Math.max(0.25, width / cssWidth));
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw new Error('Invalid fps');
  if (!Number.isFinite(duration) || duration < 0.2 || duration > 120) {
    throw new Error('Invalid duration');
  }

  const settings = QUALITY[quality] || QUALITY.high;
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const outPath = path.join(RENDERS_DIR, `${id}.mp4`);
  const tmpPath = path.join(RENDERS_DIR, `${id}.partial.mp4`);
  const posterPath = path.join(RENDERS_DIR, `${id}.jpg`);
  const started = Date.now();
  const warnings = [];
  let page = null;
  let ffmpeg = null;
  let ffmpegClosed = false;
  let ffmpegExitCode = null;
  let abortHandler = null;

  const runtime = readRuntime();
  const documentHtml = composeDocument(code, runtime, { csp: true });

  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: cssWidth, height: cssHeight, deviceScaleFactor });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      try {
        if (shouldBlockRequest(request.url())) request.abort();
        else request.continue();
      } catch (e) {}
    });
    page.on('dialog', (dialog) => {
      dialog.dismiss().catch(() => {});
    });
    page.on('pageerror', (error) => {
      if (warnings.length < 8) warnings.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && warnings.length < 8) {
        warnings.push(message.text());
      }
    });

    onProgress({ phase: 'loading', frame: 0, total: totalFrames, elapsed: 0 });

    await page
      .setContent(documentHtml, { waitUntil: 'load', timeout: 20000 })
      .catch((error) => {
        warnings.push(`Load timeout: ${error.message}`);
      });

    const readyDeadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      try {
        ready = await page.evaluate(
          () => !!(window.__MS_CLOCK__ && window.__MS_CLOCK__.ready === true)
        );
      } catch (e) {}
      if (ready) break;
      if (signal?.aborted) throw new Error('Cancelled');
      await sleep(60);
    }
    if (!ready) warnings.push('Page did not finish loading in time; rendered anyway.');

    ffmpeg = await spawnEncoder({
      outPath: tmpPath,
      fps,
      format: settings.format,
      crf: settings.crf,
      preset: settings.preset
    });
    ffmpeg.on('close', (code) => {
      ffmpegClosed = true;
      ffmpegExitCode = code;
    });

    const screenshotOptions = {
      type: settings.format,
      fromSurface: true,
      captureBeyondViewport: false
    };
    if (settings.format === 'jpeg') {
      screenshotOptions.quality = settings.jpegQuality;
    } else {
      screenshotOptions.optimizeForSpeed = true;
    }

    const writeFrame = async (buffer) => {
      if (ffmpegClosed) throw new Error('Encoder closed unexpectedly');
      const ok = ffmpeg.stdin.write(buffer);
      if (!ok) {
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            ffmpeg.stdin.off('drain', onDrain);
            ffmpeg.off('close', onClose);
          };
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const onClose = () => {
            cleanup();
            reject(new Error('Encoder closed unexpectedly'));
          };
          ffmpeg.stdin.once('drain', onDrain);
          ffmpeg.once('close', onClose);
        });
      }
    };

    if (signal) {
      abortHandler = () => {
        try {
          ffmpeg?.kill('SIGKILL');
        } catch (e) {}
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    onProgress({ phase: 'rendering', frame: 0, total: totalFrames, elapsed: 0 });

    const renderStarted = Date.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      if (signal?.aborted) throw new Error('Cancelled');
      const t = (frame * 1000) / fps;
      const pendingStep = page.evaluate((time) => window.__MS_CLOCK__.step(time), t);
      const shot = await page.screenshot(screenshotOptions);
      await pendingStep;
      await writeFrame(shot);

      const elapsed = Date.now() - started;
      const renderElapsed = Date.now() - renderStarted;
      const done = frame + 1;
      if (done === totalFrames || done % Math.max(1, Math.round(fps / 6)) === 0) {
        onProgress({
          phase: 'rendering',
          frame: done,
          total: totalFrames,
          elapsed,
          renderElapsed,
          renderFps: done / Math.max(0.001, renderElapsed / 1000),
          eta: Math.max(0, Math.round(((totalFrames - done) * renderElapsed) / done))
        });
      }
    }

    ffmpeg.stdin.end();
    await new Promise((resolve, reject) => {
      if (ffmpegClosed) {
        if (ffmpegExitCode === 0) resolve();
        else reject(new Error(`ffmpeg exited with ${ffmpegExitCode}`));
        return;
      }
      ffmpeg.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with ${code}`));
      });
      ffmpeg.once('error', reject);
    });

    fs.renameSync(tmpPath, outPath);

    const stats = fs.statSync(outPath);
    const meta = {
      id,
      width,
      height,
      fps,
      duration: totalFrames / fps,
      frames: totalFrames,
      bytes: stats.size,
      quality,
      elapsedMs: Date.now() - started,
      warnings
    };

    onProgress({
      phase: 'poster',
      frame: totalFrames,
      total: totalFrames,
      elapsed: meta.elapsedMs
    });

    const posterOk = await makePoster(outPath, posterPath, meta.duration);
    meta.poster = posterOk && fs.existsSync(posterPath);

    return meta;
  } catch (error) {
    try {
      ffmpeg?.kill('SIGKILL');
    } catch (e) {}
    for (const file of [tmpPath, outPath, posterPath]) {
      try {
        if (fs.existsSync(file) && file !== outPath) fs.unlinkSync(file);
      } catch (e) {}
      if (file === outPath) {
        try {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (e) {}
      }
    }
    throw error;
  } finally {
    if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
    if (page) {
      try {
        await page.close();
      } catch (e) {}
    }
  }
}

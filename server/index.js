import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import {
  CHROME_PATH,
  RENDERS_DIR,
  PUBLIC_DIR,
  ROOT,
  lanAddress,
  resolveSize
} from './config.js';
import { renderFilm, ffmpegVersion, shutdownBrowser } from './renderer.js';
import { listLibrary, addToLibrary, deleteFromLibrary, getLibraryItem } from './library.js';
import {
  DIRECTIONS,
  aiConfigured,
  directionsForClient,
  getHealth,
  listModels,
  resolveModel,
  streamGeneration,
  testConnection
} from './ai.js';

const app = express();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');
app.use(express.json({ limit: '14mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    }
  })
);
app.use('/media', express.static(RENDERS_DIR, { maxAge: '1h', immutable: false }));

function sseStart(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function sseSend(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get('/api/health', async (req, res) => {
  let ffmpeg = null;
  try {
    ffmpeg = await ffmpegVersion();
  } catch (e) {}
  res.json({
    ok: Boolean(CHROME_PATH) && Boolean(ffmpeg),
    chrome: CHROME_PATH ? path.basename(CHROME_PATH) : null,
    ffmpeg,
    ai: { configured: aiConfigured() },
    node: process.version
  });
});

app.get('/api/ai/health', async (req, res) => {
  res.json(await getHealth());
});

app.get('/api/ai/models', async (req, res) => {
  try {
    const models = await listModels();
    res.json({ ok: true, models, defaultModel: await resolveModel('') });
  } catch (error) {
    res.status(200).json({
      ok: false,
      models: [],
      error: error.message,
      code: error.code || 'AI_ERROR',
      retryable: Boolean(error.retryable),
      configured: aiConfigured()
    });
  }
});

app.get('/api/ai/directions', (req, res) => {
  res.json({ directions: directionsForClient() });
});

app.post('/api/ai/test', async (req, res) => {
  try {
    const result = await testConnection(req.body?.model);
    res.json(result);
  } catch (error) {
    res.status(200).json({
      ok: false,
      configured: aiConfigured(),
      error: error.message,
      code: error.code || 'AI_ERROR',
      retryable: Boolean(error.retryable)
    });
  }
});

app.post('/api/ai/stream', async (req, res) => {
  sseStart(res);
  const controller = new AbortController();
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);
  const close = () => controller.abort();
  res.on('close', close);

  try {
    await streamGeneration(
      { ...req.body, signal: controller.signal },
      {
        onMeta: (meta) => sseSend(res, 'meta', meta),
        onPhase: (phase) => sseSend(res, 'phase', phase),
        onDelta: (text) => sseSend(res, 'delta', { text }),
        onReset: (info) => sseSend(res, 'reset', info),
        onWarning: (message) => sseSend(res, 'warning', { message }),
        onViolations: (info) => sseSend(res, 'violations', info),
        onDone: (done) => {
          sseSend(res, 'done', done);
          res.end();
        }
      }
    );
  } catch (error) {
    sseSend(res, 'error', {
      message: error.message || 'AI request failed',
      code: error.code || 'AI_ERROR',
      retryable: Boolean(error.retryable)
    });
    res.end();
  } finally {
    clearInterval(ping);
    res.off('close', close);
  }
});

class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }
  acquire() {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active = Math.max(0, this.active - 1);
  }
  get waiting() {
    return this.queue.length;
  }
}

const renderSlots = new Semaphore(2);

app.post('/api/render', async (req, res) => {
  sseStart(res);
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const controller = new AbortController();
  const close = () => controller.abort();
  res.on('close', close);
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 10000);

  let acquired = false;
  try {
    const body = req.body || {};
    const code = String(body.code || '');
    if (!code.trim()) throw new Error('No code to render.');
    if (code.length > 1.6 * 1024 * 1024) throw new Error('Document is too large (max 1.6MB).');

    const aspect = ['9:16', '16:9', '1:1', '4:5'].includes(body.aspect) ? body.aspect : '9:16';
    const fps = [30, 60].includes(Number(body.fps)) ? Number(body.fps) : 60;
    const duration = Math.min(30, Math.max(1, Number(body.duration) || 10));
    const quality = ['draft', 'high', 'max'].includes(body.quality) ? body.quality : 'high';
    const resolution = ['720', '1080', '1440'].includes(String(body.resolution))
      ? String(body.resolution)
      : '1080';
    const size = resolveSize(aspect, resolution);
    const title = String(body.title || 'Custom Motion').slice(0, 80) || 'Custom Motion';

    sseSend(res, 'job', {
      id,
      width: size.width,
      height: size.height,
      designWidth: size.designWidth,
      designHeight: size.designHeight,
      fps,
      duration,
      quality,
      resolution,
      queued: renderSlots.active >= renderSlots.limit
    });

    if (renderSlots.active >= renderSlots.limit) {
      sseSend(res, 'queued', { position: renderSlots.waiting + 1 });
    }
    await renderSlots.acquire();
    acquired = true;
    if (controller.signal.aborted) throw new Error('Cancelled');

    const meta = await renderFilm({
      code,
      id,
      width: size.width,
      height: size.height,
      designWidth: size.designWidth,
      designHeight: size.designHeight,
      fps,
      duration,
      quality,
      signal: controller.signal,
      onProgress: (progress) => sseSend(res, 'progress', progress)
    });

    if (controller.signal.aborted) throw new Error('Cancelled');

    const sourceName = `${id}.html`;
    fs.writeFileSync(path.join(RENDERS_DIR, sourceName), code, 'utf8');

    const item = {
      id,
      title,
      file: `${id}.mp4`,
      poster: meta.poster ? `${id}.jpg` : null,
      source: sourceName,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      duration: meta.duration,
      bytes: meta.bytes,
      quality: meta.quality,
      aspect,
      createdAt: Date.now(),
      warnings: meta.warnings || []
    };
    addToLibrary(item);
    sseSend(res, 'done', {
      ...item,
      elapsedMs: meta.elapsedMs,
      url: `/media/${item.file}`,
      posterUrl: item.poster ? `/media/${item.poster}` : null,
      sourceUrl: `/media/${item.source}`
    });
    res.end();
  } catch (error) {
    const cancelled = controller.signal.aborted || /cancel/i.test(error.message || '');
    sseSend(res, 'error', {
      message: cancelled ? 'Render cancelled.' : error.message || 'Render failed',
      cancelled,
      id
    });
    res.end();
  } finally {
    clearInterval(ping);
    res.off('close', close);
    if (acquired) renderSlots.release();
  }
});

app.get('/api/library', (req, res) => {
  res.json({ items: listLibrary() });
});

app.get('/api/library/:id/source', (req, res) => {
  const item = getLibraryItem(req.params.id);
  if (!item || !item.source) return res.status(404).json({ error: 'Not found' });
  const sourcePath = path.join(RENDERS_DIR, item.source);
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Not found' });
  res.type('text/html').send(fs.readFileSync(sourcePath, 'utf8'));
});

app.delete('/api/library/:id', (req, res) => {
  const removed = deleteFromLibrary(req.params.id);
  res.json({ ok: removed });
});

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = app.listen(PORT, HOST, async () => {
  const local = `http://localhost:${PORT}`;
  const lan = `http://${lanAddress()}:${PORT}`;
  const ffmpeg = await ffmpegVersion();
  console.log('');
  console.log('  MOTION / STUDIO');
  console.log(`  local   ${local}`);
  console.log(`  mobile  ${lan}`);
  console.log('');
  console.log(`  chrome  ${CHROME_PATH || 'NOT FOUND'}`);
  console.log(`  ffmpeg  ${ffmpeg || 'NOT FOUND'}`);
  console.log(`  gemini  ${aiConfigured() ? 'key configured' : 'no key — add GEMINI_API_KEY to .env'}`);
  console.log(`  root    ${ROOT}`);
  console.log('');
  if (aiConfigured()) {
    getHealth().then((health) => {
      if (health.ok) {
        console.log(
          `  ai      ready in ${health.latencyMs}ms · ${health.modelCount} models · default ${health.defaultModel}`
        );
      } else {
        console.log(`  ai      NOT READY: ${health.error}`);
      }
    });
  }
});

process.on('SIGINT', async () => {
  console.log('\nShutting down…');
  server.close();
  await shutdownBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  server.close();
  await shutdownBrowser();
  process.exit(0);
});

export { app, server, DIRECTIONS };

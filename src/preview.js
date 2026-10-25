import { composeDocument } from '../shared/compose.js';
import { clamp } from './util.js';

export const DESIGNS = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 }
};

export class Preview {
  constructor(options) {
    this.iframe = options.iframe;
    this.film = options.film;
    this.stage = options.stage;
    this.onStatus = options.onStatus || (() => {});
    this.onTime = options.onTime || (() => {});
    this.onEnd = options.onEnd || (() => {});
    this.onMetrics = options.onMetrics || (() => {});
    this.onError = options.onError || (() => {});

    this.designWidth = 1080;
    this.designHeight = 1920;
    this.durationMs = 10000;
    this.code = '';
    this.runtimeSource = '';
    this.ready = false;
    this.playing = false;
    this.t = 0;
    this.seq = 0;
    this.errors = [];
    this.metrics = null;
    this.raf = 0;
    this.startedAt = 0;
    this.metricsAt = 0;
    this.readyWait = null;

    this.tick = this.tick.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.layout = this.layout.bind(this);

    window.addEventListener('message', this.handleMessage);
    this.resizeObserver = new ResizeObserver(this.layout);
    this.resizeObserver.observe(this.stage);
    this.layout();
  }

  async init() {
    if (this.runtimeSource) return;
    const response = await fetch('/runtime.js', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Could not load the clock runtime.');
    this.runtimeSource = await response.text();
  }

  setDesign(width, height) {
    this.designWidth = width;
    this.designHeight = height;
    this.iframe.width = String(width);
    this.iframe.height = String(height);
    this.iframe.style.width = `${width}px`;
    this.iframe.style.height = `${height}px`;
    this.layout();
  }

  setDuration(seconds) {
    this.durationMs = Math.max(1000, seconds * 1000);
    if (this.t > this.durationMs) {
      this.t = this.durationMs;
      this.postStep(this.durationMs);
      this.onTime(this.t);
    }
  }

  layout() {
    const rect = this.stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(rect.width / this.designWidth, rect.height / this.designHeight);
    const safe = Math.max(0.01, scale * 0.985);
    const w = this.designWidth * safe;
    const h = this.designHeight * safe;
    this.film.style.width = `${w}px`;
    this.film.style.height = `${h}px`;
    this.iframe.style.transform = `scale(${safe})`;
  }

  handleMessage(event) {
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ms:ready') {
      this.errors = Array.isArray(data.errors) ? data.errors.slice() : [];
      this.metrics = data.metrics || null;
      if (this.readyWait) {
        const wait = this.readyWait;
        this.readyWait = null;
        clearTimeout(wait.timer);
        wait.resolve(true);
      }
      return;
    }
    if (data.type === 'ms:error') {
      this.errors.push({ message: data.message || 'Script error' });
      if (this.errors.length > 6) this.errors.shift();
      this.onError(data.message || 'Script error');
      return;
    }
    if (data.type === 'ms:metrics') {
      this.metrics = data.metrics || null;
      this.onMetrics(this.metrics, this.errors);
    }
  }

  waitForReady(timeout = 22000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWait = null;
        reject(new Error('The stage did not settle in time.'));
      }, timeout);
      this.readyWait = { resolve, timer };
    });
  }

  async loadDocument({ quiet = false, resume = false } = {}) {
    if (!this.code.trim()) {
      this.ready = false;
      this.stopLoop();
      this.iframe.srcdoc = '';
      this.onStatus('empty');
      return false;
    }
    if (!this.runtimeSource) await this.init();
    const wasPlaying = this.playing;
    const resumeAt = resume ? this.t : 0;
    const seq = ++this.seq;
    this.ready = false;
    this.stopLoop();
    this.playing = false;
    this.t = 0;
    this.errors = [];
    if (!quiet) this.onStatus('loading');
    else this.onStatus('syncing');

    const doc = composeDocument(this.code, this.runtimeSource, { csp: true });
    const wait = this.waitForReady();
    this.iframe.srcdoc = doc;

    try {
      await wait;
    } catch (error) {
      if (seq === this.seq) {
        this.onStatus('error');
        this.onError(error.message);
      }
      return false;
    }
    if (seq !== this.seq) return false;
    this.ready = true;
    this.t = clamp(resumeAt, 0, this.durationMs);
    this.postStep(this.t);
    this.requestMetrics();
    this.onTime(this.t);
    if (resume && wasPlaying) this.play();
    this.onStatus('ready');
    return true;
  }

  async setCode(code, { quiet = false, resume = false } = {}) {
    this.code = String(code || '');
    return this.loadDocument({ quiet, resume });
  }

  async reloadAt(ms, { quiet = true } = {}) {
    const target = clamp(Number(ms) || 0, 0, this.durationMs);
    await this.loadDocument({ quiet });
    if (!this.ready) return;
    this.t = target;
    this.postStep(target);
    this.requestMetrics();
    this.onTime(target);
  }

  postStep(t) {
    if (!this.ready) return;
    try {
      this.iframe.contentWindow.postMessage({ type: 'ms:step', t }, '*');
    } catch (e) {}
  }

  requestMetrics() {
    if (!this.ready) return;
    try {
      this.iframe.contentWindow.postMessage({ type: 'ms:metrics' }, '*');
    } catch (e) {}
  }

  tick() {
    if (!this.playing) return;
    const wall = performance.now();
    let t = wall - this.startedAt;
    if (t >= this.durationMs) {
      this.t = this.durationMs;
      this.postStep(this.durationMs);
      this.playing = false;
      this.onTime(this.t);
      this.requestMetrics();
      this.onEnd();
      return;
    }
    this.t = t;
    this.postStep(t);
    this.onTime(t);
    if (wall - this.metricsAt > 700) {
      this.metricsAt = wall;
      this.requestMetrics();
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  play() {
    if (!this.ready || !this.code.trim()) return;
    if (this.t >= this.durationMs - 30) {
      this.restart().then(() => this.play());
      return;
    }
    this.stopLoop();
    this.playing = true;
    this.startedAt = performance.now() - this.t;
    this.metricsAt = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    this.stopLoop();
    this.requestMetrics();
  }

  stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  async restart() {
    await this.reloadAt(0, { quiet: true });
  }

  async seek(ms, { hard = false } = {}) {
    this.pause();
    if (!this.ready) return;
    const target = clamp(Number(ms) || 0, 0, this.durationMs);
    const backward = target < this.t - 120;
    if (hard && backward) {
      await this.reloadAt(target, { quiet: true });
      return;
    }
    this.t = target;
    this.postStep(target);
    this.onTime(target);
    this.requestMetrics();
  }

  shiftTime(ms) {
    this.pause();
    if (!this.ready) return;
    const target = clamp(this.t + ms, 0, this.durationMs);
    this.t = target;
    this.postStep(target);
    this.onTime(target);
  }

  destroy() {
    window.removeEventListener('message', this.handleMessage);
    this.resizeObserver.disconnect();
    this.stopLoop();
  }
}

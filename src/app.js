import { icon, hydrateIcons } from './icons.js';
import { DESIGNS, Preview } from './preview.js';
import { createEditor } from './editor.js';
import { PRESETS, loadPreset, presetArtHtml } from './presets.js';
import { aiHealth, aiModels, aiDirections, aiTest, generate } from './ai-client.js';
import { renderFilm } from './render-client.js';
import {
  escapeHtml,
  clamp,
  formatTime,
  formatBytes,
  formatDate,
  debounce,
  slugWords,
  downloadFile,
  copyText,
  safeParse
} from './util.js';

const STORE_KEY = 'ms.studio.v1';
const DEFAULT_TITLE = 'Untitled Motion';
const QUALITY_LABEL = { draft: 'Draft', high: 'High', max: 'Max' };
const RES_LABEL = { 720: '720p', 1080: '1080p', 1440: '1440p' };
const PHASE_LABEL = {
  testing: 'Testing your key',
  reconnecting: 'Reconnecting',
  connecting: 'Connecting',
  writing: 'Writing the scene',
  refining: 'Sharpening the art direction',
  ready: 'Scene ready'
};

const IDEAS = [
  'A typographic countdown to the last train home — numbers, rules, one moving line.',
  'A field guide to silence: three words arriving slowly, broken once by a hard geometric event.',
  'A museum label for an imaginary object called “The Everyday Sun”.',
  'The rules of a game that does not exist, numbered and typeset like a manifesto.',
  'A study of one square: it divides, rotates, becomes a window, a page, a horizon.',
  'A love letter told in timestamps and coordinates.',
  'An index of small weather — wind, rain, heat, fog — each with its own type treatment.',
  'The life of a paper plane in six cuts: fold, throw, glide, stall, land, unfold.'
];

const SNIPPETS = [
  {
    label: 'Keyframes',
    text: `\n<style>\n  @keyframes reveal {\n    from { transform: translateY(110%); }\n    to   { transform: translateY(0); }\n  }\n  .line { overflow: hidden; display: block; }\n  .line > span {\n    display: block;\n    animation: reveal 900ms cubic-bezier(.2,.8,.2,1) both;\n  }\n</style>\n`
  },
  {
    label: 'Stagger',
    text: `\n<script>\n  document.querySelectorAll('[data-line]').forEach(function (el, i) {\n    el.style.animationDelay = (300 + i * 120) + 'ms';\n  });\n</script>\n`
  },
  {
    label: 'SVG draw',
    text: `\n<svg viewBox="0 0 100 100" style="position:absolute;inset:0;width:100%;height:100%">\n  <path d="M10 80 L50 20 L90 80" fill="none" stroke="#E23D28" stroke-width=".6"\n        stroke-dasharray="200" stroke-dashoffset="200">\n    <animate attributeName="stroke-dashoffset" from="200" to="0"\n             dur="2s" begin=".4s" fill="freeze" />\n  </path>\n</svg>\n`
  },
  {
    label: 'Type scale',
    text: `\n<div style="position:absolute;left:6%;right:6%;top:30%">\n  <div style="font-size:15vh;line-height:.86;letter-spacing:-.055em;font-weight:800">\n    SCALE<br>IS A<br>RHYTHM\n  </div>\n</div>\n`
  },
  {
    label: 'Time loop',
    text: `\n<script>\n  var el = document.querySelector('.move');\n  function frame() {\n    var t = performance.now() / 1000;\n    el.style.transform = 'translateY(' + (Math.sin(t * 1.4) * 40) + 'px)';\n    requestAnimationFrame(frame);\n  }\n  requestAnimationFrame(frame);\n</script>\n`
  }
];

function loadState() {
  let saved = {};
  try {
    saved = safeParse(localStorage.getItem(STORE_KEY) || '{}', {}) || {};
  } catch (e) {
    saved = {};
  }
  const aspect = DESIGNS[saved.aspect] ? saved.aspect : '9:16';
  return {
    title:
      typeof saved.title === 'string' && saved.title.trim()
        ? saved.title.trim().slice(0, 60)
        : DEFAULT_TITLE,
    code: typeof saved.code === 'string' ? saved.code : '',
    aspect,
    resolution: ['720', '1080', '1440'].includes(String(saved.resolution))
      ? String(saved.resolution)
      : '1080',
    fps: [30, 60].includes(Number(saved.fps)) ? Number(saved.fps) : 60,
    duration: clamp(Number(saved.duration) || 10, 2, 30),
    quality: ['draft', 'high', 'max'].includes(saved.quality) ? saved.quality : 'high',
    guides: Boolean(saved.guides),
    strict: saved.strict !== false,
    direction: typeof saved.direction === 'string' ? saved.direction : 'editorial',
    model: typeof saved.model === 'string' ? saved.model : '',
    mode: ['generate', 'edit', 'extract'].includes(saved.mode) ? saved.mode : 'generate'
  };
}

const state = loadState();
state.tab = 'create';

const saveSoon = debounce(() => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, tab: undefined }));
  } catch (e) {}
}, 500);

const els = {};
let preview = null;
let editor = null;
let activeSheet = null;
let generating = false;
let genController = null;
let genStartedAt = 0;
let genTimer = null;
let genPhase = '';
let streamBuffer = '';
let streamFlush = null;
let codeBeforeGeneration = '';
let previewDirty = false;
let pendingAutoplay = false;
let overview = { configured: false, ok: false, checking: true };
let directions = [];
let models = [];
let modelsLoaded = false;
let health = null;
let healthAt = 0;
let library = [];
let rendering = false;
let renderController = null;
let renderToken = 0;
let currentVideo = null;
let installEvent = null;
let confirmAction = null;
let scrubStart = 0;
let scrubTarget = 0;

const schedulePreview = debounce(() => {
  if (generating) {
    previewDirty = true;
    return;
  }
  refreshPreview();
}, 650);

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function iconHtml(name, size = 16) {
  return icon(name, size);
}

/* ---------------------------------------------------------------- templates */

function aspectButtonsHtml() {
  return Object.keys(DESIGNS)
    .map((key) => `<button class="aspect-btn" data-aspect="${key}" aria-pressed="false">${key}</button>`)
    .join('');
}

function createViewHtml() {
  return `
  <section class="view" data-view="create">
    <div class="project-head">
      <div class="project-title-row">
        <h1 class="project-title" id="c-title">${DEFAULT_TITLE}</h1>
        <button class="name-edit" id="c-rename" aria-label="Rename project">${iconHtml('pencil', 14)}</button>
      </div>
      <button class="format-meta" id="c-format" title="Stage settings">
        ${iconHtml('film', 12)}
        <b id="fmt-aspect">9:16</b>
        <span>·</span>
        <span id="fmt-size">1080 × 1920</span>
        <span>·</span>
        <b id="fmt-fps">60 fps</b>
        <span>·</span>
        <span id="fmt-duration">10s</span>
        ${iconHtml('chevronDown', 11)}
      </button>
    </div>

    <div class="aspects" id="aspects" role="group" aria-label="Aspect ratio">
      ${aspectButtonsHtml()}
    </div>

    <div class="stage-card">
      <div class="stage" id="stage">
        <div class="film" id="film">
          <iframe id="preview-frame" sandbox="allow-scripts" title="Motion preview" tabindex="-1"></iframe>
          <div class="film-empty" id="film-empty">
            <div class="empty-inner">
              <div class="empty-glyph">${iconHtml('spark', 22)}</div>
              <div class="empty-title">A stage with nothing on it</div>
              <div class="empty-body">Describe a scene and the studio writes a deterministic film — or start from one of eight originals.</div>
              <div class="empty-actions">
                <button class="btn primary small" id="empty-ai">${iconHtml('spark', 14)} Write with AI</button>
                <button class="btn secondary small" id="empty-presets">${iconHtml('grid', 14)} Presets</button>
              </div>
            </div>
          </div>
          <div class="stage-loader hidden" id="stage-loader">
            <div class="loader-line"></div>
            <span>Settling frame</span>
          </div>
          <div class="stage-overlay hidden" id="stage-overlay">
            <button class="play-orb" id="play-orb" aria-label="Play film">${iconHtml('play', 20)}</button>
          </div>
          <div class="guides" id="guides"></div>
          <div class="overflow-chip hidden" id="overflow-chip">
            <span>${iconHtml('warning', 12)}</span>
            <span id="overflow-text">Content leaves the frame</span>
            <button id="overflow-fix">Fix</button>
          </div>
        </div>
      </div>
      <div class="stage-note hidden" id="stage-note">
        ${iconHtml('warning', 12)}
        <span id="stage-note-text"></span>
      </div>
    </div>

    <div class="player hidden" id="player">
      <button class="player-btn" id="play-btn" aria-label="Play film">${iconHtml('play', 15)}</button>
      <span class="time"><span id="time-now">0.00</span><span class="total" id="time-total"> / 10.00</span></span>
      <div class="scrub" id="scrub" role="slider" aria-label="Timeline" aria-valuemin="0" aria-valuemax="10" aria-valuenow="0" tabindex="0">
        <div class="scrub-track"><div class="scrub-fill" id="scrub-fill"></div></div>
        <div class="scrub-knob" id="scrub-knob"></div>
      </div>
    </div>

    <div class="action-row">
      <button class="btn secondary" id="btn-ai">${iconHtml('spark', 15)} Write with AI</button>
      <button class="btn primary" id="btn-export" disabled>${iconHtml('export', 15)} Export MP4</button>
    </div>

    <div class="meta-strip" id="meta-strip"></div>
  </section>`;
}

function codeViewHtml() {
  return `
  <section class="view" data-view="code" hidden>
    <div class="page-head">
      <div>
        <h2>Motion <span class="serif">code</span></h2>
        <div class="page-sub">One document. No build step. The clock is injected.</div>
      </div>
      <span class="count-chip" id="code-count">0 lines</span>
    </div>

    <div class="tools">
      <button class="tool ai" id="btn-code-ai">${iconHtml('spark', 14)} Ask AI</button>
      <button class="tool" id="btn-code-presets">${iconHtml('grid', 14)} Presets</button>
      <button class="tool" id="btn-code-copy">${iconHtml('copy', 14)} Copy</button>
      <button class="tool" id="btn-code-reload">${iconHtml('refresh', 14)} Reload</button>
    </div>

    <div class="snippets" id="snippets">
      ${SNIPPETS.map((s) => `<button class="chip" data-snippet="${escapeHtml(s.label)}">${escapeHtml(s.label)}</button>`).join('')}
    </div>

    <div class="editor-card" id="editor-card">
      <div class="editor-bar">
        <span class="editor-file" id="editor-file"><i class="live-dot"></i> index.html</span>
        <div class="editor-actions">
          <button class="icon-btn sm" id="btn-code-copy2" aria-label="Copy code">${iconHtml('copy', 14)}</button>
          <button class="icon-btn sm" id="btn-code-expand" aria-label="Toggle focus mode">${iconHtml('expand', 14)}</button>
        </div>
      </div>
      <div class="editor-host" id="editor-host"></div>
      <div class="editor-empty-note" id="editor-empty">
        ${iconHtml('spark', 20)}
        <div><b>Start with a blank page</b>Ask the studio, or paste your own HTML/CSS/JS.</div>
      </div>
    </div>

    <div class="code-status" id="code-status">
      <span class="dot-status"></span>
      <span id="code-status-text">Live · edits preview after a short pause</span>
    </div>
    <div class="editor-footer" style="padding:8px 19px 0">
      <span id="code-size">0 KB</span>
      <span class="right">Deterministic clock armed</span>
    </div>
  </section>`;
}

function libraryViewHtml() {
  return `
  <section class="view" data-view="library" hidden>
    <div class="page-head">
      <div>
        <h2>The <span class="serif">library</span></h2>
        <div class="page-sub">Every export, kept on this machine.</div>
      </div>
      <span class="count-chip" id="lib-count">0 films</span>
    </div>
    <div class="library-grid" id="lib-body"></div>
  </section>`;
}

function settingsViewHtml() {
  return `
  <section class="view" data-view="settings" hidden>
    <div class="page-head">
      <div>
        <h2>Studio <span class="serif">settings</span></h2>
        <div class="page-sub">Stage, export and intelligence.</div>
      </div>
    </div>

    <div class="settings-wrap">
      <div class="settings-card">
        <div class="settings-head"><h3>Stage</h3><span class="hint">DESIGN VIEWPORT</span></div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label">
              <span class="name">Frame</span>
              <span class="desc">Authored at 1080 on the long edge. Resolution never moves the layout.</span>
            </div>
          </div>
          <div class="setting-extra">
            <div class="seg wide" id="set-aspect">
              ${Object.keys(DESIGNS).map((k) => `<button data-value="${k}">${k}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label">
              <span class="name">Duration</span>
              <span class="desc">Seconds of film. Every frame is captured.</span>
            </div>
            <span class="setting-value" id="duration-value">10s</span>
          </div>
          <div class="setting-extra">
            <input class="range" id="set-duration" type="range" min="2" max="30" step="1" value="10" aria-label="Duration in seconds">
          </div>
        </div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label">
              <span class="name">Safe-area guides</span>
              <span class="desc">5% margins and centre line over the stage.</span>
            </div>
            <button class="switch" id="set-guides" role="switch" aria-checked="false" aria-label="Safe-area guides"></button>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-head"><h3>Export</h3><span class="hint">H.264 / BT.709</span></div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label"><span class="name">Resolution</span><span class="desc">Matches the frame, only denser.</span></div>
            <span class="setting-value" id="set-res-value">1080p</span>
          </div>
          <div class="setting-extra">
            <div class="seg wide" id="set-resolution">
              <button data-value="720">720p</button>
              <button data-value="1080">1080p</button>
              <button data-value="1440">1440p</button>
            </div>
          </div>
        </div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label"><span class="name">Frame rate</span><span class="desc">Constant rate, no duplication.</span></div>
            <span class="setting-value" id="set-fps-value">60</span>
          </div>
          <div class="setting-extra">
            <div class="seg wide" id="set-fps">
              <button data-value="30">30 fps</button>
              <button data-value="60">60 fps</button>
            </div>
          </div>
        </div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label"><span class="name">Quality</span><span class="desc">Draft is faster; Max is near-lossless.</span></div>
          </div>
          <div class="setting-extra">
            <div class="seg wide" id="set-quality">
              <button data-value="draft">Draft</button>
              <button data-value="high">High</button>
              <button data-value="max">Max</button>
            </div>
          </div>
        </div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label"><span class="name">Frames to capture</span><span class="desc">Duration × frame rate.</span></div>
            <span class="setting-value" id="set-frames">600</span>
          </div>
        </div>
        <div class="setting">
          <button class="btn primary block" id="set-render">${iconHtml('export', 15)} Render MP4</button>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-head"><h3>Intelligence</h3><span class="hint" id="set-ai-model">GEMINI</span></div>
        <div class="setting">
          <div class="status-line">
            <span class="status-dot" id="set-ai-dot"></span>
            <span id="set-ai-text">Checking your key…</span>
          </div>
          <div class="row-actions" style="margin-top:9px">
            <button class="btn secondary tiny" id="set-ai-test">${iconHtml('bolt', 13)} Test key</button>
            <button class="btn secondary tiny" id="set-ai-write">${iconHtml('spark', 13)} Write with AI</button>
          </div>
        </div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label"><span class="name">Model</span><span class="desc">Flash models are tested first for speed.</span></div>
          </div>
          <button class="select-row" id="set-model" style="margin-top:8px">
            <span id="model-name">Auto · fastest Flash</span>
            ${iconHtml('chevronRight', 13)}
          </button>
        </div>
        <div class="setting">
          <div class="setting-row">
            <div class="setting-label">
              <span class="name">Strict art direction</span>
              <span class="desc">Blocks gradients, neon, glass and AI-default palettes.</span>
            </div>
            <button class="switch" id="set-strict" role="switch" aria-checked="true" aria-label="Strict art direction"></button>
          </div>
        </div>
        <div class="setting">
          <div class="sheet-label"><span>Art direction</span></div>
          <div class="dir-grid" id="dir-grid"></div>
        </div>
      </div>

      <div class="info-note">
        ${iconHtml('key', 14)}
        <span>Your Gemini key lives in <b>.env</b> on the server. Before every task the studio runs a tiny live test, retries quietly, and only then writes.</span>
      </div>

      <div class="settings-card">
        <div class="settings-head"><h3>Engine</h3><span class="hint" id="about-version">v1.0</span></div>
        <div class="about-lines" id="about-lines"></div>
        <div class="setting">
          <div class="row-actions">
            <button class="btn secondary small" id="btn-install">${iconHtml('monitor', 14)} Install app</button>
            <button class="btn ghost small" id="btn-reset">${iconHtml('reset', 14)} Reset workspace</button>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

function mountViews() {
  $('#view-root').innerHTML =
    createViewHtml() + codeViewHtml() + libraryViewHtml() + settingsViewHtml();
  hydrateIcons(document);
}

/* ---------------------------------------------------------------- boot */

function boot() {
  mountViews();
  cacheElements();
  initPreview();
  initEditor();
  bindChrome();
  bindCreate();
  bindCode();
  bindSettings();
  bindSheets();
  syncEverything();
  showView('create');
  refreshServerHealth();
  refreshAiHealth();
  refreshDirectionsSafe();
  renderIdeas();
  renderDirections();
  loadModels(false);

  setTimeout(() => {
    const bootEl = $('#boot');
    if (bootEl) bootEl.classList.add('gone');
    setTimeout(() => bootEl && bootEl.remove(), 500);
  }, 420);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
  });
  window.addEventListener('appinstalled', () => toast('Motion Studio installed.'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && preview && preview.playing) preview.pause();
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }, 2200);
  }
}

function cacheElements() {
  const ids = [
    'c-title', 'c-rename', 'c-format', 'aspects', 'stage', 'film', 'preview-frame', 'film-empty',
    'stage-loader', 'stage-overlay', 'play-orb', 'guides', 'overflow-chip', 'overflow-text',
    'overflow-fix', 'stage-note', 'stage-note-text', 'player', 'play-btn', 'time-now', 'time-total',
    'scrub', 'scrub-fill', 'scrub-knob', 'btn-ai', 'btn-export', 'meta-strip', 'fmt-aspect',
    'fmt-size', 'fmt-fps', 'fmt-duration', 'empty-ai', 'empty-presets',
    'code-count', 'btn-code-ai', 'btn-code-presets', 'btn-code-copy', 'btn-code-reload',
    'snippets', 'editor-card', 'editor-host', 'editor-empty', 'editor-file', 'code-status',
    'code-status-text', 'code-size', 'btn-code-copy2', 'btn-code-expand',
    'lib-count', 'lib-body', 'set-aspect', 'duration-value', 'set-duration', 'set-guides',
    'set-res-value', 'set-resolution', 'set-fps-value', 'set-fps', 'set-quality', 'set-frames',
    'set-render', 'set-ai-dot', 'set-ai-text', 'set-ai-model', 'set-ai-test', 'set-ai-write',
    'set-model', 'model-name', 'set-strict', 'dir-grid', 'about-lines', 'about-version',
    'btn-install', 'btn-reset',
    'sheet-ai', 'ai-status-dot', 'ai-status-text', 'ai-test-btn', 'ai-mode', 'ai-prompt',
    'ai-prompt-hint', 'ai-prompt-count', 'ai-ideas', 'ai-directions', 'ai-direction-label',
    'ai-strict', 'ai-gen-panel', 'ai-gen-phase', 'ai-gen-time', 'ai-gen-meta', 'ai-error',
    'ai-error-text', 'ai-key-setup', 'ai-retest-key', 'ai-surprise', 'ai-generate',
    'sheet-presets', 'preset-grid', 'sheet-render', 'render-name', 'render-summary-meta',
    'render-res', 'render-res-value', 'render-fps', 'render-quality', 'render-quality-value',
    'render-output', 'render-estimate', 'render-form', 'render-progress', 'progress-name',
    'progress-meta', 'progress-num', 'progress-detail', 'progress-bar', 'progress-caption',
    'progress-fps', 'render-done', 'done-sub', 'done-poster', 'done-meta', 'done-warnings',
    'done-watch', 'done-download', 'render-error', 'render-error-text', 'render-cancel',
    'render-start', 'render-again', 'sheet-video', 'video-title', 'video-el', 'video-download',
    'video-link', 'video-code', 'video-delete', 'video-meta', 'sheet-model', 'model-list',
    'model-refresh', 'sheet-rename', 'rename-input', 'rename-save', 'sheet-confirm',
    'confirm-title', 'confirm-text', 'confirm-ok', 'scrim', 'toast-wrap', 'gen-pill',
    'gen-pill-text', 'gen-pill-cancel', 'tabbar'
  ];
  ids.forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

/* ---------------------------------------------------------------- preview */

function initPreview() {
  const design = DESIGNS[state.aspect];
  preview = new Preview({
    iframe: els['preview-frame'],
    film: els.film,
    stage: els.stage,
    onStatus: onPreviewStatus,
    onTime: onPreviewTime,
    onEnd: onPreviewEnd,
    onMetrics: onPreviewMetrics,
    onError: onPreviewError
  });
  preview.setDesign(design.width, design.height);
  preview.setDuration(state.duration);
  preview.init().then(() => {
    if (state.code.trim()) {
      refreshPreview();
    } else {
      onPreviewStatus('empty');
    }
  });
}

function onPreviewStatus(status) {
  if (status === 'loading') {
    els['stage-loader'].classList.remove('hidden');
    els['stage-overlay'].classList.add('hidden');
    els['film-empty'].classList.add('hidden');
    els['stage-note'].classList.add('hidden');
  } else if (status === 'ready') {
    els['stage-loader'].classList.add('hidden');
    els['film-empty'].classList.add('hidden');
    els['stage-overlay'].classList.remove('hidden');
    els['stage-note'].classList.add('hidden');
    els['overflow-chip'].classList.add('hidden');
    if (pendingAutoplay) {
      pendingAutoplay = false;
      preview.play();
    }
  } else if (status === 'error') {
    els['stage-loader'].classList.add('hidden');
  } else if (status === 'empty') {
    els['stage-loader'].classList.add('hidden');
    els['stage-overlay'].classList.add('hidden');
    els['stage-note'].classList.add('hidden');
    els['overflow-chip'].classList.add('hidden');
    els['film-empty'].classList.remove('hidden');
  }
  syncPlayButtons();
  syncEmptyState();
}

function onPreviewTime(t) {
  const duration = state.duration;
  els['time-now'].textContent = formatTime(t / 1000);
  const ratio = clamp(t / (duration * 1000 || 1), 0, 1);
  els['scrub-fill'].style.width = `${ratio * 100}%`;
  els['scrub-knob'].style.left = `${ratio * 100}%`;
  els.scrub.setAttribute('aria-valuenow', (t / 1000).toFixed(2));
  syncPlayButtons();
}

function onPreviewEnd() {
  syncPlayButtons();
  els['stage-overlay'].classList.remove('hidden');
}

function onPreviewMetrics(metrics, errors) {
  if (!metrics) return;
  const overflow = metrics.overflowX || metrics.overflowY;
  if (overflow && state.code.trim()) {
    const axis = metrics.overflowX && metrics.overflowY ? 'right and bottom' : metrics.overflowX ? 'right' : 'bottom';
    els['overflow-text'].textContent = `Content leaves the frame (${axis})`;
    els['overflow-chip'].classList.remove('hidden');
  } else {
    els['overflow-chip'].classList.add('hidden');
  }
  if (errors && errors.length && !generating) {
    els['stage-note-text'].textContent = errors[0].message || 'Script error';
    els['stage-note'].classList.remove('hidden');
  }
}

function onPreviewError(message) {
  els['stage-note-text'].textContent = message;
  els['stage-note'].classList.remove('hidden');
}

async function refreshPreview({ quiet = false, autoplay = false, resume = true } = {}) {
  if (!preview) return;
  if (generating) {
    previewDirty = true;
    return;
  }
  if (!state.code.trim()) {
    await preview.setCode('');
    return;
  }
  pendingAutoplay = pendingAutoplay || autoplay;
  try {
    await preview.setCode(state.code, { quiet, resume });
  } catch (error) {
    onPreviewError(error.message);
  }
}

function applyDesign() {
  const design = DESIGNS[state.aspect];
  preview.setDesign(design.width, design.height);
  preview.setDuration(state.duration);
}

/* ---------------------------------------------------------------- editor */

function initEditor() {
  editor = createEditor(els['editor-host'], {
    value: state.code,
    onChange: (text) => {
      if (generating) return;
      state.code = text;
      afterCodeEdit();
      saveSoon();
      schedulePreview();
    }
  });
  afterCodeEdit();
}

function afterCodeEdit() {
  const code = state.code;
  const has = Boolean(code.trim());
  const lines = code ? code.split('\n').length : 0;
  els['code-count'].textContent = `${lines} line${lines === 1 ? '' : 's'}`;
  els['code-size'].textContent =
    code.length > 900
      ? `${(code.length / 1024).toFixed(1)} KB`
      : `${code.length} B`;
  els['editor-empty'].classList.toggle('hidden', has);
  els['btn-export'].disabled = !has || generating;
  els['set-render'].disabled = !has;
  syncEmptyState();
}

function setCode(code, { silentEditor = false, playAfter = false, resume = false } = {}) {
  schedulePreview.cancel();
  state.code = String(code || '');
  if (!silentEditor) editor.setValue(state.code, { silent: true });
  afterCodeEdit();
  saveSoon();
  previewDirty = false;
  refreshPreview({ autoplay: playAfter, resume });
}

/* ---------------------------------------------------------------- chrome */

function syncEverything() {
  syncChrome();
  syncSettings();
  syncEmptyState();
  syncPlayButtons();
  updateAiStatusUi();
  renderLibrary();
}

function syncChrome() {
  const design = DESIGNS[state.aspect];
  els['c-title'].textContent = state.title || DEFAULT_TITLE;
  els['fmt-aspect'].textContent = state.aspect;
  els['fmt-size'].textContent = `${design.width} × ${design.height}`;
  els['fmt-fps'].textContent = `${state.fps} fps`;
  els['fmt-duration'].textContent = `${state.duration}s`;
  $$('#aspects .aspect-btn').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.aspect === state.aspect));
  });
  els['time-total'].textContent = ` / ${formatTime(state.duration)}`;
  els.scrub.setAttribute('aria-valuemax', String(state.duration));
  const frames = state.duration * state.fps;
  els['meta-strip'].innerHTML = `
    ${icon('film', 12)}
    <span>${design.width} × ${design.height}</span>
    <span class="dot"></span>
    <span>${state.fps} fps</span>
    <span class="dot"></span>
    <span>${frames} frames</span>
    <span class="dot"></span>
    <span class="ok">${icon('check', 11)} frame-accurate</span>`;
  const promptHint = els['ai-prompt-hint'];
  if (promptHint) updatePromptHint();
}

function syncSettings() {
  const design = DESIGNS[state.aspect];
  const setSeg = (id, value) => {
    $$(`#${id} button`).forEach((button) => {
      button.setAttribute('aria-pressed', String(String(button.dataset.value) === String(value)));
    });
  };
  setSeg('set-aspect', state.aspect);
  setSeg('set-resolution', state.resolution);
  setSeg('set-fps', state.fps);
  setSeg('set-quality', state.quality);
  setSeg('render-res', state.resolution);
  setSeg('render-fps', state.fps);
  setSeg('render-quality', state.quality);
  els['set-res-value'].textContent = RES_LABEL[state.resolution];
  els['set-fps-value'].textContent = String(state.fps);
  els['set-frames'].textContent = String(state.duration * state.fps);
  els['duration-value'].textContent = `${state.duration}s`;
  els['set-duration'].value = String(state.duration);
  els['set-guides'].setAttribute('aria-checked', String(state.guides));
  els.guides.classList.toggle('on', state.guides);
  els['set-strict'].setAttribute('aria-checked', String(state.strict));
  els['ai-strict'].setAttribute('aria-checked', String(state.strict));
  els['model-name'].textContent = state.model || 'Auto · fastest Flash';
  els['set-ai-model'].textContent = state.model ? state.model.split('-').slice(0, 2).join('-') : 'GEMINI';
  els['render-res-value'].textContent = RES_LABEL[state.resolution];
  els['render-quality-value'].textContent = QUALITY_LABEL[state.quality];
  els['render-output'].textContent = `${design.width} × ${design.height} · ${state.duration * state.fps} frames`;
  els['render-estimate'].textContent = `~${estimateSeconds()}s on this machine`;
}

function syncEmptyState() {
  const has = Boolean(state.code.trim());
  els['film-empty'].classList.toggle('hidden', has);
  els.player.classList.toggle('hidden', !has);
  els['btn-export'].disabled = !has || generating;
  els['set-render'].disabled = !has;
  if (!has) {
    els['stage-overlay'].classList.add('hidden');
    els['overflow-chip'].classList.add('hidden');
  }
}

function syncPlayButtons() {
  const has = Boolean(state.code.trim());
  const playing = preview && preview.playing;
  const ended = preview && has && preview.t >= state.duration * 1000 - 30;
  const iconName = playing ? 'pause' : ended ? 'replay' : 'play';
  els['play-btn'].innerHTML = iconHtml(iconName, 15);
  els['play-btn'].setAttribute('aria-label', playing ? 'Pause film' : ended ? 'Replay film' : 'Play film');
  els['play-orb'].innerHTML = iconHtml(iconName, 20);
  els['stage-overlay'].classList.toggle('playing', Boolean(playing));
  if (playing) els['stage-overlay'].classList.add('hidden');
  else if (has && preview && preview.ready) els['stage-overlay'].classList.remove('hidden');
  els['play-btn'].classList.toggle('active', Boolean(playing));
}

function estimateSeconds() {
  const base = { 720: 0.048, 1080: 0.095, 1440: 0.16 }[state.resolution] || 0.095;
  const quality = { draft: 0.85, high: 1, max: 1.55 }[state.quality] || 1;
  return Math.max(3, Math.round(state.duration * state.fps * base * quality + 4));
}

/* ---------------------------------------------------------------- create bindings */

function bindChrome() {
  $$('#tabbar .tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.tab));
  });
  $('#btn-top-ai').addEventListener('click', () => openAiSheet(state.code.trim() ? 'edit' : 'generate'));
  $('#btn-top-presets').addEventListener('click', openPresets);
  els.scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (activeSheet) closeSheet();
    }
    if (event.key === ' ' && !activeSheet && !isTyping(event.target) && state.tab === 'create') {
      event.preventDefault();
      togglePlay();
    }
  });
}

function bindCreate() {
  els['c-rename'].addEventListener('click', openRename);
  els['c-title'].addEventListener('click', openRename);
  els['c-format'].addEventListener('click', () => showView('settings'));
  $$('#aspects .aspect-btn').forEach((button) => {
    button.addEventListener('click', () => changeAspect(button.dataset.aspect));
  });
  els['empty-ai'].addEventListener('click', () => openAiSheet('generate'));
  els['empty-presets'].addEventListener('click', openPresets);
  els['btn-ai'].addEventListener('click', () => openAiSheet(state.code.trim() ? 'edit' : 'generate'));
  els['btn-export'].addEventListener('click', openRenderSheet);
  els['play-btn'].addEventListener('click', togglePlay);
  els['play-orb'].addEventListener('click', togglePlay);
  els['overflow-fix'].addEventListener('click', () => {
    openAiSheet('edit', 'Refit the composition into the safe area. Keep the idea, palette and timing, but scale the type and geometry so nothing leaves the frame.');
  });
  bindScrub();
}

function togglePlay() {
  if (!state.code.trim() || !preview.ready) {
    if (!state.code.trim()) openAiSheet('generate');
    return;
  }
  preview.toggle();
  syncPlayButtons();
}

function bindScrub() {
  const setFromEvent = (event) => {
    const rect = els.scrub.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    scrubTarget = x * state.duration * 1000;
    preview.pause();
    preview.seek(scrubTarget);
  };
  els.scrub.addEventListener('pointerdown', (event) => {
    if (!preview.ready) return;
    els.scrub.setPointerCapture(event.pointerId);
    scrubStart = preview.t;
    setFromEvent(event);
  });
  els.scrub.addEventListener('pointermove', (event) => {
    if (!els.scrub.hasPointerCapture(event.pointerId)) return;
    setFromEvent(event);
  });
  els.scrub.addEventListener('pointerup', (event) => {
    if (!preview.ready) return;
    try {
      els.scrub.releasePointerCapture(event.pointerId);
    } catch (e) {}
    if (scrubTarget < scrubStart - 100) preview.seek(scrubTarget, { hard: true });
    syncPlayButtons();
  });
  els.scrub.addEventListener('keydown', (event) => {
    if (!preview.ready) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      preview.shiftTime(250);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      preview.seek(preview.t - 250, { hard: true });
    }
    syncPlayButtons();
  });
}

function changeAspect(aspect) {
  if (!DESIGNS[aspect] || state.aspect === aspect) return;
  state.aspect = aspect;
  saveSoon();
  applyDesign();
  syncChrome();
  syncSettings();
  refreshPreview();
}

function openRename() {
  els['rename-input'].value = state.title;
  openSheet('sheet-rename');
  setTimeout(() => els['rename-input'].focus(), 340);
}

function saveRename() {
  const value = els['rename-input'].value.trim();
  state.title = value || DEFAULT_TITLE;
  els['c-title'].textContent = state.title;
  saveSoon();
  closeSheet();
  toast('Project renamed.');
}

/* ---------------------------------------------------------------- code bindings */

function bindCode() {
  els['btn-code-ai'].addEventListener('click', () => openAiSheet(state.code.trim() ? 'edit' : 'generate'));
  els['btn-code-presets'].addEventListener('click', openPresets);
  els['btn-code-copy'].addEventListener('click', copyCode);
  els['btn-code-copy2'].addEventListener('click', copyCode);
  els['btn-code-reload'].addEventListener('click', () => {
    previewDirty = false;
    refreshPreview({ autoplay: false });
    toast('Preview reloaded.');
  });
  els['btn-code-expand'].addEventListener('click', () => {
    els['editor-card'].classList.toggle('expanded');
    editor.refresh();
  });
  els.snippets.addEventListener('click', (event) => {
    const button = event.target.closest('[data-snippet]');
    if (!button) return;
    const snippet = SNIPPETS.find((item) => item.label === button.dataset.snippet);
    if (!snippet) return;
    editor.insert(snippet.text);
    toast(`${snippet.label} snippet inserted.`);
  });
}

async function copyCode() {
  if (!state.code.trim()) return toast('Nothing to copy yet.');
  const ok = await copyText(state.code);
  toast(ok ? 'Document copied.' : 'Could not access the clipboard.');
}

/* ---------------------------------------------------------------- tabs */

function showView(tab) {
  state.tab = tab;
  $$('#tabbar .tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
    button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false');
  });
  $$('#view-root .view').forEach((view) => {
    view.hidden = view.dataset.view !== tab;
  });
  if (tab === 'create') {
    if (preview) {
      preview.layout();
      syncPlayButtons();
    }
  } else if (tab === 'code') {
    editor.refresh();
    if (window.innerWidth > 700) editor.focus();
  } else if (tab === 'library') {
    loadLibrary();
  } else if (tab === 'settings') {
    syncSettings();
    refreshAiHealth();
    renderAbout();
  }
}

/* ---------------------------------------------------------------- sheets */

function openSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  if (activeSheet && activeSheet !== sheet) closeSheet(true);
  activeSheet = sheet;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  els.scrim.classList.add('open');
  document.body.classList.add('locked');
  updateGenPill();
}

function closeSheet(instant = false) {
  if (!activeSheet) return;
  const sheet = activeSheet;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  activeSheet = null;
  els.scrim.classList.remove('open');
  document.body.classList.remove('locked');
  updateGenPill();
  if (sheet.id === 'sheet-video') {
    els['video-el'].pause();
    els['video-el'].removeAttribute('src');
    els['video-el'].load();
  }
  if (sheet.id === 'sheet-render' && !rendering && !instant) {
    setRenderStage('form');
  }
}

function bindSheets() {
  $$('[data-close]').forEach((button) => button.addEventListener('click', closeSheet));
  els['ai-mode'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button || generating) return;
    setAiMode(button.dataset.mode);
  });
  els['ai-prompt'].addEventListener('input', updatePromptUi);
  els['ai-ideas'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-idea]');
    if (!button) return;
    els['ai-prompt'].value = button.dataset.idea;
    updatePromptUi();
  });
  els['ai-directions'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-direction]');
    if (!button) return;
    state.direction = button.dataset.direction;
    saveSoon();
    renderDirections();
  });
  els['ai-strict'].addEventListener('click', () => toggleStrict());
  els['set-strict'].addEventListener('click', () => toggleStrict());
  els['ai-test-btn'].addEventListener('click', () => runAiTest({ manual: true }));
  els['ai-retest-key'].addEventListener('click', () => runAiTest({ manual: true }));
  els['ai-generate'].addEventListener('click', () => {
    if (generating) cancelGeneration();
    else runGeneration();
  });
  els['ai-surprise'].addEventListener('click', () => {
    if (generating) return;
    const idea = IDEAS[Math.floor(Math.random() * IDEAS.length)];
    const options = ['editorial', 'brutalist', 'riso', 'blueprint', 'organic', 'cinema', 'constructivist', 'minimal', 'random'];
    state.direction = options[Math.floor(Math.random() * options.length)];
    saveSoon();
    renderDirections();
    els['ai-prompt'].value = idea;
    updatePromptUi();
    setAiMode('generate');
    runGeneration();
  });
  els['gen-pill-cancel'].addEventListener('click', cancelGeneration);
  els['render-start'].addEventListener('click', startRender);
  els['render-cancel'].addEventListener('click', cancelRender);
  els['render-again'].addEventListener('click', () => {
    setRenderStage('form');
    hideRenderError();
  });
  els['render-res'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    state.resolution = button.dataset.value;
    saveSoon();
    syncSettings();
  });
  els['render-fps'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    state.fps = Number(button.dataset.value);
    saveSoon();
    syncChrome();
    syncSettings();
  });
  els['render-quality'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    state.quality = button.dataset.value;
    saveSoon();
    syncSettings();
  });
  els['sheet-video'].addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) return;
  });
  els['done-watch'].addEventListener('click', () => {
    if (currentVideo) openVideo(currentVideo);
  });
  els['done-download'].addEventListener('click', () => {
    if (currentVideo) downloadItem(currentVideo);
  });
  els['video-download'].addEventListener('click', () => {
    if (currentVideo) downloadItem(currentVideo);
  });
  els['video-link'].addEventListener('click', async () => {
    if (!currentVideo) return;
    const ok = await copyText(`${location.origin}${currentVideo.url}`);
    toast(ok ? 'Link copied.' : 'Could not copy the link.');
  });
  els['video-code'].addEventListener('click', openVideoCode);
  els['video-delete'].addEventListener('click', () => {
    if (!currentVideo) return;
    const item = currentVideo;
    openConfirm(
      'Delete this film?',
      `“${escapeHtml(item.title)}” and its source will be removed from this machine. This cannot be undone.`,
      async () => {
        try {
          await fetch(`/api/library/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
          closeSheet();
          await loadLibrary();
          toast('Film deleted.');
        } catch (e) {
          toast('Could not delete that film.');
        }
      }
    );
  });
  $('#rename-save').addEventListener('click', saveRename);
  els['rename-input'].addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveRename();
  });
  els['confirm-ok'].addEventListener('click', async () => {
    const action = confirmAction;
    confirmAction = null;
    closeSheet();
    if (action) await action();
  });
  els['model-list'].addEventListener('click', (event) => {
    const row = event.target.closest('[data-model]');
    if (!row) return;
    state.model = row.dataset.model;
    saveSoon();
    renderModels();
    syncSettings();
    closeSheet();
    toast(state.model ? 'Model pinned.' : 'Using the fastest Flash model.');
  });
  els['model-refresh'].addEventListener('click', () => loadModels(true));
  els['set-model'].addEventListener('click', openModelSheet);
  els['video-el'].addEventListener('error', () => {
    if (els['video-el'].getAttribute('src')) toast('Could not play that file.');
  });
}

function openConfirm(title, html, action) {
  els['confirm-title'].textContent = title;
  els['confirm-text'].innerHTML = html;
  confirmAction = action;
  openSheet('sheet-confirm');
}

function setAiMode(mode) {
  state.mode = mode;
  saveSoon();
  $$('#ai-mode [data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  const placeholders = {
    generate: 'A typographic countdown to the last train home — numbers, rules, one moving line.',
    edit: 'Push the type bigger, slow the final hold, keep the palette.',
    extract: 'Keep only the motion scene. Remove every button, nav, footer and app chrome.'
  };
  els['ai-prompt'].placeholder = placeholders[mode];
  els['ai-ideas'].classList.toggle('hidden', mode !== 'generate');
  updatePromptHint();
  hideAiError();
}

function updatePromptUi() {
  const value = els['ai-prompt'].value;
  els['ai-prompt-count'].textContent = `${value.length} / 1200`;
  updatePromptHint();
}

function updatePromptHint() {
  const design = DESIGNS[state.aspect];
  const mode = state.mode;
  if (mode === 'generate') {
    els['ai-prompt-hint'].textContent = `Stage ${design.width} × ${design.height} · ${state.fps} fps · ${state.duration}s`;
  } else if (mode === 'edit') {
    els['ai-prompt-hint'].textContent = 'Rewrites the current document · key tested first';
  } else {
    els['ai-prompt-hint'].textContent = 'Finds one scene and removes app chrome';
  }
}

function toggleStrict() {
  state.strict = !state.strict;
  saveSoon();
  els['ai-strict'].setAttribute('aria-checked', String(state.strict));
  els['set-strict'].setAttribute('aria-checked', String(state.strict));
  toast(state.strict ? 'Strict art direction on.' : 'Strict art direction off — gradients allowed.');
}

/* ---------------------------------------------------------------- AI sheet */

function openAiSheet(mode = 'generate', prefill = '') {
  setAiMode(mode);
  if (prefill) {
    els['ai-prompt'].value = prefill;
    updatePromptUi();
  }
  openSheet('sheet-ai');
  refreshAiHealth();
  if (window.innerWidth > 700) setTimeout(() => els['ai-prompt'].focus(), 350);
}

function renderIdeas() {
  els['ai-ideas'].innerHTML = IDEAS.slice(0, 5)
    .map((idea) => `<button data-idea="${escapeHtml(idea)}">${escapeHtml(idea.slice(0, 42))}${idea.length > 42 ? '…' : ''}</button>`)
    .join('');
}

function renderDirections() {
  if (!directions.length) {
    const fallback = [
      { id: 'editorial', name: 'Editorial / Swiss', palette: ['#F2EEE5', '#111110', '#E23D28'] },
      { id: 'brutalist', name: 'Type Brutalist', palette: ['#0B0B0B', '#EFE9DD', '#D7FF3F'] },
      { id: 'riso', name: 'Riso Print', palette: ['#F4E8D6', '#E1482F', '#1E3A8A'] },
      { id: 'blueprint', name: 'Technical Blueprint', palette: ['#0E1B2A', '#E8E2D6', '#5BC0BE'] },
      { id: 'organic', name: 'Organic Modern', palette: ['#E9E1D4', '#3E4A3D', '#B0563A'] },
      { id: 'cinema', name: 'Cinematic Mono', palette: ['#0B0B0C', '#F2E9DC', '#D9A441'] },
      { id: 'constructivist', name: 'Constructivist', palette: ['#EFE9DD', '#0D0D0D', '#C8102E'] },
      { id: 'minimal', name: 'Quiet Minimal', palette: ['#F3F1EB', '#191919', '#8C9A7C'] }
    ];
    directions = [...fallback, { id: 'random', name: 'Random', palette: ['#85827a', '#b0563a', '#2f6b4f'] }];
  }
  const active = state.direction || 'editorial';
  if (!directions.some((direction) => direction.id === active)) {
    directions.push({ id: active, name: active, palette: ['#85827a', '#3e3d37', '#141412'] });
  }
  els['ai-directions'].innerHTML = directions
    .map(
      (direction) => `
      <button class="dir-pill" data-direction="${direction.id}" aria-pressed="${direction.id === active}">
        <span class="dir-dots">${(direction.palette || []).map((c) => `<i style="background:${c}"></i>`).join('')}</span>
        ${escapeHtml(direction.name)}
      </button>`
    )
    .join('');
  const current = directions.find((direction) => direction.id === active);
  els['ai-direction-label'].textContent = current ? current.name : 'Editorial / Swiss';
  els['dir-grid'].innerHTML = directions
    .filter((direction) => direction.id !== 'random')
    .map(
      (direction) => `
      <button class="dir-tile" data-direction="${direction.id}" aria-pressed="${direction.id === active}">
        <span class="name">${escapeHtml(direction.name)}</span>
        <span class="dir-swatches">${(direction.palette || []).map((c) => `<i style="background:${c}"></i>`).join('')}</span>
        <span class="check">${iconHtml('check', 12)}</span>
      </button>`
    )
    .join('');
  els['dir-grid'].querySelectorAll('[data-direction]').forEach((tile) => {
    tile.addEventListener('click', () => {
      state.direction = tile.dataset.direction;
      saveSoon();
      renderDirections();
    });
  });
}

async function refreshAiHealth(force = false) {
  if (!force && Date.now() - healthAt < 45000) return;
  healthAt = Date.now();
  overview.checking = true;
  updateAiStatusUi();
  const result = await aiHealth();
  overview = {
    configured: Boolean(result.configured),
    ok: Boolean(result.ok),
    error: result.error || '',
    latencyMs: result.latencyMs || 0,
    defaultModel: result.defaultModel || '',
    modelCount: result.modelCount || 0,
    checking: false
  };
  if (overview.configured && overview.ok && (!state.model || !models.length)) {
    loadModels(false);
  }
  updateAiStatusUi();
  renderAbout();
  renderDirections();
}

async function runAiTest({ manual = false } = {}) {
  const button = els['ai-test-btn'];
  button.disabled = true;
  button.textContent = 'Testing…';
  overview.checking = true;
  updateAiStatusUi();
  let result = null;
  try {
    result = await aiTest(state.model);
  } catch (error) {
    result = { ok: false, error: error.message, code: 'NETWORK', retryable: true };
  }
  button.disabled = false;
  button.textContent = 'Test key';
  if (result && result.ok) {
    overview = {
      configured: true,
      ok: true,
      latencyMs: result.latencyMs,
      defaultModel: result.model,
      error: '',
      checking: false,
      modelCount: overview.modelCount
    };
    if (manual) toast(`Connected in ${result.latencyMs}ms · ${result.model}`);
    els['ai-key-setup'].classList.add('hidden');
  } else {
    overview = {
      configured: Boolean(result?.configured),
      ok: false,
      error: result?.error || 'Connection failed.',
      code: result?.code || 'NETWORK',
      checking: false,
      defaultModel: overview.defaultModel,
      modelCount: overview.modelCount
    };
    if (manual) toast(overview.error, { duration: 6000 });
  }
  updateAiStatusUi();
  renderAbout();
  return result;
}

function updateAiStatusUi() {
  let kind = 'busy';
  let text = 'Checking your key…';
  if (!overview.checking) {
    if (!overview.configured) {
      kind = 'warn';
      text = 'No key yet — add GEMINI_API_KEY to .env';
    } else if (overview.ok) {
      kind = 'ok';
      text = `Key live · ${overview.defaultModel || 'Gemini'} · ${overview.latencyMs || 0}ms`;
    } else {
      kind = 'err';
      text = overview.error || 'Gemini is unreachable.';
    }
  }
  els['ai-status-dot'].className = `status-dot ${overview.checking ? 'busy' : kind}`;
  els['ai-status-text'].textContent = text;
  els['ai-status-text'].title = text;
  els['ai-key-setup'].classList.toggle('hidden', overview.checking || Boolean(overview.configured));
  els['set-ai-dot'].className = `status-dot ${overview.checking ? 'busy' : kind}`;
  els['set-ai-text'].textContent = text;
  els['set-ai-text'].title = text;
  els['set-ai-test'].disabled = overview.checking;
}

/* ---------------------------------------------------------------- models */

async function loadModels(force = false) {
  if (!overview.configured) {
    modelsLoaded = false;
    renderModels();
    return;
  }
  if (modelsLoaded && !force) {
    renderModels();
    return;
  }
  els['model-list'].innerHTML = '<div class="status-line"><span class="status-dot busy"></span><span>Asking Gemini for its fastest models…</span></div>';
  const result = await aiModels(force);
  if (result && result.ok) {
    models = result.models || [];
    modelsLoaded = true;
    if (!state.model && result.defaultModel) {
      overview.defaultModel = result.defaultModel;
    }
  } else {
    modelsLoaded = false;
    models = [];
    if (result?.error && !/no api key/i.test(result.error)) toast(result.error, { duration: 5000 });
  }
  renderModels();
  updateAiStatusUi();
  syncSettings();
}

function openModelSheet() {
  if (!overview.configured) {
    openAiSheet('generate');
    toast('Add a key first — the model list comes from Gemini.');
    return;
  }
  renderModels();
  openSheet('sheet-model');
  if (!modelsLoaded) loadModels(false);
}

function renderModels() {
  const rows = [];
  rows.push(`
    <button class="option-row" data-model="" aria-pressed="${!state.model}">
      <div class="oinfo"><b>Auto · fastest Flash</b><span>Gemini picks the quickest Flash model, falling back gracefully.</span></div>
      <span class="check">${iconHtml('check', 15)}</span>
    </button>`);
  models.slice(0, 10).forEach((model) => {
    rows.push(`
      <button class="option-row" data-model="${escapeHtml(model.id)}" aria-pressed="${state.model === model.id}">
        <div class="oinfo"><b>${escapeHtml(model.name || model.id)}</b><span>${escapeHtml(model.id)}</span></div>
        <span class="check">${iconHtml('check', 15)}</span>
      </button>`);
  });
  if (!models.length) {
    rows.push('<div class="info-note" style="margin:8px 0 0">No model list yet. Test the key, then refresh.</div>');
  }
  els['model-list'].innerHTML = rows.join('');
}

/* ---------------------------------------------------------------- generation */

function setGeneratingUi(on) {
  generating = on;
  els['ai-gen-panel'].classList.toggle('on', on);
  els['ai-generate'].classList.toggle('danger', on);
  els['ai-generate'].classList.toggle('primary', !on);
  els['ai-generate'].innerHTML = on
    ? `${iconHtml('close', 15)} Stop writing`
    : `${iconHtml('spark', 15)} Generate scene`;
  els['ai-mode'].querySelectorAll('button').forEach((button) => {
    button.disabled = on;
  });
  if (editor) editor.setReadOnly(on);
  els['btn-export'].disabled = on || !state.code.trim();
  if (on) {
    genStartedAt = Date.now();
    clearInterval(genTimer);
    genTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - genStartedAt) / 1000);
      els['ai-gen-time'].textContent = `${seconds}s`;
      const label = PHASE_LABEL[genPhase] || 'Writing the scene';
      els['gen-pill-text'].textContent = `${label} · ${seconds}s`;
    }, 280);
  } else {
    clearInterval(genTimer);
    genTimer = null;
  }
  updateGenPill();
}

function updateGenPill() {
  const show = generating && (!activeSheet || activeSheet.id !== 'sheet-ai');
  els['gen-pill'].classList.toggle('on', show);
}

function setGenPhase(phase, extra = '') {
  genPhase = phase;
  const label = PHASE_LABEL[phase] || PHASE_LABEL.writing;
  els['ai-gen-phase'].textContent = `${label}…`;
  if (extra) els['ai-gen-meta'].textContent = extra;
  els['gen-pill-text'].textContent = `${label}…`;
}

function showAiError(message) {
  els['ai-error-text'].textContent = message;
  els['ai-error'].classList.remove('hidden');
}

function hideAiError() {
  els['ai-error'].classList.add('hidden');
}

function userMessage(error) {
  const code = error?.code;
  if (code === 'NO_KEY') return 'No Gemini key found. Add GEMINI_API_KEY to .env, restart the server, then test the key.';
  if (code === 'INVALID_KEY') return 'Gemini rejected the key. Check that it is enabled for the Generative Language API.';
  if (code === 'RATE_LIMIT') return 'Gemini is rate limiting this key. Wait a moment and try again.';
  if (code === 'MODEL_NOT_FOUND') return 'That model is not available to this key. Pick Auto in Settings.';
  if (code === 'NETWORK') return 'The connection dropped repeatedly. Check your network and try again — the studio will retest the key first.';
  return error?.message || 'The studio could not finish that scene.';
}

async function runGeneration() {
  if (generating) return;
  const mode = state.mode;
  const prompt = els['ai-prompt'].value.trim();
  if (mode !== 'generate' && !state.code.trim()) {
    showAiError('There is no document to refine. Write a first scene or load a preset.');
    return;
  }
  if (mode === 'generate' && !prompt) {
    showAiError('Describe the scene first — one sentence is enough.');
    els['ai-prompt'].focus();
    return;
  }
  if (!overview.configured) {
    showAiError('No key configured. Add GEMINI_API_KEY to .env and restart the studio.');
    els['ai-key-setup'].classList.remove('hidden');
    return;
  }

  hideAiError();
  els['ai-gen-meta'].textContent = 'Testing the key with a tiny live request…';
  setGenPhase('testing');
  codeBeforeGeneration = state.code;
  streamBuffer = '';
  let started = 0;
  genController = new AbortController();
  setGeneratingUi(true);
  if (activeSheet && activeSheet.id === 'sheet-ai') els['ai-gen-meta'].textContent = 'Testing the key with a tiny live request…';

  streamFlush = setInterval(() => {
    if (!streamBuffer) return;
    editor.setValue(streamBuffer, { silent: true, scrollToEnd: true });
    const lines = streamBuffer.split('\n').length;
    els['code-count'].textContent = `${lines} lines`;
    els['code-size'].textContent = `${(streamBuffer.length / 1024).toFixed(1)} KB`;
    els['editor-empty'].classList.add('hidden');
  }, 95);

  const design = DESIGNS[state.aspect];
  const params = {
    mode,
    prompt,
    code: mode === 'generate' ? '' : state.code,
    aspect: state.aspect,
    width: design.width,
    height: design.height,
    fps: state.fps,
    duration: state.duration,
    direction: state.direction || 'random',
    strict: state.strict,
    model: state.model,
    signal: genController.signal
  };
  const startedAt = Date.now();

  try {
    const done = await generate(params, {
      onMeta: (meta) => {
        const bits = [];
        if (meta.testLatency) bits.push(`key tested in ${meta.testLatency}ms`);
        if (meta.model) bits.push(meta.model);
        if (meta.direction) bits.push(meta.direction);
        if (meta.cached) bits.push('cached');
        els['ai-gen-meta'].textContent = bits.join(' · ') || 'Streaming…';
        if (meta.model) overview.defaultModel = meta.model;
      },
      onPhase: (phase) => {
        if (phase?.phase === 'writing') setGenPhase('writing', 'Streaming a single HTML document…');
        else if (phase?.phase === 'refining') setGenPhase('refining', 'A gradient or glow slipped in — rebuilding it flat.');
        else if (phase?.phase === 'ready') setGenPhase('ready', 'Art direction clean.');
        else if (phase?.phase === 'testing') setGenPhase('testing');
        else if (phase?.phase === 'reconnecting') setGenPhase('reconnecting', `Connection dropped — attempt ${phase.attempt || 2} of 3.`);
        else if (phase?.phase) setGenPhase('writing');
      },
      onDelta: (text) => {
        if (!text) return;
        if (!started) {
          started = Date.now();
          setGenPhase('writing', 'Streaming a single HTML document…');
        }
        streamBuffer += text;
      },
      onReset: () => {
        streamBuffer = '';
        editor.setValue('', { silent: true });
        setGenPhase('writing', 'Restarting the document cleanly…');
      },
      onWarning: (message) => {
        toast(message, { duration: 5000 });
        els['ai-gen-meta'].textContent = message;
      },
      onViolations: (info) => {
        const list = Array.isArray(info?.violations) ? info.violations : [];
        if (list.length) els['ai-gen-meta'].textContent = `Art direction check: ${list.join(', ')}`;
      }
    });

    clearInterval(streamFlush);
    streamFlush = null;
    if (streamBuffer) editor.setValue(streamBuffer, { silent: true });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    setGeneratingUi(false);
    setCode(done.code, { silentEditor: false, playAfter: true });
    if (done.direction) {
      state.direction = done.direction;
      renderDirections();
    }
    if (state.title === DEFAULT_TITLE) {
      const derived = slugWords(prompt || `${state.direction} film`, 34);
      if (derived) {
        state.title = derived;
        saveSoon();
        syncChrome();
      }
    }
    setGenPhase('ready', `Scene ready in ${seconds}s${done.cached ? ' · from cache' : ''}`);
    if (overview) {
      overview.ok = true;
      overview.checking = false;
    }
    updateAiStatusUi();
    if (Array.isArray(done.violations) && done.violations.length) {
      toast(`Kept it flat, but flagged: ${done.violations.join(', ')}`, { duration: 6000 });
    } else {
      toast(`Scene written in ${seconds}s.`);
    }
    setTimeout(() => {
      if (activeSheet && activeSheet.id === 'sheet-ai' && !generating) closeSheet();
    }, 520);
  } catch (error) {
    clearInterval(streamFlush);
    streamFlush = null;
    const cancelled = error?.name === 'AbortError' || error?.code === 'ABORTED';
    const partial = streamBuffer.trim();
    setGeneratingUi(false);
    if (cancelled) {
      if (partial.length > 300 && mode === 'generate') {
        setCode(partial, { playAfter: false });
        toast('Writing stopped. Partial scene kept.');
      } else {
        setCode(codeBeforeGeneration, { playAfter: false });
        toast('Writing stopped.');
      }
      setGenPhase('ready', 'Stopped.');
    } else {
      if (mode === 'generate' && partial.length > 400) {
        setCode(partial, { playAfter: false });
        toast('Connection failed. The partial scene was kept.', { duration: 6000 });
      } else {
        setCode(codeBeforeGeneration, { playAfter: false });
      }
      showAiError(userMessage(error));
      els['ai-gen-meta'].textContent = userMessage(error);
    }
    updateAiStatusUi();
  } finally {
    genController = null;
    previewDirty = false;
  }
}

function cancelGeneration() {
  if (!genController) return;
  genController.abort();
  setGenPhase('ready', 'Stopping…');
}

/* ---------------------------------------------------------------- render */

function openRenderSheet() {
  if (!state.code.trim()) {
    toast('Write or load a scene first.');
    return;
  }
  syncSettings();
  setRenderStage('form');
  hideRenderError();
  els['render-name'].textContent = state.title || DEFAULT_TITLE;
  const design = DESIGNS[state.aspect];
  els['render-summary-meta'].textContent = `${design.width} × ${design.height} · ${state.fps} fps · ${state.duration}s`;
  els['render-output'].textContent = `${design.width} × ${design.height} · ${state.duration * state.fps} frames`;
  els['render-estimate'].textContent = `~${estimateSeconds()}s on this machine`;
  openSheet('sheet-render');
}

function setRenderStage(stage) {
  els['render-form'].classList.toggle('hidden', stage !== 'form');
  els['render-progress'].classList.toggle('hidden', stage !== 'progress');
  els['render-done'].classList.toggle('hidden', stage !== 'done');
  els['render-cancel'].classList.toggle('hidden', stage !== 'progress');
  els['render-start'].classList.toggle('hidden', stage !== 'form');
  els['render-again'].classList.toggle('hidden', stage !== 'done');
  if (stage === 'form') {
    els['render-start'].disabled = !state.code.trim();
  }
}

function hideRenderError() {
  els['render-error'].classList.add('hidden');
}

function showRenderError(message) {
  els['render-error-text'].textContent = message;
  els['render-error'].classList.remove('hidden');
}

async function startRender() {
  if (rendering || !state.code.trim()) return;
  hideRenderError();
  const design = DESIGNS[state.aspect];
  const token = ++renderToken;
  renderController = new AbortController();
  rendering = true;
  setRenderStage('progress');
  els['progress-name'].textContent = state.title || DEFAULT_TITLE;
  els['progress-meta'].textContent = 'Launching Chrome…';
  els['progress-num'].innerHTML = '0<small>%</small>';
  els['progress-detail'].innerHTML = `frame 0 / ${state.duration * state.fps}<br>eta —`;
  els['progress-bar'].style.width = '0%';
  els['progress-caption'].textContent = 'Rendering frame by frame';
  els['progress-fps'].textContent = '— fps';

  const params = {
    code: state.code,
    title: state.title || DEFAULT_TITLE,
    aspect: state.aspect,
    fps: state.fps,
    duration: state.duration,
    quality: state.quality,
    resolution: state.resolution
  };

  try {
    const done = await renderFilm(
      params,
      {
        onJob: (job) => {
          els['progress-meta'].textContent = `${job.width} × ${job.height} · ${job.fps} fps · ${QUALITY_LABEL[state.quality]}`;
          els['progress-detail'].innerHTML = `frame 0 / ${state.duration * job.fps}<br>eta —`;
        },
        onQueued: (info) => {
          els['progress-caption'].textContent = `Waiting for a free render slot · position ${info.position}`;
        },
        onProgress: (progress) => {
          if (token !== renderToken) return;
          if (progress.phase === 'loading') {
            els['progress-meta'].textContent = 'Settling fonts and the stage…';
            els['progress-caption'].textContent = 'Preparing the virtual clock';
            return;
          }
          if (progress.phase === 'poster') {
            els['progress-num'].innerHTML = '100<small>%</small>';
            els['progress-bar'].style.width = '100%';
            els['progress-caption'].textContent = 'Finishing the container';
            els['progress-fps'].textContent = 'done';
            return;
          }
          const pct = clamp((progress.frame / progress.total) * 100, 0, 100);
          els['progress-num'].innerHTML = `${Math.floor(pct)}<small>%</small>`;
          els['progress-bar'].style.width = `${pct}%`;
          els['progress-detail'].innerHTML = `frame ${progress.frame} / ${progress.total}<br>eta ${formatEta(progress.eta)}`;
          els['progress-caption'].textContent = 'Rendering frame by frame';
          els['progress-fps'].textContent = `${(progress.renderFps || 0).toFixed(1)} fps`;
          els['progress-meta'].textContent = `Chrome capture · ffmpeg H.264 · ${state.resolution}p`;
        },
        onDone: () => {}
      },
      renderController.signal
    );

    if (token !== renderToken) return;
    rendering = false;
    renderController = null;
    showRenderDone(done);
    loadLibrary();
  } catch (error) {
    if (token !== renderToken) return;
    rendering = false;
    renderController = null;
    setRenderStage('form');
    showRenderError(error.cancelled ? 'Render cancelled — nothing was written.' : error.message || 'Render failed.');
    if (error.cancelled) toast('Render cancelled.');
  }
}

function formatEta(ms) {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function showRenderDone(done) {
  currentVideo = done;
  setRenderStage('done');
  els['done-sub'].textContent = `${done.width} × ${done.height} · ${done.fps} fps · ${Number(done.duration).toFixed(1)}s`;
  els['done-poster'].innerHTML = done.posterUrl
    ? `<img src="${done.posterUrl}" alt="Poster frame of ${escapeHtml(done.title)}">`
    : '';
  els['done-meta'].textContent = `${formatBytes(done.bytes)} · ${QUALITY_LABEL[done.quality] || done.quality} · ${(done.elapsedMs / 1000).toFixed(1)}s`;
  const warnings = Array.isArray(done.warnings) ? done.warnings : [];
  els['done-warnings'].classList.toggle('hidden', !warnings.length);
  els['done-warnings'].textContent = warnings.join(' · ');
  if (activeSheet && activeSheet.id === 'sheet-render') {
    toast('MP4 ready.');
  } else {
    toast('MP4 ready.', {
      actionLabel: 'Watch',
      action: () => openVideo(done),
      duration: 8000
    });
  }
}

function cancelRender() {
  if (!renderController) return;
  renderController.abort();
  els['progress-caption'].textContent = 'Stopping Chrome…';
}

/* ---------------------------------------------------------------- library */

async function loadLibrary() {
  try {
    const response = await fetch('/api/library', { cache: 'no-store' });
    const data = await response.json();
    library = Array.isArray(data.items) ? data.items : [];
  } catch (e) {
    library = [];
  }
  renderLibrary();
}

function renderLibrary() {
  if (!els['lib-body']) return;
  els['lib-count'].textContent = `${library.length} film${library.length === 1 ? '' : 's'}`;
  if (!library.length) {
    els['lib-body'].innerHTML = `
      <div class="library-empty">
        <div class="big-glyph">${iconHtml('film', 26)}</div>
        <h3>No films yet</h3>
        <p>Exports land here with their source and poster. Render your first scene to start the shelf.</p>
        <button class="btn primary small" id="lib-empty-create">${iconHtml('spark', 14)} Write a first scene</button>
      </div>`;
    const button = document.getElementById('lib-empty-create');
    if (button) button.addEventListener('click', () => openAiSheet('generate'));
    return;
  }
  els['lib-body'].innerHTML = library
    .map(
      (item) => `
      <button class="lib-item" data-id="${escapeHtml(item.id)}">
        <span class="lib-thumb">
          ${item.poster ? `<img src="/media/${encodeURIComponent(item.poster)}" alt="" loading="lazy">` : ''}
          <span class="play-mini">${iconHtml('play', 16)}</span>
        </span>
        <span class="lib-info">
          <span class="lib-title">${escapeHtml(item.title)}</span>
          <span class="lib-meta">${item.width}×${item.height} · ${item.fps}fps · ${Number(item.duration).toFixed(1)}s · ${formatBytes(item.bytes)}</span>
          <span class="lib-date">${formatDate(item.createdAt)}</span>
        </span>
        <span class="lib-chev">${iconHtml('chevronRight', 15)}</span>
      </button>`
    )
    .join('');
  els['lib-body'].querySelectorAll('.lib-item').forEach((node) => {
    node.addEventListener('click', () => {
      const item = library.find((entry) => entry.id === node.dataset.id);
      if (item) openVideo(item);
    });
  });
}

function openVideo(item) {
  currentVideo = item;
  const url = item.url || `/media/${item.file}`;
  els['video-title'].textContent = item.title;
  els['video-el'].src = url;
  els['video-el'].poster = item.posterUrl || (item.poster ? `/media/${item.poster}` : '');
  els['video-meta'].innerHTML = `
    <span>${item.width} × ${item.height}</span>
    <span>${item.fps} fps</span>
    <span>${Number(item.duration).toFixed(1)}s</span>
    <span>${formatBytes(item.bytes)}</span>
    <span>${QUALITY_LABEL[item.quality] || item.quality}</span>`;
  openSheet('sheet-video');
}

function downloadItem(item) {
  const url = item.url || `/media/${item.file}`;
  const base = (item.title || 'motion-studio')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'motion-studio';
  downloadFile(url, `${base}-${item.width || ''}x${item.height || ''}.mp4`);
}

async function openVideoCode() {
  if (!currentVideo) return;
  try {
    const response = await fetch(`/api/library/${encodeURIComponent(currentVideo.id)}/source`, {
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Source not found');
    const source = await response.text();
    state.title = currentVideo.title;
    state.duration = clamp(Math.round(currentVideo.duration || state.duration), 2, 30);
    state.fps = [30, 60].includes(currentVideo.fps) ? currentVideo.fps : state.fps;
    if (currentVideo.aspect && DESIGNS[currentVideo.aspect]) state.aspect = currentVideo.aspect;
    saveSoon();
    closeSheet();
    applyDesign();
    setCode(source);
    syncChrome();
    syncSettings();
    showView('code');
    toast('Source opened.');
  } catch (error) {
    toast('Could not open that source.');
  }
}

/* ---------------------------------------------------------------- presets */

function openPresets() {
  renderPresets();
  openSheet('sheet-presets');
}

function renderPresets() {
  els['preset-grid'].innerHTML = PRESETS.map(
    (preset) => `
    <button class="preset-card" data-preset="${preset.id}">
      ${presetArtHtml(preset)}
      <div class="preset-meta">
        <div class="preset-name">${escapeHtml(preset.name)}</div>
        <div class="preset-sub">${escapeHtml(preset.sub)}</div>
      </div>
    </button>`
  ).join('');
  els['preset-grid'].querySelectorAll('[data-preset]').forEach((card) => {
    card.addEventListener('click', () => selectPreset(card.dataset.preset));
  });
}

async function selectPreset(id) {
  const preset = PRESETS.find((item) => item.id === id);
  if (!preset) return;
  try {
    const html = await loadPreset(id);
    state.title = preset.name;
    state.duration = preset.duration;
    state.fps = 60;
    saveSoon();
    closeSheet();
    setCode(html, { playAfter: true });
    syncChrome();
    syncSettings();
    applyDesign();
    showView('create');
    toast(`“${preset.name}” loaded.`);
  } catch (error) {
    toast('Could not load that preset.');
  }
}

/* ---------------------------------------------------------------- settings bindings */

function bindSettings() {
  els['set-aspect'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (button) {
      changeAspect(button.dataset.value);
      syncSettings();
    }
  });
  els['set-resolution'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    state.resolution = button.dataset.value;
    saveSoon();
    syncSettings();
  });
  els['set-fps'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    state.fps = Number(button.dataset.value);
    saveSoon();
    syncChrome();
    syncSettings();
  });
  els['set-quality'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    state.quality = button.dataset.value;
    saveSoon();
    syncSettings();
  });
  els['set-duration'].addEventListener('input', (event) => {
    state.duration = clamp(Number(event.target.value) || 10, 2, 30);
    saveSoon();
    if (preview) {
      preview.setDuration(state.duration);
      if (preview.t > state.duration * 1000) preview.seek(state.duration * 1000);
    }
    syncChrome();
    syncSettings();
    onPreviewTime(preview ? preview.t : 0);
  });
  els['set-guides'].addEventListener('click', () => {
    state.guides = !state.guides;
    saveSoon();
    syncSettings();
  });
  els['set-render'].addEventListener('click', openRenderSheet);
  els['set-ai-test'].addEventListener('click', () => runAiTest({ manual: true }));
  els['set-ai-write'].addEventListener('click', () => openAiSheet(state.code.trim() ? 'edit' : 'generate'));
  els['set-model'].addEventListener('click', openModelSheet);
  els['btn-install'].addEventListener('click', async () => {
    if (installEvent) {
      installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice?.outcome === 'accepted') toast('Installing Motion Studio…');
      installEvent = null;
    } else {
      toast('Use the browser menu and choose “Add to Home Screen”.', { duration: 6000 });
    }
  });
  els['btn-reset'].addEventListener('click', () => {
    openConfirm(
      'Reset this workspace?',
      'The current scene, name and stage settings on this device are cleared. Your rendered library stays on the server.',
      async () => {
        localStorage.removeItem(STORE_KEY);
        state.title = DEFAULT_TITLE;
        state.code = '';
        state.duration = 10;
        state.fps = 60;
        state.aspect = '9:16';
        state.resolution = '1080';
        state.quality = 'high';
        state.guides = false;
        state.strict = true;
        state.direction = 'editorial';
        state.model = '';
        state.mode = 'generate';
        editor.setValue('', { silent: true });
        applyDesign();
        syncEverything();
        refreshDirectionsSafe();
        await refreshPreview();
        toast('Workspace reset.');
      }
    );
  });
}

async function refreshDirectionsSafe() {
  const list = await aiDirections();
  if (list.length) {
    directions = [...list, { id: 'random', name: 'Random', palette: ['#85827a', '#b0563a', '#2f6b4f'] }];
    renderDirections();
  }
}

/* ---------------------------------------------------------------- health / about */

async function refreshServerHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    health = await response.json();
  } catch (e) {
    health = null;
  }
  renderAbout();
}

function renderAbout() {
  if (!els['about-lines']) return;
  const rows = [
    ['Chrome', health?.chrome || 'not detected'],
    ['ffmpeg', health?.ffmpeg || 'not detected'],
    ['Node', health?.node || '—'],
    ['Storage', 'this machine · local files'],
    ['Gemini key', overview.configured ? 'server side · .env' : 'not configured'],
    ['AI state', overview.checking ? 'checking…' : overview.ok ? 'connected' : overview.error || 'offline']
  ];
  els['about-lines'].innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="row"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value)).slice(0, 46)}</b></div>`
    )
    .join('');
}

/* ---------------------------------------------------------------- toast */

function toast(message, { action, actionLabel, duration = 4200 } = {}) {
  if (!message) return;
  const wrap = els['toast-wrap'];
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<span class="msg">${escapeHtml(message)}</span>`;
  if (action) {
    const button = document.createElement('button');
    button.textContent = actionLabel || 'Open';
    button.addEventListener('click', () => {
      action();
      node.remove();
      syncToastWrap();
    });
    node.appendChild(button);
  }
  const close = document.createElement('button');
  close.className = 'x';
  close.setAttribute('aria-label', 'Dismiss');
  close.innerHTML = iconHtml('close', 13);
  close.addEventListener('click', () => {
    node.remove();
    syncToastWrap();
  });
  node.appendChild(close);
  wrap.appendChild(node);
  wrap.classList.add('on');
  setTimeout(() => {
    node.remove();
    syncToastWrap();
  }, duration);
}

function syncToastWrap() {
  const wrap = els['toast-wrap'];
  if (!wrap.children.length) wrap.classList.remove('on');
}

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    Boolean(target.closest('.cm-editor'))
  );
}

/* ---------------------------------------------------------------- misc */

boot();

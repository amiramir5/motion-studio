import crypto from 'node:crypto';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT = 20000;
const IDLE_TIMEOUT = 30000;
const TOTAL_TIMEOUT = 170000;

export const DIRECTIONS = {
  editorial: {
    name: 'Editorial / Swiss',
    blurb: 'Paper, ink, one signal colour. Tight grotesque, rules, asymmetric grid.',
    palette: ['#F2EEE5', '#111110', '#E23D28'],
    prompt:
      'Editorial Swiss modernism. Warm paper (#F2EEE5), ink (#111110), one signal colour such as vermilion (#E23D28) or international blue. Tight grotesque type, extreme scale contrast, thin rules, generous negative space, an asymmetric grid. Motion should feel like a printed page being typeset in space: masks, line reveals, precise offsets, no decoration.'
  },
  brutalist: {
    name: 'Type Brutalist',
    blurb: 'Oversized grotesque, hard crops, marquees, zeros and ones as architecture.',
    palette: ['#0B0B0B', '#EFE9DD', '#D7FF3F'],
    prompt:
      'Brutalist typography. Black, bone white and one acid accent. Oversized grotesque or compressed type, hard crops, marquees, stacked slabs, numbers used as architecture. Abrupt but musical timing with hard cuts and long holds. No rounded cards, no soft shadows, no decoration.'
  },
  riso: {
    name: 'Riso Print',
    blurb: 'Two flat inks, misregistration, halftone dots, warm paper and grain.',
    palette: ['#F4E8D6', '#E1482F', '#1E3A8A'],
    prompt:
      'Contemporary risograph print. Warm paper, two or three flat inks with deliberate misregistration (tomato, ultramarine, warm grey), halftone dots, grain, bold cut-paper shapes and hand-set type. Overprint with mix-blend-mode. Tactile and warm, never glossy. No gradients.'
  },
  blueprint: {
    name: 'Technical Blueprint',
    blurb: 'Hairline rules, measurement ticks, monospace labels, drawn SVG paths.',
    palette: ['#0E1B2A', '#E8E2D6', '#5BC0BE'],
    prompt:
      'Technical drawing and instrument-panel language. Deep ink or bone background, hairline rules, measurement ticks, monospace annotations, small caps, diagrams and SVG paths. Reveal a system: strokes draw, coordinates tick, labels track. Restrained single accent. Precise, engineered, calm.'
  },
  organic: {
    name: 'Organic Modern',
    blurb: 'Clay, moss and bone; serif display, arcs, grain, slow breathing motion.',
    palette: ['#E9E1D4', '#3E4A3D', '#B0563A'],
    prompt:
      'Organic modernism with an art-book feel. Muted earth palette (clay, moss, bone, charcoal), a high-contrast serif display paired with a grotesque, arcs, soft circles, paper grain. Slow breathing motion with long eases, layered depth, quiet confidence. No neon, no glass, no gradients.'
  },
  cinema: {
    name: 'Cinematic Mono',
    blurb: 'Near-black, warm white, one amber accent, graphic light, slow parallax.',
    palette: ['#0B0B0C', '#F2E9DC', '#D9A441'],
    prompt:
      'Cinematic monochrome. Near-black, warm white, a single amber accent. Full-bleed compositions, big quiet type, graphic light and shadow built from flat shapes (never glows), slow parallax, precise cuts. Title-sequence energy. 2.39:1 attitude even in a vertical frame.'
  },
  constructivist: {
    name: 'Constructivist',
    blurb: 'Diagonal axes, heavy geometry, condensed type, red and black.',
    palette: ['#EFE9DD', '#0D0D0D', '#C8102E'],
    prompt:
      'Constructivist poster language. Off-white, black and red. Diagonal axes, heavy geometric blocks, condensed type, numbers, arrows. Build the frame like a machine: parts enter on strong vectors, lock into a grid, then break. Bold political-poster energy, but contemporary and refined.'
  },
  minimal: {
    name: 'Quiet Minimal',
    blurb: 'One idea per frame, extreme space, long holds, tiny precise moves.',
    palette: ['#F3F1EB', '#191919', '#8C9A7C'],
    prompt:
      'Quiet minimalism with unusual proportions. Bone, graphite and one muted accent. One idea per frame: a line, a number, a word. Extreme negative space, thoughtful typography and long holds punctuated by tiny precise moves. Nothing decorative.'
  }
};

const SURPRISE = [
  'A typographic countdown to the last train home, using only numbers, rules and a single moving line.',
  'The life cycle of a paper airplane told in six cuts: fold, throw, glide, stall, land, unfold.',
  'A field guide to silence: three words arriving slowly, interrupted by one loud geometric event.',
  'A museum label for an imaginary object called "The Everyday Sun".',
  'An index of small weather: wind, rain, heat, fog — each as a different type treatment.',
  'A love letter written in timestamps and coordinates.',
  'The rules of a game that does not exist, numbered and typeset like a manifesto.',
  'A study of a single square: it divides, rotates, becomes a window, a page, a horizon.'
];

export class AiError extends Error {
  constructor(message, code = 'AI_ERROR', retryable = false, status = 0) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function apiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

export function aiConfigured() {
  return Boolean(apiKey());
}

function authHeaders(extra) {
  return { 'x-goog-api-key': apiKey(), ...extra };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mapHttpError(status, body) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || '';
  } catch (e) {
    detail = String(body || '').slice(0, 300);
  }
  const lower = detail.toLowerCase();
  if (status === 401 || status === 403 || lower.includes('api key not valid') || lower.includes('api_key_invalid')) {
    return new AiError('API key is not valid or lacks access to this model.', 'INVALID_KEY', false, status);
  }
  if (status === 404) {
    return new AiError(detail || 'Model not found.', 'MODEL_NOT_FOUND', false, status);
  }
  if (status === 429) {
    return new AiError('Rate limit reached. Retrying shortly.', 'RATE_LIMIT', true, status);
  }
  if (status >= 500) {
    return new AiError(detail || 'The AI service is temporarily unavailable.', 'UPSTREAM', true, status);
  }
  if (lower.includes('thinking')) {
    return new AiError(detail || 'Thinking configuration rejected.', 'THINKING_CONFIG', false, status);
  }
  return new AiError(detail || `AI request failed (${status}).`, 'AI_HTTP', status >= 500, status);
}

async function readJson(response) {
  const text = await response.text();
  if (!response.ok) throw mapHttpError(response.status, text);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AiError('Malformed response from AI service.', 'BAD_JSON', true, response.status);
  }
}

let modelCache = { at: 0, models: [] };

export async function listModels(force = false) {
  if (!aiConfigured()) {
    throw new AiError('No Gemini API key configured. Add GEMINI_API_KEY to .env.', 'NO_KEY', false);
  }
  if (!force && modelCache.models.length && Date.now() - modelCache.at < 5 * 60 * 1000) {
    return modelCache.models;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE}/models?pageSize=200`, {
      headers: authHeaders(),
      signal: controller.signal
    });
    const data = await readJson(response);
    const models = (data.models || [])
      .filter((m) => {
        const methods = m.supportedGenerationMethods || [];
        return methods.includes('generateContent') && /gemini/i.test(m.name || '');
      })
      .map((m) => ({
        id: String(m.name || '').replace(/^models\//, ''),
        name: m.displayName || String(m.name || '').replace(/^models\//, ''),
        description: m.description || '',
        inputLimit: m.inputTokenLimit || null,
        outputLimit: m.outputTokenLimit || null
      }));
    models.sort((a, b) => {
      const score = (m) => {
        const id = m.id.toLowerCase();
        let s = 0;
        if (id.includes('flash') && !id.includes('lite')) s += 30;
        if (id.includes('lite')) s -= 4;
        if (/-latest$/.test(id)) s -= 8;
        if (/preview|experimental/.test(id)) s -= 10;
        if (id.includes('pro')) s += 5;
        const version = id.match(/(\d+)[._-](\d+)/);
        if (version) s += Number(version[1]) * 2 + Number(version[2]);
        if (/image|tts|embedding|audio|live|omni|veo|imagen/.test(id)) s -= 100;
        return s;
      };
      return score(b) - score(a);
    });
    modelCache = { at: Date.now(), models };
    return models;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AiError('Could not reach Gemini (timeout).', 'NETWORK', true);
    }
    if (error instanceof AiError) throw error;
    throw new AiError(`Could not reach Gemini: ${error.message}`, 'NETWORK', true);
  } finally {
    clearTimeout(timer);
  }
}

const GOOD_TTL = 10 * 60 * 1000;
const PREFERRED_MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
let lastGoodModel = { id: '', at: 0 };

function isUsableModel(id) {
  return !/image|tts|embedding|audio|live|omni|veo|imagen|computer[-_]?use|robotics/i.test(id);
}

function preferredModel(models) {
  for (const id of PREFERRED_MODELS) {
    if (models.some((m) => m.id === id)) return id;
  }
  return '';
}

export async function resolveModel(requested) {
  if (requested && requested.trim()) return requested.trim();
  if (process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim()) {
    return process.env.GEMINI_MODEL.trim();
  }
  if (lastGoodModel.id && Date.now() - lastGoodModel.at < GOOD_TTL) {
    return lastGoodModel.id;
  }
  try {
    const models = await listModels();
    const preferred = preferredModel(models);
    if (preferred) return preferred;
    const usable = models.filter((m) => isUsableModel(m.id));
    const full = usable.filter((m) => !/lite/i.test(m.id));
    const pool = full.length ? full : usable;
    const flash = pool.find((m) => /flash/i.test(m.id));
    if (flash) return flash.id;
    if (pool[0]) return pool[0].id;
  } catch (e) {}
  return 'gemini-2.5-flash';
}

export async function getHealth() {
  if (!aiConfigured()) {
    return {
      configured: false,
      ok: false,
      error: 'No API key. Add GEMINI_API_KEY to .env and restart.',
      retryable: false
    };
  }
  const started = Date.now();
  try {
    const models = await listModels();
    return {
      configured: true,
      ok: true,
      latencyMs: Date.now() - started,
      modelCount: models.length,
      defaultModel: await resolveModel(''),
      models: models.slice(0, 12)
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - started,
      error: error.message,
      code: error.code || 'NETWORK',
      retryable: Boolean(error.retryable)
    };
  }
}

function buildSystem({ width, height, aspect, duration, fps, direction }) {
  return `You are MOTION/STUDIO, a world-class motion designer and creative front-end engineer. You create short motion-graphics films as a single self-contained HTML document.

OUTPUT CONTRACT
Return ONLY one complete HTML file, starting with <!DOCTYPE html>. No markdown fences, no explanations, no comments about yourself. The file must contain all CSS and JS inline. No build tools, no frameworks, no bundler.
The viewport is exactly ${width}x${height} CSS pixels (${aspect}). Render edge to edge at that size. The video is exactly ${duration} seconds at ${fps} fps and is exported frame by frame, deterministically. It is a film frame, not an interactive page.
Do not include navigation bars, buttons, forms, close icons, footers, "click" instructions, browser chrome, or UI that belongs to an app. Do not rely on hover, click, focus, audio, video files, cameras, or network APIs. No external JavaScript. External Google Fonts are allowed and should be loaded with a <link>; always provide a strong fallback stack.
Never use placeholders such as "Lorem ipsum". Write short, specific, well-set copy. Every text block must be grammatical and intentional.

TIME
Design the full timeline from 0.000s to ${duration}.000s. Give the piece a strong first frame, an intentional build with staggered entrances, a turn or climax, and a composed final frame that holds. Do not loop infinitely in a way that makes the last frame random. Animation must be continuous and visible at a glance, not elements popping in one after another. Use custom cubic-bezier easing, masks, clip-path, transforms, opacity, staggered delays and precise holds.
Animate with CSS keyframes, the Web Animations API, or requestAnimationFrame. For 60 fps, animate transform and opacity; avoid layout thrash, giant blurs, filters on large areas, and hundreds of animated nodes. Keep the DOM under ~150 nodes.

ART DIRECTION
${direction.prompt}
The palette, typography and composition must feel authored by a human art director. Choose a maximum of one display face and one text face. Use a deliberate type scale, optical alignment, tracking and line-height. Use 2-3 colours plus paper/ink. Build depth with scale, cropping, layering, rules, texture and motion — not decoration.

HARD NEGATIVES
No linear-gradient, radial-gradient or conic-gradient. No neon, glow, bloom or luminous shadows. No glassmorphism or backdrop-filter. No purple-blue "AI" palette. No generic centered SaaS hero with floating cards. No floating 3D blobs or orbs. No emoji. No stock photography. No generic "modern gradient" backgrounds. If you need texture, draw it with CSS/SVG: halftone dots, grain, rules, grids, flat shapes.
If the brief pushes you toward a cliché, find a more specific, surprising formal idea instead. Be a designer, not a template.

CRAFT
Compose within a safety margin of at least 5% of the frame. Check that text does not collide at any keyframe. Use readable contrast. Let one element dominate; keep the rest quiet. The final frame should look like a poster on its own.

Return only the HTML document.`;
}

function buildUserPrompt({ mode, prompt, code, width, height, aspect, duration, fps, direction }) {
  const base =
    `Make a ${duration}-second ${aspect} motion-graphics film (${width}x${height}, ${fps} fps).\n` +
    `Brief: ${prompt || 'Surprise me with a strong, original motion-design idea.'}\n` +
    `Art direction: ${direction.name}. ${direction.blurb}\n` +
    `Return the complete HTML document only.`;

  if (mode === 'edit') {
    return `Revise the existing motion piece below.\n\nRequested change: ${prompt}\n\nRules: keep the stage ${width}x${height}, the ${duration}s duration, the ${fps} fps stage and everything the request does not ask to change. Preserve the art direction. Return the complete revised HTML document only, no commentary.\n\nCURRENT DOCUMENT:\n${code}`;
  }
  if (mode === 'extract') {
    return `This document may have been written as a web page and can contain navigation, panels, social buttons, footers or other chrome that does not belong in a film.\n\nRefactor it into a pure full-bleed ${aspect} motion piece at ${width}x${height}:\n- identify the primary animated scene and keep it,\n- remove all page chrome, unrelated UI, buttons and borders,\n- recompose the scene to fill the frame without distortion or stretching,\n- preserve the character and timing of the original animation,\n- remove any gradients, glows, glass or neon styling.\nReturn the complete revised HTML document only.\n\nSOURCE DOCUMENT:\n${code}`;
  }
  return base;
}

function thinkingConfig(model) {
  if (process.env.GEMINI_THINKING === 'auto') return null;
  if (/pro/i.test(model)) return null;
  return { thinkingBudget: 0 };
}

function bodyFor({ model, system, prompt, maxOutputTokens = 30000, temperature = 1 }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      topP: 0.95,
      maxOutputTokens,
      responseMimeType: 'text/plain'
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };
  const thinking = thinkingConfig(model);
  if (thinking) body.generationConfig.thinkingConfig = thinking;
  return body;
}

async function streamOnce({ model, system, prompt, maxOutputTokens, temperature, signal, onDelta }) {
  if (!aiConfigured()) {
    throw new AiError('No Gemini API key configured. Add GEMINI_API_KEY to .env.', 'NO_KEY', false);
  }
  const controller = new AbortController();
  let timedOut = false;
  let connected = false;
  let idleTimer = null;
  let totalTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TOTAL_TIMEOUT);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(totalTimer);
      throw new AiError('Cancelled', 'CANCELLED', false);
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, connected ? IDLE_TIMEOUT : REQUEST_TIMEOUT);
  };

  armIdle();
  let text = '';
  let usage = null;
  let finishReason = null;

  try {
    const response = await fetch(
      `${API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(bodyFor({ model, system, prompt, maxOutputTokens, temperature })),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw mapHttpError(response.status, errorText);
    }
    connected = true;
    armIdle();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      let boundary = -1;
      let separatorLength = 2;
      while (true) {
        const lf = buffer.indexOf('\n\n');
        const crlf = buffer.indexOf('\r\n\r\n');
        if (lf === -1 && crlf === -1) break;
        if (lf !== -1 && (crlf === -1 || lf < crlf)) {
          boundary = lf;
          separatorLength = 2;
        } else {
          boundary = crlf;
          separatorLength = 4;
        }
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separatorLength);
        if (!rawEvent.trim()) continue;
        const dataLines = rawEvent
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());
        if (!dataLines.length) continue;
        const payload = dataLines.join('\n');
        if (payload === '[DONE]') continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        if (parsed.promptFeedback?.blockReason) {
          throw new AiError(
            `The idea was blocked by the safety filter (${parsed.promptFeedback.blockReason}). Try a different brief.`,
            'BLOCKED',
            false
          );
        }
        const candidate = parsed.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (part.thought) continue;
          if (typeof part.text === 'string' && part.text) {
            text += part.text;
            onDelta(part.text);
          }
        }
        if (parsed.usageMetadata) usage = parsed.usageMetadata;
      }
    }
    return { text, usage, finishReason };
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error.name === 'AbortError') {
      if (signal?.aborted) throw new AiError('Cancelled', 'CANCELLED', false);
      throw new AiError(
        timedOut ? 'The AI service stopped responding. Retrying.' : 'The AI request was interrupted.',
        'TIMEOUT',
        true
      );
    }
    throw new AiError(`Connection to Gemini failed: ${error.message}`, 'NETWORK', true);
  } finally {
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

const cache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > 24) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

async function streamWithRetry(options, handlers) {
  const maxAttempts = 3;
  let lastError = null;
  let attempt = 0;
  let thinkingRetried = false;
  while (attempt < maxAttempts) {
    attempt++;
    if (attempt > 1) {
      const wait = 600 * Math.pow(2, attempt - 2) + Math.floor(Math.random() * 400);
      handlers.onRetry?.(attempt, lastError?.message || 'Connection lost');
      await sleep(wait);
    }
    let received = false;
    try {
      const result = await streamOnce({
        ...options,
        onDelta: (chunk) => {
          if (!received) {
            received = true;
            handlers.onFirstDelta?.();
          }
          handlers.onDelta(chunk);
        }
      });
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (error.code === 'CANCELLED') throw error;
      if (error.code === 'THINKING_CONFIG' && !thinkingRetried) {
        thinkingRetried = true;
        process.env.GEMINI_THINKING = 'auto';
        attempt--;
        continue;
      }
      if (!error.retryable || attempt === maxAttempts) throw error;
      if (received) {
        handlers.onReset?.(attempt);
      }
    }
  }
  throw lastError || new AiError('AI request failed.', 'AI_ERROR', true);
}

export function lintDesign(code) {
  const source = String(code || '');
  const violations = [];
  if (/(?:linear|radial|conic)-gradient\s*\(/i.test(source)) {
    violations.push('gradient fills');
  }
  if (/(?:-webkit-)?backdrop-filter\s*:/i.test(source)) {
    violations.push('glassmorphism');
  }
  if (
    /(?:text-shadow|box-shadow)\s*:[^;{}]*0\s+0\s+(?:[2-9]\d|[1-9]\d{2,})px[^;{}]*(?:rgba?\(|hsla?\(|#[0-9a-f]{3,8})/i.test(
      source
    )
  ) {
    violations.push('neon glow');
  }
  if (/lorem\s+ipsum/i.test(source)) {
    violations.push('placeholder copy');
  }
  if (/#(?:a855f7|8b5cf6|6366f1|7c3aed|06b6d4|22d3ee|f0abfc|e879f9)\b/i.test(source)) {
    violations.push('generic AI palette');
  }
  return violations;
}

function cleanOutput(text) {
  let out = String(text || '').trim();
  out = out.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const htmlStart = out.search(/<!doctype html|<html[\s>]/i);
  if (htmlStart > 0) {
    out = out.slice(htmlStart);
  } else if (htmlStart < 0) {
    const fragment = out.search(/<(?:style|script|div|section|main|svg)[\s>]/i);
    if (fragment > 0) out = out.slice(fragment);
  }
  const end = out.lastIndexOf('</html>');
  if (end !== -1) out = out.slice(0, end + 7);
  return out.trim();
}

function isCompleteDocument(code) {
  return /<\/html>$/i.test(String(code || '').trim());
}

export async function streamGeneration(params, handlers) {
  const {
    mode = 'generate',
    prompt = '',
    code = '',
    model: requestedModel,
    aspect = '9:16',
    width = 1080,
    height = 1920,
    fps = 60,
    duration = 10,
    direction: requestedDirection = 'editorial',
    strict = true,
    signal
  } = params;

  if (mode !== 'generate' && !String(code || '').trim()) {
    throw new AiError('There is no code to edit yet.', 'NO_CODE', false);
  }
  if (String(code || '').length > 120000) {
    throw new AiError('The document is too large to send. Trim it first.', 'TOO_LARGE', false);
  }

  let directionId = requestedDirection;
  if (!DIRECTIONS[directionId] || directionId === 'random') {
    const ids = Object.keys(DIRECTIONS);
    directionId = ids[Math.floor(Math.random() * ids.length)];
  }
  const direction = DIRECTIONS[directionId];
  const idea =
    String(prompt || '').trim() ||
    SURPRISE[Math.floor(Math.random() * SURPRISE.length)];

  const model = requestedModel || (await resolveModel(''));
  const system = buildSystem({ width, height, aspect, duration, fps, direction });
  const userPrompt = buildUserPrompt({
    mode,
    prompt: idea,
    code,
    width,
    height,
    aspect,
    duration,
    fps,
    direction
  });

  const cacheKey = hash(
    JSON.stringify({
      model,
      mode,
      idea,
      directionId,
      width,
      height,
      fps,
      duration,
      strict: Boolean(strict),
      code: mode === 'generate' ? '' : hash(String(code))
    })
  );
  const cached = cacheGet(cacheKey);
  if (cached) {
    handlers.onMeta?.({ model, cached: true, direction: directionId });
    handlers.onDelta(cached);
    handlers.onDone?.({ code: cached, model, cached: true, violations: [], usage: null });
    return;
  }

  handlers.onMeta?.({ model, cached: false, direction: directionId, attempts: 1 });

  const modelCandidates = await generationCandidates(model);
  let final = '';
  let usage = null;
  let usedModel = model;
  try {
    let incomplete = null;
    for (const candidate of modelCandidates) {
      if (candidate !== modelCandidates[0]) {
        final = '';
        handlers.onReset?.({ reason: 'model' });
        handlers.onWarning?.(`The model stopped early. Retrying with ${candidate}…`);
      }
      const first = await streamWithRetry(
        { model: candidate, system, prompt: userPrompt, maxOutputTokens: 30000, temperature: 1, signal },
        {
          onDelta: (chunk) => handlers.onDelta(chunk),
          onReset: (attempt) => {
            final = '';
            handlers.onReset?.({ attempt });
          },
          onRetry: (attempt, message) => handlers.onWarning?.(`Connection interrupted. Retry ${attempt}/3…`),
          onFirstDelta: () => handlers.onPhase?.({ phase: 'writing' })
        }
      );
      const cleaned = cleanOutput(first.text);
      usage = first.usage || usage;
      if (cleaned.length >= 40 && isCompleteDocument(cleaned)) {
        final = cleaned;
        usedModel = candidate;
        break;
      }
      incomplete = new AiError('The model returned an incomplete document. Try again.', 'TRUNCATED', true);
    }

    if (!final) {
      throw incomplete || new AiError('The model returned an empty document. Try again.', 'EMPTY', true);
    }

    let violations = lintDesign(final);
    if (violations.length && strict) {
      handlers.onViolations?.({ violations, phase: 'draft' });
      handlers.onReset?.({ reason: 'art-direction' });
      handlers.onPhase?.({ phase: 'refining', violations });
      const repairSystem = buildSystem({ width, height, aspect, duration, fps, direction });
      const repairPrompt =
        `Your previous document used ${violations.join(', ')}. Rebuild the same idea, composition and timing using only flat spot colours on paper/ink, typography, rules, flat geometry and drawn texture. Absolutely no gradients, no glow, no glass, no neon.\n` +
        `Stage: ${width}x${height}, ${duration}s, ${fps}fps. Return the complete corrected HTML document only.\n\n` +
        `PREVIOUS DOCUMENT:\n${final}`;
      const repaired = await streamWithRetry(
        { model: usedModel, system: repairSystem, prompt: repairPrompt, maxOutputTokens: 30000, temperature: 0.9, signal },
        {
          onDelta: (chunk) => handlers.onDelta(chunk),
          onReset: () => {
            final = '';
            handlers.onReset?.({ reason: 'reconnect' });
          },
          onRetry: (attempt) => handlers.onWarning?.(`Refining connection interrupted. Retry ${attempt}/3…`),
          onFirstDelta: () => handlers.onPhase?.({ phase: 'refining' })
        }
      );
      const cleaned = cleanOutput(repaired.text);
      if (cleaned.length > 40 && isCompleteDocument(cleaned)) {
        final = cleaned;
      } else {
        handlers.onWarning?.('The refined draft was incomplete, so the original was kept.');
      }
      violations = lintDesign(final);
      if (violations.length) {
        handlers.onWarning?.(`Art direction still contains: ${violations.join(', ')}. You can ask AI to refine it.`);
      } else {
        handlers.onPhase?.({ phase: 'ready' });
      }
    }

    cacheSet(cacheKey, final);
    handlers.onDone?.({
      code: final,
      model: usedModel,
      cached: false,
      violations: lintDesign(final),
      direction: directionId,
      usage
    });
  } catch (error) {
    const normalized =
      error instanceof AiError ? error : new AiError(error.message || 'AI request failed', 'AI_ERROR', true);
    if (normalized.code === 'THINKING_CONFIG') {
      process.env.GEMINI_THINKING = 'auto';
    }
    throw normalized;
  }
}

async function candidateModels(requested) {
  const primary = await resolveModel(requested || '');
  const list = [primary];
  try {
    const models = await listModels();
    const usable = models.filter((m) => isUsableModel(m.id));
    const ordered = [
      ...PREFERRED_MODELS.filter((id) => models.some((m) => m.id === id)),
      ...usable.filter((m) => !/lite/i.test(m.id)).map((m) => m.id),
      ...usable.map((m) => m.id)
    ];
    for (const id of ordered) {
      if (list.length >= 3) break;
      if (isUsableModel(id) && !list.includes(id)) list.push(id);
    }
  } catch (e) {}
  return list;
}

async function generationCandidates(model) {
  const list = [model];
  try {
    const models = await listModels();
    const usable = models.filter((m) => isUsableModel(m.id));
    const ordered = [
      ...PREFERRED_MODELS.filter((id) => models.some((m) => m.id === id)),
      ...usable.filter((m) => !/lite/i.test(m.id)).map((m) => m.id),
      ...usable.map((m) => m.id)
    ];
    for (const id of ordered) {
      if (list.length >= 2) break;
      if (isUsableModel(id) && !list.includes(id)) list.push(id);
    }
  } catch (e) {}
  return list;
}

async function testModel(chosen) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  const started = Date.now();
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8 }
  };
  const thinking = thinkingConfig(chosen);
  if (thinking) body.generationConfig.thinkingConfig = thinking;

  const send = () =>
    fetch(`${API_BASE}/models/${encodeURIComponent(chosen)}:generateContent`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: controller.signal
    });

  try {
    let response = await send();
    if (!response.ok) {
      const error = mapHttpError(response.status, await response.text());
      if (error.code === 'THINKING_CONFIG' || (response.status === 400 && body.generationConfig.thinkingConfig)) {
        delete body.generationConfig.thinkingConfig;
        response = await send();
        if (!response.ok) throw mapHttpError(response.status, await response.text());
      } else {
        throw error;
      }
    }
    const data = await readJson(response);
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || '')
      .join('')
      .trim();
    lastGoodModel = { id: chosen, at: Date.now() };
    return {
      ok: true,
      model: chosen,
      latencyMs: Date.now() - started,
      reply: text.slice(0, 80)
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AiError(`Connection timed out (${chosen}).`, 'TIMEOUT', true);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(model) {
  if (!aiConfigured()) {
    throw new AiError('No API key configured. Add GEMINI_API_KEY to .env.', 'NO_KEY', false);
  }
  const candidates = await candidateModels(model);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await testModel(candidate);
    } catch (error) {
      if (error instanceof AiError && ['NO_KEY', 'INVALID_KEY', 'CANCELLED'].includes(error.code)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError || new AiError('Could not reach Gemini.', 'NETWORK', true);
}

export function directionsForClient() {
  return Object.entries(DIRECTIONS).map(([id, value]) => ({
    id,
    name: value.name,
    blurb: value.blurb,
    palette: value.palette
  }));
}

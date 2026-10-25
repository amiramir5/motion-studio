import { postSSE, isAbort, networkError } from './sse.js';
import { sleep } from './util.js';

const BASE = 'api/ai';

function abortError() {
  const error = new Error('Cancelled.');
  error.name = 'AbortError';
  error.code = 'ABORTED';
  return error;
}

function aiErrorFrom(payload) {
  const error = new Error(payload?.message || payload?.error || 'AI request failed.');
  error.code = payload?.code || 'AI_ERROR';
  error.retryable = payload?.retryable !== false;
  return error;
}

async function json(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = { ok: false, error: text.slice(0, 200) };
  }
  return data;
}

export async function aiHealth() {
  try {
    return await json(`${BASE}/health`, { cache: 'no-store' });
  } catch (error) {
    return { configured: false, ok: false, error: error.message, code: 'NETWORK' };
  }
}

export async function aiModels(force = false) {
  try {
    const data = await json(`${BASE}/models${force ? '?force=1' : ''}`, { cache: 'no-store' });
    return data;
  } catch (error) {
    return { ok: false, models: [], error: error.message, code: 'NETWORK' };
  }
}

export async function aiDirections() {
  try {
    const data = await json(`${BASE}/directions`, { cache: 'no-store' });
    return Array.isArray(data.directions) ? data.directions : [];
  } catch (error) {
    return [];
  }
}

export async function aiTest(model) {
  const data = await json(`${BASE}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || '' })
  });
  return data;
}

async function preflight(model, handlers, signal) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (signal?.aborted) throw abortError();
    handlers.onPhase?.({ phase: attempt === 1 ? 'testing' : 'reconnecting', attempt });
    let result = null;
    try {
      result = await aiTest(model);
    } catch (error) {
      last = networkError(error);
    }
    if (result) {
      if (result.ok) {
        handlers.onMeta?.({ testLatency: result.latencyMs, testedModel: result.model });
        return result;
      }
      last = aiErrorFrom(result);
      if (last.code === 'NO_KEY' || last.code === 'INVALID_KEY') throw last;
    }
    if (attempt < 3) await sleep(attempt === 1 ? 800 : 1900);
  }
  throw last || new Error('The studio could not reach Gemini.');
}

async function stream(params, handlers, signal) {
  let done = null;
  const body = { ...params };
  delete body.signal;
  try {
    await postSSE(`${BASE}/stream`, body, {
      signal,
      onEvent: (event, payload) => {
        if (event === 'meta') handlers.onMeta?.(payload);
        else if (event === 'phase') handlers.onPhase?.(payload);
        else if (event === 'delta') handlers.onDelta?.(payload?.text || '');
        else if (event === 'reset') handlers.onReset?.(payload);
        else if (event === 'warning') handlers.onWarning?.(payload?.message || '');
        else if (event === 'violations') handlers.onViolations?.(payload);
        else if (event === 'done') done = payload;
        else if (event === 'error') throw aiErrorFrom(payload);
      }
    });
  } catch (error) {
    if (isAbort(error) || signal?.aborted) throw abortError();
    if (error && (error.code || error.retryable !== undefined)) throw error;
    throw networkError(error);
  }
  if (!done) {
    const error = new Error('The stream ended before the scene was finished. Retrying…');
    error.code = 'NETWORK';
    error.retryable = true;
    throw error;
  }
  return done;
}

export async function generate(params, handlers = {}) {
  const signal = params.signal;
  const clean = { ...params };
  delete clean.signal;

  await preflight(clean.model, handlers, signal);

  let last = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal?.aborted) throw abortError();
    try {
      return await stream(clean, handlers, signal);
    } catch (error) {
      if (isAbort(error) || signal?.aborted) throw abortError();
      last = error instanceof Error ? error : new Error(String(error));
      const retryable = last.retryable !== false && last.code !== 'NO_KEY' && last.code !== 'INVALID_KEY';
      if (attempt >= 2 || !retryable) throw last;
      handlers.onWarning?.('Connection dropped. Rebuilding the scene automatically…');
      handlers.onReset?.({ reason: 'reconnect' });
      await sleep(900);
      try {
        await preflight(clean.model, handlers, signal);
      } catch (testError) {
        last = testError;
      }
    }
  }
  throw last || new Error('AI generation failed.');
}

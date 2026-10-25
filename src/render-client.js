import { postSSE, isAbort, networkError } from './sse.js';

export async function renderFilm(params, handlers = {}, signal) {
  let done = null;
  try {
    await postSSE('/api/render', params, {
      signal,
      onEvent: (event, payload) => {
        if (event === 'job') handlers.onJob?.(payload);
        else if (event === 'queued') handlers.onQueued?.(payload);
        else if (event === 'progress') handlers.onProgress?.(payload);
        else if (event === 'done') {
          done = payload;
          handlers.onDone?.(payload);
        } else if (event === 'error') {
          const error = new Error(payload?.message || 'Render failed.');
          error.cancelled = Boolean(payload?.cancelled);
          error.id = payload?.id;
          throw error;
        }
      }
    });
  } catch (error) {
    if (isAbort(error) || signal?.aborted) {
      const aborted = new Error('Render cancelled.');
      aborted.cancelled = true;
      throw aborted;
    }
    if (error && (error.cancelled || error.status)) throw error;
    throw networkError(error);
  }
  if (!done) throw new Error('The renderer stopped before producing a file.');
  return done;
}

export async function measureFilm(params, signal) {
  let response;
  try {
    response = await fetch('api/measure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal
    });
  } catch (error) {
    if (isAbort(error) || signal?.aborted) throw networkError(error);
    throw networkError(error);
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch (e) {
    payload = null;
  }
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || 'Could not measure the film.');
  }
  return payload;
}

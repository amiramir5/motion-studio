function parseFrame(raw, onEvent) {
  const lines = raw.split(/\r?\n/);
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart();
  }
  if (!data) return;
  let payload = null;
  try {
    payload = JSON.parse(data);
  } catch (e) {
    payload = { text: data };
  }
  return onEvent(event, payload);
}

export async function postSSE(url, body, { signal, onEvent } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body || {}),
    signal
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch (e) {}
    const error = new Error(detail || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  if (!response.body) throw new Error('Streaming is not supported by this browser.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let match = buffer.match(/\r?\n\r?\n/);
    while (match && match.index !== undefined) {
      const raw = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (raw.trim()) parseFrame(raw, onEvent);
      match = buffer.match(/\r?\n\r?\n/);
    }
  }
  if (buffer.trim()) parseFrame(buffer, onEvent);
}

export function isAbort(error) {
  return Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORTED');
}

export function networkError(error) {
  if (!error) return new Error('Connection lost.');
  const message = /fetch|network|terminated|load failed|connection/i.test(error.message || '')
    ? 'Connection dropped. Reconnecting…'
    : error.message || 'Connection failed.';
  const wrapped = new Error(message);
  wrapped.code = 'NETWORK';
  wrapped.retryable = true;
  wrapped.cause = error;
  return wrapped;
}

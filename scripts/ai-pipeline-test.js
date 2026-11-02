// Offline test of the Gemini pipeline with a simulated API (no key needed).
process.env.GEMINI_API_KEY = 'AIzaTEST_TEST_TEST_TEST_TEST';
process.env.GEMINI_MODEL = '';
const { streamGeneration } = await import('../server/ai.js');
const { shutdownBrowser } = await import('../server/renderer.js');

const FILM = '<!DOCTYPE html><html><head><meta name="ms-duration" content="4"><style>body{margin:0;background:#f2eee5}</style></head><body><h1>Signal</h1></body></html>';
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  if (!url.includes('generativelanguage')) return realFetch(url, options);
  if (url.includes('/models?')) {
    return new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }
    ] }), { status: 200 });
  }
  const model = url.match(/models\/([^:]+):/)[1];
  calls.push(model);
  if (model === 'gemini-2.5-flash') {
    return new Response(JSON.stringify({ error: { message: 'models/gemini-2.5-flash is not found' } }), { status: 404 });
  }
  // Split the film across two events; the last one has no trailing blank line.
  const half = Math.floor(FILM.length / 2);
  const ev = (text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}`;
  return new Response(`${ev(FILM.slice(0, half))}\r\n\r\n${ev(FILM.slice(half))}`, { status: 200 });
};

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const run = (nonce) => new Promise((resolve, reject) => {
  const out = { text: '', warnings: [] };
  streamGeneration({ prompt: 'a test', model: 'gemini-2.5-flash', duration: 6, nonce, direction: 'editorial' }, {
    onDelta: (t) => { out.text += t; },
    onReset: () => { out.text = ''; },
    onWarning: (m) => out.warnings.push(m),
    onDone: (done) => resolve({ ...out, done })
  }).catch(reject);
});

try {
  const first = await run('a');
  check('falls back to another model when the first is missing', first.done.model === 'gemini-3.5-flash');
  check('keeps the final event that had no trailing blank line', first.done.code.endsWith('</html>'));
  check('reads the declared duration', first.done.duration === 4);
  const before = calls.length;
  const retry = await run('a');
  check('an automatic retry with the same nonce reuses the result', retry.done.cached === true && calls.length === before);
  const fresh = await run('b');
  check('a new request (new nonce) generates a fresh take', fresh.done.cached === false && calls.length > before);
} finally {
  await shutdownBrowser();
}
process.exit(failed ? 1 : 0);

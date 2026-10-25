const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob: https:",
  "media-src data: blob: https:",
  "connect-src 'none'",
  "worker-src blob:",
  "object-src 'none'",
  "form-action 'none'"
].join('; ');

function headExtras(runtimeSource, useCsp) {
  const charset = '<meta charset="utf-8">';
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  const csp = useCsp
    ? `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
    : '';
  const runtime = `<script>${String(runtimeSource).replace(/<\/script/gi, '<\\/script')}</script>`;
  return charset + viewport + csp + runtime;
}

/**
 * Wrap a user's HTML/CSS/JS into a complete document with the deterministic
 * clock installed before any user script runs.
 */
export function composeDocument(code, runtimeSource, { csp = true } = {}) {
  let doc = String(code || '').trim();
  const extras = headExtras(runtimeSource, csp);

  if (!doc) {
    doc = '<!DOCTYPE html><html><head></head><body></body></html>';
  }

  const hasHtml = /<html[\s>]/i.test(doc);
  const hasHead = /<head[\s>]/i.test(doc);
  const hasBody = /<body[\s>]/i.test(doc);

  if (hasHtml) {
    if (hasHead) {
      doc = doc.replace(/<head[^>]*>/i, (m) => m + extras);
    } else {
      doc = doc.replace(/<html[^>]*>/i, (m) => m + `<head>${extras}</head>`);
    }
    if (!/<!doctype/i.test(doc)) doc = '<!DOCTYPE html>' + doc;
  } else if (hasHead || hasBody) {
    if (hasHead) {
      doc = doc.replace(/<head[^>]*>/i, (m) => m + extras);
    } else {
      doc = doc.replace(/<body[^>]*>/i, (m) => `<head>${extras}</head>${m}`);
    }
    doc = '<!DOCTYPE html><html>' + doc + '</html>';
  } else {
    doc = `<!DOCTYPE html><html><head>${extras}</head><body>${doc}</body></html>`;
  }

  if (!/<\/body>/i.test(doc)) doc = doc.replace(/<\/html>/i, '</body></html>');
  if (!/<\/html>/i.test(doc)) doc += '</html>';
  return doc;
}

export function isFullDocument(code) {
  return /<html[\s>]|<!doctype/i.test(code || '');
}

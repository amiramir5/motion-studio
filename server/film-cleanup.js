const CONTROL_TAGS = ['button', 'nav', 'form', 'select', 'textarea', 'label', 'dialog', 'menu'];
const VOID_TAGS = new Set(['input']);
const ROLE_HOSTS = ['div', 'span', 'section', 'article', 'aside'];
const ROLE_PATTERN = /role\s*=\s*["']?(?:button|navigation|menu|menubar|toolbar|dialog)\b/i;
const LINK_PATTERN = /\bhref\s*=|\bonclick\s*=|\brole\s*=\s*["']?button/i;
const EVENT_PATTERN =
  /\s+on(?:click|dblclick|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend|keydown|keyup|submit|change)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

function inRawText(source, index) {
  const before = source.slice(0, index).toLowerCase();
  const scriptOpen = before.lastIndexOf('<script');
  const scriptClose = before.lastIndexOf('</script');
  if (scriptOpen > scriptClose) return true;
  const styleOpen = before.lastIndexOf('<style');
  const styleClose = before.lastIndexOf('</style');
  return styleOpen > styleClose;
}

function tagEnd(source, index) {
  let quote = '';
  for (let i = index; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
  }
  return -1;
}

function collectMarkers(openTag) {
  const ids = [];
  const classes = [];
  const idMatch = openTag.match(/\bid\s*=\s*["']([^"']+)["']/i);
  if (idMatch) ids.push(idMatch[1].trim());
  const classMatch = openTag.match(/\bclass\s*=\s*["']([^"']+)["']/i);
  if (classMatch) {
    classMatch[1]
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => classes.push(value));
  }
  return { ids, classes };
}

function removeTagOccurrences(source, tagName, predicate) {
  let out = source;
  let removed = 0;
  const ids = [];
  const classes = [];
  let from = 0;
  const openPattern = new RegExp(`<${tagName}(?=[\\s/>])`, 'ig');
  while (from < out.length) {
    openPattern.lastIndex = from;
    const match = openPattern.exec(out);
    if (!match) break;
    if (inRawText(out, match.index)) {
      from = match.index + 1;
      continue;
    }
    const end = tagEnd(out, match.index);
    if (end < 0) break;
    const openTag = out.slice(match.index, end);
    if (predicate && !predicate(openTag)) {
      from = end;
      continue;
    }
    const markers = collectMarkers(openTag);
    ids.push(...markers.ids);
    classes.push(...markers.classes);
    const selfClosing = /\/\s*>$/.test(openTag) || VOID_TAGS.has(tagName);
    if (selfClosing) {
      out = out.slice(0, match.index) + out.slice(end);
      removed++;
      from = match.index;
      continue;
    }
    let depth = 1;
    let closeEnd = -1;
    const tokenPattern = new RegExp(`<(/?)${tagName}(?=[\\s>])[^>]*>`, 'ig');
    tokenPattern.lastIndex = end;
    let token;
    while ((token = tokenPattern.exec(out))) {
      if (token[1] === '/') depth--;
      else depth++;
      if (depth === 0) {
        closeEnd = token.index + token[0].length;
        break;
      }
    }
    if (closeEnd < 0) {
      from = end;
      continue;
    }
    out = out.slice(0, match.index) + out.slice(closeEnd);
    removed++;
    from = match.index;
  }
  return { code: out, removed, ids, classes };
}

function countMatches(source, pattern) {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

function danglingReferences(code, ids, classes) {
  const found = [];
  for (const id of new Set(ids)) {
    if (!id || id.length < 2) continue;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `getElementById\\(\\s*["']${escaped}["']|querySelector(?:All)?\\(\\s*["'][^"']*#${escaped}|#${escaped}(?![\\w-])`,
      'i'
    );
    if (pattern.test(code)) found.push(`#${id}`);
  }
  for (const cls of new Set(classes)) {
    if (!cls || cls.length < 3) continue;
    const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\.${escaped}(?![\\w-])`).test(code)) found.push(`.${cls}`);
  }
  return found.slice(0, 12);
}

export function lintFilmUi(code) {
  const source = String(code || '');
  const issues = [];
  if (/<(?:button|form|select|textarea|nav|dialog|menu)\b/i.test(source)) issues.push('controls');
  if (/<input\b/i.test(source)) issues.push('inputs');
  if (/<a(?=[\s>])[^>]*\bhref\s*=/i.test(source)) issues.push('links');
  if (/\bon(?:click|pointerdown|mousedown|touchstart)\s*=/i.test(source)) issues.push('click handlers');
  return issues;
}

export function stripFilmUi(rawCode) {
  let code = String(rawCode || '');
  const removedByTag = {};
  let removedCount = 0;
  const ids = [];
  const classes = [];

  for (const tag of CONTROL_TAGS) {
    const result = removeTagOccurrences(code, tag);
    code = result.code;
    if (result.removed) {
      removedByTag[tag] = (removedByTag[tag] || 0) + result.removed;
      removedCount += result.removed;
    }
    ids.push(...result.ids);
    classes.push(...result.classes);
  }

  const inputResult = removeTagOccurrences(code, 'input');
  code = inputResult.code;
  if (inputResult.removed) {
    removedByTag.input = inputResult.removed;
    removedCount += inputResult.removed;
  }
  ids.push(...inputResult.ids);
  classes.push(...inputResult.classes);

  const linkResult = removeTagOccurrences(code, 'a', (openTag) => LINK_PATTERN.test(openTag));
  code = linkResult.code;
  if (linkResult.removed) {
    removedByTag.a = linkResult.removed;
    removedCount += linkResult.removed;
  }
  ids.push(...linkResult.ids);
  classes.push(...linkResult.classes);

  for (const tag of ROLE_HOSTS) {
    const result = removeTagOccurrences(code, tag, (openTag) => ROLE_PATTERN.test(openTag));
    code = result.code;
    if (result.removed) {
      removedByTag[`${tag}[role]`] = result.removed;
      removedCount += result.removed;
    }
    ids.push(...result.ids);
    classes.push(...result.classes);
  }

  const eventCount = countMatches(code, EVENT_PATTERN);
  if (eventCount) {
    code = code.replace(EVENT_PATTERN, '');
    removedCount += eventCount;
  }
  const cursorCount = countMatches(code, /cursor\s*:\s*pointer\s*;?/gi);
  if (cursorCount) code = code.replace(/cursor\s*:\s*pointer\s*;?/gi, 'cursor: default;');

  return {
    code,
    removed: removedCount,
    removedByTag,
    events: eventCount,
    dangling: removedCount ? danglingReferences(code, ids, classes) : [],
    residual: lintFilmUi(code)
  };
}

export function summarizeCleanup(cleanup) {
  if (!cleanup || !cleanup.removed) return '';
  const byTag = cleanup.byTag || cleanup.removedByTag || {};
  const labels = [];
  for (const [tag, count] of Object.entries(byTag)) {
    labels.push(`${count}× ${tag}`);
  }
  return labels.slice(0, 4).join(', ');
}

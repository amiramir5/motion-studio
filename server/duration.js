const MIN_DURATION = 2;
const MAX_DURATION = 30;
const TAIL = 0.5;

export function parseDeclaredDuration(code) {
  const match = String(code || '').match(
    /<meta[^>]+name\s*=\s*["']ms-duration["'][^>]*content\s*=\s*["']([\d.]+)\s*s?["']/i
  ) || String(code || '').match(
    /<meta[^>]+content\s*=\s*["']([\d.]+)\s*s?["'][^>]*name\s*=\s*["']ms-duration["']/i
  );
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 1 || value > 40) return null;
  return value;
}

export function measurePageDuration(page) {
  return page.evaluate(() => {
    const clock = window.__MS_CLOCK__ || {};
    let end = 0;
    let indefinite = false;

    const absorb = (value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      if (value > end) end = value;
    };

    const parseClock = (raw) => {
      if (!raw) return null;
      const text = String(raw).trim();
      if (/^indefinite$/i.test(text)) return Infinity;
      const match = text.match(/^(-?[\d.]+)\s*(ms|s|min|h)?$/i);
      if (!match) return null;
      const amount = Number(match[1]);
      if (!Number.isFinite(amount)) return null;
      const unit = (match[2] || 's').toLowerCase();
      const scale = unit === 'ms' ? 0.001 : unit === 'min' ? 60 : unit === 'h' ? 3600 : 1;
      return amount * scale * 1000;
    };

    try {
      for (const animation of document.getAnimations()) {
        const timing = animation.effect?.getComputedTiming?.();
        if (!timing) continue;
        if (timing.endTime === Infinity) {
          indefinite = true;
          continue;
        }
        absorb(timing.endTime);
      }
    } catch (e) {}

    try {
      document.querySelectorAll('animate, animateTransform, animateMotion, set').forEach((node) => {
        const dur = parseClock(node.getAttribute('dur'));
        if (dur === null) return;
        if (dur === Infinity) {
          indefinite = true;
          return;
        }
        const begin = parseClock(node.getAttribute('begin')) || 0;
        if (begin === Infinity) return;
        const repeat = node.getAttribute('repeatCount');
        let cycles = 1;
        if (repeat && /indefinite/i.test(repeat)) {
          indefinite = true;
          return;
        }
        if (repeat) {
          const value = Number(repeat);
          if (Number.isFinite(value) && value > 0) cycles = value;
        }
        absorb(begin + dur * cycles);
      });
    } catch (e) {}

    if (clock.rafs && clock.rafs.size > 0 && end === 0) indefinite = true;

    return { measured: end > 0 ? end / 1000 : 0, indefinite };
  });
}

export function resolveFilmDuration({ requested = 10, declared = null, measured = 0, indefinite = false } = {}) {
  const hint = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Number(requested) || 10));
  const observed = Number(measured) || 0;
  let duration;
  let source;
  let warning = '';

  if (declared) {
    duration = declared;
    source = 'declared';
  } else if (observed >= 2.5) {
    duration = observed + TAIL;
    source = 'measured';
  } else {
    duration = hint;
    source = 'requested';
    warning = indefinite ? 'loop' : 'missing';
  }

  if (observed > duration + 0.2) {
    duration = observed;
    source = `${source}+measured`;
  }
  if (declared && observed > declared + 0.2) {
    warning = 'extended';
  }

  duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.ceil(duration * 10) / 10));
  return {
    duration: Math.round(duration * 10) / 10,
    source,
    warning,
    declared,
    measured: observed,
    indefinite
  };
}

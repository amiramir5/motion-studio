const MIN_DURATION = 2;
const MAX_DURATION = 30;
const TAIL = 0.5;
const MAX_PROBE_SECONDS = 32;
const PROBE_STEP = 1 / 30;
const QUIET_SECONDS = 1.2;

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

/**
 * Fast-forwards the film's virtual clock inside the loaded page and reports
 * when the scene actually stops moving. This catches CSS animations, timed
 * reveals and requestAnimationFrame work, not just declared metadata.
 */
export async function probePageDuration(page, options = {}) {
  const max = Number(options.max) > 0 ? Number(options.max) : MAX_PROBE_SECONDS;
  const step = Number(options.step) > 0 ? Number(options.step) : PROBE_STEP;
  const quiet = Number(options.quiet) > 0 ? Number(options.quiet) : QUIET_SECONDS;

  try {
    return await page.evaluate(
      ({ max, step, quiet }) => {
        const clock = window.__MS_CLOCK__;
        if (!clock || typeof clock.step !== 'function') {
          return { measured: 0, indefinite: false, settled: true, supported: false };
        }

        const stepMs = step * 1000;
        const limit = max * 1000;
        const quietMs = quiet * 1000;
        let lastChange = 0;
        let endless = false;
        let settled = false;

        const animationState = () => {
          let active = false;
          let infinite = false;
          try {
            for (const animation of document.getAnimations()) {
              let timing;
              try {
                timing = animation.effect?.getComputedTiming?.();
              } catch (e) {
                continue;
              }
              if (!timing) continue;
              if (timing.endTime === Infinity) {
                infinite = true;
                continue;
              }
              const end = Number(timing.endTime) || 0;
              if (!(end > 0)) continue;
              let current = 0;
              try {
                current = Number(animation.currentTime) || 0;
              } catch (e) {
                current = 0;
              }
              if (current < end) active = true;
            }
          } catch (e) {}
          return { active, infinite };
        };

        for (let t = 0; t <= limit; t += stepMs) {
          let dueTimer = false;
          try {
            for (const timer of clock.timers.values()) {
              if (timer.due <= t) {
                dueTimer = true;
                break;
              }
            }
          } catch (e) {}
          let rafsBefore = 0;
          try {
            rafsBefore = clock.rafs.size;
          } catch (e) {}

          try {
            clock.step(t);
          } catch (e) {}

          const animation = animationState();
          if (animation.infinite) endless = true;

          const changed = dueTimer || rafsBefore > 0 || animation.active;
          if (changed) lastChange = t;

          let pending = animation.active;
          if (!pending) {
            try {
              pending = clock.timers.size > 0 || clock.rafs.size > 0;
            } catch (e) {
              pending = false;
            }
          }

          if (!pending && t - lastChange >= quietMs) {
            settled = true;
            break;
          }
        }

        return {
          measured: lastChange / 1000,
          indefinite: endless || !settled,
          settled,
          supported: true
        };
      },
      { max, step, quiet }
    );
  } catch (e) {
    return { measured: 0, indefinite: false, settled: false, supported: false, error: e.message };
  }
}

export function resolveFilmDuration({
  requested = 10,
  declared = null,
  measured = 0,
  indefinite = false,
  settled = true
} = {}) {
  const hint = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Number(requested) || 10));
  const observed = Number(measured) || 0;
  const usable = settled && observed >= 0.4;
  let duration;
  let source;
  let warning = '';

  if (declared) {
    duration = declared;
    source = 'declared';
    if (usable && observed > declared + 0.2) {
      duration = observed + TAIL;
      source = 'declared+measured';
      warning = 'extended';
    }
  } else if (usable) {
    duration = observed + TAIL;
    source = 'measured';
  } else {
    duration = hint;
    source = 'requested';
    warning = indefinite ? 'loop' : 'missing';
  }

  if (!settled && !declared && !usable) warning = warning || 'loop';

  duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.ceil(duration * 10) / 10));
  return {
    duration: Math.round(duration * 10) / 10,
    source,
    warning,
    declared,
    measured: Math.round(observed * 100) / 100,
    indefinite,
    settled
  };
}

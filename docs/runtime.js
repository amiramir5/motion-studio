/*
 * Motion Studio deterministic clock.
 * Injected before the user's document scripts. It virtualises time so the
 * exact same frame can be produced in the live preview and in the exporter.
 *
 * Preview protocol (postMessage):
 *   parent -> frame: { type: 'ms:step', t } | { type: 'ms:metrics' }
 *   frame -> parent: { type: 'ms:ready', metrics } | { type: 'ms:error', ... }
 *                    { type: 'ms:metrics', metrics }
 */
(function () {
  if (window.__MS_CLOCK__) return;

  var nativeSetTimeout = window.setTimeout.bind(window);
  var EPOCH = 1735689600000; // 2025-01-01T00:00:00Z, fixed so Date.now() is stable

  var C = {
    now: 0,
    ready: false,
    fps: 60,
    duration: 0,
    timerSeq: 1,
    rafSeq: 1,
    timers: new Map(),
    rafs: new Map(),
    animStart: new WeakMap(),
    errors: [],
    steps: 0
  };
  window.__MS_CLOCK__ = C;

  // A fixed seed makes layouts that use randomness reproducible.
  var seed = 0x9e3779b9;
  Math.random = function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  var NativeDate = Date;
  NativeDate.now = function () {
    return EPOCH + Math.floor(C.now);
  };

  var nativeNow = performance.now.bind(performance);
  performance.now = function () {
    return C.now;
  };

  function reportError(err) {
    var message = '';
    var stack = '';
    try {
      if (err && err.stack) {
        message = err.message || String(err);
        stack = err.stack;
      } else {
        message = String(err);
      }
    } catch (e) {
      message = 'Unknown error';
    }
    if (C.errors.length < 8) {
      C.errors.push({ message: message, stack: stack });
    }
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'ms:error', message: message }, '*');
      } catch (e) {}
    }
  }
  C.reportError = reportError;

  window.addEventListener('error', function (e) {
    reportError(e.error || e.message || 'Script error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    reportError(e.reason || 'Unhandled rejection');
  });

  function schedule(fn, delay, args, repeat, id) {
    if (typeof fn !== 'function') {
      var src = String(fn);
      fn = function () {
        (0, eval)(src);
      };
    }
    var ms = Math.max(0, Number(delay) || 0);
    C.timers.set(id, {
      id: id,
      due: C.now + ms,
      fn: fn,
      args: args || [],
      interval: repeat ? Math.max(1, ms) : 0
    });
    return id;
  }

  window.setTimeout = function (fn, delay) {
    return schedule(fn, delay, Array.prototype.slice.call(arguments, 2), false, C.timerSeq++);
  };
  window.setInterval = function (fn, delay) {
    return schedule(fn, delay, Array.prototype.slice.call(arguments, 2), true, C.timerSeq++);
  };
  window.clearTimeout = window.clearInterval = function (id) {
    C.timers.delete(id);
  };

  window.requestAnimationFrame = function (cb) {
    var id = C.rafSeq++;
    C.rafs.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    C.rafs.delete(id);
  };

  function seekAnimations(t) {
    var list = [];
    try {
      list = document.getAnimations();
    } catch (e) {
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      try {
        var born = C.animStart.get(a);
        if (born === undefined) {
          born = t;
          C.animStart.set(a, born);
          a.pause();
          a.currentTime = 0;
        } else {
          if (a.playState !== 'paused') a.pause();
          a.currentTime = Math.max(0, t - born);
        }
      } catch (e) {}
    }
  }

  C.step = function (t) {
    C.now = Math.max(0, Number(t) || 0);
    C.steps++;

    var guard = 0;
    while (guard++ < 20000) {
      var next = null;
      C.timers.forEach(function (timer) {
        if (timer.due <= C.now) {
          if (
            !next ||
            timer.due < next.due ||
            (timer.due === next.due && timer.id < next.id)
          ) {
            next = timer;
          }
        }
      });
      if (!next) break;
      if (next.interval) next.due += next.interval;
      else C.timers.delete(next.id);
      try {
        next.fn.apply(window, next.args);
      } catch (e) {
        reportError(e);
      }
    }

    var callbacks = [];
    C.rafs.forEach(function (cb) {
      callbacks.push(cb);
    });
    C.rafs.clear();
    for (var i = 0; i < callbacks.length; i++) {
      try {
        callbacks[i](C.now);
      } catch (e) {
        reportError(e);
      }
    }

    seekAnimations(C.now);
    return true;
  };

  function metrics() {
    var de = document.documentElement;
    var body = document.body;
    var sw = Math.max(de ? de.scrollWidth : 0, body ? body.scrollWidth : 0);
    var sh = Math.max(de ? de.scrollHeight : 0, body ? body.scrollHeight : 0);
    var animations = 0;
    try {
      animations = document.getAnimations().length;
    } catch (e) {}
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollW: sw,
      scrollH: sh,
      animations: animations,
      overflowX: sw > window.innerWidth + 2,
      overflowY: sh > window.innerHeight + 2
    };
  }
  C.metrics = metrics;

  function settle() {
    var waits = [];
    try {
      if (document.fonts && document.fonts.ready) {
        waits.push(document.fonts.ready.catch(function () {}));
      }
    } catch (e) {}
    try {
      for (var i = 0; i < document.images.length; i++) {
        (function (img) {
          if (img.complete) return;
          waits.push(
            new Promise(function (resolve) {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            })
          );
        })(document.images[i]);
      }
    } catch (e) {}
    return Promise.race([
      Promise.all(waits),
      new Promise(function (resolve) {
        nativeSetTimeout(resolve, 8000);
      })
    ]);
  }

  function boot() {
    settle().then(function () {
      try {
        C.step(0);
      } catch (e) {}
      C.ready = true;
      if (window.parent && window.parent !== window) {
        try {
          window.parent.postMessage(
            { type: 'ms:ready', metrics: metrics(), errors: C.errors.slice(0, 3) },
            '*'
          );
        } catch (e) {}
      }
    });
  }

  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot);

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'ms:step') {
      try {
        C.step(data.t);
      } catch (e) {
        reportError(e);
      }
    } else if (data.type === 'ms:metrics') {
      try {
        window.parent.postMessage({ type: 'ms:metrics', metrics: metrics() }, '*');
      } catch (e) {}
    }
  });

  // Keep a handle around for debugging inside the preview.
  C.nativeNow = nativeNow;
})();

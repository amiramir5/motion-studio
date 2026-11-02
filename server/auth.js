import crypto from 'node:crypto';

// Optional password gate for hosted deployments. Set APP_PASSWORD to enable it;
// without it the studio stays open, as it always was on a local machine.
const PASSWORD = String(process.env.APP_PASSWORD || '');
const COOKIE = 'ms_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 8;
const MAX_FAILURES_TOTAL = 60;

// Files the browser fetches without cookies (the install manifest and icons).
const PUBLIC_PATHS = [/^\/login\/?$/, /^\/manifest\.webmanifest$/, /^\/icon\.svg$/, /^\/icons\/[\w.-]+\.png$/];

const failures = new Map();
let totalFailures = { count: 0, since: Date.now() };

export const authEnabled = Boolean(PASSWORD);

function sessionToken() {
  return crypto.createHmac('sha256', PASSWORD).update('motion-studio-session-v1').digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readCookie(req, name) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

function isAuthed(req) {
  return safeEqual(readCookie(req, COOKIE), sessionToken());
}

function throttled(ip) {
  const now = Date.now();
  if (now - totalFailures.since > WINDOW_MS) totalFailures = { count: 0, since: now };
  const entry = failures.get(ip);
  if (entry && now - entry.since > WINDOW_MS) failures.delete(ip);
  const current = failures.get(ip);
  return (current && current.count >= MAX_FAILURES_PER_IP) || totalFailures.count >= MAX_FAILURES_TOTAL;
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = failures.get(ip) || { count: 0, since: now };
  entry.count++;
  failures.set(ip, entry);
  totalFailures.count++;
  if (failures.size > 2000) failures.clear();
}

function loginPage({ error = '' } = {}) {
  const message = error
    ? `<p class="error" role="alert">${error}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f1efe9">
<meta name="robots" content="noindex">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg">
<title>Motion Studio · ورود</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:#f1efe9;color:#141412;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
  main{min-height:100vh;display:grid;place-items:center;padding:24px}
  form{width:100%;max-width:340px;background:#fbfaf7;border:1px solid #e2ded5;border-radius:22px;padding:28px 22px}
  .brand{font:700 13px/1 ui-monospace,monospace;letter-spacing:.08em;direction:ltr;text-align:right;margin:0 0 22px}
  .brand span{color:#e23d28}
  h1{font-size:22px;margin:0 0 6px}
  p{margin:0 0 18px;color:#6b675f;font-size:14px;line-height:1.7}
  label{display:block;font-size:13px;margin-bottom:8px}
  input{width:100%;font:inherit;font-size:16px;padding:13px 14px;border-radius:12px;border:1px solid #d6d1c6;background:#fff;direction:ltr}
  input:focus{outline:2px solid #141412;outline-offset:1px}
  button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:#141412;color:#fff;font:inherit;font-size:15px;font-weight:600}
  .error{color:#b3261e;margin:12px 0 0;font-size:13px}
  .en{direction:ltr;text-align:left;font-size:12px;color:#8a857b;margin:16px 0 0}
</style>
</head>
<body>
<main>
  <form method="post" action="login" autocomplete="on">
    <div class="brand">MOTION <span>/</span> STUDIO</div>
    <h1>ورود به استودیو</h1>
    <p>برای ادامه رمز استودیو را وارد کن.</p>
    <label for="password">رمز</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">ورود</button>
    ${message}
    <p class="en">Enter the studio password to continue.</p>
  </form>
</main>
</body>
</html>`;
}

export function installAuth(app, urlencoded) {
  if (!authEnabled) return;

  app.get('/login', (req, res) => {
    if (isAuthed(req)) return res.redirect(302, './');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(loginPage());
  });

  app.post('/login', urlencoded, (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    res.setHeader('Cache-Control', 'no-store');
    if (throttled(ip)) {
      return res.status(429).type('html').send(loginPage({ error: 'تلاش زیادی شد. ۱۵ دقیقه بعد دوباره امتحان کن.' }));
    }
    const given = String(req.body?.password || '');
    if (!safeEqual(given, PASSWORD)) {
      recordFailure(ip);
      return res.status(401).type('html').send(loginPage({ error: 'رمز درست نیست.' }));
    }
    failures.delete(ip);
    const secure = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${sessionToken()}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`
    );
    res.redirect(303, './');
  });

  app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    res.redirect(302, 'login');
  });

  app.use((req, res, next) => {
    if (PUBLIC_PATHS.some((pattern) => pattern.test(req.path)) || isAuthed(req)) return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.method !== 'GET') {
      return res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Sign in to the studio first.' });
    }
    if (/\.\w+$/.test(req.path) && !/\.html?$/.test(req.path)) return res.status(401).end();
    res.redirect(302, 'login');
  });
}

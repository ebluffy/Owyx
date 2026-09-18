const crypto = require('crypto');

const COOKIE_NAME = 'owyx_discord_pending';
const MAX_AGE_SEC = 600;

function pendingSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    'dev-discord-pending-insecure'
  );
}

function signPayload(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', pendingSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', pendingSecret()).update(payload).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object') return null;
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return null;
}

function setPendingCookie(res, discordData) {
  const token = signPayload({ ...discordData, exp: Date.now() + MAX_AGE_SEC * 1000 });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`,
  );
}

function clearPendingCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

function readPendingDiscord(req) {
  const token = readCookie(req, COOKIE_NAME);
  const data = verifyToken(token);
  if (!data) return null;
  const { exp, ...rest } = data;
  return rest;
}

module.exports = {
  COOKIE_NAME,
  setPendingCookie,
  clearPendingCookie,
  readPendingDiscord,
};

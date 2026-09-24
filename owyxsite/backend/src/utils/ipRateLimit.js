/**
 * In-process IP rate limit (single backend instance). Resets on restart.
 */
const buckets = new Map();

function consumeIp(key, { windowMs = 60 * 60 * 1000, max = 5 } = {}) {
  const now = Date.now();
  const id = String(key || 'unknown');
  let entry = buckets.get(id);
  if (!entry || now - entry.start >= windowMs) {
    entry = { start: now, count: 0 };
    buckets.set(id, entry);
  }
  entry.count += 1;
  if (entry.count > max) {
    const retryAfterSec = Math.ceil((windowMs - (now - entry.start)) / 1000);
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  return { allowed: true };
}

function consumeIdentifier(key, identifier, options) {
  return consumeIp(`${key}:${String(identifier || 'unknown').toLowerCase()}`, options);
}

module.exports = { consumeIp, consumeIdentifier };

/**
 * In-process IP / key rate limit.
 *
 * Assumes a single backend process (typical VPS / pm2 without cluster).
 * Counters reset on process restart and are not shared across workers —
 * if you run multiple Node workers, move this to Redis/Postgres.
 *
 * Memory is bounded: expired buckets are pruned periodically and the map
 * refuses to grow past MAX_KEYS (oldest/expired keys dropped first).
 */

const buckets = new Map();
const MAX_KEYS = 50_000;
const PRUNE_EVERY_MS = 60_000;
let lastPruneAt = 0;

function prune(now, windowMs) {
  if (now - lastPruneAt < PRUNE_EVERY_MS && buckets.size < MAX_KEYS) {
    return;
  }
  lastPruneAt = now;
  for (const [key, entry] of buckets) {
    if (now - entry.start >= windowMs) {
      buckets.delete(key);
    }
  }
  // Hard cap: drop arbitrary oldest-ish keys if still over limit.
  if (buckets.size > MAX_KEYS) {
    const overflow = buckets.size - MAX_KEYS;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }
}

function consumeIp(key, { windowMs = 60 * 60 * 1000, max = 5 } = {}) {
  const now = Date.now();
  prune(now, windowMs);
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

/** Test helper / ops introspection. */
function bucketSize() {
  return buckets.size;
}

module.exports = { consumeIp, bucketSize, MAX_KEYS };

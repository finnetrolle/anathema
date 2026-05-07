/**
 * In-memory rate limiter for single-process deployments.
 * Tracks request timestamps per key and enforces a sliding window limit.
 */

const windows = new Map<string, number[]>();

const MAX_REQUESTS_PER_WINDOW = 5;
const WINDOW_MS = 60_000; // 1 minute

let activeSyncCount = 0;
const MAX_CONCURRENT_SYNCS = 1;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  reason?: string;
}

/**
 * Check concurrent sync limit. Call acquireSyncSlot() if allowed.
 */
export function checkConcurrentSync(): RateLimitResult {
  if (activeSyncCount >= MAX_CONCURRENT_SYNCS) {
    return {
      allowed: false,
      retryAfterMs: 30_000,
      reason: "A sync is already in progress. Please wait for it to finish.",
    };
  }
  return { allowed: true };
}

export function acquireSyncSlot(): void {
  activeSyncCount++;
}

export function releaseSyncSlot(): void {
  activeSyncCount = Math.max(0, activeSyncCount - 1);
}

/**
 * Check per-key rate limit (e.g. by client IP).
 */
export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = windows.get(key) ?? [];
  const recent = timestamps.filter((t) => t > windowStart);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldestInWindow = recent[0];
    const retryAfterMs = oldestInWindow - windowStart;
    return {
      allowed: false,
      retryAfterMs,
      reason: `Rate limit exceeded. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
    };
  }

  recent.push(now);
  windows.set(key, recent);
  return { allowed: true };
}

/**
 * Clean up expired entries. Called periodically.
 */
export function cleanupRateLimit(): void {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of windows) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, recent);
    }
  }
}

// Periodic cleanup every 5 minutes
setInterval(cleanupRateLimit, 5 * 60_000).unref();

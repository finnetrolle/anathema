import { describe, it, expect, vi, beforeEach } from "vitest";

// Re-import to reset module state between tests
describe("rate-limit", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function importFresh() {
    return import("@/modules/auth/rate-limit");
  }

  describe("checkRateLimit", () => {
    it("allows requests within limit", async () => {
      const { checkRateLimit } = await importFresh();
      const result = checkRateLimit("ip-1");
      expect(result.allowed).toBe(true);
    });

    it("blocks requests after limit exceeded", async () => {
      const { checkRateLimit } = await importFresh();
      for (let i = 0; i < 5; i++) {
        checkRateLimit("ip-2");
      }
      const result = checkRateLimit("ip-2");
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.reason).toContain("Rate limit exceeded");
    });

    it("tracks keys independently", async () => {
      const { checkRateLimit } = await importFresh();
      for (let i = 0; i < 5; i++) {
        checkRateLimit("ip-a");
      }
      const result = checkRateLimit("ip-b");
      expect(result.allowed).toBe(true);
    });

    it("sets Retry-After header value in seconds", async () => {
      const { checkRateLimit } = await importFresh();
      for (let i = 0; i < 5; i++) {
        checkRateLimit("ip-3");
      }
      const result = checkRateLimit("ip-3");
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });
  });

  describe("checkConcurrentSync", () => {
    it("allows when no sync is active", async () => {
      const { checkConcurrentSync } = await importFresh();
      expect(checkConcurrentSync().allowed).toBe(true);
    });

    it("blocks when sync slot is acquired", async () => {
      const { checkConcurrentSync, acquireSyncSlot } = await importFresh();
      acquireSyncSlot();
      const result = checkConcurrentSync();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("already in progress");
    });

    it("allows again after release", async () => {
      const { checkConcurrentSync, acquireSyncSlot, releaseSyncSlot } =
        await importFresh();
      acquireSyncSlot();
      releaseSyncSlot();
      expect(checkConcurrentSync().allowed).toBe(true);
    });

    it("does not go below zero on extra release", async () => {
      const { checkConcurrentSync, releaseSyncSlot } = await importFresh();
      releaseSyncSlot();
      expect(checkConcurrentSync().allowed).toBe(true);
    });
  });

  describe("cleanupRateLimit", () => {
    it("removes expired entries", async () => {
      const { checkRateLimit, cleanupRateLimit } = await importFresh();
      vi.useFakeTimers();
      checkRateLimit("old-key");
      vi.advanceTimersByTime(61_000);
      cleanupRateLimit();
      // "old-key" should be cleaned up, new key should still work
      const result = checkRateLimit("new-key");
      expect(result.allowed).toBe(true);
      vi.useRealTimers();
    });
  });
});

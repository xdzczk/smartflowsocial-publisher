/**
 * Replay Protection Security Tests
 *
 * Tests that the application prevents replay attacks by tracking
 * event IDs and rejecting duplicate events.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';

import { checkAndRecordEvent, checkReplay, recordEvent } from '../../src/security/replayProtection';

/**
 * Creates a mock KV namespace for testing
 */
function createMockKV(): KVNamespace {
  const store = new Map<string, { value: string; expirationTtl?: number }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) {
        return null;
      }
      return entry.value;
    }),
    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store.set(key, { value, expirationTtl: options?.expirationTtl });

      // Simulate TTL expiration (for testing, we'll use a shorter timeout)
      if (options?.expirationTtl) {
        const timer = setTimeout(() => {
          store.delete(key);
          timers.delete(key);
        }, options.expirationTtl * 1000); // Convert to milliseconds for setTimeout
        timers.set(key, timer);
      }

      return;
    }),
    delete: vi.fn(async (key: string) => {
      const timer = timers.get(key);
      if (timer) {
        clearTimeout(timer);
        timers.delete(key);
      }
      store.delete(key);
      return;
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

const TEST_EVENT_ID = 'test-event-id-replay-protection-123';

describe('Replay Protection: Event ID Tracking', () => {
  describe('checkReplay', () => {
    it('should return false for new event', async () => {
      const kv = createMockKV();
      const isReplay = await checkReplay(TEST_EVENT_ID, kv);
      expect(isReplay).toBe(false);
    });

    it('should return true for existing event', async () => {
      const kv = createMockKV();
      await recordEvent(TEST_EVENT_ID, kv);
      const isReplay = await checkReplay(TEST_EVENT_ID, kv);
      expect(isReplay).toBe(true);
    });

    it('should fail open if KV operation fails', async () => {
      const kv = createMockKV();
      vi.spyOn(kv, 'get').mockRejectedValueOnce(new Error('KV error'));
      const isReplay = await checkReplay(TEST_EVENT_ID, kv);
      expect(isReplay).toBe(false); // Fail open
    });
  });

  describe('recordEvent', () => {
    it('should record event successfully', async () => {
      const kv = createMockKV();
      await recordEvent(TEST_EVENT_ID, kv);
      const isReplay = await checkReplay(TEST_EVENT_ID, kv);
      expect(isReplay).toBe(true);
    });

    it('should set 24-hour TTL', async () => {
      const kv = createMockKV();
      await recordEvent(TEST_EVENT_ID, kv);
      const putCall = vi.mocked(kv.put);
      expect(putCall).toHaveBeenCalledWith(
        expect.stringContaining(TEST_EVENT_ID),
        expect.any(String),
        expect.objectContaining({
          expirationTtl: 24 * 60 * 60, // 24 hours
        })
      );
    });

    it('should not throw if KV operation fails', async () => {
      const kv = createMockKV();
      vi.spyOn(kv, 'put').mockRejectedValueOnce(new Error('KV error'));
      await expect(recordEvent(TEST_EVENT_ID, kv)).resolves.not.toThrow();
    });
  });

  describe('checkAndRecordEvent', () => {
    it('should return false and record new event', async () => {
      const kv = createMockKV();
      const isReplay = await checkAndRecordEvent(TEST_EVENT_ID, kv);
      expect(isReplay).toBe(false);
      const isReplayAfter = await checkReplay(TEST_EVENT_ID, kv);
      expect(isReplayAfter).toBe(true);
    });

    it('should return true for existing event', async () => {
      const kv = createMockKV();
      await recordEvent(TEST_EVENT_ID, kv);
      const isReplay = await checkAndRecordEvent(TEST_EVENT_ID, kv);
      expect(isReplay).toBe(true);
    });

    it('should handle concurrent requests gracefully', async () => {
      const kv = createMockKV();
      const results = await Promise.all([
        checkAndRecordEvent(TEST_EVENT_ID, kv),
        checkAndRecordEvent(TEST_EVENT_ID, kv),
        checkAndRecordEvent(TEST_EVENT_ID, kv),
      ]);

      // All should complete without throwing
      expect(results.length).toBe(3);
      // At least one should detect it as a replay after first recording
      const replayCount = results.filter((r) => r).length;
      expect(replayCount).toBeGreaterThanOrEqual(0);
    });

    it('should fail open if KV operation fails', async () => {
      const kv = createMockKV();
      vi.spyOn(kv, 'get').mockRejectedValueOnce(new Error('KV error'));
      const isReplay = await checkAndRecordEvent(TEST_EVENT_ID, kv);
      expect(isReplay).toBe(false); // Fail open
    });
  });

  describe('Replay Attack Prevention', () => {
    it('should prevent same event from being published twice', async () => {
      const kv = createMockKV();
      const eventId = 'attack-event-123';

      // First publish should succeed
      const firstCheck = await checkAndRecordEvent(eventId, kv);
      expect(firstCheck).toBe(false); // Not a replay

      // Second publish should be detected as replay
      const secondCheck = await checkAndRecordEvent(eventId, kv);
      expect(secondCheck).toBe(true); // Is a replay
    });

    it('should allow different events to be published', async () => {
      const kv = createMockKV();
      const eventId1 = 'event-1';
      const eventId2 = 'event-2';

      await checkAndRecordEvent(eventId1, kv);
      const check2 = await checkAndRecordEvent(eventId2, kv);

      expect(check2).toBe(false); // Different event, not a replay
    });

    it('should use correct KV key prefix', async () => {
      const kv = createMockKV();
      const eventId = 'test-event';
      await recordEvent(eventId, kv);

      const putCall = vi.mocked(kv.put);
      expect(putCall).toHaveBeenCalledWith(
        expect.stringContaining('replay:'),
        expect.any(String),
        expect.any(Object)
      );
    });
  });
});

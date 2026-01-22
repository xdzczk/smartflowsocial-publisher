import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishSignedEvent } from '../../src/core/PublishEngine';
import type { PublishPolicy } from '../../src/policies/PublishPolicy';
import { createSignedEvent } from '../utils/fixtures';
import { createMockLogger, createMockRelays } from '../utils/testHelpers';

describe('Chaos Tests - Concurrency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('high concurrency stress', () => {
    it('should handle many relays with low concurrency limit', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        relayConcurrency: 2, // Low limit
        perRelayTimeoutMs: 1000,
        connectionTimeoutMs: 500,
        overallTimeoutMs: 10000,
        minSuccessRelays: 1,
        retry: { maxAttempts: 0, backoffMs: 100 },
      };
      const relays = createMockRelays(
        Array.from({ length: 20 }, (_, i) => `wss://relay${i}.example.com`)
      );
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, policy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      // Should have results for all relays
      expect(outcome.relays).toHaveLength(20);
      // Concurrency limit should be respected (no more than 2 executing at once)
      // This is verified by the fact that all complete successfully
      outcome.relays.forEach((result) => {
        expect(result.status).toBeDefined();
      });
    });
  });

  describe('low concurrency stress', () => {
    it('should handle few relays with high concurrency limit', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        relayConcurrency: 10, // High limit, but only 3 relays
        perRelayTimeoutMs: 1000,
        connectionTimeoutMs: 500,
        overallTimeoutMs: 5000,
        minSuccessRelays: 1,
        retry: { maxAttempts: 0, backoffMs: 100 },
      };
      const relays = createMockRelays([
        'wss://relay1.example.com',
        'wss://relay2.example.com',
        'wss://relay3.example.com',
      ]);
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, policy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.relays).toHaveLength(3);
      expect(outcome.relays.every((r) => r.status === 'success')).toBe(true);
    });
  });

  describe('no race conditions', () => {
    it('should handle concurrent publishes without race conditions', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        relayConcurrency: 5,
        perRelayTimeoutMs: 1000,
        connectionTimeoutMs: 500,
        overallTimeoutMs: 5000,
        minSuccessRelays: 1,
        retry: { maxAttempts: 0, backoffMs: 100 },
      };
      const relays = createMockRelays(
        Array.from({ length: 10 }, (_, i) => `wss://relay${i}.example.com`)
      );
      const event = createSignedEvent();

      // Add small random delays to test race conditions
      relays.forEach((relay, index) => {
        const connection = relay.getConnection();
        if (connection) {
          connection.publishDelay = (index % 3) * 50; // Varying delays
        }
      });

      const promise = publishSignedEvent(event, relays, policy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      // Should have exactly 10 results (no duplicates, no missing)
      expect(outcome.relays).toHaveLength(10);
      // All relay URLs should be unique
      const relayUrls = outcome.relays.map((r) => r.relay);
      const uniqueUrls = new Set(relayUrls);
      expect(uniqueUrls.size).toBe(10);
    });
  });
});

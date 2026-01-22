import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishSignedEvent } from '../../src/core/PublishEngine';
import type { PublishPolicy } from '../../src/policies/PublishPolicy';
import { createSignedEvent } from '../utils/fixtures';
import { createMockLogger, createMockRelays } from '../utils/testHelpers';

const RELAY1_URL = 'wss://relay1.example.com';
const RELAY2_URL = 'wss://relay2.example.com';
const RELAY3_URL = 'wss://relay3.example.com';
const RELAY4_URL = 'wss://relay4.example.com';
const RELAY5_URL = 'wss://relay5.example.com';

describe('Chaos Tests - Relay Failures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const testPolicy: PublishPolicy = {
    relayConcurrency: 3,
    perRelayTimeoutMs: 1000,
    connectionTimeoutMs: 500,
    overallTimeoutMs: 5000,
    minSuccessRelays: 1,
    retry: {
      maxAttempts: 0,
      backoffMs: 100,
    },
  };

  describe('random relay failures', () => {
    it('should handle random mix of success and failure', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([
        RELAY1_URL,
        RELAY2_URL,
        RELAY3_URL,
        RELAY4_URL,
        RELAY5_URL,
      ]);
      const event = createSignedEvent();

      // Randomly make some fail
      const conn1 = relays[1].getConnection();
      if (conn1) conn1.shouldFailPublish = true;
      const conn3 = relays[3].getConnection();
      if (conn3) conn3.shouldFailPublish = true;

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      // Should have results for all relays
      expect(outcome.relays).toHaveLength(5);
      // All outcomes should be classified
      outcome.relays.forEach((result) => {
        expect(result.status).toBeDefined();
        expect(['success', 'failure']).toContain(result.status);
      });
      // Should not be 'failed' if at least one succeeded
      const successCount = outcome.relays.filter((r) => r.status === 'success').length;
      if (successCount > 0) {
        expect(['success', 'partial']).toContain(outcome.status);
      }
    });

    it('should handle all relays failing', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([RELAY1_URL, RELAY2_URL, RELAY3_URL]);
      const event = createSignedEvent();

      // Make all fail - need to set up before publish
      // Since connections are created during publish, we'll use a different approach
      // Set up relays to fail on connection creation
      relays.forEach((relay) => {
        relay.shouldFailCreateConnection = true;
        relay.createConnectionError = new Error('Connection failed');
      });

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('failed');
      expect(outcome.relays.every((r) => r.status === 'failure')).toBe(true);
    });

    it('should handle all relays timing out', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        ...testPolicy,
        overallTimeoutMs: 100, // Very short timeout
        perRelayTimeoutMs: 2000, // Longer than overall
      };
      const relays = createMockRelays([RELAY1_URL, RELAY2_URL]);
      const event = createSignedEvent();

      // Make relays slow
      relays.forEach((relay) => {
        const connection = relay.getConnection();
        if (connection) {
          connection.publishDelay = 5000; // Much longer than overall timeout
        }
      });

      const promise = publishSignedEvent(event, relays, policy, logger);
      vi.advanceTimersByTime(200);
      const outcome = await promise;

      // Should have timeout results
      const timeoutResults = outcome.relays.filter(
        (r) => r.reason === 'timeout' || r.error === 'TIMEOUT'
      );
      expect(timeoutResults.length).toBeGreaterThan(0);
    });
  });

  describe('mixed failure types', () => {
    it('should handle mix of timeout, rejected, and unreachable', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([
        RELAY1_URL, // Success
        RELAY2_URL, // Timeout
        RELAY3_URL, // Rejected
        RELAY4_URL, // Unreachable
      ]);
      const event = createSignedEvent();

      // Relay 1: success (default)
      // Relay 2: timeout (slow)
      const connection2 = relays[1].getConnection();
      if (connection2) {
        connection2.publishDelay = 2000;
      }
      // Relay 3: rejected
      const connection3 = relays[2].getConnection();
      if (connection3) {
        connection3.shouldFailPublish = true;
        connection3.publishError = new Error('REJECTED: invalid');
      }
      // Relay 4: unreachable
      relays[3].shouldFailCreateConnection = true;
      relays[3].createConnectionError = new Error('ECONNREFUSED');

      const policy: PublishPolicy = {
        ...testPolicy,
        overallTimeoutMs: 1500, // Will timeout relay2
      };

      const promise = publishSignedEvent(event, relays, policy, logger);
      vi.advanceTimersByTime(1600);
      const outcome = await promise;

      expect(outcome.relays).toHaveLength(4);
      // All should be classified
      outcome.relays.forEach((result) => {
        expect(result.status).toBeDefined();
        if (result.status === 'failure') {
          expect(result.reason).toBeDefined();
        }
      });
    });
  });

  describe('no unhandled promises', () => {
    it('should not leave unhandled promises', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([RELAY1_URL, RELAY2_URL, RELAY3_URL]);
      const event = createSignedEvent();

      // Track unhandled rejections
      const unhandledRejections: Error[] = [];
      const originalHandler = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      process.on('unhandledRejection', (error) => {
        unhandledRejections.push(error as Error);
      });

      try {
        const promise = publishSignedEvent(event, relays, testPolicy, logger);
        await vi.runAllTimersAsync();
        await promise;

        // Should have no unhandled rejections
        expect(unhandledRejections).toHaveLength(0);
      } finally {
        // Restore original handlers
        process.removeAllListeners('unhandledRejection');
        originalHandler.forEach((handler) => {
          process.on('unhandledRejection', handler);
        });
      }
    });
  });

  describe('no deadlocks', () => {
    it('should complete even with many relays and low concurrency', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        ...testPolicy,
        relayConcurrency: 2, // Low concurrency
      };
      const relays = createMockRelays(
        Array.from({ length: 10 }, (_, i) => `wss://relay${i}.example.com`)
      );
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, policy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      // Should complete with results for all relays
      expect(outcome.relays).toHaveLength(10);
      // All should be classified
      outcome.relays.forEach((result) => {
        expect(result.status).toBeDefined();
      });
    });
  });
});

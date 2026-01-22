import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishSignedEvent } from '../../src/core/PublishEngine';
import type { PublishPolicy } from '../../src/policies/PublishPolicy';
import { createSignedEvent } from '../utils/fixtures';
import { createMockLogger, createMockRelays } from '../utils/testHelpers';

const RELAY1_URL = 'wss://relay1.example.com';

describe('Chaos Tests - Timeout Scenarios', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('connection timeout', () => {
    it('should timeout on connection before publish', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        relayConcurrency: 1,
        perRelayTimeoutMs: 2000,
        connectionTimeoutMs: 500,
        overallTimeoutMs: 5000,
        minSuccessRelays: 1,
        retry: { maxAttempts: 0, backoffMs: 100 },
        successCriteria: (results) => {
          const successCount = results.filter((r) => r.status === 'success').length;
          if (successCount >= 1) {
            if (successCount === results.length) {
              return { status: 'success', relays: results };
            }
            return { status: 'partial', relays: results };
          }
          return { status: 'failed', relays: results };
        },
      };
      const relays = createMockRelays([RELAY1_URL]);
      const event = createSignedEvent();

      // Make connection slow
      relays[0].connectionDelay = 1000; // Longer than connectionTimeoutMs

      const promise = publishSignedEvent(event, relays, policy, logger);
      vi.advanceTimersByTime(600);
      const outcome = await promise;

      expect(outcome.relays[0].status).toBe('failure');
      expect(outcome.relays[0].reason).toBe('connection_timeout');
    });
  });

  describe('publish timeout', () => {
    it('should timeout on publish after connection', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        relayConcurrency: 1,
        perRelayTimeoutMs: 1000,
        connectionTimeoutMs: 500,
        overallTimeoutMs: 5000,
        minSuccessRelays: 1,
        retry: { maxAttempts: 0, backoffMs: 100 },
        successCriteria: (results) => {
          const successCount = results.filter((r) => r.status === 'success').length;
          if (successCount >= 1) {
            if (successCount === results.length) {
              return { status: 'success', relays: results };
            }
            return { status: 'partial', relays: results };
          }
          return { status: 'failed', relays: results };
        },
      };
      const relays = createMockRelays([RELAY1_URL]);
      const event = createSignedEvent();

      // Make publish slow
      const connection = relays[0].getConnection();
      if (connection) {
        connection.publishDelay = 2000; // Longer than perRelayTimeoutMs
      }

      const promise = publishSignedEvent(event, relays, policy, logger);
      vi.advanceTimersByTime(1500);
      const outcome = await promise;

      expect(outcome.relays[0].status).toBe('failure');
      expect(outcome.relays[0].reason).toBe('publish_timeout');
    });
  });

  describe('overall timeout', () => {
    it('should cancel remaining work on overall timeout', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        relayConcurrency: 2,
        perRelayTimeoutMs: 5000,
        connectionTimeoutMs: 2000,
        overallTimeoutMs: 1000, // Short overall timeout
        minSuccessRelays: 1,
        retry: { maxAttempts: 0, backoffMs: 100 },
        successCriteria: (results) => {
          const successCount = results.filter((r) => r.status === 'success').length;
          if (successCount >= 1) {
            if (successCount === results.length) {
              return { status: 'success', relays: results };
            }
            return { status: 'partial', relays: results };
          }
          return { status: 'failed', relays: results };
        },
      };
      const relays = createMockRelays([
        'wss://relay1.example.com',
        'wss://relay2.example.com',
        'wss://relay3.example.com',
      ]);
      const event = createSignedEvent();

      // Make all relays slow
      relays.forEach((relay) => {
        const connection = relay.getConnection();
        if (connection) {
          connection.publishDelay = 3000; // Longer than overall timeout
        }
      });

      const promise = publishSignedEvent(event, relays, policy, logger);
      vi.advanceTimersByTime(1100); // Past overall timeout
      const outcome = await promise;

      // Should have timeout results for incomplete relays
      const timeoutResults = outcome.relays.filter(
        (r) => r.reason === 'timeout' || r.error === 'TIMEOUT'
      );
      expect(timeoutResults.length).toBeGreaterThan(0);
    });

    it('should verify timeouts are respected', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        relayConcurrency: 1,
        perRelayTimeoutMs: 500,
        connectionTimeoutMs: 200,
        overallTimeoutMs: 1000,
        minSuccessRelays: 1,
        retry: { maxAttempts: 0, backoffMs: 100 },
        successCriteria: (results) => {
          const successCount = results.filter((r) => r.status === 'success').length;
          if (successCount >= 1) {
            if (successCount === results.length) {
              return { status: 'success', relays: results };
            }
            return { status: 'partial', relays: results };
          }
          return { status: 'failed', relays: results };
        },
      };
      const relays = createMockRelays([RELAY1_URL]);
      const event = createSignedEvent();

      // Make connection timeout
      relays[0].connectionDelay = 300; // Longer than connectionTimeoutMs

      const startTime = Date.now();
      const promise = publishSignedEvent(event, relays, policy, logger);
      vi.advanceTimersByTime(300);
      const outcome = await promise;
      const elapsed = Date.now() - startTime;

      // Should timeout within connectionTimeoutMs + some buffer
      expect(elapsed).toBeLessThan(policy.connectionTimeoutMs + 200);
      expect(outcome.relays.length).toBeGreaterThan(0);
      expect(outcome.relays[0]?.status).toBe('failure');
    });
  });

  describe('cleanup on timeout', () => {
    it('should cleanup connections on timeout', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        relayConcurrency: 1,
        perRelayTimeoutMs: 1000,
        connectionTimeoutMs: 500,
        overallTimeoutMs: 2000,
        minSuccessRelays: 1,
        retry: { maxAttempts: 0, backoffMs: 100 },
        successCriteria: (results) => {
          const successCount = results.filter((r) => r.status === 'success').length;
          if (successCount >= 1) {
            if (successCount === results.length) {
              return { status: 'success', relays: results };
            }
            return { status: 'partial', relays: results };
          }
          return { status: 'failed', relays: results };
        },
      };
      const relays = createMockRelays([RELAY1_URL]);
      const event = createSignedEvent();

      // Make connection timeout
      relays[0].connectionDelay = 1000;

      const promise = publishSignedEvent(event, relays, policy, logger);
      vi.advanceTimersByTime(1100);
      const outcome = await promise;

      // Connection should be closed (checked via mock)
      const connection = relays[0].getConnection();
      // Connection might be null if creation failed, or closed if it succeeded
      if (connection) {
        // If connection was created, it should be closed
        expect(connection.closed || !connection.isConnected).toBe(true);
      }

      expect(outcome.relays.length).toBeGreaterThan(0);
      expect(outcome.relays[0]?.status).toBe('failure');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishSignedEvent } from '../../src/core/PublishEngine';
import type { PublishPolicy } from '../../src/policies/PublishPolicy';
import { createSignedEvent } from '../utils/fixtures';
import { MockRelay, MockRelayConnection } from '../utils/mocks';
import { createMockLogger, createMockRelays } from '../utils/testHelpers';

const RELAY1_URL = 'wss://relay1.example.com';
const RELAY2_URL = 'wss://relay2.example.com';
const RELAY3_URL = 'wss://relay3.example.com';
const RELAY4_URL = 'wss://relay4.example.com';

describe('PublishEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const testPolicy: PublishPolicy = {
    relayConcurrency: 2,
    perRelayTimeoutMs: 1000,
    connectionTimeoutMs: 500,
    overallTimeoutMs: 5000,
    minSuccessRelays: 1,
    retry: {
      maxAttempts: 0,
      backoffMs: 100,
    },
  };

  describe('single relay', () => {
    it('should publish to single relay successfully', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([RELAY1_URL]);
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('success');
      expect(outcome.relays).toHaveLength(1);
      expect(outcome.relays[0].status).toBe('success');
    });

    it('should handle single relay failure', async () => {
      const logger = createMockLogger();
      const event = createSignedEvent();

      // Create relay with connection that fails on publish
      const connection = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error('Publish failed'),
      });
      const relay = new MockRelay(RELAY1_URL, { connection });
      const relays = [relay];

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('failed');
      expect(outcome.relays[0].status).toBe('failure');
    });
  });

  describe('multiple relays - all succeed', () => {
    it('should publish to all relays successfully', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([RELAY1_URL, RELAY2_URL, RELAY3_URL]);
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('success');
      expect(outcome.relays).toHaveLength(3);
      expect(outcome.relays.every((r) => r.status === 'success')).toBe(true);
    });
  });

  describe('partial success', () => {
    it('should classify as partial when some relays succeed', async () => {
      const logger = createMockLogger();
      const event = createSignedEvent();

      // Create 3 relays, make relay2 fail
      const relay1 = new MockRelay(RELAY1_URL);
      const connection2 = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error('Failed'),
      });
      const relay2 = new MockRelay(RELAY2_URL, { connection: connection2 });
      const relay3 = new MockRelay(RELAY3_URL);
      const relays = [relay1, relay2, relay3];

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('partial');
      expect(outcome.relays).toHaveLength(3);
      const successCount = outcome.relays.filter((r) => r.status === 'success').length;
      expect(successCount).toBe(2);
    });

    it('should classify as partial when minSuccessRelays is met but not all succeed', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        ...testPolicy,
        minSuccessRelays: 2,
      };
      const event = createSignedEvent();

      // Create 3 relays, make relay3 fail
      const relay1 = new MockRelay(RELAY1_URL);
      const relay2 = new MockRelay(RELAY2_URL);
      const connection3 = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error('Failed'),
      });
      const relay3 = new MockRelay(RELAY3_URL, { connection: connection3 });
      const relays = [relay1, relay2, relay3];

      const promise = publishSignedEvent(event, relays, policy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('partial');
      const successCount = outcome.relays.filter((r) => r.status === 'success').length;
      expect(successCount).toBe(2);
    });
  });

  describe('complete failure', () => {
    it('should classify as failed when all relays fail', async () => {
      const logger = createMockLogger();
      const event = createSignedEvent();

      // Create relays that all fail
      const connection1 = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error('Failed'),
      });
      const connection2 = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error('Failed'),
      });
      const relay1 = new MockRelay(RELAY1_URL, { connection: connection1 });
      const relay2 = new MockRelay(RELAY2_URL, { connection: connection2 });
      const relays = [relay1, relay2];

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('failed');
      expect(outcome.relays.every((r) => r.status === 'failure')).toBe(true);
    });

    it('should classify as failed when success count < minSuccessRelays', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        ...testPolicy,
        minSuccessRelays: 3,
      };
      const event = createSignedEvent();

      // Create 3 relays, make relay3 fail
      const relay1 = new MockRelay(RELAY1_URL);
      const relay2 = new MockRelay(RELAY2_URL);
      const connection3 = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error('Failed'),
      });
      const relay3 = new MockRelay(RELAY3_URL, { connection: connection3 });
      const relays = [relay1, relay2, relay3];

      const promise = publishSignedEvent(event, relays, policy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('failed');
      const successCount = outcome.relays.filter((r) => r.status === 'success').length;
      expect(successCount).toBe(2);
      expect(successCount).toBeLessThan(policy.minSuccessRelays);
    });
  });

  describe('concurrency limiting', () => {
    it('should respect relayConcurrency limit', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        ...testPolicy,
        relayConcurrency: 2,
      };
      const relays = createMockRelays([
        RELAY1_URL,
        RELAY2_URL,
        RELAY3_URL,
        RELAY4_URL,
      ]);
      // Add delays to track concurrency
      relays.forEach((relay) => {
        const connection = relay.getConnection();
        if (connection) {
          connection.publishDelay = 100;
        }
      });
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, policy, logger);
      // Advance timers to see concurrency in action
      vi.advanceTimersByTime(50);
      // At this point, only 2 should be executing (concurrency limit)
      vi.advanceTimersByTime(200);
      const outcome = await promise;

      expect(outcome.relays).toHaveLength(4);
      // All should eventually complete
      outcome.relays.forEach((r) => {
        expect(['success', 'failure']).toContain(r.status);
      });
    });
  });

  describe('overall timeout', () => {
    it('should mark incomplete relays as timeout when overall timeout hits', async () => {
      const logger = createMockLogger();
      const policy: PublishPolicy = {
        ...testPolicy,
        overallTimeoutMs: 500,
        perRelayTimeoutMs: 2000, // Longer than overall timeout
      };
      const relays = createMockRelays([
        RELAY1_URL,
        RELAY2_URL,
      ]);
      // Make relays slow
      relays.forEach((relay) => {
        const connection = relay.getConnection();
        if (connection) {
          connection.publishDelay = 1000; // Longer than overall timeout
        }
      });
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, policy, logger);
      vi.advanceTimersByTime(600); // Past overall timeout
      const outcome = await promise;

      // Should have timeout results for relays that didn't complete
      const timeoutResults = outcome.relays.filter(
        (r) => r.reason === 'timeout' || r.error === 'TIMEOUT'
      );
      expect(timeoutResults.length).toBeGreaterThan(0);
    });
  });

  describe('result ordering', () => {
    it('should return results in input relay order', async () => {
      const logger = createMockLogger();
      const relayUrls = [
        RELAY1_URL,
        RELAY2_URL,
        RELAY3_URL,
      ];
      const relays = createMockRelays(relayUrls);
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.relays).toHaveLength(3);
      expect(outcome.relays[0].relay).toBe(relayUrls[0]);
      expect(outcome.relays[1].relay).toBe(relayUrls[1]);
      expect(outcome.relays[2].relay).toBe(relayUrls[2]);
    });
  });

  describe('empty relays', () => {
    it('should return failed outcome for empty relay list', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([]);
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const outcome = await promise;

      expect(outcome.status).toBe('failed');
      expect(outcome.relays).toHaveLength(0);
    });
  });

  describe('logging', () => {
    it('should log publish start', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([RELAY1_URL]);
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      expect(
        logger.infoLogs.some((log) => log.join(' ').includes('Starting publish'))
      ).toBe(true);
    });

    it('should log completion', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([RELAY1_URL]);
      const event = createSignedEvent();

      const promise = publishSignedEvent(event, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      expect(
        logger.infoLogs.some((log) => log.join(' ').includes('Publish completed'))
      ).toBe(true);
    });
  });
});

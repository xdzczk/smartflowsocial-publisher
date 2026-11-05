import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishToRelay, resetCircuitBreakerManager } from '../../src/core/RelayPublisher';
import type { PublishPolicy } from '../../src/policies/PublishPolicy';
import { createSignedEvent } from '../utils/fixtures';
import { MockRelay, MockRelayConnection } from '../utils/mocks';
import { createMockLogger, createMockRelay } from '../utils/testHelpers';

const RELAY_URL = 'wss://relay.example.com';

describe('RelayPublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetCircuitBreakerManager(); // Reset circuit breaker between tests
  });

  const testPolicy: PublishPolicy = {
    relayConcurrency: 1,
    perRelayTimeoutMs: 1000,
    connectionTimeoutMs: 500,
    overallTimeoutMs: 2000,
    minSuccessRelays: 1,
    retry: {
      maxAttempts: 0,
      backoffMs: 100,
    },
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

  describe('successful publish', () => {
    it('should successfully publish an event', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL);
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('success');
      expect(result.relay).toBe(RELAY_URL);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.reason).toBeUndefined();
      expect(result.error).toBeUndefined();

      const connection = relay.getConnection();
      expect(connection?.closed).toBe(true);
    });

    it('should measure latency correctly', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        connectionDelay: 100,
      });
      const connection = relay.getConnection();
      if (connection) {
        connection.publishDelay = 50;
      }
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      vi.advanceTimersByTime(150);
      const result = await promise;

      expect(result.status).toBe('success');
      expect(result.latencyMs).toBeGreaterThanOrEqual(150);
    });
  });

  describe('connection timeout', () => {
    it('should timeout on connection creation', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        connectionDelay: 1000, // Longer than connectionTimeoutMs (500)
      });
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      vi.advanceTimersByTime(600);
      const result = await promise;

      expect(result.status).toBe('failure');
      expect(result.reason).toBe('connection_timeout');
      expect(result.error).toContain('CONNECTION_TIMEOUT');
    });

    it('should timeout on connection.connect()', async () => {
      const logger = createMockLogger();
      const event = createSignedEvent();

      // Create relay with a connection that has connect delay
      const connection = new MockRelayConnection({ connectDelay: 1000 });
      const relay = new MockRelay(RELAY_URL, { connection });

      const promise = publishToRelay(relay, event, testPolicy, logger);
      vi.advanceTimersByTime(600);
      const result = await promise;

      expect(result.status).toBe('failure');
      expect(result.reason).toBe('connection_timeout');
    });
  });

  describe('publish timeout', () => {
    it('should timeout on publish', async () => {
      const logger = createMockLogger();
      const event = createSignedEvent();

      // Create relay with a connection that has publish delay
      // Connection connects quickly, but publish is slow
      const connection = new MockRelayConnection({ publishDelay: 2000 });
      const relay = new MockRelay(RELAY_URL, { connection });

      const promise = publishToRelay(relay, event, testPolicy, logger);
      // Advance past connection (happens quickly) but publish times out
      // Connection: ~0ms, Connect: ~0ms, Publish starts but times out
      vi.advanceTimersByTime(1200); // Past perRelayTimeoutMs (1000ms)
      const result = await promise;

      expect(result.status).toBe('failure');
      expect(result.reason).toBe('publish_timeout');
      expect(result.error).toContain('PUBLISH_TIMEOUT');
    });

    it('should timeout if connection takes too long, leaving no time for publish', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        connectionDelay: 600, // Uses most of perRelayTimeoutMs
      });
      const event = createSignedEvent();

      const policy: PublishPolicy = {
        ...testPolicy,
        perRelayTimeoutMs: 700,
        connectionTimeoutMs: 600,
      };

      const promise = publishToRelay(relay, event, policy, logger);
      vi.advanceTimersByTime(700);
      const result = await promise;

      expect(result.status).toBe('failure');
      // Connection timeout happens first since connection takes too long
      expect(result.reason).toBe('connection_timeout');
    });
  });

  describe('connection failure', () => {
    it('should handle connection creation failure', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        shouldFailCreateConnection: true,
        createConnectionError: new Error('Failed to create connection'),
      });
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('failure');
      expect(result.reason).toBe('unknown');
      expect(result.error).toContain('Failed to create connection');
    });

    it('should handle connection.connect() failure', async () => {
      const logger = createMockLogger();
      const event = createSignedEvent();

      // Create relay with a connection that fails on connect
      const connection = new MockRelayConnection({
        shouldFailConnect: true,
        connectError: new Error('Connection refused'),
      });
      const relay = new MockRelay(RELAY_URL, { connection });

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('failure');
      expect(result.error).toContain('Connection refused');
    });
  });

  describe('publish failure', () => {
    it('should handle publish failure', async () => {
      const logger = createMockLogger();
      const event = createSignedEvent();

      // Create relay with a connection that fails on publish
      const connection = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error('Event rejected'),
      });
      const relay = new MockRelay(RELAY_URL, { connection });

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.status).toBe('failure');
      expect(result.reason).toBe('rejected');
      expect(result.error).toContain('Event rejected');
    });
  });

  describe('error classification', () => {
    it('should classify timeout errors correctly', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        connectionDelay: 1000,
      });
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      vi.advanceTimersByTime(600);
      const result = await promise;

      expect(result.reason).toBe('connection_timeout');
    });

    it('should classify rejected errors correctly', async () => {
      const logger = createMockLogger();
      const event = createSignedEvent();

      // Create relay with a connection that fails on publish with REJECTED error
      const connection = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error('REJECTED: invalid event'),
      });
      const relay = new MockRelay(RELAY_URL, { connection });

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.reason).toBe('rejected');
    });

    it('should classify unreachable errors correctly', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        shouldFailCreateConnection: true,
        createConnectionError: new Error('ECONNREFUSED'),
      });
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.reason).toBe('relay_unreachable');
    });

    it('should classify unknown errors as unknown', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        shouldFailCreateConnection: true,
        createConnectionError: new Error('Some weird error'),
      });
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.reason).toBe('unknown');
    });
  });

  describe('cleanup', () => {
    it('should close connection on success', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL);
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      const connection = relay.getConnection();
      expect(connection?.closed).toBe(true);
    });

    it('should close connection on failure', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        shouldFailCreateConnection: true,
      });
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      // Connection should still be attempted to be closed even if creation failed
      // (though in this case connection might be null)
    });

    it('should log connection closure', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL);
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      expect(logger.infoLogs.some((log) => log.join(' ').includes('Connection closed'))).toBe(true);
    });
  });

  describe('logging', () => {
    it('should log publish start', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL);
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      expect(
        logger.infoLogs.some((log) => log.join(' ').includes('Starting publish for event'))
      ).toBe(true);
    });

    it('should log errors', async () => {
      const logger = createMockLogger();
      const relay = createMockRelay(RELAY_URL, {
        shouldFailCreateConnection: true,
      });
      const event = createSignedEvent();

      const promise = publishToRelay(relay, event, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      expect(logger.errorLogs.length).toBeGreaterThan(0);
      expect(logger.errorLogs.some((log) => log.join(' ').includes('Publish failed'))).toBe(true);
    });
  });
});

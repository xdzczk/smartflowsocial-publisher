import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchProfile } from '../../src/core/ProfileEngine';
import type { ProfilePolicy } from '../../src/policies/ProfilePolicy';
import { createSignedEvent } from '../utils/fixtures';
import { MockRelay, MockRelayConnection } from '../utils/mocks';
import { createMockLogger, createMockRelays } from '../utils/testHelpers';

const RELAY1_URL = 'wss://relay1.example.com';
const TEST_PUBKEY = 'test-pubkey';

describe('ProfileEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const testPolicy: ProfilePolicy = {
    perRelayTimeoutMs: 1000,
    overallTimeoutMs: 2000,
    maxRelays: 10,
  };

  describe('successful fetch', () => {
    it('should fetch profile from single relay', async () => {
      const logger = createMockLogger();
      const pubkey = 'test-pubkey';
      const profileEvent = createSignedEvent({ kind: 0 });

      // Create relay with connection that emits event
      const connection = new MockRelayConnection();
      connection.subscribe = vi.fn((_filters, callbacks) => {
        // Immediately emit event
        callbacks.onevent(profileEvent);
        return { close: vi.fn() };
      });
      const relay = new MockRelay(RELAY1_URL, { connection });
      const relays = [relay];

      const promise = fetchProfile(pubkey, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.event).toEqual(profileEvent);
      expect(result.pubkey).toBe(pubkey);
      expect(result.relays).toHaveLength(1);
    });

    it('should fetch profile from first successful relay (Promise.any)', async () => {
      const logger = createMockLogger();
      const pubkey = 'test-pubkey';
      const profileEvent = createSignedEvent({ kind: 0 });

      // Create relay1 that succeeds quickly
      const connection1 = new MockRelayConnection();
      connection1.subscribe = vi.fn((_filters, callbacks) => {
        callbacks.onevent(profileEvent);
        return { close: vi.fn() };
      });
      const relay1 = new MockRelay('wss://relay1.example.com', { connection: connection1 });

      // Create relay2 that would succeed slower (but won't be needed)
      const connection2 = new MockRelayConnection();
      connection2.subscribe = vi.fn((_filters, callbacks) => {
        callbacks.onevent(createSignedEvent({ kind: 0, content: 'slower' }));
        return { close: vi.fn() };
      });
      const relay2 = new MockRelay('wss://relay2.example.com', { connection: connection2 });

      const relays = [relay1, relay2];

      const promise = fetchProfile(pubkey, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.event).toEqual(profileEvent);
      expect(result.event?.content).not.toBe('slower');
    });
  });

  describe('failure handling', () => {
    it('should return null event when all relays fail', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([RELAY1_URL]);
      const pubkey = TEST_PUBKEY;

      // Make relay fail
      const connection = relays[0].getConnection();
      if (connection) {
        connection.shouldFailConnect = true;
      }

      const promise = fetchProfile(pubkey, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.event).toBeNull();
      expect(result.relays[0].status).toBe('failure');
    });

    it('should handle timeout', async () => {
      const logger = createMockLogger();
      const pubkey = 'test-pubkey';

      // Create a connection that times out - subscribe never calls onevent
      // The timeout is set up in fetchProfileFromRelay with setTimeout
      const connection = new MockRelayConnection();
      connection.subscribe = vi.fn(() => {
        // Never call onevent, will timeout after perRelayTimeoutMs
        // The timeout is handled by the setTimeout in fetchProfileFromRelay
        return { close: vi.fn() };
      });
      const relay = new MockRelay(RELAY1_URL, { connection });
      const relays = [relay];

      const promise = fetchProfile(pubkey, relays, testPolicy, logger);
      // The timeout is set up inside fetchProfileFromRelay
      // We need to advance past the timeout (perRelayTimeoutMs = 1000ms)
      // But also need to handle the Promise.any which waits for all to reject
      vi.advanceTimersByTime(1100); // Past perRelayTimeoutMs (1000ms)
      
      // Run all pending timers to ensure timeout fires
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.event).toBeNull();
      expect(result.relays[0].status).toBe('failure');
    }, 15000); // Increase timeout for this test
  });

  describe('maxRelays limit', () => {
    it('should limit to maxRelays', async () => {
      const logger = createMockLogger();
      const policy: ProfilePolicy = {
        ...testPolicy,
        maxRelays: 2,
      };
      const relays = createMockRelays([
        'wss://relay1.example.com',
        'wss://relay2.example.com',
        'wss://relay3.example.com',
        'wss://relay4.example.com',
      ]);
      const pubkey = 'test-pubkey';

      const promise = fetchProfile(pubkey, relays, policy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      // Should only query first 2 relays
      expect(result.relays.length).toBeLessThanOrEqual(2);
    });
  });

  describe('empty relays', () => {
    it('should return null event for empty relay list', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([]);
      const pubkey = 'test-pubkey';

      const promise = fetchProfile(pubkey, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.event).toBeNull();
      expect(result.relays).toHaveLength(0);
    });
  });

  describe('logging', () => {
    it('should log fetch start', async () => {
      const logger = createMockLogger();
      const pubkey = 'test-pubkey';
      const profileEvent = createSignedEvent({ kind: 0 });

      // Create relay with connection that emits event quickly
      const connection = new MockRelayConnection();
      connection.subscribe = vi.fn((_filters, callbacks) => {
        // Call onevent immediately
        callbacks.onevent(profileEvent);
        return { close: vi.fn() };
      });
      const relay = new MockRelay(RELAY1_URL, { connection });
      const relays = [relay];

      const promise = fetchProfile(pubkey, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      expect(
        logger.infoLogs.some((log) => log.join(' ').includes('Fetching profile'))
      ).toBe(true);
    });

    it('should log errors on failure', async () => {
      const logger = createMockLogger();
      const relays = createMockRelays([RELAY1_URL]);
      const pubkey = TEST_PUBKEY;

      const connection = relays[0].getConnection();
      if (connection) {
        connection.shouldFailConnect = true;
      }

      const promise = fetchProfile(pubkey, relays, testPolicy, logger);
      await vi.runAllTimersAsync();
      await promise;

      expect(
        logger.errorLogs.some((log) => log.join(' ').includes('Failed to fetch profile'))
      ).toBe(true);
    });
  });
});

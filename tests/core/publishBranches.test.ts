import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishSignedEvent, publishSignedEventStreaming } from '../../src/core/PublishEngine';
import { publishToRelay } from '../../src/core/RelayPublisher';
import type { PublishPolicy } from '../../src/policies/PublishPolicy';
import { createSignedEvent } from '../utils/fixtures';
import { MockRelay, MockRelayConnection } from '../utils/mocks';
import { createMockLogger } from '../utils/testHelpers';

const SLOW_URL = 'wss://slow-warning.example.com';
const UNHEALTHY_URL = 'wss://unhealthy-filter.example.com';
const RETRY_URL = 'wss://retry-once.example.com';
const CIRCUIT_URL = 'wss://circuit-open.example.com';
const CLOSE_URL = 'wss://close-throws.example.com';
const ABORT_URL = 'wss://already-aborted.example.com';

const metrics = () => ({
  increment: vi.fn(),
  histogram: vi.fn(),
  gauge: vi.fn(),
});

function policy(overrides: Partial<PublishPolicy> = {}): PublishPolicy {
  return {
    relayConcurrency: 2,
    perRelayTimeoutMs: 1_000,
    connectionTimeoutMs: 500,
    overallTimeoutMs: 5_000,
    minSuccessRelays: 1,
    retry: { maxAttempts: 0, backoffMs: 10 },
    successCriteria: (results) => {
      const successCount = results.filter((result) => result.status === 'success').length;
      if (successCount === 0) {
        return { status: 'failed', relays: results };
      }
      if (successCount === results.length) {
        return { status: 'success', relays: results };
      }
      return { status: 'partial', relays: results };
    },
    ...overrides,
  };
}

describe('publish branch coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns before the worker limit and records publish metrics', async () => {
    const logger = createMockLogger();
    const recorded = metrics();
    const connection = new MockRelayConnection({ connectDelay: 30_000 });
    const relay = new MockRelay(SLOW_URL, { connection });
    const slowPolicy = policy({
      overallTimeoutMs: 60_000,
      perRelayTimeoutMs: 60_000,
      connectionTimeoutMs: 60_000,
    });

    const promise = publishSignedEvent(createSignedEvent(), [relay], slowPolicy, logger, recorded);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(recorded.increment).toHaveBeenCalledWith(
      'publish.worker_timeout_warning',
      1,
      expect.objectContaining({ eventId: createSignedEvent().id })
    );
    await vi.runAllTimersAsync();
    const outcome = await promise;
    expect(outcome.relays[0]?.status).toBe('success');
    expect(recorded.increment).toHaveBeenCalledWith('publish.attempts', 1, expect.any(Object));
  });

  it('filters a relay after three consecutive failures', async () => {
    const logger = createMockLogger();
    const connection = new MockRelayConnection({
      shouldFailPublish: true,
      publishError: new Error('Publish failed'),
    });
    const relay = new MockRelay(UNHEALTHY_URL, { connection });
    const event = createSignedEvent();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const promise = publishSignedEvent(event, [relay], policy(), logger);
      await vi.runAllTimersAsync();
      await promise;
    }

    const filtered = publishSignedEvent(event, [relay], policy(), logger);
    await vi.runAllTimersAsync();
    const outcome = await filtered;
    expect(outcome.status).toBe('failed');
    expect(logger.infoLogs.some((log) => String(log[0]).includes('Filtered out'))).toBe(true);
  });

  it('records a streaming failure and its metrics', async () => {
    const logger = createMockLogger();
    const recorded = metrics();
    const connection = new MockRelayConnection({
      shouldFailPublish: true,
      publishError: new Error('rejected by relay'),
    });
    const relay = new MockRelay('wss://stream-fail.example.com', { connection });

    const promise = publishSignedEventStreaming(
      createSignedEvent(),
      [relay],
      policy(),
      logger,
      () => {},
      recorded
    );
    await vi.runAllTimersAsync();
    const outcome = await promise;

    expect(outcome.status).toBe('failed');
    expect(recorded.increment).toHaveBeenCalledWith('publish.success', 0, expect.any(Object));
  });

  it('retries a relay publish and then reports success', async () => {
    const logger = createMockLogger();
    const recorded = metrics();
    const connection = new MockRelayConnection({
      shouldFailPublish: true,
      publishError: new Error('timeout talking to relay'),
    });
    const relay = new MockRelay(RETRY_URL, { connection });
    const retryPolicy = policy({ retry: { maxAttempts: 2, backoffMs: 5 } });

    const first = publishToRelay(
      relay,
      createSignedEvent(),
      retryPolicy,
      logger,
      undefined,
      recorded
    );
    await vi.runAllTimersAsync();
    await expect(first).resolves.toMatchObject({ status: 'failure', reason: 'timeout' });

    connection.shouldFailPublish = false;
    const second = publishToRelay(
      relay,
      createSignedEvent(),
      retryPolicy,
      logger,
      undefined,
      recorded
    );
    await vi.runAllTimersAsync();
    await expect(second).resolves.toMatchObject({ status: 'success' });
    expect(recorded.increment).toHaveBeenCalledWith(
      'relay.publish.success',
      1,
      expect.objectContaining({ relay: RETRY_URL })
    );
  });

  it('skips a relay whose circuit breaker is open', async () => {
    const logger = createMockLogger();
    const connection = new MockRelayConnection({
      shouldFailConnect: true,
      connectError: new Error('ECONNREFUSED'),
    });
    const relay = new MockRelay(CIRCUIT_URL, { connection });
    const failingPolicy = policy();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const attemptPromise = publishToRelay(relay, createSignedEvent(), failingPolicy, logger);
      await vi.runAllTimersAsync();
      await attemptPromise;
    }

    const blocked = await publishToRelay(relay, createSignedEvent(), failingPolicy, logger);
    expect(blocked).toMatchObject({
      status: 'failure',
      reason: 'relay_unreachable',
      error: 'CIRCUIT_BREAKER_OPEN',
    });
  });

  it('classifies close errors and an already aborted publish', async () => {
    const logger = createMockLogger();
    const connection = new MockRelayConnection();
    connection.close = () => {
      throw new Error('close failed');
    };
    const relay = new MockRelay(CLOSE_URL, { connection });

    const published = publishToRelay(relay, createSignedEvent(), policy(), logger);
    await vi.runAllTimersAsync();
    await expect(published).resolves.toMatchObject({ status: 'success' });
    expect(logger.warnLogs.some((log) => String(log[0]).includes('Error closing connection'))).toBe(
      true
    );

    const stringConnection = new MockRelayConnection();
    stringConnection.close = () => {
      throw 'close string';
    };
    const stringRelay = new MockRelay('wss://close-string.example.com', {
      connection: stringConnection,
    });
    const stringClose = publishToRelay(stringRelay, createSignedEvent(), policy(), logger);
    await vi.runAllTimersAsync();
    await expect(stringClose).resolves.toMatchObject({ status: 'success' });

    const controller = new AbortController();
    controller.abort();
    const aborted = await publishToRelay(
      new MockRelay(ABORT_URL),
      createSignedEvent(),
      policy(),
      logger,
      controller.signal
    );
    expect(aborted.status).toBe('failure');
  });

  it('classifies rejected, invalid, and unknown publish failures', async () => {
    const logger = createMockLogger();
    const cases: Array<[string, string]> = [
      ['rejected by peer', 'rejected'],
      ['INVALID event', 'invalid_event'],
      ['something else', 'unknown'],
    ];

    for (const [message, reason] of cases) {
      const connection = new MockRelayConnection({
        shouldFailPublish: true,
        publishError: new Error(message),
      });
      const relay = new MockRelay(`wss://${reason}.example.com`, { connection });
      const result = publishToRelay(relay, createSignedEvent(), policy(), logger);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toMatchObject({ status: 'failure', reason });
    }
  });
});

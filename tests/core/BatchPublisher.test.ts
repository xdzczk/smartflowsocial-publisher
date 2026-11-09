import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publishBatch } from '../../src/core/BatchPublisher';
import { publishSignedEvent } from '../../src/core/PublishEngine';
import { defaultPolicy } from '../../src/policies/defaultPolicy';
import type { PublishPolicy } from '../../src/policies/PublishPolicy';
import { createSignedEvent } from '../utils/fixtures';
import { createMockLogger, createMockRelays } from '../utils/testHelpers';

vi.mock('../../src/core/PublishEngine', () => ({
  publishSignedEvent: vi.fn(),
}));

const mockedPublish = vi.mocked(publishSignedEvent);

const policy: PublishPolicy = defaultPolicy;

describe('publishBatch', () => {
  beforeEach(() => {
    mockedPublish.mockReset();
  });

  it('returns an empty result without calling the publisher', async () => {
    const logger = createMockLogger();

    const result = await publishBatch(
      [],
      createMockRelays(['wss://relay.example.com']),
      policy,
      logger
    );

    expect(result).toEqual({
      results: [],
      totalEvents: 0,
      successfulEvents: 0,
      failedEvents: 0,
    });
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('counts successes and failures and records metrics', async () => {
    const logger = createMockLogger();
    const metrics = {
      increment: vi.fn(),
      histogram: vi.fn(),
      gauge: vi.fn(),
    };
    const events = [createSignedEvent(), createSignedEvent({ id: 'd'.repeat(64) })];
    mockedPublish
      .mockResolvedValueOnce({ status: 'success', relays: [] })
      .mockResolvedValueOnce({ status: 'failed', relays: [] });

    const result = await publishBatch(
      events,
      createMockRelays(['wss://relay.example.com']),
      policy,
      logger,
      metrics
    );

    expect(result.totalEvents).toBe(2);
    expect(result.successfulEvents).toBe(1);
    expect(result.failedEvents).toBe(1);
    expect(result.results.map((entry) => entry.eventId)).toEqual(events.map((event) => event.id));
    expect(metrics.increment).toHaveBeenCalledWith('batch.publish.attempts', 1);
    expect(metrics.histogram).toHaveBeenCalledWith('batch.publish.event_count', 2);
  });

  it('turns a thrown publish error into a failed batch entry', async () => {
    const logger = createMockLogger();
    const event = createSignedEvent();
    mockedPublish.mockRejectedValueOnce('relay exploded');

    const result = await publishBatch([event], [], policy, logger);

    expect(result.failedEvents).toBe(1);
    expect(result.results[0]?.outcome.status).toBe('failed');
    expect(logger.errorLogs.some((log) => String(log[0]).includes('Batch publish failed'))).toBe(
      true
    );
  });
});

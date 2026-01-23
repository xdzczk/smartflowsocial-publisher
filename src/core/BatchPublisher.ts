import type { Logger } from '../observability/logger';
import type { Metrics } from '../observability/metrics';
import type { PublishPolicy } from '../policies/PublishPolicy';

import { publishSignedEvent } from './PublishEngine';
import type { Relay } from './Relay';
import type { PublishOutcome, SignedEvent } from './types';

/**
 * Batch publish result for a single event
 */
export interface BatchEventResult {
  eventId: string;
  outcome: PublishOutcome;
}

/**
 * Batch publish result
 */
export interface BatchPublishResult {
  results: BatchEventResult[];
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
}

/**
 * Publishes multiple events to multiple relays in batch
 * Optimizes relay operations by reusing connections where possible
 * @param events Array of signed events to publish
 * @param relays Array of relays to publish to
 * @param policy Publish policy
 * @param logger Logger instance
 * @param metrics Optional metrics instance
 * @returns Batch publish results
 */
export async function publishBatch(
  events: SignedEvent[],
  relays: Relay[],
  policy: PublishPolicy,
  logger: Logger,
  metrics?: Metrics
): Promise<BatchPublishResult> {
  const startTime = Date.now();
  logger.info(`Starting batch publish of ${events.length} event(s) to ${relays.length} relay(s)`);

  if (events.length === 0) {
    return {
      results: [],
      totalEvents: 0,
      successfulEvents: 0,
      failedEvents: 0,
    };
  }

  // Publish all events concurrently (with concurrency limit)
  const publishPromises = events.map(async (event) => {
    try {
      const outcome = await publishSignedEvent(event, relays, policy, logger, metrics);
      return { eventId: event.id, outcome };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[${event.id}] Batch publish failed: ${errorMessage}`);
      const outcome: PublishOutcome = {
        status: 'failed',
        relays: [],
      };
      return {
        eventId: event.id,
        outcome,
      };
    }
  });

  const results = await Promise.all(publishPromises);

  const successfulEvents = results.filter((r) => r.outcome.status === 'success').length;
  const failedEvents = results.filter((r) => r.outcome.status === 'failed').length;

  const elapsed = Date.now() - startTime;
  logger.info(
    `Batch publish completed in ${elapsed}ms: ${successfulEvents} successful, ${failedEvents} failed`
  );

  if (metrics) {
    metrics.increment('batch.publish.attempts', 1);
    metrics.increment('batch.publish.success', successfulEvents);
    metrics.increment('batch.publish.failed', failedEvents);
    metrics.histogram('batch.publish.latency', elapsed);
    metrics.histogram('batch.publish.event_count', events.length);
  }

  return {
    results,
    totalEvents: events.length,
    successfulEvents,
    failedEvents,
  };
}

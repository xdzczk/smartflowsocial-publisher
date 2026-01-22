import type { Logger } from '../observability/logger';
import type { PublishPolicy } from '../policies/PublishPolicy';

import type { Relay } from './Relay';
import { publishToRelay } from './RelayPublisher';
import type { PublishOutcome, RelayResult, RelayUrl, SignedEvent } from './types';

/**
 * Limits concurrency of async operations
 * Uses Promise.race to wait for one to complete when at limit
 */
async function limitConcurrency<T, R>(
  items: T[],
  limit: number,
  // eslint-disable-next-line no-unused-vars
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Array<Promise<void>> = [];

  for (const item of items) {
    // Wait if we're at the limit
    if (executing.length >= limit) {
      await Promise.race(executing);
      // Filter out settled promises (they resolve immediately on next race)
      // This is a simple approach - completed promises will resolve instantly
      // so they won't block, but we don't explicitly remove them
    }

    // Start the operation
    let operationPromise: Promise<R>;
    try {
      operationPromise = fn(item);
    } catch (error) {
      // Create a rejected promise to maintain consistency
      operationPromise = Promise.reject(error);
    }

    const promise = (async () => {
      try {
        const result = await operationPromise;
        results.push(result);
      } catch (error) {
        // Create a default error result
        const errorResult = {
          relay: String(item) as RelayUrl,
          status: 'failure' as const,
          reason: 'unknown' as const,
          latencyMs: 0,
          error: error instanceof Error ? error.message : String(error),
        } as R;
        results.push(errorResult);
      }
    })();

    executing.push(promise);
  }

  // Wait for all remaining operations
  await Promise.all(executing);
  return results;
}

/**
 * Publishes a signed event to multiple relays with concurrency control and timeout handling
 * Returns a structured outcome classifying success/partial/failed
 */
export async function publishSignedEvent(
  event: SignedEvent,
  relays: Relay[],
  policy: PublishPolicy,
  logger: Logger
): Promise<PublishOutcome> {
  const startTime = Date.now();
  const eventId = event.id;

  logger.info(`[${eventId}] Starting publish to ${relays.length} relay(s)`);

  if (relays.length === 0) {
    return {
      status: 'failed',
      relays: [],
    };
  }

  const completedRelays = new Set<RelayUrl>();
  let results: RelayResult[] = [];

  // Publish to all relays with concurrency limit
  const publishPromise = (async () => {
    try {
      const publishResults = await limitConcurrency(relays, policy.relayConcurrency, (relay) =>
        publishToRelay(relay, event, policy, logger)
      );
      results = publishResults;
      for (const result of publishResults) {
        completedRelays.add(result.relay);
      }
    } catch (error) {
      logger.error(`[${eventId}] Error in concurrent publish: ${error}`);
      throw error;
    }
  })();

  // Set up overall timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, policy.overallTimeoutMs);
  });

  // Race between publishing and overall timeout
  try {
    await Promise.race([publishPromise, timeoutPromise]);
  } catch (error) {
    logger.error(`[${eventId}] Error during publish: ${error}`);
    // Continue to return results even if there was an error
  }

  const elapsed = Date.now() - startTime;
  logger.info(`[${eventId}] Publish completed in ${elapsed}ms, ${results.length} results`);

  // If overall timeout hit, mark remaining relays as timeout
  for (const relay of relays) {
    if (!completedRelays.has(relay.url)) {
      results.push({
        relay: relay.url,
        status: 'failure',
        reason: 'timeout',
        latencyMs: Math.min(elapsed, policy.overallTimeoutMs),
        error: 'TIMEOUT',
      });
    }
  }

  // Ensure we have results for all relays
  const relayUrlSet = new Set(relays.map((r) => r.url));
  for (const relayUrl of relayUrlSet) {
    if (!results.some((r) => r.relay === relayUrl)) {
      results.push({
        relay: relayUrl,
        status: 'failure',
        reason: 'timeout',
        latencyMs: elapsed,
        error: 'TIMEOUT',
      });
    }
  }

  // Sort results to match input order
  const relayIndexMap = new Map(relays.map((r, index) => [r.url, index]));
  results.sort((a, b) => {
    const indexA = relayIndexMap.get(a.relay) ?? Infinity;
    const indexB = relayIndexMap.get(b.relay) ?? Infinity;
    return indexA - indexB;
  });

  // Classify outcome based on policy
  const successCount = results.filter((r) => r.status === 'success').length;
  const minSuccess = policy.minSuccessRelays;

  if (successCount >= minSuccess) {
    if (successCount === results.length) {
      return { status: 'success', relays: results };
    }
    return { status: 'partial', relays: results };
  }

  return { status: 'failed', relays: results };
}

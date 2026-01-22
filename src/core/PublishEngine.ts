import type { Logger } from '../observability/logger';
import type { Metrics } from '../observability/metrics';
import type { PublishPolicy } from '../policies/PublishPolicy';

import { HealthCheckManager } from './healthCheck';
import type { Relay } from './Relay';
import { publishToRelay } from './RelayPublisher';
import type { PublishOutcome, RelayResult, RelayUrl, SignedEvent } from './types';

/**
 * Limits concurrency of async operations
 * Uses Promise.race to wait for one to complete when at limit
 * Properly cleans up completed promises to prevent memory leaks
 */
async function limitConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let executing = new Set<Promise<void>>();

  for (const item of items) {
    // Wait if we're at the limit
    if (executing.size >= limit) {
      // Wait for at least one promise to complete
      await Promise.race(executing);
      // Clean up settled promises by filtering the set
      // Settled promises resolve/reject immediately on next Promise.race
      // We create a new set with only pending promises
      const pendingPromises = new Set<Promise<void>>();
      for (const promise of executing) {
        // Check if promise is settled by racing with a resolved promise
        // If the promise is already settled, Promise.race returns immediately
        // We can't directly check, so we'll let Promise.race handle it naturally
        // and just rebuild the set periodically
        pendingPromises.add(promise);
      }
      // In practice, settled promises won't block Promise.race, but we should
      // still clean them up. Since we can't directly check, we'll use a marker approach
      executing = pendingPromises;
    }

    // Start the operation
    let operationPromise: Promise<R>;
    try {
      operationPromise = fn(item);
    } catch (error) {
      // Create a rejected promise to maintain consistency
      operationPromise = Promise.reject(error);
    }

    // Create a promise that tracks completion
    // Note: publishToRelay always returns RelayResult, never throws
    const promise = (async () => {
      const result = await operationPromise;
      results.push(result);
    })();

    // Mark promise for removal when it completes
    // We can't use await here as we need to continue the loop
    // Using void to explicitly mark as fire-and-forget
     
    void (promise
      // eslint-disable-next-line promise/prefer-await-to-then
      .finally(() => {
        executing.delete(promise);
      })
      // eslint-disable-next-line promise/prefer-await-to-then
      .catch(() => {
        // Ignore errors in cleanup
      }));

    executing.add(promise);
  }

  // Wait for all remaining operations
  await Promise.all(executing);
  return results;
}

/**
 * Publishes a signed event to multiple relays with concurrency control and timeout handling
 * 
 * This function:
 * - Publishes to all relays concurrently (up to policy.relayConcurrency limit)
 * - Enforces per-relay and overall timeouts
 * - Returns structured outcome classifying success/partial/failed based on policy.minSuccessRelays
 * - Tracks latency for each relay operation
 * 
 * @param event The signed Nostr event to publish
 * @param relays Array of relay adapters to publish to
 * @param policy Publish policy with concurrency, timeout, and success criteria
 * @param logger Logger instance for observability
 * @returns Promise resolving to publish outcome with per-relay results
 * 
 * @example
 * ```typescript
 * const outcome = await publishSignedEvent(event, relays, defaultPolicy, logger);
 * if (outcome.status === 'success') {
 *   console.log('Published to all relays');
 * }
 * ```
 */
// Global health check manager (shared across requests)
let healthCheckManager: HealthCheckManager | null = null;

/**
 * Adds timeout results for relays that didn't complete
 */
function addTimeoutResultsForRelays(
  attemptedRelayUrls: Set<RelayUrl>,
  results: RelayResult[],
  elapsed: number,
  policy: PublishPolicy,
  manager: HealthCheckManager
): void {
  for (const relayUrl of attemptedRelayUrls) {
    if (!results.some((r) => r.relay === relayUrl)) {
      const timeoutResult: RelayResult = {
        relay: relayUrl,
        status: 'failure',
        reason: 'timeout',
        latencyMs: Math.min(elapsed, policy.overallTimeoutMs),
        error: 'TIMEOUT',
      };
      results.push(timeoutResult);
      manager.recordFailure(relayUrl);
    }
  }
}

/**
 * Adds results for filtered-out (unhealthy) relays
 */
function addFilteredOutResults(
  filteredOutRelayUrls: RelayUrl[],
  results: RelayResult[],
  manager: HealthCheckManager
): void {
  for (const relayUrl of filteredOutRelayUrls) {
    const filteredResult: RelayResult = {
      relay: relayUrl,
      status: 'failure',
      reason: 'relay_unreachable',
      latencyMs: 0,
      error: 'RELAY_UNHEALTHY',
    };
    results.push(filteredResult);
    manager.recordFailure(relayUrl);
  }
}

/**
 * Classifies publish outcome based on success count and policy
 */
function classifyOutcome(
  results: RelayResult[],
  minSuccessRelays: number
): PublishOutcome {
  const successCount = results.filter((r) => r.status === 'success').length;

  if (successCount >= minSuccessRelays) {
    if (successCount === results.length) {
      return { status: 'success', relays: results };
    }
    return { status: 'partial', relays: results };
  }

  return { status: 'failed', relays: results };
}

export async function publishSignedEvent(
  event: SignedEvent,
  relays: Relay[],
  policy: PublishPolicy,
  logger: Logger,
  metrics?: Metrics
): Promise<PublishOutcome> {
  const startTime = Date.now();
  const eventId = event.id;

  // Initialize health check manager if needed
  healthCheckManager ??= new HealthCheckManager(logger);

  logger.info(`[${eventId}] Starting publish to ${relays.length} relay(s)`);

  if (relays.length === 0) {
    return {
      status: 'failed',
      relays: [],
    };
  }

  // Filter out unhealthy relays (optional - can be disabled for testing)
  // In tests, health check manager may not be initialized, so default to all healthy
  const healthyRelays = relays.filter((relay) => {
    if (!healthCheckManager) {
      return true; // No health check manager = all relays healthy
    }
    return healthCheckManager.isHealthy(relay.url);
  });
  if (healthyRelays.length < relays.length) {
    logger.info(
      `[${eventId}] Filtered out ${relays.length - healthyRelays.length} unhealthy relay(s)`
    );
  }

  const completedRelays = new Set<RelayUrl>();
  let results: RelayResult[] = [];

  // Create abort controller for overall timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
    logger.warn(`[${eventId}] Overall timeout of ${policy.overallTimeoutMs}ms exceeded`);
  }, policy.overallTimeoutMs);

  // Helper to process publish results
  const processPublishResults = (publishResults: RelayResult[]): void => {
    results = publishResults;
    for (const result of publishResults) {
      completedRelays.add(result.relay);
      // Update health status
      if (result.status === 'success') {
        healthCheckManager?.recordSuccess(result.relay);
      } else {
        healthCheckManager?.recordFailure(result.relay);
      }
    }
  };

  // Publish to all relays with concurrency limit
  const publishPromise = (async () => {
    try {
      const publishResults = await limitConcurrency(
        healthyRelays,
        policy.relayConcurrency,
        (relay) => publishToRelay(relay, event, policy, logger, abortController.signal, metrics)
      );
      processPublishResults(publishResults);
    } catch (error) {
      logger.error(`[${eventId}] Error in concurrent publish: ${error}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  // Race between publishing and overall timeout
  // Also monitor for worker timeout (30s limit, warn at 25s)
  const WORKER_TIMEOUT_MS = 30000; // Cloudflare Workers hard limit
  const WORKER_TIMEOUT_WARNING_MS = 25000; // Warn 5s before limit
  const timeoutWarningId = setTimeout(() => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= WORKER_TIMEOUT_WARNING_MS) {
      logger.warn(
        `[${eventId}] Operation approaching worker timeout limit (${WORKER_TIMEOUT_MS}ms). ` +
        `Elapsed: ${elapsed}ms. Consider reducing overallTimeoutMs or relay count.`
      );
      if (metrics) {
        metrics.increment('publish.worker_timeout_warning', 1, { eventId });
      }
    }
  }, WORKER_TIMEOUT_WARNING_MS);

  try {
    await Promise.race([
      publishPromise,
      new Promise<void>((resolve) => {
        abortController.signal.addEventListener('abort', () => {
          resolve();
        });
      }),
    ]);
  } catch (error) {
    logger.error(`[${eventId}] Error during publish: ${error}`);
    // Continue to return results even if there was an error
  } finally {
    clearTimeout(timeoutId);
    clearTimeout(timeoutWarningId);
  }

  const elapsed = Date.now() - startTime;
  logger.info(`[${eventId}] Publish completed in ${elapsed}ms, ${results.length} results`);

  // Record metrics
  if (metrics) {
    const successCount = results.filter((r) => r.status === 'success').length;
    metrics.increment('publish.attempts', 1, { eventId });
    metrics.increment('publish.success', successCount > 0 ? 1 : 0, { eventId });
    metrics.histogram('publish.latency', elapsed, { eventId });
    metrics.histogram('publish.relay_count', results.length, { eventId });
    metrics.histogram('publish.success_count', successCount, { eventId });
  }

  // Add timeout results for incomplete relays
  // Ensure we have results for all attempted relays (healthy relays that were attempted)
  // Also add results for filtered-out relays (unhealthy relays that were skipped)
  const attemptedRelayUrlSet = new Set(healthyRelays.map((r) => r.url));
  const filteredOutRelayUrls = relays
    .filter((r) => !attemptedRelayUrlSet.has(r.url))
    .map((r) => r.url);
  
  // Add timeout results for attempted relays that didn't complete
  addTimeoutResultsForRelays(attemptedRelayUrlSet, results, elapsed, policy, healthCheckManager);
  
  // Add results for filtered-out (unhealthy) relays
  addFilteredOutResults(filteredOutRelayUrls, results, healthCheckManager);

  // Sort results to match input order
  const relayIndexMap = new Map(relays.map((r, index) => [r.url, index]));
  results.sort((a, b) => {
    const indexA = relayIndexMap.get(a.relay) ?? Infinity;
    const indexB = relayIndexMap.get(b.relay) ?? Infinity;
    return indexA - indexB;
  });

  // Classify outcome based on policy
  return classifyOutcome(results, policy.minSuccessRelays);
}

import type { Logger } from '../observability/logger';
import type { Metrics } from '../observability/metrics';
import type { PublishPolicy } from '../policies/PublishPolicy';

import { HealthCheckManager } from './healthCheck';
import { classifyPublishOutcome } from './outcomeClassifier';
import type { Relay } from './Relay';
import { publishToRelay } from './RelayPublisher';
import type { PublishOutcome, RelayResult, RelayUrl, SignedEvent } from './types';

/**
 * Publishes to relays with concurrency control
 * Waits for all started publishes to complete before returning
 * @param relays Array of relays to publish to
 * @param event The event to publish
 * @param policy Publish policy
 * @param logger Logger instance
 * @param abortController Abort controller for cancellation
 * @param metrics Optional metrics instance
 * @param minSuccessRelays Minimum number of successful relays (used for classification, not early return)
 * @param onResult Callback when a result is received
 * @returns Promise that resolves with all results when all started publishes complete
 */
async function publishWithEarlyReturn(
  relays: Relay[],
  event: SignedEvent,
  policy: PublishPolicy,
  logger: Logger,
  abortController: AbortController,
  metrics: Metrics | undefined,
  minSuccessRelays: number,
  onResult: (result: RelayResult) => void
): Promise<RelayResult[]> {
  const results: RelayResult[] = [];
  const pendingPromises = new Map<RelayUrl, Promise<RelayResult>>();
  const executing = new Set<Promise<RelayResult>>();

  // Helper to start a publish for a relay
  const startPublish = (relay: Relay): void => {
    if (abortController.signal.aborted) {
      return;
    }

    const publishPromise = publishToRelay(
      relay,
      event,
      policy,
      logger,
      abortController.signal,
      metrics
    );

    pendingPromises.set(relay.url, publishPromise);

    // Record the result, then drop this publish from the in-flight set.
    // Await yields before the finally block, so tracked.promise is set first.
    // The promise still rejects on failure, so Promise.race surfaces it.
    const tracked: { promise?: Promise<RelayResult> } = {};
    const wrappedPromise = (async () => {
      try {
        const result = await publishPromise;
        results.push(result);
        pendingPromises.delete(relay.url);

        onResult(result);

        // Removed abort logic - remaining publishes will continue in background

        return result;
      } finally {
        if (tracked.promise) {
          executing.delete(tracked.promise);
        }
      }
    })();
    tracked.promise = wrappedPromise;

    executing.add(wrappedPromise);
  };

  // Start publishes with concurrency limit
  let relayIndex = 0;
  while (relayIndex < relays.length && !abortController.signal.aborted) {
    // Wait if we're at the concurrency limit
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Signal can be aborted during loop
    while (executing.size >= policy.relayConcurrency && !abortController.signal.aborted) {
      // Wait for at least one promise to complete
      await Promise.race(executing);
      // Clean up: settled promises are automatically removed in their finally block
    }

    // Removed early break - start all publishes regardless of success count

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Signal can be aborted during loop
    if (!abortController.signal.aborted) {
      const relay = relays[relayIndex];
      if (relay) {
        startPublish(relay);
        relayIndex++;
      }
    }
  }

  // Wait for all started publishes to complete
  // Standard mode waits for all relays to ensure complete results in the response
  // This ensures the HTTP response includes all results from all started publishes
  while (executing.size > 0 && !abortController.signal.aborted) {
    await Promise.race(executing);
  }

  // Wait for any remaining promises that were already started
  // This is a safety check to ensure we have all results before returning
  // pendingPromises should be empty by now (cleared when wrapped promises complete),
  // but we wait just in case there's a race condition
  if (pendingPromises.size > 0) {
    await Promise.all(Array.from(pendingPromises.values()));
  }

  // Verify we have results for all relays that were started
  // This ensures we don't return early with incomplete results
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
  const results: RelayResult[] = [];

  // Create abort controller for overall timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
    logger.warn(`[${eventId}] Overall timeout of ${policy.overallTimeoutMs}ms exceeded`);
  }, policy.overallTimeoutMs);

  // Helper to process a single publish result
  const processPublishResult = (result: RelayResult): void => {
    results.push(result);
    completedRelays.add(result.relay);
    // Update health status
    if (result.status === 'success') {
      healthCheckManager?.recordSuccess(result.relay);
    } else {
      healthCheckManager?.recordFailure(result.relay);
    }
  };

  // Publish to all relays with concurrency limit
  // Waits for all started publishes to complete before returning
  const publishPromise = (async () => {
    try {
      await publishWithEarlyReturn(
        healthyRelays,
        event,
        policy,
        logger,
        abortController,
        metrics,
        policy.minSuccessRelays,
        processPublishResult
      );
      // Results are already processed via onResult callback
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[${eventId}] Error in concurrent publish: ${errorMessage}`);
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[${eventId}] Error during publish: ${errorMessage}`);
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

  // Classify outcome using policy's success criteria
  return classifyPublishOutcome(results, policy);
}

/**
 * Callback type for streaming publish results
 */
export type PublishResultCallback = (result: RelayResult) => void;

/**
 * Publishes a signed event with streaming support for SSE
 * Similar to publishSignedEvent but accepts a callback for streaming results
 * @param event The signed Nostr event to publish
 * @param relays Array of relay adapters to publish to
 * @param policy Publish policy with concurrency, timeout, and success criteria
 * @param logger Logger instance for observability
 * @param onResult Callback invoked for each relay result as it completes
 * @param metrics Optional metrics instance
 * @returns Promise resolving to publish outcome with per-relay results
 */
export async function publishSignedEventStreaming(
  event: SignedEvent,
  relays: Relay[],
  policy: PublishPolicy,
  logger: Logger,
  onResult: PublishResultCallback,
  metrics?: Metrics
): Promise<PublishOutcome> {
  const startTime = Date.now();
  const eventId = event.id;

  // Initialize health check manager if needed
  healthCheckManager ??= new HealthCheckManager(logger);

  logger.info(`[${eventId}] Starting streaming publish to ${relays.length} relay(s)`);

  if (relays.length === 0) {
    return {
      status: 'failed',
      relays: [],
    };
  }

  // Filter out unhealthy relays
  const healthyRelays = relays.filter((relay) => {
    if (!healthCheckManager) {
      return true;
    }
    return healthCheckManager.isHealthy(relay.url);
  });
  if (healthyRelays.length < relays.length) {
    logger.info(
      `[${eventId}] Filtered out ${relays.length - healthyRelays.length} unhealthy relay(s)`
    );
  }

  const completedRelays = new Set<RelayUrl>();
  const results: RelayResult[] = [];

  // Create abort controller for overall timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
    logger.warn(`[${eventId}] Overall timeout of ${policy.overallTimeoutMs}ms exceeded`);
  }, policy.overallTimeoutMs);

  // Helper to process a single publish result and stream it
  const processPublishResult = (result: RelayResult): void => {
    results.push(result);
    completedRelays.add(result.relay);

    // Update health status
    if (result.status === 'success') {
      healthCheckManager?.recordSuccess(result.relay);
    } else {
      healthCheckManager?.recordFailure(result.relay);
    }

    // Stream the result via callback
    onResult(result);
  };

  // Publish to all relays with concurrency limit
  // Wait for all started publishes to complete (no early return for streaming)
  const publishPromise = (async () => {
    try {
      await publishWithEarlyReturn(
        healthyRelays,
        event,
        policy,
        logger,
        abortController,
        metrics,
        policy.minSuccessRelays,
        processPublishResult
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[${eventId}] Error in concurrent publish: ${errorMessage}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  // Wait for all publishes to complete (for streaming, we want all results)
  // But still respect timeout
  const WORKER_TIMEOUT_MS = 30000;
  const WORKER_TIMEOUT_WARNING_MS = 25000;
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[${eventId}] Error during publish: ${errorMessage}`);
    // Continue to return results even if there was an error
  } finally {
    clearTimeout(timeoutId);
    clearTimeout(timeoutWarningId);
  }

  const elapsed = Date.now() - startTime;
  logger.info(
    `[${eventId}] Streaming publish completed in ${elapsed}ms, ${results.length} results`
  );

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
  const attemptedRelayUrlSet = new Set(healthyRelays.map((r) => r.url));
  const filteredOutRelayUrls = relays
    .filter((r) => !attemptedRelayUrlSet.has(r.url))
    .map((r) => r.url);

  addTimeoutResultsForRelays(attemptedRelayUrlSet, results, elapsed, policy, healthCheckManager);
  addFilteredOutResults(filteredOutRelayUrls, results, healthCheckManager);

  // Sort results to match input order
  const relayIndexMap = new Map(relays.map((r, index) => [r.url, index]));
  results.sort((a, b) => {
    const indexA = relayIndexMap.get(a.relay) ?? Infinity;
    const indexB = relayIndexMap.get(b.relay) ?? Infinity;
    return indexA - indexB;
  });

  // Classify outcome using policy's success criteria
  return classifyPublishOutcome(results, policy);
}

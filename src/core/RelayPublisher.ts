import type { Logger } from '../observability/logger';
import type { Metrics } from '../observability/metrics';
import type { PublishPolicy } from '../policies/PublishPolicy';

import { CircuitBreakerManager, defaultCircuitBreakerConfig } from './circuitBreaker';
import { TimeoutError } from './errors';
import type { Relay, RelayConnection } from './Relay';
import { retryWithBackoff } from './retry';
import type { RelayFailureReason, RelayResult, SignedEvent } from './types';

const OPERATION_ABORTED_MSG = 'Operation aborted';

// Global circuit breaker manager (shared across requests in same worker instance)
let circuitBreakerManager: CircuitBreakerManager | null = null;

/**
 * Resets the circuit breaker manager (useful for testing)
 */
export function resetCircuitBreakerManager(): void {
  circuitBreakerManager?.reset();
  circuitBreakerManager = null;
}

/**
 * Internal function that performs a single publish attempt
 * @param relay The relay to publish to
 * @param event The signed event to publish
 * @param policy The publish policy with timeout settings
 * @param logger Logger instance
 * @param abortSignal Optional abort signal for cancellation
 * @returns Result of the publish operation
 */
async function publishToRelayAttempt(
  relay: Relay,
  event: SignedEvent,
  policy: PublishPolicy,
  logger: Logger,
  abortSignal?: AbortSignal
): Promise<RelayResult> {
  const startTime = Date.now();
  const relayUrl = relay.url;

  let connection: RelayConnection | null = null;

  try {
    // Check if already aborted
    if (abortSignal?.aborted) {
      throw new TimeoutError(OPERATION_ABORTED_MSG, policy.connectionTimeoutMs);
    }

    // Set up connection timeout with abort signal support
    const connectionTimeout = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError('CONNECTION_TIMEOUT', policy.connectionTimeoutMs));
      }, policy.connectionTimeoutMs);

      abortSignal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new TimeoutError(OPERATION_ABORTED_MSG, policy.connectionTimeoutMs));
      });
    });

    // Create connection
    const connectionPromise = relay.createConnection();
    connection = await Promise.race([connectionPromise, connectionTimeout]);

    await Promise.race([connection.connect(), connectionTimeout]);

    // Check if aborted before publishing
    if (abortSignal?.aborted) {
      throw new TimeoutError(OPERATION_ABORTED_MSG, policy.perRelayTimeoutMs);
    }

    // Calculate remaining time for publish
    const elapsed = Date.now() - startTime;
    const remainingTime = policy.perRelayTimeoutMs - elapsed;

    if (remainingTime <= 0) {
      throw new TimeoutError('PUBLISH_TIMEOUT', policy.perRelayTimeoutMs);
    }

    // Set up publish timeout with abort signal support
    const publishTimeout = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError('PUBLISH_TIMEOUT', remainingTime));
      }, remainingTime);

      abortSignal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new TimeoutError(OPERATION_ABORTED_MSG, remainingTime));
      });
    });

    // Publish with timeout
    await Promise.race([connection.publish(event), publishTimeout]);

    const latencyMs = Date.now() - startTime;

    return {
      relay: relayUrl,
      status: 'success',
      latencyMs,
    };
  } finally {
    // Cleanup connection
    if (connection) {
      try {
        connection.close();
        logger.info(`[${relayUrl}] Connection closed`);
      } catch (closeError) {
        logger.warn(`[${relayUrl}] Error closing connection: ${closeError}`);
      }
    }
  }
}

/**
 * Publishes an event to a single relay with timeout handling and retry logic
 * Returns structured result with failure reason classification
 * @param relay The relay to publish to
 * @param event The signed event to publish
 * @param policy The publish policy with timeout and retry settings
 * @param logger Logger instance
 * @param abortSignal Optional abort signal for cancellation
 * @param metrics Optional metrics instance for tracking
 * @returns Result of the publish operation
 */
export async function publishToRelay(
  relay: Relay,
  event: SignedEvent,
  policy: PublishPolicy,
  logger: Logger,
  abortSignal?: AbortSignal,
  metrics?: Metrics
): Promise<RelayResult> {
  const overallStartTime = Date.now();
  const relayUrl = relay.url;

  // Initialize circuit breaker manager if needed
  circuitBreakerManager ??= new CircuitBreakerManager(defaultCircuitBreakerConfig, logger);

  // Check circuit breaker
  if (!circuitBreakerManager.canAttempt(relayUrl)) {
    logger.warn(`[${relayUrl}] Circuit breaker is open, skipping publish`);
    return {
      relay: relayUrl,
      status: 'failure',
      reason: 'relay_unreachable',
      latencyMs: 0,
      error: 'CIRCUIT_BREAKER_OPEN',
    };
  }

  logger.info(`[${relayUrl}] Starting publish for event ${event.id}`);

  // If retries are disabled, just attempt once
  if (policy.retry.maxAttempts === 0) {
    try {
      const result = await publishToRelayAttempt(relay, event, policy, logger, abortSignal);
      // Update circuit breaker
      circuitBreakerManager.recordSuccess(relayUrl);
      return result;
    } catch (error) {
      // Handle error and return failure result
      const latencyMs = Date.now() - overallStartTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const reason = classifyFailureReason(errorMessage);
      
      circuitBreakerManager.recordFailure(relayUrl);
      
      logger.error(`[${relayUrl}] Publish failed: ${errorMessage}`);
      
      return {
        relay: relayUrl,
        status: 'failure',
        reason,
        latencyMs,
        error: errorMessage,
      };
    }
  }

  // Use retry logic with backoff
  try {
    const result = await retryWithBackoff(
      () => publishToRelayAttempt(relay, event, policy, logger, abortSignal),
      policy.retry.maxAttempts,
      policy.retry.backoffMs,
      logger,
      abortSignal
    );

    // Update latency to include retry time
    const totalLatencyMs = Date.now() - overallStartTime;

    // Update circuit breaker
    circuitBreakerManager.recordSuccess(relayUrl);

    // Record metrics
    if (metrics) {
      metrics.increment('relay.publish.success', 1, { relay: relayUrl });
      metrics.histogram('relay.publish.latency', totalLatencyMs, { relay: relayUrl });
    }

    return {
      ...result,
      latencyMs: totalLatencyMs,
    };
  } catch (error) {
    // All retries failed
    const totalLatencyMs = Date.now() - overallStartTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const reason = classifyFailureReason(errorMessage);

    // Update circuit breaker
    circuitBreakerManager.recordFailure(relayUrl);

    logger.error(`[${relayUrl}] Publish failed after retries: ${errorMessage}`);

    // Record metrics
    if (metrics) {
      metrics.increment('relay.publish.failure', 1, { relay: relayUrl, reason });
      metrics.histogram('relay.publish.latency', totalLatencyMs, { relay: relayUrl });
    }

    return {
      relay: relayUrl,
      status: 'failure',
      reason,
      latencyMs: totalLatencyMs,
      error: errorMessage,
    };
  }
}

/**
 * Classifies error messages into structured failure reasons
 */
function classifyFailureReason(errorMessage: string): RelayFailureReason {
  // Check for specific timeout types first
  if (errorMessage === 'CONNECTION_TIMEOUT' || errorMessage.includes('CONNECTION_TIMEOUT')) {
    return 'connection_timeout';
  }
  if (errorMessage === 'PUBLISH_TIMEOUT' || errorMessage.includes('PUBLISH_TIMEOUT')) {
    return 'publish_timeout';
  }
  // Check for rejected errors (before timeout check to avoid false positives)
  if (errorMessage.includes('rejected') || errorMessage.includes('REJECTED')) {
    return 'rejected';
  }
  // Check for timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('Timeout') || errorMessage.includes('aborted')) {
    return 'timeout';
  }
  // Check for invalid event errors
  if (errorMessage.includes('invalid') || errorMessage.includes('INVALID')) {
    return 'invalid_event';
  }
  // Check for unreachable errors
  if (
    errorMessage.includes('unreachable') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ENOTFOUND')
  ) {
    return 'relay_unreachable';
  }
  return 'unknown';
}

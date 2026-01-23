import type { Logger } from '../observability/logger';
import type { Metrics } from '../observability/metrics';
import type { PublishPolicy } from '../policies/PublishPolicy';

import { CircuitBreakerManager, defaultCircuitBreakerConfig } from './circuitBreaker';
import { TimeoutError } from './errors';
import type { Relay, RelayConnection } from './Relay';
import { retryWithBackoff } from './retry';
import { RelayStateMachineManager, type RelayOperationStateMachine } from './stateMachine';
import type { RelayFailureReason, RelayResult, RelayUrl, SignedEvent } from './types';

const OPERATION_ABORTED_MSG = 'Operation aborted';

// Global circuit breaker manager (shared across requests in same worker instance)
let circuitBreakerManager: CircuitBreakerManager | null = null;

// Global state machine manager (shared across requests in same worker instance)
let stateMachineManager: RelayStateMachineManager | null = null;

/**
 * Resets the circuit breaker manager (useful for testing)
 */
export function resetCircuitBreakerManager(): void {
  circuitBreakerManager?.reset();
  circuitBreakerManager = null;
  stateMachineManager = null;
}

/**
 * Creates a connection timeout promise
 */
function createConnectionTimeout(
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<never> {
  return new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError('CONNECTION_TIMEOUT', timeoutMs));
    }, timeoutMs);

    abortSignal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(new TimeoutError(OPERATION_ABORTED_MSG, timeoutMs));
    });
  });
}

/**
 * Creates a publish timeout promise
 */
function createPublishTimeout(
  remainingTime: number,
  abortSignal?: AbortSignal
): Promise<never> {
  return new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError('PUBLISH_TIMEOUT', remainingTime));
    }, remainingTime);

    abortSignal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(new TimeoutError(OPERATION_ABORTED_MSG, remainingTime));
    });
  });
}

/**
 * Establishes connection to relay
 */
async function establishConnection(
  relay: Relay,
  policy: PublishPolicy,
  abortSignal?: AbortSignal
): Promise<RelayConnection> {
  const connectionTimeout = createConnectionTimeout(policy.connectionTimeoutMs, abortSignal);
  const connectionPromise = relay.createConnection();
  const connection = await Promise.race([connectionPromise, connectionTimeout]);
  await Promise.race([connection.connect(), connectionTimeout]);
  return connection;
}

/**
 * Publishes event with timeout
 */
async function publishWithTimeout(
  connection: RelayConnection,
  event: SignedEvent,
  remainingTime: number,
  abortSignal?: AbortSignal
): Promise<void> {
  const publishTimeout = createPublishTimeout(remainingTime, abortSignal);
  await Promise.race([connection.publish(event), publishTimeout]);
}

/**
 * Updates state machine transition if possible
 */
function updateStateMachineTransition(
  machine: RelayOperationStateMachine | undefined,
  targetState: 'connecting' | 'publishing' | 'success' | 'failure'
): void {
  if (machine?.canTransitionTo(targetState)) {
    machine.transition(targetState);
  }
}

/**
 * Handles abort signal and updates state machine
 */
function handleAbort(
  abortSignal: AbortSignal | undefined,
  machine: RelayOperationStateMachine | undefined,
  timeoutMs: number
): never {
  updateStateMachineTransition(machine, 'failure');
  throw new TimeoutError(OPERATION_ABORTED_MSG, timeoutMs);
}

/**
 * Internal function that performs a single publish attempt
 * @param relay The relay to publish to
 * @param event The signed event to publish
 * @param policy The publish policy with timeout settings
 * @param logger Logger instance
 * @param abortSignal Optional abort signal for cancellation
 * @param stateMachine Optional state machine for tracking operation state
 * @returns Result of the publish operation
 */
async function publishToRelayAttempt(
  relay: Relay,
  event: SignedEvent,
  policy: PublishPolicy,
  logger: Logger,
  abortSignal?: AbortSignal,
  stateMachine?: RelayStateMachineManager
): Promise<RelayResult> {
  const startTime = Date.now();
  const relayUrl = relay.url;
  const machine = stateMachine?.getMachine(relayUrl);

  let connection: RelayConnection | null = null;

  try {
    updateStateMachineTransition(machine, 'connecting');

    if (abortSignal?.aborted) {
      handleAbort(abortSignal, machine, policy.connectionTimeoutMs);
    }

    connection = await establishConnection(relay, policy, abortSignal);
    updateStateMachineTransition(machine, 'publishing');

    if (abortSignal?.aborted) {
      handleAbort(abortSignal, machine, policy.perRelayTimeoutMs);
    }

    const elapsed = Date.now() - startTime;
    const remainingTime = policy.perRelayTimeoutMs - elapsed;

    if (remainingTime <= 0) {
      throw new TimeoutError('PUBLISH_TIMEOUT', policy.perRelayTimeoutMs);
    }

    await publishWithTimeout(connection, event, remainingTime, abortSignal);

    const latencyMs = Date.now() - startTime;
    updateStateMachineTransition(machine, 'success');

    return {
      relay: relayUrl,
      status: 'success',
      latencyMs,
    };
  } catch (error) {
    updateStateMachineTransition(machine, 'failure');
    throw error;
  } finally {
    // Cleanup connection
    if (connection) {
      try {
        connection.close();
        logger.info(`[${relayUrl}] Connection closed`);
      } catch (closeError) {
        const errorMessage = closeError instanceof Error ? closeError.message : String(closeError);
        logger.warn(`[${relayUrl}] Error closing connection: ${errorMessage}`);
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

  // Initialize state machine manager if needed
  stateMachineManager ??= new RelayStateMachineManager(logger);
  const stateMachine = stateMachineManager.getMachine(relayUrl);

  // Initialize state machine: idle -> connecting
  if (stateMachine.getState() === 'idle') {
    stateMachine.transition('connecting');
  }

  // Check circuit breaker
  if (!circuitBreakerManager.canAttempt(relayUrl)) {
    logger.warn(`[${relayUrl}] Circuit breaker is open, skipping publish`);
    
    // Update state machine: circuit_open
    if (stateMachine.canTransitionTo('circuit_open')) {
      stateMachine.transition('circuit_open');
    }
    stateMachine.setCircuitState('open');
    
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
    return handleSingleAttempt(
      relay,
      event,
      policy,
      logger,
      abortSignal,
      stateMachineManager,
      circuitBreakerManager,
      relayUrl,
      overallStartTime
    );
  }

  // Use retry logic with backoff and state machine
  return handleRetryAttempt(
    relay,
    event,
    policy,
    logger,
    abortSignal,
    stateMachineManager,
    stateMachine,
    relayUrl,
    circuitBreakerManager,
    metrics,
    overallStartTime
  );
}

/**
 * Handles a single publish attempt without retries
 */
async function handleSingleAttempt(
  relay: Relay,
  event: SignedEvent,
  policy: PublishPolicy,
  logger: Logger,
  abortSignal: AbortSignal | undefined,
  stateMachineManager: RelayStateMachineManager | null,
  circuitBreakerManager: CircuitBreakerManager,
  relayUrl: RelayUrl,
  overallStartTime: number
): Promise<RelayResult> {
  try {
    const result = await publishToRelayAttempt(
      relay,
      event,
      policy,
      logger,
      abortSignal,
      stateMachineManager ?? undefined
    );
    circuitBreakerManager.recordSuccess(relayUrl);
    return result;
  } catch (error) {
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

/**
 * Handles publish with retry logic
 */
async function handleRetryAttempt(
  relay: Relay,
  event: SignedEvent,
  policy: PublishPolicy,
  logger: Logger,
  abortSignal: AbortSignal | undefined,
  stateMachineManager: RelayStateMachineManager | null,
  stateMachine: RelayOperationStateMachine,
  relayUrl: RelayUrl,
  circuitBreakerManager: CircuitBreakerManager,
  metrics: Metrics | undefined,
  overallStartTime: number
): Promise<RelayResult> {
  try {
    const result = await retryWithBackoff(
      () => publishToRelayAttempt(relay, event, policy, logger, abortSignal, stateMachineManager ?? undefined),
      policy.retry.maxAttempts,
      policy.retry.backoffMs,
      logger,
      abortSignal,
      stateMachine,
      relayUrl
    );

    const totalLatencyMs = Date.now() - overallStartTime;
    circuitBreakerManager.recordSuccess(relayUrl);

    if (metrics) {
      metrics.increment('relay.publish.success', 1, { relay: relayUrl });
      metrics.histogram('relay.publish.latency', totalLatencyMs, { relay: relayUrl });
    }

    return {
      ...result,
      latencyMs: totalLatencyMs,
    };
  } catch (error) {
    const totalLatencyMs = Date.now() - overallStartTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const reason = classifyFailureReason(errorMessage);

    circuitBreakerManager.recordFailure(relayUrl);
    logger.error(`[${relayUrl}] Publish failed after retries: ${errorMessage}`);

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

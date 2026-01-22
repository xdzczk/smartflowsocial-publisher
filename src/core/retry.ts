import type { Logger } from '../observability/logger';

import type { RelayOperationStateMachine } from './stateMachine';
import type { RelayUrl } from './types';

/**
 * Determines if an error is retryable
 * @param error The error to check
 * @returns True if the error should be retried
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  // Retry on timeouts and connection failures
  // Don't retry on validation errors or rejections
  return (
    message.includes('timeout') ||
    message.includes('Timeout') ||
    message.includes('TIMEOUT') ||
    message.includes('CONNECTION_TIMEOUT') ||
    message.includes('PUBLISH_TIMEOUT') ||
    message.includes('aborted') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('unreachable') ||
    message.includes('network') ||
    message.includes('Network')
  );
}

/**
 * Calculates exponential backoff delay with jitter
 * @param attempt The current attempt number (0-indexed)
 * @param baseDelayMs The base delay in milliseconds
 * @returns Delay in milliseconds
 */
function calculateBackoff(attempt: number, baseDelayMs: number): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  // Add jitter: ±20% random variation
  const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, exponentialDelay + jitter);
}

/**
 * Retries an async operation with exponential backoff
 * @param operation The async operation to retry
 * @param maxAttempts Maximum number of attempts (including initial)
 * @param baseBackoffMs Base backoff delay in milliseconds
 * @param logger Logger instance
 * @param abortSignal Optional abort signal to cancel retries
 * @returns Result of the operation
 * @throws Last error if all attempts fail
 */
/**
 * Handles a single retry attempt
 */
async function attemptOperation<T>(
  operation: () => Promise<T>,
  attempt: number,
  logger: Logger,
  abortSignal?: AbortSignal
): Promise<T> {
  // Check if aborted before attempting
  if (abortSignal?.aborted) {
    throw new Error('Operation aborted');
  }

  const result = await operation();
  // Success - return immediately
  if (attempt > 0) {
    logger.info(`Operation succeeded after ${attempt + 1} attempt(s)`);
  }
  return result;
}

/**
 * Handles retry logic for a failed attempt
 */
async function handleRetry(
  error: unknown,
  attempt: number,
  maxAttempts: number,
  baseBackoffMs: number,
  logger: Logger,
  abortSignal?: AbortSignal
): Promise<void> {
  // Don't retry if error is not retryable
  if (!isRetryableError(error)) {
    logger.warn(`Non-retryable error encountered: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  // If this was the last attempt, don't wait
  if (attempt >= maxAttempts) {
    logger.error(`Operation failed after ${maxAttempts} attempt(s): ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  // Calculate backoff delay
  const backoffMs = calculateBackoff(attempt - 1, baseBackoffMs);
  logger.info(`Attempt ${attempt} failed, retrying in ${Math.round(backoffMs)}ms...`);

  // Wait with backoff, but respect abort signal
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      resolve();
    }, backoffMs);

    abortSignal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(new Error('Operation aborted during retry backoff'));
    });
  });
}

/**
 * Updates state machine for retry attempt
 */
function updateStateMachineForRetry(
  stateMachine: RelayOperationStateMachine | undefined,
  attempt: number
): void {
  if (stateMachine && attempt > 0) {
    if (stateMachine.canTransitionTo('retry_in_progress')) {
      stateMachine.transition('retry_in_progress');
    }
  }
}

/**
 * Updates state machine on success
 */
function updateStateMachineOnSuccess(
  stateMachine: RelayOperationStateMachine | undefined
): void {
  if (stateMachine?.canTransitionTo('success')) {
    stateMachine.transition('success');
  }
}

/**
 * Updates state machine on failure
 */
function updateStateMachineOnFailure(
  stateMachine: RelayOperationStateMachine | undefined,
  attempt: number,
  maxAttempts: number,
  error: unknown
): void {
  if (!stateMachine) {
    return;
  }

  if (stateMachine.canTransitionTo('failure')) {
    stateMachine.transition('failure');
  }

  // Check if we can retry
  if (attempt < maxAttempts && isRetryableError(error)) {
    if (stateMachine.canTransitionTo('retry_eligible')) {
      stateMachine.transition('retry_eligible');
    }
  } else {
    // No more retries or non-retryable error
    if (stateMachine.canTransitionTo('circuit_open')) {
      stateMachine.transition('circuit_open');
    }
  }
}

/**
 * Initializes state machine if provided
 */
function initializeStateMachine(
  stateMachine: RelayOperationStateMachine | undefined,
  relayUrl: RelayUrl | undefined
): void {
  if (stateMachine && relayUrl && stateMachine.getState() === 'idle') {
    stateMachine.transition('connecting');
  }
}

/**
 * Retries an async operation with exponential backoff and state machine tracking
 * @param operation The async operation to retry
 * @param maxAttempts Maximum number of attempts (including initial)
 * @param baseBackoffMs Base backoff delay in milliseconds
 * @param logger Logger instance
 * @param abortSignal Optional abort signal to cancel retries
 * @param stateMachine Optional state machine for tracking retry state
 * @param relayUrl Optional relay URL for state machine tracking
 * @returns Result of the operation
 * @throws Last error if all attempts fail
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  baseBackoffMs: number,
  logger: Logger,
  abortSignal?: AbortSignal,
  stateMachine?: RelayOperationStateMachine,
  relayUrl?: RelayUrl
): Promise<T> {
  let lastError: unknown;
  let attempt = 0;

  initializeStateMachine(stateMachine, relayUrl);

  while (attempt < maxAttempts) {
    try {
      updateStateMachineForRetry(stateMachine, attempt);
      const result = await attemptOperation(operation, attempt, logger, abortSignal);
      updateStateMachineOnSuccess(stateMachine);
      return result;
    } catch (error) {
      lastError = error;
      attempt++;
      updateStateMachineOnFailure(stateMachine, attempt, maxAttempts, error);
      await handleRetry(error, attempt, maxAttempts, baseBackoffMs, logger, abortSignal);
    }
  }

  // All attempts failed
  throw lastError ?? new Error('Operation failed with unknown error');
}

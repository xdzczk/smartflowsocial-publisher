import type { Logger } from '../observability/logger';
import type { PublishPolicy } from '../policies/PublishPolicy';

import type { Relay, RelayConnection } from './Relay';
import type { RelayFailureReason, RelayResult, SignedEvent } from './types';

/**
 * Publishes an event to a single relay with timeout handling
 * Returns structured result with failure reason classification
 */
export async function publishToRelay(
  relay: Relay,
  event: SignedEvent,
  policy: PublishPolicy,
  logger: Logger
): Promise<RelayResult> {
  const startTime = Date.now();
  const relayUrl = relay.url;

  logger.info(`[${relayUrl}] Starting publish for event ${event.id}`);

  let connection: RelayConnection | null = null;

  try {
    // Set up connection timeout
    const connectionTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('CONNECTION_TIMEOUT'));
      }, policy.connectionTimeoutMs);
    });

    // Create connection
    logger.info(`[${relayUrl}] Creating connection`);
    const connectionPromise = relay.createConnection();
    connection = await Promise.race([connectionPromise, connectionTimeout]);

    logger.info(`[${relayUrl}] Connecting`);
    await Promise.race([connection.connect(), connectionTimeout]);

    logger.info(`[${relayUrl}] Connected, publishing event`);

    // Calculate remaining time for publish
    const elapsed = Date.now() - startTime;
    const remainingTime = policy.perRelayTimeoutMs - elapsed;

    if (remainingTime <= 0) {
      throw new Error('PUBLISH_TIMEOUT');
    }

    // Set up publish timeout
    const publishTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('PUBLISH_TIMEOUT'));
      }, remainingTime);
    });

    // Publish with timeout
    await Promise.race([connection.publish(event), publishTimeout]);

    const latencyMs = Date.now() - startTime;
    logger.info(`[${relayUrl}] Event published successfully in ${latencyMs}ms`);

    return {
      relay: relayUrl,
      status: 'success',
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const reason = classifyFailureReason(errorMessage);

    logger.error(`[${relayUrl}] Publish failed: ${errorMessage}`);

    return {
      relay: relayUrl,
      status: 'failure',
      reason,
      latencyMs,
      error: errorMessage,
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
 * Classifies error messages into structured failure reasons
 */
function classifyFailureReason(errorMessage: string): RelayFailureReason {
  if (errorMessage === 'CONNECTION_TIMEOUT') {
    return 'connection_timeout';
  }
  if (errorMessage === 'PUBLISH_TIMEOUT') {
    return 'publish_timeout';
  }
  if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
    return 'timeout';
  }
  if (errorMessage.includes('rejected') || errorMessage.includes('REJECTED')) {
    return 'rejected';
  }
  if (errorMessage.includes('invalid') || errorMessage.includes('INVALID')) {
    return 'invalid_event';
  }
  if (
    errorMessage.includes('unreachable') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ENOTFOUND')
  ) {
    return 'relay_unreachable';
  }
  return 'unknown';
}

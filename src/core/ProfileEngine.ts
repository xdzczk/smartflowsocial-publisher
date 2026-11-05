import type { Event } from 'nostr-tools';

import type { Logger } from '../observability/logger';
import type { ProfilePolicy } from '../policies/ProfilePolicy';

import { TimeoutError } from './errors';
import type { Relay } from './Relay';
import type { ProfileResult, RelayResult } from './types';

const OPERATION_ABORTED_MSG = 'Operation aborted';

/**
 * Fetches a profile event from a single relay
 * @param relay The relay to fetch from
 * @param pubkey The pubkey to fetch profile for
 * @param policy The profile policy with timeout settings
 * @param logger Logger instance
 * @param abortSignal Optional abort signal for cancellation
 * @returns The profile event
 * @throws {TimeoutError} if operation times out or is aborted
 */
async function fetchProfileFromRelay(
  relay: Relay,
  pubkey: string,
  policy: ProfilePolicy,
  logger: Logger,
  abortSignal?: AbortSignal
): Promise<{ event: Event; latencyMs: number }> {
  const relayUrl = relay.url;
  const startTime = Date.now();
  logger.info(`[${relayUrl}] Fetching profile for ${pubkey}`);

  const connection = await relay.createConnection();

  try {
    // Check if already aborted
    if (abortSignal?.aborted) {
      throw new TimeoutError(OPERATION_ABORTED_MSG, policy.perRelayTimeoutMs);
    }

    // Connect with timeout and abort signal support
    const connectTimeout = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError(`Timeout connecting to ${relayUrl}`, policy.perRelayTimeoutMs));
      }, policy.perRelayTimeoutMs);

      abortSignal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new TimeoutError(OPERATION_ABORTED_MSG, policy.perRelayTimeoutMs));
      });
    });

    await Promise.race([connection.connect(), connectTimeout]);
    logger.info(`[${relayUrl}] Connected`);

    // Wait for event with timeout
    return new Promise<{ event: Event; latencyMs: number }>((resolve, reject) => {
      let subscription: ReturnType<typeof connection.subscribe> | null = null;

      const eventTimeout = setTimeout(() => {
        if (subscription) {
          subscription.close();
        }
        connection.close();
        const latencyMs = Date.now() - startTime;
        reject(new TimeoutError(`Timeout waiting for profile event from ${relayUrl}`, latencyMs));
      }, policy.perRelayTimeoutMs);

      // Handle abort signal
      abortSignal?.addEventListener('abort', () => {
        clearTimeout(eventTimeout);
        if (subscription) {
          subscription.close();
        }
        connection.close();
        const abortLatencyMs = Date.now() - startTime;
        reject(new TimeoutError(OPERATION_ABORTED_MSG, abortLatencyMs));
      });

      // Subscribe to get the profile
      subscription = connection.subscribe([{ limit: 1, kinds: [0], authors: [pubkey] }], {
        onevent: (ev: Event) => {
          logger.info(`[${relayUrl}] Fetched profile for ${pubkey}`);
          clearTimeout(eventTimeout);
          if (subscription) {
            subscription.close();
          }
          connection.close();
          const latencyMs = Date.now() - startTime;
          resolve({ event: ev, latencyMs });
        },
        onclose: (reason: string) => {
          clearTimeout(eventTimeout);
          connection.close();
          reject(new Error(`Subscription closed: ${reason}`));
        },
      });
    });
  } catch (error) {
    connection.close();
    throw error;
  }
}

/**
 * Fetches a profile from multiple relays
 * Returns the first successful result
 * @param pubkey The pubkey to fetch profile for
 * @param relays Array of relays to try
 * @param policy The profile policy with timeout settings
 * @param logger Logger instance
 * @param abortSignal Optional abort signal for cancellation
 * @returns Profile result with event and per-relay results
 */
export async function fetchProfile(
  pubkey: string,
  relays: Relay[],
  policy: ProfilePolicy,
  logger: Logger,
  abortSignal?: AbortSignal
): Promise<ProfileResult> {
  if (relays.length === 0) {
    return {
      pubkey,
      event: null,
      relays: [],
    };
  }

  // Limit to maxRelays
  const limitedRelays = relays.slice(0, policy.maxRelays);

  logger.info(`Fetching profile for ${pubkey} from ${limitedRelays.length} relay(s)`);

  // Track results for all relays
  const relayResults: RelayResult[] = [];
  const relayPromises = limitedRelays.map(async (relay) => {
    const startTime = Date.now();
    try {
      const result = await fetchProfileFromRelay(relay, pubkey, policy, logger, abortSignal);
      relayResults.push({
        relay: relay.url,
        status: 'success',
        latencyMs: result.latencyMs,
      });
      return result.event;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      relayResults.push({
        relay: relay.url,
        status: 'failure',
        reason: error instanceof TimeoutError ? 'timeout' : 'unknown',
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

  // Try to fetch from any relay (Promise.any pattern)
  try {
    const event = await Promise.any(relayPromises);
    return {
      pubkey,
      event,
      relays: relayResults,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to fetch profile for ${pubkey} from all relays: ${errorMessage}`);
    return {
      pubkey,
      event: null,
      relays: relayResults,
    };
  }
}

import type { Event } from 'nostr-tools';

import type { Logger } from '../observability/logger';
import type { ProfilePolicy } from '../policies/ProfilePolicy';

import type { Relay } from './Relay';
import type { ProfileResult } from './types';

/**
 * Fetches a profile event from a single relay
 */
async function fetchProfileFromRelay(
  relay: Relay,
  pubkey: string,
  policy: ProfilePolicy,
  logger: Logger
): Promise<Event> {
  const relayUrl = relay.url;
  logger.info(`[${relayUrl}] Fetching profile for ${pubkey}`);

  const connection = await relay.createConnection();

  try {
    // Connect with timeout
    const connectTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout connecting to ${relayUrl}`));
      }, policy.perRelayTimeoutMs);
    });

    await Promise.race([connection.connect(), connectTimeout]);
    logger.info(`[${relayUrl}] Connected`);

    // Wait for event with timeout
    return new Promise<Event>((resolve, reject) => {
      let subscription: ReturnType<typeof connection.subscribe> | null = null;

      const eventTimeout = setTimeout(() => {
        if (subscription) {
          subscription.close();
        }
        connection.close();
        reject(new Error(`Timeout waiting for profile event from ${relayUrl}`));
      }, policy.perRelayTimeoutMs);

      // Subscribe to get the profile
      subscription = connection.subscribe(
        [{ limit: 1, kinds: [0], authors: [pubkey] }],
        {
          onevent: (ev: Event) => {
            logger.info(`[${relayUrl}] Fetched profile for ${pubkey}`);
            clearTimeout(eventTimeout);
            if (subscription) {
              subscription.close();
            }
            connection.close();
            resolve(ev);
          },
          onclose: (reason: string) => {
            clearTimeout(eventTimeout);
            connection.close();
            reject(new Error(`Subscription closed: ${reason}`));
          },
        }
      );
    });
  } catch (error) {
    connection.close();
    throw error;
  }
}

/**
 * Fetches a profile from multiple relays
 * Returns the first successful result
 */
export async function fetchProfile(
  pubkey: string,
  relays: Relay[],
  policy: ProfilePolicy,
  logger: Logger
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

  // Try to fetch from any relay (Promise.any pattern)
  const fetchPromises = limitedRelays.map((relay) =>
    fetchProfileFromRelay(relay, pubkey, policy, logger)
  );

  try {
    const event = await Promise.any(fetchPromises);
    return {
      pubkey,
      event,
      relays: limitedRelays.map((relay) => ({
        relay: relay.url,
        status: 'success' as const,
        latencyMs: 0, // Could track this if needed
      })),
    };
  } catch (error) {
    logger.error(`Failed to fetch profile for ${pubkey} from all relays: ${error}`);
    return {
      pubkey,
      event: null,
      relays: limitedRelays.map((relay) => ({
        relay: relay.url,
        status: 'failure' as const,
        reason: 'unknown' as const,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      })),
    };
  }
}

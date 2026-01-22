import type { Request, ExecutionContext } from '@cloudflare/workers-types';
import { Relay } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import type { Env, PublishRequest, RelayPublishResult, PublishResponse, ErrorResponse } from './types';
import { normalizeRelays } from './utils';

// Check if WebSocket is available and log for debugging
if (typeof WebSocket === 'undefined') {
  console.warn('WebSocket is not available in this environment');
} else {
  console.info('WebSocket is available:', typeof WebSocket);
}

const PER_RELAY_TIMEOUT_MS = 10000; // Increased to 10s to allow for connection establishment
const CONNECTION_TIMEOUT_MS = 5000; // Timeout for initial connection
const OVERALL_TIMEOUT_MS = 15000; // Increased overall timeout to 15s
const MAX_CONCURRENT = 8;

/**
 * Validates that an event has the required fields
 */
const validateEvent = (event: unknown): event is Event => {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const e = event as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.pubkey === 'string' &&
    typeof e.kind === 'number' &&
    typeof e.sig === 'string'
  );
};

/**
 * Sets up event handlers for a relay connection
 */
const setupRelayHandlers = (
  relay: Relay,
  relayUrl: string,
  event: Event,
  eventId: string,
  connected: { value: boolean },
  connectionTimeoutId: { value: ReturnType<typeof setTimeout> | null },
  // eslint-disable-next-line no-unused-vars
  finish: (ok: boolean, error?: string) => void
): void => {
    relay.on('connect', () => {
      console.info(`[${relayUrl}] 'connect' event fired`);
      connected.value = true;
      if (connectionTimeoutId.value) {
        clearTimeout(connectionTimeoutId.value);
        connectionTimeoutId.value = null;
      }
      console.info(`[${relayUrl}] Sending ${eventId} to relay`);
      try {
        const pub = relay.publish(event);
        pub.on('ok', () => {
          console.info(`[${relayUrl}] Event ${eventId} published successfully`);
          finish(true);
        });
        pub.on('failed', (reason?: string) => {
          console.warn(`[${relayUrl}] Failed to publish ${eventId}: ${reason}`);
          finish(false, reason ?? 'RELAY_REJECTED');
        });
      } catch (error) {
        console.error(`[${relayUrl}] Error calling relay.publish():`, error);
        finish(false, `PUBLISH_ERROR: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  relay.on('error', (msg: unknown) => {
    console.error(`Failed to connect to ${relayUrl}`, JSON.stringify(msg));
    finish(false, `CONNECTION_ERROR: ${JSON.stringify(msg)}`);
  });

  relay.on('disconnect', () => {
    if (!connected.value) {
      console.warn(`Disconnected from ${relayUrl} before connection established`);
      finish(false, 'DISCONNECTED');
    }
  });
};

/**
 * Publishes an event to a single relay and returns the result
 */
const publishToRelay = async (
  relayUrl: string,
  event: Event,
  eventId: string
): Promise<RelayPublishResult> => {
  const startTime = Date.now();
  let resolved = false;

  return new Promise<RelayPublishResult>((resolve) => {
    console.info(`[${relayUrl}] Creating Relay instance`);
    let relay: Relay;
    try {
      relay = new Relay(relayUrl);
      console.info(`[${relayUrl}] Relay instance created`);
    } catch (error) {
      console.error(`[${relayUrl}] Failed to create Relay instance:`, error);
      const latencyMs = Date.now() - startTime;
      resolve({
        relay: relayUrl,
        ok: false,
        latencyMs,
        error: `RELAY_INIT_ERROR: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const connectionTimeoutId = { value: null as ReturnType<typeof setTimeout> | null };
    const connected = { value: false };

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (connectionTimeoutId.value) {
        clearTimeout(connectionTimeoutId.value);
        connectionTimeoutId.value = null;
      }
      try {
        relay.close();
      } catch {
        // Ignore errors during cleanup
      }
    };

    const finish = (ok: boolean, error?: string) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      const latencyMs = Date.now() - startTime;
      resolve({
        relay: relayUrl,
        ok,
        latencyMs,
        error,
      });
    };

    // Overall timeout for the entire operation
    timeoutId = setTimeout(() => {
      console.warn(`[${relayUrl}] Overall timeout reached after ${PER_RELAY_TIMEOUT_MS}ms`);
      finish(false, 'TIMEOUT');
    }, PER_RELAY_TIMEOUT_MS);

    // Connection timeout - if we don't connect within this time, fail
    connectionTimeoutId.value = setTimeout(() => {
      if (!connected.value) {
        console.error(`Connection timeout: failed to connect to ${relayUrl} within ${CONNECTION_TIMEOUT_MS}ms`);
        finish(false, 'CONNECTION_TIMEOUT');
      }
    }, CONNECTION_TIMEOUT_MS);

    setupRelayHandlers(relay, relayUrl, event, eventId, connected, connectionTimeoutId, finish);

    // Handle connect() promise rejection
    console.info(`[${relayUrl}] About to call relay.connect()`);
    try {
      console.info(`[${relayUrl}] Calling relay.connect()`);
      const connectPromise = relay.connect();
      console.info(`[${relayUrl}] relay.connect() returned, type: ${typeof connectPromise}`);
      
      // We can't use await here since we're in a Promise constructor
      // eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
      connectPromise.catch((error: unknown) => {
        console.error(`[${relayUrl}] relay.connect() rejected:`, error);
        finish(false, `CONNECTION_ERROR: ${error instanceof Error ? error.message : String(error)}`);
      });
    } catch (error) {
      // Catch synchronous errors
      console.error(`[${relayUrl}] Synchronous error calling relay.connect():`, error);
      finish(false, `CONNECTION_ERROR_SYNC: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
};

/**
 * Limits concurrency of async operations
 */
const limitConcurrency = async <T>(
  items: T[],
  limit: number,
  // eslint-disable-next-line no-unused-vars -- Parameter name in function type is for documentation only
  fn: (_item: T) => Promise<RelayPublishResult>
): Promise<RelayPublishResult[]> => {
  const results: RelayPublishResult[] = [];
  const executing: Array<Promise<void>> = [];

  console.info(`limitConcurrency: START - processing ${items.length} items with limit ${limit}, items:`, items);
  
  if (items.length === 0) {
    console.warn(`limitConcurrency: items array is empty!`);
    return [];
  }
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.info(`limitConcurrency: LOOP START - item ${i + 1}/${items.length}, executing: ${executing.length}, item:`, item);
    
    // Wait if we're at the limit
    if (executing.length >= limit) {
      console.info(`limitConcurrency: at limit ${limit}, waiting for one to complete`);
      await Promise.race(executing);
      console.info(`limitConcurrency: after race, executing: ${executing.length}`);
    }

    // Start the operation
    console.info(`limitConcurrency: calling fn for item ${i + 1}`);
    let operationPromise: Promise<RelayPublishResult>;
    try {
      operationPromise = fn(item);
      console.info(`limitConcurrency: fn returned promise for item ${i + 1}, type: ${typeof operationPromise}`);
    } catch (error) {
      console.error(`limitConcurrency: fn threw synchronously for item ${i + 1}:`, error);
      // Create a rejected promise to maintain consistency
      operationPromise = Promise.reject(error);
    }
    
    const promise = (async () => {
      try {
        console.info(`limitConcurrency: awaiting result for item ${i + 1}`);
        const result = await operationPromise;
        console.info(`limitConcurrency: got result for item ${i + 1}:`, JSON.stringify(result));
        results.push(result);
        console.info(`limitConcurrency: result added, results count: ${results.length}`);
      } catch (error) {
        console.error(`limitConcurrency: error awaiting result for item ${i + 1}:`, error);
        // Create a default error result
        const errorResult: RelayPublishResult = {
          relay: String(item),
          ok: false,
          latencyMs: 0,
          error: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
        };
        results.push(errorResult);
        console.info(`limitConcurrency: error result added, results count: ${results.length}`);
      }
    })();

    executing.push(promise);
    console.info(`limitConcurrency: promise added to executing, executing count: ${executing.length}`);
  }

  // Wait for all remaining operations
  console.info(`limitConcurrency: END LOOP - waiting for all ${executing.length} operations to complete`);
  await Promise.all(executing);
  console.info(`limitConcurrency: all operations completed, returning ${results.length} results`);
  return results;
};

/**
 * Validates and parses the request body
 */
const parseAndValidateRequest = async (request: Request): Promise<{ event: Event; relayUrls: string[] } | ErrorResponse> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: 'Invalid JSON body' };
  }

  // Validate body structure
  if (
    !body ||
    typeof body !== 'object' ||
    !('relays' in body) ||
    !Array.isArray((body as { relays: unknown }).relays) ||
    !('event' in body) ||
    !(body as { event: unknown }).event
  ) {
    return { error: 'Invalid request: relays must be an array and event must be an object' };
  }

  const publishRequest = body as PublishRequest;
  const event = publishRequest.event;

  // Validate event has required fields
  if (!validateEvent(event)) {
    return { error: 'Invalid event: must have id, pubkey, kind, and sig fields' };
  }

  // Normalize relays
  let relayUrls: string[];
  try {
    relayUrls = normalizeRelays(publishRequest.relays);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid relays array',
    };
  }

  if (relayUrls.length === 0) {
    return { error: 'No valid relays after normalization' };
  }

  return { event, relayUrls };
};

export const publishEvent = async (
  request: Request,
  // eslint-disable-next-line no-unused-vars
  _env: Env,
  // eslint-disable-next-line no-unused-vars
  _ctx: ExecutionContext
): Promise<Response> => {
  // Parse and validate request
  const validationResult = await parseAndValidateRequest(request);
  if ('error' in validationResult) {
    return new Response(JSON.stringify(validationResult), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { event, relayUrls } = validationResult;

  const eventId = event.id;
  console.info(`Processing ${eventId} to ${relayUrls.length} relay(s)`);

  const startTime = Date.now();
  const completedRelays = new Set<string>();
  let results: RelayPublishResult[] = [];

  // Publish to all relays with concurrency limit
  const publishPromise = (async () => {
    console.info(`[${eventId}] Starting limitConcurrency with ${relayUrls.length} relays`);
    try {
      const publishResults = await limitConcurrency(relayUrls, MAX_CONCURRENT, (relayUrl) =>
        publishToRelay(relayUrl, event, eventId)
      );
      console.info(`[${eventId}] limitConcurrency completed with ${publishResults.length} results`);
      results = publishResults;
      for (const result of publishResults) {
        completedRelays.add(result.relay);
      }
    } catch (error) {
      console.error(`[${eventId}] Error in limitConcurrency:`, error);
      throw error;
    }
  })();

  // Set up overall timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, OVERALL_TIMEOUT_MS);
  });

  // Race between publishing and overall timeout
  console.info(`[${eventId}] Starting Promise.race with timeout ${OVERALL_TIMEOUT_MS}ms`);
  try {
    const raceResult = await Promise.race([publishPromise, timeoutPromise]);
    console.info(`[${eventId}] Promise.race completed, result:`, raceResult);
  } catch (error) {
    console.error(`[${eventId}] Error during publish promise:`, error);
    // Continue to return results even if there was an error
  }
  console.info(`[${eventId}] After Promise.race, elapsed: ${Date.now() - startTime}ms, results count: ${results.length}`);

  // If overall timeout hit, mark remaining relays as TIMEOUT
  const elapsed = Date.now() - startTime;
  for (const relayUrl of relayUrls) {
    if (!completedRelays.has(relayUrl)) {
      results.push({
        relay: relayUrl,
        ok: false,
        latencyMs: Math.min(elapsed, OVERALL_TIMEOUT_MS),
        error: 'TIMEOUT',
      });
    }
  }

  // Ensure we have results for all relays
  if (results.length !== relayUrls.length) {
    console.warn(`Expected ${relayUrls.length} results but got ${results.length}`);
    // Add missing results
    for (const relayUrl of relayUrls) {
      if (!results.some((r) => r.relay === relayUrl)) {
        results.push({
          relay: relayUrl,
          ok: false,
          latencyMs: elapsed,
          error: 'TIMEOUT',
        });
      }
    }
  }

  // Sort results to match input order
  const relayIndexMap = new Map(relayUrls.map((url, index) => [url, index]));
  results.sort((a, b) => {
    const indexA = relayIndexMap.get(a.relay) ?? Infinity;
    const indexB = relayIndexMap.get(b.relay) ?? Infinity;
    return indexA - indexB;
  });

  const response: PublishResponse = { results };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

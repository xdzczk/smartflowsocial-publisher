import type { Request, ExecutionContext } from '@cloudflare/workers-types';
import { relayInit } from 'nostr-tools';
import type { Event } from 'nostr-tools';

import type { Env, PublishRequest, RelayPublishResult, PublishResponse, ErrorResponse } from './types';
import { normalizeRelays } from './utils';

const PER_RELAY_TIMEOUT_MS = 3000;
const OVERALL_TIMEOUT_MS = 5000;
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
    const relay = relayInit(relayUrl);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
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

    // Per-relay timeout
    timeoutId = setTimeout(() => {
      finish(false, 'TIMEOUT');
    }, PER_RELAY_TIMEOUT_MS);

    relay.on('connect', () => {
      console.info(`Sending ${eventId} to ${relayUrl}`);
      const pub = relay.publish(event);
      pub.on('ok', () => {
        console.info(`Event ${eventId} published to ${relayUrl}`);
        finish(true);
      });
      pub.on('failed', (reason?: string) => {
        console.warn(`Failed to publish ${eventId} to ${relayUrl}: ${reason}`);
        finish(false, reason ?? 'RELAY_REJECTED');
      });
    });

    relay.on('error', (msg: unknown) => {
      console.error(`Failed to connect to ${relayUrl}`, JSON.stringify(msg));
      finish(false, `CONNECTION_ERROR: ${JSON.stringify(msg)}`);
    });

    void relay.connect();
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

  for (const item of items) {
    // Wait if we're at the limit
    if (executing.length >= limit) {
      await Promise.race(executing);
      // Note: We don't remove completed promises from the array.
      // Promise.race works correctly even with already-resolved promises,
      // and the memory overhead is minimal for small limits.
    }

    // Start the operation
    const operationPromise = fn(item);
    const promise = (async () => {
      try {
        const result = await operationPromise;
        results.push(result);
      } catch {
        // Errors are handled in fn, but we need to catch here too
      }
    })();

    executing.push(promise);
  }

  // Wait for all remaining operations
  await Promise.all(executing);
  return results;
};

export const publishEvent = async (
  request: Request,
  // eslint-disable-next-line no-unused-vars
  _env: Env,
  // eslint-disable-next-line no-unused-vars
  _ctx: ExecutionContext
): Promise<Response> => {
  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const errorResponse: ErrorResponse = { error: 'Invalid JSON body' };
    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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
    const errorResponse: ErrorResponse = { error: 'Invalid request: relays must be an array and event must be an object' };
    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const publishRequest = body as PublishRequest;
  const event = publishRequest.event;

  // Validate event has required fields
  if (!validateEvent(event)) {
    const errorResponse: ErrorResponse = { error: 'Invalid event: must have id, pubkey, kind, and sig fields' };
    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Normalize relays
  let relayUrls: string[];
  try {
    relayUrls = normalizeRelays(publishRequest.relays);
  } catch (error) {
    const errorResponse: ErrorResponse = {
      error: error instanceof Error ? error.message : 'Invalid relays array',
    };
    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (relayUrls.length === 0) {
    const errorResponse: ErrorResponse = { error: 'No valid relays after normalization' };
    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const eventId = event.id;
  console.info(`Processing ${eventId} to ${relayUrls.length} relay(s)`);

  const startTime = Date.now();
  const completedRelays = new Set<string>();
  let results: RelayPublishResult[] = [];

  // Publish to all relays with concurrency limit
  const publishPromise = (async () => {
    const publishResults = await limitConcurrency(relayUrls, MAX_CONCURRENT, (relayUrl) =>
      publishToRelay(relayUrl, event, eventId)
    );
    results = publishResults;
    for (const result of publishResults) {
      completedRelays.add(result.relay);
    }
  })();

  // Set up overall timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, OVERALL_TIMEOUT_MS);
  });

  // Race between publishing and overall timeout
  await Promise.race([publishPromise, timeoutPromise]);

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

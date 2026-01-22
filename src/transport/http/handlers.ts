import type { ExecutionContext, Request } from '@cloudflare/workers-types';

import { NostrRelayAdapter } from '../../adapters/nostr/relayAdapter';
import { fetchProfile } from '../../core/ProfileEngine';
import { publishSignedEvent } from '../../core/PublishEngine';
import { normalizeRelayUrls } from '../../core/RelayUrl';
import type { SignedEvent } from '../../core/types';
import { ConsoleLogger } from '../../observability/logger';
import { aggressivePolicy } from '../../policies/aggressivePolicy';
import { conservativePolicy } from '../../policies/conservativePolicy';
import { defaultPolicy } from '../../policies/defaultPolicy';
import { defaultProfilePolicy } from '../../policies/ProfilePolicy';
import type { Env } from '../../types';

import {
  mapErrorToResponse,
  mapPublishOutcomeToResponse,
  parsePublishRequest,
} from './mappers';

const HOUR = 60 * 60;

/**
 * Selects a publish policy based on query parameter
 */
function selectPolicy(queryParams: URLSearchParams) {
  const policyName = queryParams.get('policy');
  switch (policyName) {
    case 'conservative':
      return conservativePolicy;
    case 'aggressive':
      return aggressivePolicy;
    default:
      return defaultPolicy;
  }
}

/**
 * HTTP handler for publishing events
 */
export async function publishHandler(
  request: Request,
  _env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  // Parameters kept for API compatibility
  void _env;
  void _ctx;
  const logger = new ConsoleLogger();

  try {
    // Parse request body
    const body = await request.json();
    const { event, relayUrls } = parsePublishRequest(body);

    // Select policy from query params
    const url = new URL(request.url);
    const policy = selectPolicy(url.searchParams);

    // Create relay adapters
    const relays = relayUrls.map((url) => new NostrRelayAdapter(url));

    // Publish using core engine
    const outcome = await publishSignedEvent(
      event as SignedEvent,
      relays,
      policy,
      logger
    );

    // Map outcome to HTTP response
    const response = mapPublishOutcomeToResponse(outcome);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Error in publishHandler:', error);
    const errorResponse = mapErrorToResponse(error);
    return new Response(JSON.stringify(errorResponse), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * HTTP handler for fetching profiles
 */
export async function profileHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const logger = new ConsoleLogger();

  try {
    // Parse request body
    const body = await request.json();

    if (
      !body ||
      typeof body !== 'object' ||
      !('relays' in body) ||
      !Array.isArray((body as { relays: unknown }).relays) ||
      !('pubkey' in body)
    ) {
      return new Response('INVALID_REQUEST', { status: 422 });
    }

    const profileRequest = body as { relays: string[]; pubkey: string };
    const relayUrls = normalizeRelayUrls(profileRequest.relays);
    const pubkey = profileRequest.pubkey;

    if (relayUrls.length === 0 || !pubkey) {
      return new Response('INVALID_REQUEST', { status: 422 });
    }

    // Normalize pubkey (handle bech32)
    // Import normalizeToHex from utils (will be moved later)
    const { normalizeToHex } = await import('../../utils');
    const normalizedPubkey = normalizeToHex(pubkey);

    if (!normalizedPubkey) {
      return new Response('INVALID_REQUEST', { status: 422 });
    }

    // Cache functions
    const setCache = (key: string, data: string): Promise<void> => {
      return env.PROFILES.put(key, data, {
        metadata: { createdAt: Date.now() },
        expirationTtl: 7 * 24 * HOUR,
      });
    };

    const getCache = async (key: string): Promise<{
      value: string | null;
      metadata: { createdAt: number } | null;
    }> => {
      return await env.PROFILES.getWithMetadata(key);
    };

    // Check cache first
    const cacheResult = await getCache(normalizedPubkey);
    if (cacheResult.value) {
      const { value, metadata } = cacheResult;

      // Refresh in background if stale (older than 3 hours)
      if (!metadata || metadata.createdAt + 3 * HOUR * 1000 < Date.now()) {
        ctx.waitUntil(
          (async () => {
            try {
              const relays = relayUrls.map((url) => new NostrRelayAdapter(url));
              const result = await fetchProfile(
                normalizedPubkey,
                relays,
                defaultProfilePolicy,
                logger
              );
              if (result.event) {
                await setCache(normalizedPubkey, JSON.stringify(result.event));
              }
            } catch (e) {
              logger.error(`Failed to refresh profile for ${normalizedPubkey}:`, e);
            }
          })()
        );
      }

      return new Response(value, {
        status: 200,
        headers: {
          'content-type': 'application/json;charset=UTF-8',
        },
      });
    }

    // Not in cache - fetch asynchronously
    ctx.waitUntil(
      (async () => {
        try {
          const relays = relayUrls.map((url) => new NostrRelayAdapter(url));
          const result = await fetchProfile(
            normalizedPubkey,
            relays,
            defaultProfilePolicy,
            logger
          );
          if (result.event) {
            await setCache(normalizedPubkey, JSON.stringify(result.event));
          }
        } catch (e) {
          logger.error(`Failed to fetch profile for ${normalizedPubkey}:`, e);
        }
      })()
    );

    return new Response(null, {
      status: 202,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    });
  } catch (error) {
    logger.error('Error in profileHandler:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

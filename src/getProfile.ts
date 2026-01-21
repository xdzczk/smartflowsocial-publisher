import type { Request, ExecutionContext } from '@cloudflare/workers-types';
import { fetchProfiles, normalizeToHex, cleanURLs } from './utils';
import type { Env, ProfileRequest, CacheMetadata } from './types';

const HOUR = 60 * 60;

export const getProfile = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch (e) {
    return new Response('INVALID_REQUEST', { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('relays' in body) || !Array.isArray((body as ProfileRequest).relays)) {
    return new Response('INVALID_REQUEST', { status: 422 });
  }

  const profileRequest = body as ProfileRequest;
  const relayUrls = cleanURLs(profileRequest.relays);
  const pubkey = normalizeToHex(profileRequest.pubkey);

  if (!relayUrls || relayUrls.length === 0 || !pubkey) {
    return new Response('INVALID_REQUEST', { status: 422 });
  }

  const setCache = (key: string, data: string): Promise<void> => {
    return env.PROFILES.put(key, data, {
      metadata: { createdAt: Date.now() },
      // key expires after 7 days
      expirationTtl: 7 * 24 * HOUR
    });
  };

  const getCache = async (key: string): Promise<{ value: string | null; metadata: CacheMetadata | null }> => {
    return await env.PROFILES.getWithMetadata(key);
  };

  const fetchAndCache = async (pubkey: string, relayUrls: string[]): Promise<void | null> => {
    try {
      const result = await Promise.any(fetchProfiles(pubkey, relayUrls));
      return await setCache(pubkey, JSON.stringify(result));
    } catch (e) {
      console.error(`Failed to fetch profile for ${pubkey} from all relays:`, e);
      return null;
    }
  };

  const cacheResult = await getCache(pubkey);
  if (!cacheResult || !cacheResult.value) {
    ctx.waitUntil(fetchAndCache(pubkey, relayUrls));
    return new Response(null, {
      status: 202,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      }
    });
  }

  const { value, metadata } = cacheResult;

  if (!metadata || metadata.createdAt + 3 * HOUR * 1000 < Date.now()) {
    ctx.waitUntil(fetchAndCache(pubkey, relayUrls));
  }

  return new Response(value, {
    status: (value ? 200 : 202),
    headers: {
      'content-type': 'application/json;charset=UTF-8',
    }
  });
};
